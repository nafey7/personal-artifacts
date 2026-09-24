import { currentUser, publicUser } from "@/lib/auth";
import { ownerOfToken } from "@/lib/tokens";
import { users, toObjectId } from "@/lib/mongo";

// The owner of the API token in the Authorization header, in the same shape
// currentUser() returns, or null. The token that publishes an artifact is the
// same level of trust as the browser session that manages it, so routes that
// take a request can let either one in.
export async function userFromToken(request) {
  const auth = request?.headers?.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;

  const userId = await ownerOfToken(auth.slice(7).trim());
  if (!userId) return null;

  const _id = toObjectId(userId);
  if (!_id) return null;
  const doc = await (await users()).findOne({ _id }, { projection: { passwordHash: 0 } });
  if (!doc) return null;

  return publicUser(doc);
}

// The dashboard API routes are called from the browser with the session
// cookie. Pass the request to also accept an API token, which is how the CLI
// and the agent behind it reach the same routes. Anything without either gets
// 401 rather than touching the data.
export async function requireUser(request) {
  const user = (await currentUser()) || (request ? await userFromToken(request) : null);
  if (user) return { user, response: null };
  return {
    user: null,
    response: Response.json({ error: "unauthorized" }, { status: 401 }),
  };
}
