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
  const database = await db();
  await ensureIndexes(database);
  return database.collection("artifacts");
}

export async function projects() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("projects");
}

// Indexes are created once per process, behind a cached promise, so the email
// uniqueness guard exists without a separate migration step.
let indexesPromise;
function ensureIndexes(database) {
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      database.collection("users").createIndex({ email: 1 }, { unique: true }),
      database.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
      // Mongo evicts expired sessions on its own, so nothing accumulates.
      database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      // Every dashboard read filters by owner.
      database.collection("artifacts").createIndex({ userId: 1, createdAt: -1 }),
      database.collection("artifacts").createIndex({ slug: 1 }, { unique: true }),
      database.collection("projects").createIndex({ userId: 1, name: 1 }),
      database.collection("projects").createIndex({ slug: 1 }, { unique: true }),
    ]).catch((err) => {
      indexesPromise = undefined;
      throw err;
    });
  }
  return indexesPromise;
}

export async function users() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("users");
}

export async function sessions() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("sessions");
}

export function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
