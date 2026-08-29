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

  const col = await artifacts();
  if ((await col.countDocuments({ userId })) >= MAX_PER_USER) {
    return Response.json(
      { error: `you have reached the limit of ${MAX_PER_USER} artifacts — delete some first` },
      { status: 409 }
    );
  }

  let projectId = null;
  if (body.project) {
    projectId = await resolveProject(body.project, userId);
    if (projectId === undefined) {
      return Response.json({ error: `unknown project: ${body.project}` }, { status: 400 });
    }
  }

  const slug = slugify(title, "artifact");
  await col.insertOne({
    slug,
    title,
    html,
    projectId,
    userId,
    // Private unless the owner shares it from the dashboard.
    visibility: "private",
    bytes,
    createdAt: new Date(),
  });

  const origin = new URL(request.url).origin;
  return Response.json({ slug, url: `${origin}/a/${slug}` }, { status: 201 });
}
