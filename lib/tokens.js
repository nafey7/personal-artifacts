import { randomBytes, createHash } from "crypto";
import { tokens } from "@/lib/mongo";

// Tokens are shown once at creation and stored only as a SHA-256 hash, so a
// database dump cannot be used to publish. The prefix is kept in the clear
// purely so the owner can tell their tokens apart in the settings list.
const PREFIX = "pa_";

export function mintToken() {
  const secret = `${PREFIX}${randomBytes(24).toString("hex")}`;
  return { secret, hash: hashToken(secret), prefix: secret.slice(0, PREFIX.length + 6) };
}

export function hashToken(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

// Resolves a bearer token to its owner's id, or null. Records last use so an
// unused token is obvious in the settings list.
export async function ownerOfToken(secret) {
  if (typeof secret !== "string" || !secret.startsWith(PREFIX)) return null;

  const col = await tokens();
  const doc = await col.findOneAndUpdate(
    { tokenHash: hashToken(secret) },
    { $set: { lastUsedAt: new Date() } },
    { returnDocument: "after" }
  );
  return doc ? doc.userId : null;
}
