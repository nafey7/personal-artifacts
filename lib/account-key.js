// The browser's side of the account key: deriving it from the password,
// making a fresh one at signup, keeping it in the keystore, and asking the
// person to unlock when a page needs it and the keystore is empty.
//
// Browser only. Everything here runs in event handlers and effects of client
// components; nothing is called during render or on the server.
//
// Two ways to get the key, on purpose:
//
//   requestAccountKey()          the stored, non-extractable key — enough to
//                                encrypt an artifact or open one; asks for
//                                the password once per browser if the store
//                                is empty
//   unlockWithPassword(..., { extractable: true })
//                                the raw key, for the two things that must
//                                export it: sealing it to a CLI machine and
//                                wrapping it under a new recovery phrase.
//                                Always costs the password, even on a browser
//                                that is already unlocked.

import * as crypto from "@/cli/crypto";
import * as keystore from "@/lib/keystore";

export async function deriveAuth(email, password) {
  return crypto.split(await crypto.deriveFromPassword(password, email));
}

// A brand-new account key, wrapped for storage, and the phrase that can
// recover it. The caller shows `words` once and puts `accountKey` in the
// keystore.
export async function makeKeys(wrapKey) {
  const accountKey = await crypto.newKey();
  const words = await crypto.phrase.generate();
  const [accountKeyByPassword, accountKeyByRecovery] = await Promise.all([
    crypto.wrap(accountKey, wrapKey),
    crypto.wrap(accountKey, await crypto.phrase.toKey(words)),
  ]);
  return { accountKey, words, accountKeyByPassword, accountKeyByRecovery };
}

// Wrapping the account key under a new phrase needs the raw key, so this
// takes an extractable one.
export async function rewrapForRecovery(accountKey) {
  const words = await crypto.phrase.generate();
  const accountKeyByRecovery = await crypto.wrap(accountKey, await crypto.phrase.toKey(words));
  return { words, accountKeyByRecovery };
}

// The keystore holds a non-extractable key; a freshly made one is
// extractable so it could be wrapped. This is the same key, locked.
export async function lockedCopy(accountKey) {
  return crypto.importKey(await crypto.exportKey(accountKey), { extractable: false });
}

export async function fetchKeys() {
  const res = await fetch("/api/auth/keys", { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `could not fetch keys (${res.status})`);
  return data;
}

// Puts the unwrapped account key in the keystore so later page loads need no
// password. Non-extractable: page script can use it, never read it.
export async function remember(blob, wrapKey) {
  const key = await crypto.unwrap(blob, wrapKey, { extractable: false });
  await keystore.put(key);
  return key;
}

// Derives from the password, fetches the wrapped keys, and opens the one
// the password wraps. Throws a plain-language error on a wrong password.
export async function unlockWithPassword(email, password, { extractable = false } = {}) {
  const { authHash, wrapKey } = await deriveAuth(email, password);
  const keys = await fetchKeys();
  if (keys.authVersion !== 2 || !keys.accountKeyByPassword) {
    throw new Error("this account has no encryption keys yet — sign out and sign in again to make them");
  }
  let key;
  try {
    key = await crypto.unwrap(keys.accountKeyByPassword, wrapKey, { extractable });
  } catch {
    throw new Error("that password is not right");
  }
  if (!extractable) await keystore.put(key);
  return { key, authHash, keys };
}

/* ---------- asking for the key from anywhere in the dashboard ---------- */

// The dashboard layout mounts one unlock dialog and registers it here. Any
// component that needs the key calls requestAccountKey(): the stored key if
// there is one, otherwise the dialog opens and the promise settles with what
// the person did — the key, or null if they dismissed it.
let prompt = null;
let inflight = null;

export function registerUnlockPrompt(fn) {
  prompt = fn;
  return () => {
    if (prompt === fn) prompt = null;
  };
}

export async function requestAccountKey() {
  const stored = await keystore.get();
  if (stored) return stored;
  if (!prompt) return null;
  // One dialog at a time, however many callers ask.
  if (!inflight) {
    inflight = prompt().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export async function hasAccountKey() {
  return Boolean(await keystore.get());
}

export async function forget() {
  await keystore.clear();
}
