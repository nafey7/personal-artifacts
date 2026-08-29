import { pendingSignups } from "@/lib/mongo";
import { normalizeEmail } from "@/lib/auth";
import { hashCode, makeVerificationCode, VERIFY_TTL_SECONDS } from "@/lib/device";
import { sendVerificationCode } from "@/lib/email";
import { clientIp, tooManyAttempts } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// A code cannot be read back out of the database — it is stored hashed — so
// resending means issuing a new one, and the old one stops working.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) return Response.json({ error: "email is required" }, { status: 400 });

  // The same address bucket the signup send uses, so the two together cannot
  // spend more than three messages in a quarter of an hour.
  const limited = await Promise.all([
    tooManyAttempts(`verify:send:${email}`, { limit: 3, windowSeconds: 900 }),
    tooManyAttempts(`resend:ip:${clientIp(request)}`, { limit: 10, windowSeconds: 900 }),
  ]);
  if (limited.some(Boolean)) {
    return Response.json(
      { error: "too many codes sent — wait fifteen minutes and try again" },
      { status: 429 }
    );
  }

  const col = await pendingSignups();
  const doc = await col.findOne({ _id: email });
  if (!doc || new Date(doc.expiresAt) < new Date()) {
    return Response.json(
      { error: "that signup has expired — start again", restart: true },
      { status: 410 }
    );
  }

  const code = makeVerificationCode();
  const now = new Date();
  await col.updateOne(
    { _id: email },
    {
      $set: {
        codeHash: hashCode(code),
        // A fresh code deserves a fresh window and a fresh guess budget.
        attempts: 0,
        expiresAt: new Date(now.getTime() + VERIFY_TTL_SECONDS * 1000),
      },
    }
  );

  const sent = await sendVerificationCode(email, code);
  if (!sent.ok) return Response.json({ error: sent.error }, { status: 502 });

  return Response.json({ pending: true, email }, { status: 202 });
}
