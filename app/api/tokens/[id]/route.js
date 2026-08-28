import { tokens, toObjectId } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return Response.json({ error: "not found" }, { status: 404 });

  const col = await tokens();
  const { deletedCount } = await col.deleteOne({ _id, userId: user.id });
  if (!deletedCount) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ revoked: true });
}
