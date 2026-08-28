import { currentUser } from "@/lib/auth";

// The dashboard API routes are called from the browser with the session
// cookie. Anything without a session gets 401 rather than touching the data.
export async function requireUser() {
  const user = await currentUser();
  if (user) return { user, response: null };
  return {
    user: null,
    response: Response.json({ error: "unauthorized" }, { status: 401 }),
  };
}
