import { artifacts, projects, toObjectId } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  if (name.length > 80) {
    return Response.json({ error: "name is too long" }, { status: 400 });
  }

  const col = await projects();
  const clash = await col.findOne({ name, userId: user.id, _id: { $ne: _id } });
  if (clash) {
    return Response.json({ error: "a project with that name already exists" }, { status: 409 });
  }

  // The slug stays as minted so existing /p/<slug> links keep resolving. The
  // userId in the filter makes another account's id a 404, not an edit.
  const result = await col.findOneAndUpdate(
    { _id, userId: user.id },
    { $set: { name, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({
    project: { id: result._id.toString(), name: result.name, slug: result.slug },
  });
}

export async function DELETE(_request, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return Response.json({ error: "not found" }, { status: 404 });

  const col = await projects();
  const project = await col.findOne({ _id, userId: user.id });
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  // Deleting a project takes its artifacts with it. Remove the artifacts first
  // so a failure part-way through can't orphan them behind a missing project.
  const art = await artifacts();
  const { deletedCount } = await art.deleteMany({
    projectId: _id.toString(),
    userId: user.id,
  });
  await col.deleteOne({ _id, userId: user.id });

  return Response.json({ deleted: { project: project.name, artifacts: deletedCount } });
}
