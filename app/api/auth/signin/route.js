import { users } from "@/lib/mongo";
import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return Response.json({ error: "email and password are required" }, { status: 400 });
  }

  const doc = await (await users()).findOne({ email });
  // Same message either way, so this can't be used to enumerate accounts.
  const ok = doc ? await verifyPassword(password, doc.passwordHash) : false;
  if (!ok) {
    return Response.json({ error: "wrong email or password" }, { status: 401 });
  }

  await createSession(doc._id.toString());
  return Response.json({
    user: { id: doc._id.toString(), email: doc.email, name: doc.name || "" },
  });
}
