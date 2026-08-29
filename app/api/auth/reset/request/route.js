import { randomBytes } from "crypto";
import { passwordResets, users } from "@/lib/mongo";
import { normalizeEmail } from "@/lib/auth";
import { hashCode, makeVerificationCode, VERIFY_TTL_SECONDS } from "@/lib/device";
import { sendResetCode } from "@/lib/email";
import { clientIp, tooManyAttempts } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Always reports success, whether or not the address has an account. Signup
// leaks membership by design; reset has no reason to, and a stranger asking to
// reset someone else's password should learn nothing.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) return Response.json({ error: "email is required" }, { status: 400 });

  const limited = await Promise.all([
    tooManyAttempts(`reset:send:${email}`, { limit: 3, windowSeconds: 900 }),
    tooManyAttempts(`reset:ip:${clientIp(request)}`, { limit: 10, windowSeconds: 900 }),
  ]);
  // Even the rate limit answers the same way, so timing it tells you nothing.
  if (limited.some(Boolean)) return Response.json({ sent: true }, { status: 202 });

  const user = await (await users()).findOne({ email });
  if (user) {
    const code = makeVerificationCode();
    const now = new Date();
    const col = await passwordResets();

    // One live request per account: asking again invalidates the last code.
    await col.deleteMany({ userId: user._id.toString() });
    await col.insertOne({
      _id: randomBytes(16).toString("hex"),
      userId: user._id.toString(),
      codeHash: hashCode(code),
      attempts: 0,
      createdAt: now,
      expiresAt: new Date(now.getTime() + VERIFY_TTL_SECONDS * 1000),
    });

    // A failed send is not reported either — the answer must not depend on
    // anything that happened after the address was looked up.
    await sendResetCode(email, code);
  }

  return Response.json({ sent: true }, { status: 202 });
}
