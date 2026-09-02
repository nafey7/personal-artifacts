import { artifacts, projects, toObjectId } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { readExpiry, readPassphrase, shareSummary } from "@/lib/share";
import { TRASH_DAYS, trashSummary } from "@/lib/trash";

export const dynamic = "force-dynamic";

// The path segment is a slug or an id — the CLI knows slugs, the dashboard
// ids — and either way it only ever matches the caller's own artifacts.
function ownedBy(user, key) {
  const _id = toObjectId(key);
  return {
    userId: user.id,
    $or: _id ? [{ _id }, { slug: key }] : [{ slug: key }],
  };
}

// Reads one artifact back, HTML included. Session or API token. The path
// segment is a slug or an id — the CLI hands out slugs, the dashboard ids.
//
// By default the answer is JSON with the HTML in a field. `?format=html`
// returns the HTML alone, but as text/plain with a download disposition: this
// site never serves an artifact's markup same-origin, or the page could run
// with the dashboard's cookies. The rendered page lives at /a/<slug>.
export async function GET(request, { params }) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const { id } = await params;
  const col = await artifacts();
  const doc = await col.findOne(ownedBy(user, String(id).trim()));
  // Same answer whether the slug is unknown or someone else's.
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });

  const url = new URL(request.url);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };

  if (url.searchParams.get("format") === "html") {
    return new Response(doc.html, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${doc.slug}.html"`,
      },
    });
  }

  const projectId = doc.projectId ? toObjectId(doc.projectId) : null;
  const project = projectId
    ? await (await projects()).findOne({ _id: projectId, userId: user.id })
    : null;

  return Response.json(
    {
      artifact: {
        id: doc._id.toString(),
        slug: doc.slug,
        title: doc.title,
        url: `${url.origin}/a/${doc.slug}`,
        project: project ? { id: project._id.toString(), name: project.name, slug: project.slug } : null,
        visibility: doc.visibility === "public" ? "public" : "private",
        // isPublic, expiresAt, isExpired, hasPassphrase — never the hash.
        ...shareSummary(doc),
        // A trashed artifact still reads back for its owner — that is what
        // makes "restore it or copy it out" possible — but it says so.
        ...trashSummary(doc),
        bytes: doc.bytes ?? Buffer.byteLength(doc.html, "utf8"),
        createdAt: new Date(doc.createdAt).toISOString(),
        updatedAt: new Date(doc.updatedAt || doc.createdAt).toISOString(),
        html: doc.html,
      },
    },
    { headers }
  );
}

