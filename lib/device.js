import { randomBytes, createHash, timingSafeEqual } from "crypto";

// The code a person reads and types is deliberately short and unambiguous —
// no O/0, no I/1/L. It only identifies the request; it cannot fetch the token.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export const CODE_TTL_SECONDS = 600; // ten minutes to finish signing in

// Deliberately a separate constant from CODE_TTL_SECONDS even though the two
// are equal today. Machine approval and email verification are different jobs
// that happen to want the same window; changing one must not move the other.
export const VERIFY_TTL_SECONDS = 600; // ten minutes to type the emailed code

export function makeUserCode() {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// Emailed verification and password-reset codes. Six characters from the same
// unambiguous alphabet — read off a phone screen and typed back, so the shape
// matters more than the length. 30^6 is ~7e8, and five guesses per code makes
// brute force pointless.
export function makeVerificationCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// The device code is the actual secret: only the CLI that started the flow
// holds it, so watching someone type their user code into a browser is not
// enough to steal the token that comes out the other end.
export function makeDeviceCode() {
  return randomBytes(32).toString("hex");
}

export function hashCode(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

// Compared on the hashes, in constant time, for the same reason sessions are:
// the database never holds anything replayable, and a timing signal must not
// leak how much of a guess was right.
export function codeMatches(candidate, storedHash) {
  const a = Buffer.from(hashCode(candidate), "hex");
  const b = Buffer.from(String(storedHash || ""), "hex");
  if (a.length !== b.length || b.length === 0) return false;
  return timingSafeEqual(a, b);
}

// Shown to the person approving, so keep it recognisable but harmless.
export function cleanDeviceName(value) {
  const name = String(value || "").trim().replace(/[^\w @.'-]/g, "").slice(0, 60);
  return name || "an unnamed machine";
}
