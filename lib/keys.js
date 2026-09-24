// What the server knows about encryption: the shapes, and nothing else.
//
// A v2 account signs in with an `authHash` the browser derives from the
// password, and keeps two wrapped copies of its account key here — one the
// password opens, one the recovery phrase opens. An encrypted artifact keeps
// its own key wrapped under the account key, and optionally under a
// passphrase. Every one of those is a blob this server can store, hand back
// and check the shape of, and can never open. That is the promise, so this
// file must never grow a function that decrypts anything.
//
// Validation is strict on shape and generous on nothing: a blob that is not
// exactly { v: 1, iv, ct } (plus `salt` for a passphrase) is refused, since a
// stored blob nobody can open is worse than a refused request.

import { isBlob } from "@/cli/crypto";

export const AUTH_VERSION = 2;

// A wrapped 32-byte key is 48 bytes of ciphertext; give it room and no more.
const MAX_BLOB_FIELD = 200;

function readBlobWith(value, fields, what) {
  if (value === null) return { value: null };
  if (!isBlob(value, fields)) return { error: `${what} is not a valid encrypted blob` };
  for (const field of fields) {
    if (value[field].length > MAX_BLOB_FIELD) return { error: `${what} is too large` };
  }
  const out = { v: 1 };
  for (const field of fields) out[field] = value[field];
  return { value: out };
}

// { value: blob } or { value: null } for an explicit null, or { error }.
export function readKeyBlob(value, what = "wrapped key") {
  return readBlobWith(value, ["iv", "ct"], what);
}

export function readPassphraseBlob(value, what = "passphrase-wrapped key") {
  return readBlobWith(value, ["salt", "iv", "ct"], what);
}

// 32 bytes of HKDF output, base64url: always 43 characters.
export function readAuthHash(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}

// The client sends the raw AES-GCM iv beside the ciphertext for an artifact.
export function readIv(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16}$/.test(value) ? value : "";
}

// Reads the v2 key material out of a signup, upgrade or reset body: both
// wrapped copies of the account key, together or not at all.
export function readAccountKeys(body) {
  const byPassword = readKeyBlob(body.accountKeyByPassword, "accountKeyByPassword");
  if (byPassword.error) return { error: byPassword.error };
  const byRecovery = readKeyBlob(body.accountKeyByRecovery, "accountKeyByRecovery");
  if (byRecovery.error) return { error: byRecovery.error };
  if (!byPassword.value || !byRecovery.value) {
    return { error: "accountKeyByPassword and accountKeyByRecovery are both required" };
  }
  return { value: { accountKeyByPassword: byPassword.value, accountKeyByRecovery: byRecovery.value } };
}

// The fields a client needs to unlock, and nothing that could help anyone
// else: the blobs are useless without the password or the phrase.
export function keySummary(doc) {
  const v2 = doc?.authVersion === AUTH_VERSION;
  return {
    authVersion: v2 ? AUTH_VERSION : 1,
    accountKeyByPassword: v2 ? doc.accountKeyByPassword : null,
    accountKeyByRecovery: v2 ? doc.accountKeyByRecovery : null,
    keysCreatedAt: v2 && doc.keysCreatedAt ? new Date(doc.keysCreatedAt).toISOString() : null,
  };
}

/* ---------- encrypted artifacts ---------- */

// Reads the encryption fields out of an upload or PATCH body. They come
// together or not at all: `enc: 1`, the `iv` the html was encrypted with, and
// `artKeyWrapped`. `artKeyByPassphrase` is optional and may be null to clear.
//
//   { present: false }                    the body says nothing about encryption
//   { present: true, value: {...} }       enc, iv, artKeyWrapped, artKeyByPassphrase?
//   { present: true, error }
export function readEncryption(body) {
  const has = (key) => key in body && body[key] !== undefined;
  const any = has("enc") || has("iv") || has("artKeyWrapped");
  if (!any && !has("artKeyByPassphrase")) return { present: false };

  const byPassphrase = has("artKeyByPassphrase")
    ? readPassphraseBlob(body.artKeyByPassphrase, "artKeyByPassphrase")
    : { value: undefined };
  if (byPassphrase.error) return { present: true, error: byPassphrase.error };

  // Only the passphrase wrapping is changing (the share sheet does this).
  if (!any) return { present: true, value: { artKeyByPassphrase: byPassphrase.value } };

  if (body.enc !== 1) return { present: true, error: "enc must be 1 when iv or artKeyWrapped is sent" };
  const iv = readIv(body.iv);
  if (!iv) return { present: true, error: "iv must be the 12-byte AES-GCM iv, base64url" };
  const wrapped = readKeyBlob(body.artKeyWrapped, "artKeyWrapped");
  if (wrapped.error || !wrapped.value) {
    return { present: true, error: wrapped.error || "artKeyWrapped is required with enc" };
  }
  return {
    present: true,
    value: { enc: 1, iv, artKeyWrapped: wrapped.value, artKeyByPassphrase: byPassphrase.value },
  };
}

// The encryption fields an API hands back for one artifact. Ciphertext and
// wrapped keys are the owner's to read; nothing here opens anything.
export function encryptionSummary(doc) {
  if (doc?.enc !== 1) return { encrypted: false };
  return {
    encrypted: true,
    enc: 1,
    iv: doc.iv,
    artKeyWrapped: doc.artKeyWrapped,
    artKeyByPassphrase: doc.artKeyByPassphrase || null,
  };
}
