import { artifacts, projects, toObjectId } from "@/lib/mongo";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// Accepts a project id, slug or exact name so the CLI can pass whichever the
// caller has to hand. Returns undefined when nothing matches.
async function resolveProject(value) {
  const key = String(value).trim();
  if (!key) return undefined;

  const col = await projects();
  const _id = toObjectId(key);
  const doc = await col.findOne(
    _id ? { $or: [{ _id }, { slug: key }, { name: key }] } : { $or: [{ slug: key }, { name: key }] }
  );
  return doc ? doc._id.toString() : undefined;
}

export async function POST(request) {
  const secret = process.env.UPLOAD_TOKEN;
  if (!secret) {
    return Response.json({ error: "UPLOAD_TOKEN not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
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

  let projectId = null;
  if (body.project) {
    projectId = await resolveProject(body.project);
    if (projectId === undefined) {
      return Response.json({ error: `unknown project: ${body.project}` }, { status: 400 });
    }
  }

  const slug = slugify(title, "artifact");
  const col = await artifacts();
  await col.insertOne({ slug, title, html, projectId, createdAt: new Date() });

  const origin = new URL(request.url).origin;
  return Response.json({ slug, url: `${origin}/a/${slug}` }, { status: 201 });
}
