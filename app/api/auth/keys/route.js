import { users, toObjectId } from "@/lib/mongo";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { requireUser } from "@/lib/guard";
import { AUTH_VERSION, keySummary, readAuthHash, readKeyBlob } from "@/lib/keys";

export const dynamic = "force-dynamic";

// The account's wrapped keys, for a client that has a credential but not the
// key: a second browser after signing in, the settings page before it
// regenerates a phrase, or `personal-artifact --token` on a headless box
// unlocking with the recovery phrase. Session or API token — the same level
// of trust, as everywhere else — and nothing here opens without the password
// or the phrase.
export async function GET(request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const doc = await (await users()).findOne({ _id: toObjectId(user.id) });
  if (!doc) return Response.json({ error: "unauthorized" }, { status: 401 });
  // The email is the PBKDF2 salt, so a client unlocking from the password
  // needs it; the artifact viewer has no other way to learn it.
  return Response.json(
    { ...keySummary(doc), email: doc.email },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

// Replaces the recovery wrapping after the owner generates a new phrase. It
// asks for authHash again: handing out a fresh phrase is the kind of thing a
// borrowed, still-signed-in laptop must not be able to do.
export async function PATCH(request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const authHash = readAuthHash(body.authHash);
  if (!authHash) return Response.json({ error: "authHash is required" }, { status: 400 });
  const blob = readKeyBlob(body.accountKeyByRecovery, "accountKeyByRecovery");
  if (blob.error || !blob.value) {
    return Response.json({ error: blob.error || "accountKeyByRecovery is required" }, { status: 400 });
  }

  const col = await users();
  const doc = await col.findOne({ _id: toObjectId(user.id) });
  if (!doc || doc.authVersion !== AUTH_VERSION) {
    return Response.json({ error: "this account has no encryption keys yet — sign out and in" }, { status: 409 });
  }
  if (!(await verifyPassword(authHash, doc.passwordHash))) {
    return Response.json({ error: "wrong password" }, { status: 401 });
  }

  // Also the moment to re-hash: the stored hash stays scrypt of the same
  // authHash, but a fresh salt costs nothing.
  await col.updateOne(
    { _id: doc._id },
    { $set: { accountKeyByRecovery: blob.value, passwordHash: await hashPassword(authHash) } }
  );
  return Response.json({ replaced: true });
}
