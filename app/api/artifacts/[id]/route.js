import { artifacts, projects, toObjectId } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { readExpiry, readPassphrase, shareSummary } from "@/lib/share";

export const dynamic = "force-dynamic";

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
  const key = String(id).trim();
  const _id = toObjectId(key);
  const col = await artifacts();
  const doc = await col.findOne({
    userId: user.id,
    $or: _id ? [{ _id }, { slug: key }] : [{ slug: key }],
  });
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
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return Response.json({ error: "not found" }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
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

  const col = await artifacts();
  const result = await col.findOneAndUpdate(
    { _id, userId: user.id },
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

export async function DELETE(_request, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return Response.json({ error: "not found" }, { status: 404 });

  const col = await artifacts();
  const { deletedCount } = await col.deleteOne({ _id, userId: user.id });
  if (!deletedCount) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ deleted: true });
}
