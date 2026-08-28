import { randomBytes, createHash } from "crypto";

// The code a person reads and types is deliberately short and unambiguous —
// no O/0, no I/1/L. It only identifies the request; it cannot fetch the token.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export const CODE_TTL_SECONDS = 600; // ten minutes to finish signing in

export function makeUserCode() {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
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

// Shown to the person approving, so keep it recognisable but harmless.
export function cleanDeviceName(value) {
  const name = String(value || "").trim().replace(/[^\w @.'-]/g, "").slice(0, 60);
  return name || "an unnamed machine";
}
