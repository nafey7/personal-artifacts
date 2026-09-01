import { artifacts, projects, toObjectId } from "@/lib/mongo";
import { ownerOfToken } from "@/lib/tokens";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// A page has to fit in a MongoDB document (16MB) but should be nowhere near it.
// A generous HTML page with inlined CSS and fonts is a few hundred KB; the cap
// exists so one embedded video can't take a meaningful slice of the cluster.
const MAX_BYTES = Number(process.env.MAX_ARTIFACT_BYTES || 2_000_000);
const MAX_PER_USER = Number(process.env.MAX_ARTIFACTS_PER_USER || 200);

// Accepts a project id, slug or exact name so the CLI can pass whichever the
// caller has to hand. Only the owner's own projects are searched. Returns
// undefined when nothing matches.
async function resolveProject(value, userId) {
  const key = String(value).trim();
  if (!key) return undefined;

  const col = await projects();
  const _id = toObjectId(key);
  const doc = await col.findOne({
    userId,
    $or: _id ? [{ _id }, { slug: key }, { name: key }] : [{ slug: key }, { name: key }],
  });
  return doc ? doc._id.toString() : undefined;
}

// Said in the response itself, not just in the docs. A caller that publishes
// and then fetches its own URL without a credential gets a 404 by design; the
// only way that reads as intended rather than as an outage is if the upload
// that produced the URL already said what to expect.
function noteFor(isPublic, origin) {
  return isPublic
    ? "public — anyone with this link can open it. Mark it Private in your dashboard to close it again."
    : `private — it opens for you in a browser you are signed in to, or with this same API token as an Authorization: Bearer header. Fetching it without either returns 404, which is expected and not an error. Share it from ${origin}/ to get a link anyone can open.`;
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

  let visibility = "private";
  if ("visibility" in body && body.visibility !== undefined && body.visibility !== null) {
    if (body.visibility !== "private" && body.visibility !== "public") {
      return Response.json({ error: "visibility must be private or public" }, { status: 400 });
    }
    visibility = body.visibility;
  }

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

  let projectId = null;
  if (body.project) {
    projectId = await resolveProject(body.project, userId);
    if (projectId === undefined) {
      return Response.json({ error: `unknown project: ${body.project}` }, { status: 400 });
    }
  }

  const col = await artifacts();
  const origin = new URL(request.url).origin;

  // Replacing an artifact in place, keeping its URL. Publishing used to be
  // append-only, which meant the only way to correct a page was to mint a
  // second one and leave the first behind under a link already handed out.
  const replacing = typeof body.slug === "string" ? body.slug.trim() : "";
  if (replacing) {
    const set = { title, html, bytes, visibility, updatedAt: new Date() };
    if (body.project) set.projectId = projectId;

    const updated = await col.findOneAndUpdate(
      { slug: replacing, userId },
      { $set: set },
      { returnDocument: "after", projection: { html: 0 } }
    );
    // Same answer whether the slug is unknown or someone else's.
    if (!updated) {
      return Response.json(
        { error: `no artifact of yours has the slug: ${replacing}` },
        { status: 404 }
      );
    }

    const isPublic = updated.visibility === "public";
    return Response.json(
      {
        slug: updated.slug,
        url: `${origin}/a/${updated.slug}`,
        updated: true,
        visibility: updated.visibility,
        isPublic,
        note: noteFor(isPublic, origin),
        manageUrl: `${origin}/`,
      },
      { status: 200 }
    );
  }

  if ((await col.countDocuments({ userId })) >= MAX_PER_USER) {
    return Response.json(
      { error: `you have reached the limit of ${MAX_PER_USER} artifacts — delete some first` },
      { status: 409 }
    );
  }

  const slug = slugify(title, "artifact");
  await col.insertOne({
    slug,
    title,
    html,
    projectId,
    userId,
    // Private unless the caller asked otherwise or shares it later.
    visibility,
    bytes,
    createdAt: new Date(),
  });

  const isPublic = visibility === "public";
  return Response.json(
    {
      slug,
      url: `${origin}/a/${slug}`,
      updated: false,
      visibility,
      isPublic,
      note: noteFor(isPublic, origin),
      manageUrl: `${origin}/`,
    },
    { status: 201 }
  );
}
