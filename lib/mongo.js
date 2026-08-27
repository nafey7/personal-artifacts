import { MongoClient } from "mongodb";

// Connect lazily and cache the promise across hot reloads (dev) and lambda
// invocations (Vercel), so we never open a connection at build time.
function client() {
  if (!global._mongoClientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    global._mongoClientPromise = new MongoClient(uri).connect();
  }
  return global._mongoClientPromise;
}

export async function artifacts() {
  const c = await client();
  return c.db(process.env.MONGODB_DB || "artifacts").collection("artifacts");
}
