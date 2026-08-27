import { artifacts, projects, toObjectId } from "@/lib/mongo";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
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
      const project = await (await projects()).findOne({ _id: projectId });
      if (!project) return Response.json({ error: "unknown project" }, { status: 400 });
      set.projectId = projectId.toString();
    }
  }

  if (Object.keys(set).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const col = await artifacts();
  const result = await col.findOneAndUpdate(
    { _id },
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
    },
  });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return Response.json({ error: "not found" }, { status: 404 });

  const col = await artifacts();
  const { deletedCount } = await col.deleteOne({ _id });
  if (!deletedCount) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ deleted: true });
}
