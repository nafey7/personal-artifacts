// The one place encryption happens, for the CLI and the browser alike.
//
// Everything here is WebCrypto on `globalThis.crypto`, so the same file runs
// in Node 20+ and in every current browser with no dependency and no build.
// The browser copy at public/artifact-crypto.v1.js is generated from this
// file by scripts/sync-crypto.mjs, so the code a person can read on npm is the
// code their browser runs — and a test fails if the two ever drift.
//
// The shapes, all of them opaque to the server:
//
//   blob            { v: 1, iv, ct }            AES-256-GCM, fields base64url
//   passphrase blob { v: 1, salt, iv, ct }      same, plus the PBKDF2 salt
//   sealed blob     { v: 1, epk, iv, ct }       ECDH P-256 to a public key
//
// The `v` in every blob is what lets PBKDF2 give way to Argon2id, or GCM to
// something else, without a flag day: a reader checks the version and picks.
//
// Keys, and who holds them:
//
//   passKey      PBKDF2(password, email) — never leaves the client
//   authHash     HKDF(passKey, "auth")   — sent instead of the password;
//                                          the server scrypts it as before
//   wrapKey      HKDF(passKey, "wrap")   — encrypts the account key
//   accountKey   32 random bytes         — encrypts every artifact key
//   recoveryKey  HKDF(12 BIP39 words)    — a second wrapping of accountKey
//   artKey       32 random bytes         — one per artifact, encrypts the HTML
//
// The server stores accountKey wrapped under wrapKey and under recoveryKey,
// and each artKey wrapped under accountKey. It never holds anything that can
// open any of them.

import { WORDLIST } from "./wordlist.js";

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const VERSION = 1;

// About one second on a phone, under half on a laptop. Shown as "unlocking".
export const PBKDF2_ITERATIONS = 600000;

const AES = { name: "AES-GCM", length: 256 };
const HKDF_SALT = encoder.encode("personal-artifact");

/* ---------- bytes ---------- */

// getRandomValues fills at most 65536 bytes per call.
export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    globalThis.crypto.getRandomValues(bytes.subarray(i, Math.min(n, i + 65536)));
  }
  return bytes;
}

// base64url without padding: safe in a URL fragment, a JSON string and a
// Mongo field alike. Chunked so a 2MB page does not blow the call stack.
export const b64u = {
  encode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text) {
    if (typeof text !== "string" || /[^A-Za-z0-9_-]/.test(text)) {
      throw new Error("not base64url");
    }
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
};

// True when `value` has the shape of a blob this module wrote. The server
// uses it to refuse garbage without ever being able to open the real thing.
export function isBlob(value, fields = ["iv", "ct"]) {
  if (!value || typeof value !== "object" || value.v !== VERSION) return false;
  for (const field of fields) {
    const text = value[field];
    if (typeof text !== "string" || !text || /[^A-Za-z0-9_-]/.test(text)) return false;
  }
  return b64u.decode(value.iv).length === 12;
}

/* ---------- AES-GCM ---------- */

export async function newKey() {
  return subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
}

export async function exportKey(key) {
  return new Uint8Array(await subtle.exportKey("raw", key));
}

export async function importKey(bytes, { extractable = true } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("a key is 32 bytes");
  return subtle.importKey("raw", bytes, AES, extractable, ["encrypt", "decrypt"]);
}

async function sealBytes(bytes, key) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { v: VERSION, iv: b64u.encode(iv), ct: b64u.encode(new Uint8Array(ct)) };
}

async function openBytes(blob, key) {
  if (!isBlob(blob)) throw new Error("not an encrypted blob");
  return new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv: b64u.decode(blob.iv) }, key, b64u.decode(blob.ct))
  );
}

// A key, encrypted under another key. Unwrapping an artifact key gives one
// that can be exported again (to put in a share link, or seal to a machine);
// the account key is unwrapped non-extractable for day-to-day use so page
// script can use it but never read it.
export async function wrap(key, withKey) {
  return sealBytes(await exportKey(key), withKey);
}

export async function unwrap(blob, withKey, options) {
  return importKey(await openBytes(blob, withKey), options);
}

export async function encrypt(text, key) {
  return sealBytes(encoder.encode(text), key);
}

export async function decrypt(blob, key) {
  return decoder.decode(await openBytes(blob, key));
}

/* ---------- from a password ---------- */

function hkdfKey(baseKey, info, { extractable = false } = {}) {
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: encoder.encode(info) },
    baseKey,
    AES,
    extractable,
    ["encrypt", "decrypt"]
  );
}

async function hkdfBits(baseKey, info) {
  return new Uint8Array(
    await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: encoder.encode(info) },
      baseKey,
      256
    )
  );
}

// The slow step. The email is the salt, so the same password on two accounts
// gives two unrelated keys, and there is no salt to store or fetch before
// signing in. Returns an HKDF base key the two halves are drawn from.
export async function deriveFromPassword(password, email) {
  const salt = encoder.encode(`personal-artifact:v1:${String(email).trim().toLowerCase()}`);
  const raw = await subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    raw,
    256
  );
  return subtle.importKey("raw", bits, "HKDF", false, ["deriveBits", "deriveKey"]);
}

