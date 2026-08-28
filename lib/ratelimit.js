import { attempts } from "@/lib/mongo";

// Counters live in Mongo rather than memory because every request may land on a
// different serverless instance, and an in-memory limiter would reset with each
// cold start. A TTL index on expiresAt clears them.
export async function tooManyAttempts(key, { limit, windowSeconds }) {
  const col = await attempts();
  const now = new Date();

  // One upsert does the whole job: start a window or extend the count in it.
  const doc = await col.findOneAndUpdate(
    { _id: key, expiresAt: { $gt: now } },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date(now.getTime() + windowSeconds * 1000) },
    },
    { upsert: true, returnDocument: "after" }
  );

  return (doc?.count ?? 1) > limit;
}

// Reset on success, so a person who mistypes twice and then signs in correctly
// isn't still carrying the failures.
export async function clearAttempts(key) {
  const col = await attempts();
  await col.deleteOne({ _id: key });
}

// Vercel sets x-forwarded-for; the first entry is the client. Absent it, all
// callers share one bucket, which fails closed rather than open.
export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}
