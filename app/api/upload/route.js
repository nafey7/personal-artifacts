import { artifacts } from "@/lib/mongo";
import { ownerOfToken } from "@/lib/tokens";
import { slugify } from "@/lib/slug";
import { findProject, listProjects, createProject, publicProject } from "@/lib/projects";
import { MAX_BYTES, MAX_PER_USER } from "@/lib/limits";
import { hashPassword } from "@/lib/auth";
import { readExpiry, readPassphrase, shareSummary } from "@/lib/share";
import { stamp } from "@/lib/data";
import { LIVE } from "@/lib/trash";

export const dynamic = "force-dynamic";

// Said in the response itself, not just in the docs. A caller that publishes
// and then fetches its own URL without a credential gets a 404 by design; the
// only way that reads as intended rather than as an outage is if the upload
// that produced the URL already said what to expect.
function noteFor(share, origin) {
  if (!share.isPublic) {
    return `private — it opens for you in a browser you are signed in to, or with this same API token as an Authorization: Bearer header. Fetching it without either returns 404, which is expected and not an error. Share it from ${origin}/ to get a link anyone can open.`;
  }

  const who = share.hasPassphrase
    ? "anyone with this link and the passphrase can open it; the page asks for the passphrase first"
    : "anyone with this link can open it";
  const until = share.expiresAt
    ? ` until ${stamp(share.expiresAt)} UTC, after which the link goes private again`
    : "";
  return `public — ${who}${until}. Mark it Private in your dashboard to close it sooner.`;
}

// The response for a saved artifact. `share` is isPublic, expiresAt,
// isExpired and hasPassphrase — never the passphrase or its hash.
function reply(doc, origin, { updated, project, status }) {
  const share = shareSummary(doc);
  return Response.json(
    {
      slug: doc.slug,
      url: `${origin}/a/${doc.slug}`,
      updated,
      project,
      visibility: doc.visibility,
      ...share,
      note: noteFor(share, origin),
      manageUrl: `${origin}/`,
    },
    { status }
  );
}

