import { createHmac, timingSafeEqual } from "crypto";

// A shared link can carry two optional restrictions on top of
// visibility: "public" — a moment after which it stops opening, and a
// passphrase the viewer has to type first. Both live on the artifact document:
//
//   shareExpiresAt  Date | null      the link closes at this instant
//   sharePassHash   string | null    scrypt hash, same format as a password
//
// Neither field changes what "private" means. An expired or passphrase-gated
// artifact still opens for its owner exactly as a private one does.

const UNITS = { m: 60, h: 3600, d: 86400, w: 604800 };
const MAX_SECONDS = 366 * 86400;
const MIN_PASSPHRASE = 4;
const MAX_PASSPHRASE = 200;

// "30m", "24h", "7d", "2w" → seconds. Anything else → null.
export function parseDuration(value) {
  const m = /^(\d+(?:\.\d+)?)\s*([mhdw])$/i.exec(String(value ?? "").trim());
  if (!m) return null;
  const seconds = Number(m[1]) * UNITS[m[2].toLowerCase()];
  return seconds > 0 ? seconds : null;
}

function unset(value) {
  return value === null || value === "" || value === "never";
}

// Reads an expiry out of a request body. Callers may send either
// `expiresIn` (a duration such as "7d", or a number of seconds) or `expiresAt`
// (an ISO 8601 instant); null, "" or "never" clears it. Returns
// { present: false } when the body says nothing about expiry, otherwise
// { present: true, value: Date | null } or { present: true, error }.
export function readExpiry(body, now = new Date()) {
  const has = (key) => key in body && body[key] !== undefined;
  if (!has("expiresIn") && !has("expiresAt")) return { present: false };

  let date = null;
  if (has("expiresIn")) {
    const raw = body.expiresIn;
    if (!unset(raw)) {
      const seconds = typeof raw === "number" ? raw : parseDuration(raw);
      if (!seconds || seconds <= 0) {
        return { present: true, error: "expiresIn must be a duration like 30m, 24h, 7d or 2w" };
      }
      date = new Date(now.getTime() + seconds * 1000);
    }
  } else {
    const raw = body.expiresAt;
    if (!unset(raw)) {
      date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        return { present: true, error: "expiresAt must be an ISO 8601 date" };
      }
      if (date <= now) return { present: true, error: "expiresAt is already in the past" };
    }
  }

  if (date && date.getTime() - now.getTime() > MAX_SECONDS * 1000) {
    return { present: true, error: "a link can be shared for at most a year at a time" };
  }
  return { present: true, value: date };
}

// Reads a passphrase out of a request body. null or "" removes one. Same
// return shape as readExpiry. The value comes back in the clear; the caller
// hashes it.
export function readPassphrase(body) {
  if (!("passphrase" in body) || body.passphrase === undefined) return { present: false };
  const raw = body.passphrase;
  if (raw === null || raw === "") return { present: true, value: null };
  if (typeof raw !== "string") return { present: true, error: "passphrase must be a string" };
  if (raw.length < MIN_PASSPHRASE) {
    return { present: true, error: `passphrase must be at least ${MIN_PASSPHRASE} characters` };
  }
  if (raw.length > MAX_PASSPHRASE) {
    return { present: true, error: `passphrase must be at most ${MAX_PASSPHRASE} characters` };
  }
  return { present: true, value: raw };
}

export function hasExpired(doc, now = new Date()) {
  return Boolean(doc.shareExpiresAt) && new Date(doc.shareExpiresAt) <= now;
}

// True when a stranger holding the link may open it, passphrase permitting.
export function linkIsOpen(doc, now = new Date()) {
  return doc.visibility === "public" && !hasExpired(doc, now);
}

// The shape the dashboard and the API hand back. Never the hash itself.
export function shareSummary(doc, now = new Date()) {
  return {
    isPublic: doc.visibility === "public",
    expiresAt: doc.shareExpiresAt ? new Date(doc.shareExpiresAt).toISOString() : null,
    isExpired: doc.visibility === "public" && hasExpired(doc, now),
    hasPassphrase: Boolean(doc.sharePassHash),
  };
}

/* ---------- the viewer's grant ---------- */

// Once a viewer types the right passphrase they get a cookie scoped to that
// one artifact's path, so they aren't asked again on every reload. The value
// is an HMAC of the slug keyed by the stored hash: it holds nothing that can
// be turned back into the passphrase, it cannot be lifted from one artifact
// and presented to another, and changing or removing the passphrase silently
// revokes every grant already handed out — no table of grants to keep.
export const GRANT_COOKIE = "artifact_pass";
const GRANT_MAX_DAYS = 30;

export function grantValue(slug, passHash) {
  return createHmac("sha256", passHash).update(slug).digest("hex");
}

export function grantMatches(presented, slug, passHash) {
  if (typeof presented !== "string" || !passHash) return false;
  const expected = Buffer.from(grantValue(slug, passHash), "utf8");
  const actual = Buffer.from(presented, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// The cookie that arrived for this request, if any. Cookies are path-scoped
// per artifact so only the one for this slug is ever sent here, but the value
// is verified regardless.
export function readGrant(request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === GRANT_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// The Set-Cookie header that records a successful passphrase. It lives no
// longer than the link does.
export function grantCookie(slug, passHash, doc, now = new Date()) {
  let maxAge = GRANT_MAX_DAYS * 86400;
  if (doc.shareExpiresAt) {
    const remaining = Math.floor((new Date(doc.shareExpiresAt).getTime() - now.getTime()) / 1000);
    maxAge = Math.max(1, Math.min(maxAge, remaining));
  }
  const parts = [
    `${GRANT_COOKIE}=${grantValue(slug, passHash)}`,
    `Path=/a/${slug}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
