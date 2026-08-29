import { passwordResets, sessions, users } from "@/lib/mongo";
import { hashPassword, normalizeEmail } from "@/lib/auth";
import { codeMatches } from "@/lib/device";
import { clearAttempts, tooManyAttempts } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 10;
const MAX_TRIES = 5;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim().toUpperCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !code) {
    return Response.json({ error: "email and code are required" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return Response.json(
      { error: `password must be at least ${MIN_PASSWORD} characters` },
      { status: 400 }
    );
  }

  if (await tooManyAttempts(`reset:try:${email}`, { limit: 5, windowSeconds: 600 })) {
    return Response.json(
      { error: "too many attempts — start again in a few minutes" },
      { status: 429 }
    );
  }

  const user = await (await users()).findOne({ email });
  const col = await passwordResets();
  const doc = user ? await col.findOne({ userId: user._id.toString() }) : null;

  // A missing account and a missing request answer identically, so confirm
  // stays as quiet about membership as request is.
  if (!doc || new Date(doc.expiresAt) < new Date()) {
    if (doc) await col.deleteOne({ _id: doc._id });
    return Response.json(
      { error: "that code has expired — request a new one", restart: true },
      { status: 410 }
    );
  }

  if (!codeMatches(code, doc.codeHash)) {
    const left = MAX_TRIES - (doc.attempts + 1);
    if (left <= 0) {
      await col.deleteOne({ _id: doc._id });
      return Response.json(
        { error: "too many wrong codes — request a new one", restart: true },
        { status: 429 }
      );
    }
    await col.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
    return Response.json(
      { error: `that code is wrong — ${left} ${left === 1 ? "try" : "tries"} left` },
      { status: 401 }
    );
  }

  await (await users()).updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(password) } }
  );

  // The point of a reset: whoever prompted it must not stay signed in.
  // destroySession only clears the caller's own cookie, which is the wrong tool.
  await (await sessions()).deleteMany({ userId: user._id.toString() });

  await col.deleteOne({ _id: doc._id });
  await clearAttempts(`reset:try:${email}`);

  return Response.json({ reset: true });
}
