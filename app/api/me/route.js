import { users, toObjectId } from "@/lib/mongo";
import { ownerOfToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// Lets `personal-artifact init` confirm a token before writing it to disk, so a
// mistyped paste fails at setup rather than at the first publish.
export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!presented) return Response.json({ error: "unauthorized" }, { status: 401 });

  const userId = await ownerOfToken(presented);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const _id = toObjectId(userId);
  const doc = _id ? await (await users()).findOne({ _id }, { projection: { passwordHash: 0 } }) : null;
  if (!doc) return Response.json({ error: "unauthorized" }, { status: 401 });

  return Response.json({ user: { email: doc.email, name: doc.name || "" } });
}
