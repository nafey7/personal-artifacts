import { users } from "@/lib/mongo";
import {
  createSession,
  hashPassword,
  looksLikeEmail,
  normalizeEmail,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 10;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // When SIGNUP_CODE is set the deployment is invite-only; unset means open.
  const gate = process.env.SIGNUP_CODE;
  if (gate && String(body.code || "") !== gate) {
    return Response.json({ error: "invalid invite code" }, { status: 403 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";

  if (!looksLikeEmail(email)) {
    return Response.json({ error: "enter a valid email address" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return Response.json(
      { error: `password must be at least ${MIN_PASSWORD} characters` },
      { status: 400 }
    );
  }

  const col = await users();
  // Unique index is the real guard against two signups racing; this check just
  // turns the common case into a readable message.
  if (await col.findOne({ email })) {
    return Response.json({ error: "an account with that email already exists" }, { status: 409 });
  }

  const doc = {
    email,
    name,
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
  };

  let insertedId;
  try {
    ({ insertedId } = await col.insertOne(doc));
  } catch (err) {
    if (err?.code === 11000) {
      return Response.json({ error: "an account with that email already exists" }, { status: 409 });
    }
    throw err;
  }

  await createSession(insertedId.toString());
  return Response.json({ user: { id: insertedId.toString(), email, name } }, { status: 201 });
}
