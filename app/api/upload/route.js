import { artifacts, projects, users, toObjectId } from "@/lib/mongo";
import { normalizeEmail } from "@/lib/auth";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// UPLOAD_TOKEN is still one shared secret, so it has to be told whose account to
// publish into: UPLOAD_USER_EMAIL if set, otherwise the oldest account (the
// single-user case). Per-user tokens replace this whole function in phase 3 —
// see docs/accounts.md.
async function uploadOwner() {
  const col = await users();
  const email = normalizeEmail(process.env.UPLOAD_USER_EMAIL);
  if (email) return col.findOne({ email });
  return col.find({}).sort({ createdAt: 1 }).limit(1).next();
}

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
  const secret = process.env.UPLOAD_TOKEN;
  if (!secret) {
    return Response.json({ error: "UPLOAD_TOKEN not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const owner = await uploadOwner();
  if (!owner) {
    return Response.json(
      { error: "no account to publish into — sign up first, or set UPLOAD_USER_EMAIL" },
      { status: 500 }
    );
  }
  const userId = owner._id.toString();

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
    projectId = await resolveProject(body.project, userId);
    if (projectId === undefined) {
      return Response.json({ error: `unknown project: ${body.project}` }, { status: 400 });
    }
  }

  const slug = slugify(title, "artifact");
  const col = await artifacts();
  await col.insertOne({
    slug,
    title,
    html,
    projectId,
    userId,
    // Private unless the owner shares it from the dashboard.
    visibility: "private",
    createdAt: new Date(),
  });

  const origin = new URL(request.url).origin;
  return Response.json({ slug, url: `${origin}/a/${slug}` }, { status: 201 });
}
