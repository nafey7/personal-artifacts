import { pendingAuth } from "@/lib/mongo";
import { hashCode } from "@/lib/device";

export const dynamic = "force-dynamic";

// The CLI asks, repeatedly, whether the person has approved yet. An approved
// request hands over the token exactly once and is then destroyed, so the same
// device code cannot be replayed.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode : "";
  if (!deviceCode) return Response.json({ error: "deviceCode is required" }, { status: 400 });

  const col = await pendingAuth();
  const doc = await col.findOne({ deviceCodeHash: hashCode(deviceCode) });

  // Expired rows may outlive the TTL sweep by a minute or two; treat them as gone.
  if (!doc || new Date(doc.expiresAt) < new Date()) {
    return Response.json({ status: "expired" });
  }
  if (doc.status === "denied") {
    await col.deleteOne({ _id: doc._id });
    return Response.json({ status: "denied" });
  }
  if (doc.status !== "approved") {
    return Response.json({ status: "pending" });
  }

  await col.deleteOne({ _id: doc._id });
  return Response.json({
    status: "approved",
    token: doc.secret,
    user: doc.user,
    // The account key, sealed to the public key this CLI sent when it
    // started; null when the approving browser had no key to give.
    accountKeySealed: doc.accountKeySealed || null,
  });
}
