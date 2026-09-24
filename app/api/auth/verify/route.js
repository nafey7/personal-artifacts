import { pendingSignups, users } from "@/lib/mongo";
import { createSession, normalizeEmail } from "@/lib/auth";
import { codeMatches } from "@/lib/device";
import { clearAttempts, tooManyAttempts } from "@/lib/ratelimit";
import { AUTH_VERSION } from "@/lib/keys";

export const dynamic = "force-dynamic";

const MAX_TRIES = 5;

// Step two of signup: the code comes back and the account is created. This is
// the only place an account is born, so everything signup used to do at the end
// happens here instead.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim().toUpperCase();
  if (!email || !code) {
    return Response.json({ error: "email and code are required" }, { status: 400 });
  }

  if (await tooManyAttempts(`verify:try:${email}`, { limit: 5, windowSeconds: 600 })) {
    return Response.json(
      { error: "too many attempts — start again in a few minutes" },
      { status: 429 }
    );
  }

  const col = await pendingSignups();
  const doc = await col.findOne({ _id: email });

  // Rows can outlive the TTL sweep by a minute or two; treat them as gone.
  if (!doc || new Date(doc.expiresAt) < new Date()) {
    if (doc) await col.deleteOne({ _id: email });
    return Response.json(
      { error: "that code has expired — start again", restart: true },
      { status: 410 }
    );
  }

  if (!codeMatches(code, doc.codeHash)) {
    const left = MAX_TRIES - (doc.attempts + 1);
    if (left <= 0) {
      await col.deleteOne({ _id: email });
      return Response.json(
        { error: "too many wrong codes — start again", restart: true },
        { status: 429 }
      );
    }
    await col.updateOne({ _id: email }, { $inc: { attempts: 1 } });
    return Response.json(
      { error: `that code is wrong — ${left} ${left === 1 ? "try" : "tries"} left` },
      { status: 401 }
    );
  }

  let insertedId;
  try {
    // The unique index, not the check in signup, is the real guard: two people
    // can hold pending signups for the same address at once.
    ({ insertedId } = await (await users()).insertOne({
      email,
      name: doc.name || "",
      passwordHash: doc.passwordHash,
      // Everything the signup parked about encryption, carried over as it
      // was: a v2 signup arrives here with its wrapped keys already made.
      authVersion: doc.authVersion === AUTH_VERSION ? AUTH_VERSION : 1,
      accountKeyByPassword: doc.accountKeyByPassword ?? null,
      accountKeyByRecovery: doc.accountKeyByRecovery ?? null,
      keysCreatedAt: doc.authVersion === AUTH_VERSION ? new Date() : null,
      createdAt: new Date(),
    }));
  } catch (err) {
    if (err?.code === 11000) {
      await col.deleteOne({ _id: email });
      return Response.json({ error: "an account with that email already exists" }, { status: 409 });
    }
    throw err;
  }

  await col.deleteOne({ _id: email });
  await clearAttempts(`verify:try:${email}`);
  await createSession(insertedId.toString());

  return Response.json(
    {
      user: { id: insertedId.toString(), email, name: doc.name || "" },
      authVersion: doc.authVersion === AUTH_VERSION ? AUTH_VERSION : 1,
    },
    { status: 201 }
  );
}
