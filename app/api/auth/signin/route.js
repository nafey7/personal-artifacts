import { users } from "@/lib/mongo";
import { createSession, normalizeEmail, publicUser, verifyPassword } from "@/lib/auth";
import { clearAttempts, clientIp, tooManyAttempts } from "@/lib/ratelimit";
import { AUTH_VERSION, keySummary, readAuthHash } from "@/lib/keys";

export const dynamic = "force-dynamic";

// A v2 account signs in with `authHash`, which the browser derives from the
// password and the email; the password itself never arrives. The scrypt check
// is exactly what it was — it is just hashing a different string. The reply
// carries the account key wrapped under the password, so the browser can
// unlock it locally, and says which version the account is.
//
// A v1 account (made before encryption) still signs in with `password`. A
// browser that sent `authHash` to one gets `legacy: true` back with the 401,
// which is its cue to run the upgrade with the password it already holds.
// That flag does admit a legacy account exists at that address; it is gone
// the moment the last v1 account upgrades, and the plain-password path with
// it.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const authHash = readAuthHash(body.authHash);
  if (!email || (!password && !authHash)) {
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
  const v2 = doc?.authVersion === AUTH_VERSION;
  // A v2 account only ever checks authHash; the plain password is not
  // something it can verify any more, by design.
  const presented = v2 ? authHash : password;
  // Same message either way, so this can't be used to enumerate accounts.
  const ok = doc && presented ? await verifyPassword(presented, doc.passwordHash) : false;
  if (!ok) {
    const legacy = Boolean(doc) && !v2 && Boolean(authHash) && !password;
    return Response.json(
      { error: "wrong email or password", ...(legacy ? { legacy: true } : {}) },
      { status: 401 }
    );
  }

  await clearAttempts(`signin:email:${email}`);
  await createSession(doc._id.toString());
  const keys = keySummary(doc);
  return Response.json({
    user: publicUser(doc),
    authVersion: keys.authVersion,
    accountKeyByPassword: keys.accountKeyByPassword,
  });
}
