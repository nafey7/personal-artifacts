import { users } from "@/lib/mongo";
import { createSession, hashPassword, normalizeEmail, publicUser, verifyPassword } from "@/lib/auth";
import { clearAttempts, clientIp, tooManyAttempts } from "@/lib/ratelimit";
import { AUTH_VERSION, readAccountKeys, readAuthHash } from "@/lib/keys";

export const dynamic = "force-dynamic";

// The one-time move from a v1 account to a v2 one. The browser sends the plain
// password one last time, to prove it is the owner, together with the
// `authHash` that replaces it and the freshly wrapped account key. From here
// on the account signs in with authHash only and the plain password never
// crosses the wire again.
//
// Same rate-limit keys as sign-in: this is a sign-in, and a wrong guess here
// must cost the same as a wrong guess there.
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
  if (!email || !password || !authHash) {
    return Response.json({ error: "email, password and authHash are required" }, { status: 400 });
  }
  const keys = readAccountKeys(body);
  if (keys.error) return Response.json({ error: keys.error }, { status: 400 });

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

  const col = await users();
  const doc = await col.findOne({ email });
  if (doc?.authVersion === AUTH_VERSION) {
    // Already moved — perhaps from another tab. Refuse rather than overwrite
    // keys that may already wrap artifacts.
    return Response.json(
      { error: "this account already has encryption keys — sign in normally" },
      { status: 409 }
    );
  }
  const ok = doc ? await verifyPassword(password, doc.passwordHash) : false;
  if (!ok) return Response.json({ error: "wrong email or password" }, { status: 401 });

  // The filter repeats the version check so two upgrades racing each other
  // cannot both win.
  const result = await col.findOneAndUpdate(
    { _id: doc._id, authVersion: { $ne: AUTH_VERSION } },
    {
      $set: {
        passwordHash: await hashPassword(authHash),
        authVersion: AUTH_VERSION,
        ...keys.value,
        keysCreatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );
  if (!result) {
    return Response.json(
      { error: "this account already has encryption keys — sign in normally" },
      { status: 409 }
    );
  }

  await clearAttempts(`signin:email:${email}`);
  await createSession(doc._id.toString());
  return Response.json({
    user: publicUser(result),
    authVersion: AUTH_VERSION,
    accountKeyByPassword: result.accountKeyByPassword,
    upgraded: true,
  });
}
