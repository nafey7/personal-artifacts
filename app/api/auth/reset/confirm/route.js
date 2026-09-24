import { passwordResets, sessions, users } from "@/lib/mongo";
import { hashPassword, normalizeEmail } from "@/lib/auth";
import { codeMatches } from "@/lib/device";
import { clearAttempts, tooManyAttempts } from "@/lib/ratelimit";
import { AUTH_VERSION, keySummary, readAccountKeys, readAuthHash, readKeyBlob } from "@/lib/keys";

export const dynamic = "force-dynamic";

const MAX_TRIES = 5;

// Two calls with the same code. The first, with just { email, code }, checks
// the code and answers with the account's recovery-wrapped key — so the
// browser can ask for the recovery phrase, unwrap the account key with it,
// and wrap it again under the new password. The second carries that new
// wrapping and the new authHash, and is what changes the password. The code
// is consumed only by the second call.
//
// A v2 account whose second call lacks accountKeyByPassword is refused: the
// password can be changed without the phrase only by giving up the account
// key, which the browser has to say out loud with `replaceKeys: true` and a
// fresh pair of wrappings. Encrypted artifacts stay unreadable after that.
// A v1 account is upgraded here as a side effect — it arrives with fresh
// keys the same way, and leaves as v2.
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

  // The first call: the code is right, hand over what the browser needs to
  // build the second. The blob is useless without the phrase.
  if (!("authHash" in body)) {
    const keys = keySummary(user);
    await clearAttempts(`reset:try:${email}`);
    return Response.json({
      verified: true,
      authVersion: keys.authVersion,
      accountKeyByRecovery: keys.accountKeyByRecovery,
    });
  }
  const authHash = readAuthHash(body.authHash);
  if (!authHash) return Response.json({ error: "authHash is required" }, { status: 400 });

  const v2 = user.authVersion === AUTH_VERSION;
  const set = { passwordHash: await hashPassword(authHash), authVersion: AUTH_VERSION };

  if (v2 && body.replaceKeys !== true) {
    const given = body.accountKeyByPassword !== undefined && body.accountKeyByPassword !== null;
    const blob = given ? readKeyBlob(body.accountKeyByPassword, "accountKeyByPassword") : { value: null };
    if (blob.error) return Response.json({ error: blob.error }, { status: 400 });
    if (!blob.value) {
      return Response.json(
        {
          error:
            "this account has encryption keys, so a new password needs the recovery phrase to carry them over — or choose to start over without them",
          needsRecovery: true,
        },
        { status: 400 }
      );
    }
    set.accountKeyByPassword = blob.value;
  } else {
    // Fresh keys: a v1 account getting its first, or a v2 owner who lost the
    // phrase and chose to start over.
    const keys = readAccountKeys(body);
    if (keys.error) return Response.json({ error: keys.error }, { status: 400 });
    Object.assign(set, keys.value, { keysCreatedAt: new Date() });
  }

  await (await users()).updateOne({ _id: user._id }, { $set: set });

  // The point of a reset: whoever prompted it must not stay signed in.
  // destroySession only clears the caller's own cookie, which is the wrong tool.
  await (await sessions()).deleteMany({ userId: user._id.toString() });

  await col.deleteOne({ _id: doc._id });
  await clearAttempts(`reset:try:${email}`);

  return Response.json({ reset: true, authVersion: AUTH_VERSION, keysReplaced: !v2 || body.replaceKeys === true });
}
