import { cookies } from "next/headers";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { users, sessions, toObjectId } from "@/lib/mongo";

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = "artifact_session";
const SESSION_DAYS = 30;

/* ---------- passwords ---------- */

// scrypt from the standard library, so the app stays dependency-free. The salt
// travels with the hash: "scrypt:<salt-hex>:<key-hex>".
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

/* ---------- sessions ---------- */

// Only the hash of the session token is stored, so a database dump can't be
// replayed as a login.
function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);

  const col = await sessions();
  await col.insertOne({ tokenHash: tokenHash(token), userId, createdAt: new Date(), expiresAt });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const col = await sessions();
    await col.deleteOne({ tokenHash: tokenHash(token) });
  }
  jar.delete(SESSION_COOKIE);
}

// The signed-in user, or null. Expired sessions are swept as they are hit.
export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const col = await sessions();
  const session = await col.findOne({ tokenHash: tokenHash(token) });
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    await col.deleteOne({ _id: session._id });
    return null;
  }

  const _id = toObjectId(session.userId);
  if (!_id) return null;
  const doc = await (await users()).findOne({ _id }, { projection: { passwordHash: 0 } });
  if (!doc) return null;

  return publicUser(doc);
}

// The shape every route hands back for the signed-in person. authVersion is
// what tells the browser whether this account has encryption keys yet.
export function publicUser(doc) {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name || "",
    authVersion: doc.authVersion === 2 ? 2 : 1,
  };
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// Deliberately loose — the mail server is the real validator.
export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
