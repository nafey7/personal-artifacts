import { artifacts, projects } from "@/lib/mongo";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

export async function GET() {
  const col = await projects();
  const docs = await col.find({}).sort({ name: 1 }).toArray();
  return Response.json({
    projects: docs.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      slug: p.slug,
    })),
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  if (name.length > 80) {
    return Response.json({ error: "name is too long" }, { status: 400 });
  }

  const col = await projects();
  const existing = await col.findOne({ name });
  if (existing) {
    return Response.json({ error: "a project with that name already exists" }, { status: 409 });
  }

  const now = new Date();
  const doc = { name, slug: slugify(name, "project"), createdAt: now, updatedAt: now };
  const { insertedId } = await col.insertOne(doc);

  // Report the count so the freshly created project renders like the rest.
  const art = await artifacts();
  const count = await art.countDocuments({ projectId: insertedId.toString() });

  return Response.json(
    { project: { id: insertedId.toString(), name: doc.name, slug: doc.slug, count } },
    { status: 201 }
  );
}