export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!presented) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Every token resolves to an owner. The shared deployment-wide secret that
  // used to stand in for one is gone: signup is open now, so a credential with
  // nobody's name on it is no longer something to tolerate.
  const userId = await ownerOfToken(presented);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";
  if (!title || !html) {
    return Response.json({ error: "title and html are required" }, { status: 400 });
  }

  const explicitVisibility =
    "visibility" in body && body.visibility !== undefined && body.visibility !== null;
  let visibility = "private";
  if (explicitVisibility) {
    if (body.visibility !== "private" && body.visibility !== "public") {
      return Response.json({ error: "visibility must be private or public" }, { status: 400 });
    }
    visibility = body.visibility;
  }

  // Share options: `expiresIn: "7d"` (or `expiresAt: <ISO>`) and `passphrase`.
  // "Share this for a week" or "share this behind a passphrase" is a request
  // to share, so either one implies public unless the caller said private
  // outright — in which case the two contradict and it is told so.
  const expiry = readExpiry(body);
  if (expiry.error) return Response.json({ error: expiry.error }, { status: 400 });
  const pass = readPassphrase(body);
  if (pass.error) return Response.json({ error: pass.error }, { status: 400 });

  if (expiry.value || pass.value) {
    if (explicitVisibility && visibility === "private") {
      return Response.json(
        { error: "a private artifact cannot carry an expiry or passphrase — drop one or the other" },
        { status: 400 }
      );
    }
    visibility = "public";
  }
  const shareExpiresAt = expiry.present ? expiry.value : null;
  const sharePassHash = pass.present && pass.value ? await hashPassword(pass.value) : null;

  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_BYTES) {
    return Response.json(
      {
        error: `artifact is ${Math.round(bytes / 1000)}KB, over the ${Math.round(
          MAX_BYTES / 1000
        )}KB limit — embed less, or link large media instead of inlining it`,
      },
      { status: 413 }
    );
  }

  // The project is looked up by id, slug or exact name. An unknown name is a
  // 400 that lists the projects that do exist, so a misspelling is obvious;
  // with createProject the name is made on the spot instead, which is what
  // the first publish into a new folder needs.
  let project = null;
  let projectCreated = false;
  if (body.project) {
    project = await findProject(body.project, userId);
    if (!project && body.createProject === true) {
      const created = await createProject(String(body.project), userId);
      if (created.error) {
        return Response.json({ error: created.error }, { status: created.status });
      }
      project = created.project;
      projectCreated = true;
    }
    if (!project) {
      const names = (await listProjects(userId)).map((p) => p.name);
      const have = names.length ? `your projects: ${names.join(", ")}` : "you have no projects yet";
      return Response.json(
        {
          error: `unknown project: ${body.project} — ${have}. Pass createProject: true (CLI: --new-project) to create it.`,
          projects: names,
        },
        { status: 400 }
      );
    }
  }
  const projectId = project ? project._id.toString() : null;
  const projectOut = project ? { ...publicProject(project), created: projectCreated } : null;

  const col = await artifacts();
  const origin = new URL(request.url).origin;

  // Replacing an artifact in place, keeping its URL. Publishing used to be
  // append-only, which meant the only way to correct a page was to mint a
  // second one and leave the first behind under a link already handed out.
  const replacing = typeof body.slug === "string" ? body.slug.trim() : "";
  if (replacing) {
    const set = { title, html, bytes, visibility, updatedAt: new Date() };
    if (body.project) set.projectId = projectId;
    // Share options the caller mentioned are applied; ones it didn't are left
    // as they were, so re-publishing a page doesn't quietly drop its
    // passphrase. Going private clears both, as the dashboard does.
    if (expiry.present) set.shareExpiresAt = expiry.value;
    if (pass.present) set.sharePassHash = sharePassHash;
    if (visibility === "private") {
      set.shareExpiresAt = null;
      set.sharePassHash = null;
    }

    const updated = await col.findOneAndUpdate(
      { slug: replacing, userId, ...LIVE },
      { $set: set },
      { returnDocument: "after", projection: { html: 0 } }
    );
    // Same answer whether the slug is unknown or someone else's. A slug of
    // the caller's own that is sitting in the trash says so instead: quietly
    // republishing into it would resurrect a page they deleted.
    if (!updated) {
      const trashed = await col.findOne(
        { slug: replacing, userId, deletedAt: { $ne: null } },
        { projection: { _id: 1 } }
      );
      if (trashed) {
        return Response.json(
          {
            error: `that artifact is in the trash — restore it at ${origin}/trash first, or publish without --update to mint a new one`,
          },
          { status: 409 }
        );
      }
      return Response.json(
        { error: `no artifact of yours has the slug: ${replacing}` },
        { status: 404 }
      );
    }

    return reply(updated, origin, {
      updated: true,
      project: body.project ? projectOut : null,
      status: 200,
    });
  }

  // The cap counts live artifacts only; what is in the trash is on its way
  // out and shouldn't block a publish, though it does still take up space
  // until the sweep removes it.
  if ((await col.countDocuments({ userId, ...LIVE })) >= MAX_PER_USER) {
    return Response.json(
      { error: `you have reached the limit of ${MAX_PER_USER} artifacts — delete some first` },
      { status: 409 }
    );
  }

  const slug = slugify(title, "artifact");
  const doc = {
    slug,
    title,
    html,
    projectId,
    userId,
    // Private unless the caller asked otherwise or shares it later.
    visibility,
    shareExpiresAt,
    sharePassHash,
    bytes,
    // Set from the start so the TTL index has a field to look at, and every
    // read filter matches without a special case for older documents.
    deletedAt: null,
    createdAt: new Date(),
  };
  await col.insertOne(doc);

  return reply(doc, origin, { updated: false, project: projectOut, status: 201 });
}
