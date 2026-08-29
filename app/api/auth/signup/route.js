import { pendingSignups, users } from "@/lib/mongo";
import { hashPassword, looksLikeEmail, normalizeEmail } from "@/lib/auth";
import { hashCode, makeVerificationCode, VERIFY_TTL_SECONDS } from "@/lib/device";
import { sendVerificationCode } from "@/lib/email";
import { clientIp, tooManyAttempts } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 10;

// Step one of two. Nothing is created here: what the person typed is parked in
// a short-lived record and a code goes out by email. /api/auth/verify does the
// account creation that this route used to do.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (await tooManyAttempts(`signup:ip:${clientIp(request)}`, { limit: 5, windowSeconds: 3600 })) {
    return Response.json(
      { error: "too many accounts created from here — try again later" },
      { status: 429 }
    );
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

  // Signup tells the truth about an address already being taken. That makes the
  // form a membership oracle, which is why sign-in refuses to do the same; the
  // trade is deliberate and the per-address send limit blunts bulk probing.
  if (await (await users()).findOne({ email })) {
    return Response.json({ error: "an account with that email already exists" }, { status: 409 });
  }

  // Sending mail is the expensive part and an unauthenticated stranger triggers
  // it, so the limit sits on the address rather than on the attempt.
  if (await tooManyAttempts(`verify:send:${email}`, { limit: 3, windowSeconds: 900 })) {
    return Response.json(
      { error: "too many codes sent to that address — wait fifteen minutes" },
      { status: 429 }
    );
  }

  const code = makeVerificationCode();
  const now = new Date();
  const record = {
    name,
    // Hashed before it is parked, so a dump of half-finished signups is worth
    // no more than a dump of accounts.
    passwordHash: await hashPassword(password),
    codeHash: hashCode(code),
    attempts: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + VERIFY_TTL_SECONDS * 1000),
  };

  // Keyed by email, so retyping the form replaces the first attempt rather than
  // colliding with it — and $set replaces the code rather than reviving the old.
  const col = await pendingSignups();
  await col.updateOne({ _id: email }, { $set: record }, { upsert: true });

  const sent = await sendVerificationCode(email, code);
  if (!sent.ok) {
    // No half-finished record the person cannot complete.
    await col.deleteOne({ _id: email });
    return Response.json({ error: sent.error }, { status: 502 });
  }

  return Response.json({ pending: true, email }, { status: 202 });
}
