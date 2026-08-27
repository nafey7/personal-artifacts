import { MongoClient, ObjectId } from "mongodb";

// Connect lazily and cache the promise across hot reloads (dev) and lambda
// invocations (Vercel), so we never open a connection at build time. If the
// connect fails, drop the cached promise so the next request retries instead
// of the instance serving the same rejection forever.
function client() {
  if (!global._mongoClientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    global._mongoClientPromise = new MongoClient(uri).connect().catch((err) => {
      global._mongoClientPromise = undefined;
      throw err;
    });
  }
  return global._mongoClientPromise;
}

async function db() {
  const c = await client();
  return c.db(process.env.MONGODB_DB || "artifacts");
}

export async function artifacts() {
  return (await db()).collection("artifacts");
}

export async function projects() {
  return (await db()).collection("projects");
}

export function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