// Two independent secrets from one derivation: what the server sees, and
// what it never does. Knowing authHash says nothing about wrapKey.
export async function split(passKey) {
  const [auth, wrapKey] = await Promise.all([
    hkdfBits(passKey, "personal-artifact auth"),
    hkdfKey(passKey, "personal-artifact wrap"),
  ]);
  return { authHash: b64u.encode(auth), wrapKey };
}

/* ---------- from a passphrase on a shared link ---------- */

// A random salt travels with the blob, so a passphrase can be set before the
// artifact has a slug and two artifacts with the same passphrase still get
// different keys.
async function passphraseKey(passphrase, salt) {
  const raw = await subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    raw,
    AES,
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapWithPassphrase(key, passphrase) {
  const salt = randomBytes(16);
  const blob = await wrap(key, await passphraseKey(passphrase, salt));
  return { ...blob, salt: b64u.encode(salt) };
}

export async function unwrapWithPassphrase(blob, passphrase) {
  if (!isBlob(blob, ["salt", "iv", "ct"])) throw new Error("not a passphrase blob");
  return unwrap(blob, await passphraseKey(passphrase, b64u.decode(blob.salt)));
}

/* ---------- the recovery phrase ---------- */

async function sha256(bytes) {
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

// BIP39 encoding: 128 bits of entropy, then the first 4 bits of its SHA-256
// as a checksum, read out as twelve 11-bit indexes into the wordlist.
async function wordsFromEntropy(entropy) {
  if (entropy.length !== 16) throw new Error("entropy is 16 bytes");
  const check = (await sha256(entropy))[0] >> 4;
  let bits = "";
  for (const byte of entropy) bits += byte.toString(2).padStart(8, "0");
  bits += check.toString(2).padStart(4, "0");
  const words = [];
  for (let i = 0; i < 12; i++) words.push(WORDLIST[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  return words;
}

export function normalizePhrase(text) {
  return String(Array.isArray(text) ? text.join(" ") : text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Words back to entropy, or an Error that says which word is wrong. The
// checksum catches a swapped or misheard word before it turns into a key that
// silently opens nothing.
async function entropyFromWords(input) {
  const words = normalizePhrase(input);
  if (words.length !== 12) throw new Error(`a recovery phrase is twelve words, not ${words.length}`);
  let bits = "";
  for (const word of words) {
    const index = WORDLIST.indexOf(word);
    if (index === -1) throw new Error(`"${word}" is not a word from a recovery phrase — check the spelling`);
    bits += index.toString(2).padStart(11, "0");
  }
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const check = (await sha256(entropy))[0] >> 4;
  if (check !== parseInt(bits.slice(128), 2)) {
    throw new Error("that is not a valid recovery phrase — one of the words is wrong or out of order");
  }
  return entropy;
}

export const phrase = {
  async generate() {
    return wordsFromEntropy(randomBytes(16));
  },
  fromEntropy: wordsFromEntropy,
  toEntropy: entropyFromWords,
  // The key the account key is wrapped under for recovery. Extractable is
  // never needed: it only ever unwraps.
  async toKey(words) {
    const entropy = await entropyFromWords(words);
    const base = await subtle.importKey("raw", entropy, "HKDF", false, ["deriveKey"]);
    return hkdfKey(base, "personal-artifact recovery");
  },
};

/* ---------- handing a secret to another machine ---------- */

const EC = { name: "ECDH", namedCurve: "P-256" };

async function fingerprintOf(publicBytes) {
  const hash = await sha256(publicBytes);
  return Array.from(hash.subarray(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sharedKey(privateKey, publicBytes, publicForSalt) {
  const peer = await subtle.importKey("raw", publicBytes, EC, true, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const base = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: publicForSalt, info: encoder.encode("personal-artifact ecdh v1") },
    base,
    AES,
    false,
    ["encrypt", "decrypt"]
  );
}

// The CLI makes a key pair and sends the public half with its sign-in
// request. The browser that approves the machine seals the account key to
// that public key; the server relays a blob it cannot open; the CLI opens it
// with the private half that never left the machine. The fingerprint is shown
// on both ends so a person can see they match.
export const ecdh = {
  async generate() {
    const pair = await subtle.generateKey(EC, false, ["deriveBits"]);
    const publicBytes = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
    return {
      publicKey: b64u.encode(publicBytes),
      privateKey: pair.privateKey,
      fingerprint: await fingerprintOf(publicBytes),
    };
  },
  async fingerprint(publicKey) {
    return fingerprintOf(b64u.decode(publicKey));
  },
  isPublicKey(value) {
    try {
      const bytes = b64u.decode(value);
      return bytes.length === 65 && bytes[0] === 4;
    } catch {
      return false;
    }
  },
  async seal(bytes, publicKey) {
    const peerBytes = b64u.decode(publicKey);
    const ephemeral = await subtle.generateKey(EC, false, ["deriveBits"]);
    const epk = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));
    const key = await sharedKey(ephemeral.privateKey, peerBytes, peerBytes);
    return { ...(await sealBytes(bytes, key)), epk: b64u.encode(epk) };
  },
  async open(blob, privateKey, ownPublicKey) {
    if (!isBlob(blob, ["epk", "iv", "ct"])) throw new Error("not a sealed blob");
    const key = await sharedKey(privateKey, b64u.decode(blob.epk), b64u.decode(ownPublicKey));
    return openBytes(blob, key);
  },
};