export async function PATCH(request, { params }) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const { id } = await params;
  const filter = ownedBy(user, String(id).trim());

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const col = await artifacts();
  const existing = await col.findOne(filter, { projection: { html: 0 } });
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });

  // Lifting an artifact back out of the trash. On its own — everything else
  // in the body is ignored — so a restore can never also change what is being
  // restored. The project it was filed under may have been deleted meanwhile;
  // it comes back Unfiled in that case rather than into a folder that is gone.
  if (body.restore === true) {
    if (!existing.deletedAt) {
      return Response.json({ error: "that artifact is not in the trash" }, { status: 409 });
    }
    const stillThere =
      existing.projectId &&
      (await (await projects()).findOne({
        _id: toObjectId(existing.projectId),
        userId: user.id,
      }));

    const restored = await col.findOneAndUpdate(
      filter,
      {
        $set: {
          deletedAt: null,
          projectId: stillThere ? existing.projectId : null,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after", projection: { html: 0 } }
    );
    return Response.json({
      restored: true,
      artifact: {
        id: restored._id.toString(),
        slug: restored.slug,
        title: restored.title,
        projectId: restored.projectId ?? null,
        ...shareSummary(restored),
      },
    });
  }

  // Anything else has to wait until it is out of the trash: a page nobody can
  // open should not be quietly re-shared or re-filed.
  if (existing.deletedAt) {
    return Response.json(
      { error: "that artifact is in the trash — restore it first" },
      { status: 409 }
    );
  }

  const set = {};

  if ("title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return Response.json({ error: "title is required" }, { status: 400 });
    set.title = title;
  }

  if ("projectId" in body) {
    const raw = body.projectId;
    if (raw === null || raw === "") {
      set.projectId = null;
    } else {
      const projectId = toObjectId(raw);
      if (!projectId) return Response.json({ error: "unknown project" }, { status: 400 });
      // Only the caller's own projects are valid destinations.
      const project = await (await projects()).findOne({ _id: projectId, userId: user.id });
      if (!project) return Response.json({ error: "unknown project" }, { status: 400 });
      set.projectId = projectId.toString();
    }
  }

  if ("visibility" in body) {
    const visibility = body.visibility;
    if (visibility !== "private" && visibility !== "public") {
      return Response.json({ error: "visibility must be private or public" }, { status: 400 });
    }
    set.visibility = visibility;
  }

  // Share options: an expiry (`expiresIn: "7d"` or `expiresAt: <ISO>`) and a
  // passphrase. Either one, when set to a real value, only makes sense on a
  // shared link, so it implies visibility: "public" unless the body says
  // otherwise. Clearing one (null) implies nothing.
  const expiry = readExpiry(body);
  if (expiry.present) {
    if (expiry.error) return Response.json({ error: expiry.error }, { status: 400 });
    set.shareExpiresAt = expiry.value;
  }

  const pass = readPassphrase(body);
  if (pass.present) {
    if (pass.error) return Response.json({ error: pass.error }, { status: 400 });
    set.sharePassHash = pass.value ? await hashPassword(pass.value) : null;
  }

  const restricting = Boolean(set.shareExpiresAt || set.sharePassHash);
  if (restricting && !("visibility" in body)) set.visibility = "public";

  // Going private closes the link outright, so the options attached to it go
  // too. Sharing again starts from a clean slate rather than resurrecting a
  // passphrase the owner may have forgotten was there.
  if (set.visibility === "private") {
    if (restricting) {
      return Response.json(
        { error: "a private artifact cannot carry an expiry or passphrase — share it first" },
        { status: 400 }
      );
    }
    set.shareExpiresAt = null;
    set.sharePassHash = null;
  }

  if (Object.keys(set).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const result = await col.findOneAndUpdate(
    { ...filter, deletedAt: null },
    { $set: { ...set, updatedAt: new Date() } },
    { returnDocument: "after", projection: { html: 0 } }
  );
  if (!result) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({
    artifact: {
      id: result._id.toString(),
      slug: result.slug,
      title: result.title,
      projectId: result.projectId ?? null,
      ...shareSummary(result),
    },
  });
}

// Deleting moves the artifact to the trash, where it sits for TRASH_DAYS
// before Mongo removes it. The link stops opening straight away, so a page
// shared by mistake is closed the moment the owner asks — the recovery window
// is for the owner, not for whoever held the link.
//
// `?permanent=1` removes it outright, and only works on something already in
// the trash: the one-click path can never destroy anything.
export async function DELETE(request, { params }) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const { id } = await params;
  const filter = ownedBy(user, String(id).trim());

  const permanent = ["1", "true", "yes"].includes(
    (new URL(request.url).searchParams.get("permanent") || "").toLowerCase()
  );
  const col = await artifacts();

  if (permanent) {
    const { deletedCount } = await col.deleteOne({ ...filter, deletedAt: { $ne: null } });
    if (!deletedCount) {
      // Either it is not theirs, or it is still live — say which, since the
      // caller owning it is already established by the softer branch below.
      const live = await col.findOne(filter, { projection: { _id: 1 } });
      if (live) {
        return Response.json(
          { error: "that artifact is not in the trash — delete it first" },
          { status: 409 }
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json({ deleted: true, permanent: true });
  }

  const deletedAt = new Date();
  const result = await col.findOneAndUpdate(
    { ...filter, deletedAt: null },
    { $set: { deletedAt } },
    { returnDocument: "after", projection: { html: 0 } }
  );
  if (!result) {
    const already = await col.findOne(filter, { projection: { deletedAt: 1 } });
    if (already) return Response.json({ error: "already in the trash" }, { status: 409 });
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({
    deleted: true,
    artifact: { id: result._id.toString(), slug: result.slug, title: result.title },
    ...trashSummary(result),
    note: `moved to the trash — restore it within ${TRASH_DAYS} days at /trash, after which it is removed for good`,
  });
}
