import { users } from "@/lib/mongo";
import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth";
import { clearAttempts, clientIp, tooManyAttempts } from "@/lib/ratelimit";

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

  // Per email and per address, so neither one account nor one machine can be
  // ground through a password list.
  const limited = await Promise.all([
    tooManyAttempts(`signin:email:${email}`, { limit: 10, windowSeconds: 900 }),
    tooManyAttempts(`signin:ip:${clientIp(request)}`, { limit: 30, windowSeconds: 900 }),
  ]);
  if (limited.some(Boolean)) {
    return Response.json(
      { error: "too many attempts — wait a few minutes and try again" },
      { status: 429 }
    );
  }

  const doc = await (await users()).findOne({ email });
  // Same message either way, so this can't be used to enumerate accounts.
  const ok = doc ? await verifyPassword(password, doc.passwordHash) : false;
  if (!ok) {
    return Response.json({ error: "wrong email or password" }, { status: 401 });
  }

  await clearAttempts(`signin:email:${email}`);
  await createSession(doc._id.toString());
  return Response.json({
    user: { id: doc._id.toString(), email: doc.email, name: doc.name || "" },
  });
}
