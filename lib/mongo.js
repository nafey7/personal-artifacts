import { MongoClient, ObjectId } from "mongodb";
import { TRASH_SECONDS } from "@/lib/limits";

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
      // The trash empties itself: Mongo removes an artifact TRASH_SECONDS
      // after its deletedAt stamp. Documents with no deletedAt, or a null
      // one, are never touched by a TTL index, so live artifacts stay put.
      trashTtlIndex(database),
      database.collection("projects").createIndex({ userId: 1, name: 1 }),
      database.collection("projects").createIndex({ slug: 1 }, { unique: true }),
      database.collection("tokens").createIndex({ tokenHash: 1 }, { unique: true }),
      database.collection("tokens").createIndex({ userId: 1, createdAt: -1 }),
      // Sign-in and sign-up attempt counters clean themselves up.
      database.collection("attempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      // Half-finished CLI sign-ins expire on their own.
      database.collection("pendingAuth").createIndex({ deviceCodeHash: 1 }, { unique: true }),
      database.collection("pendingAuth").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      // Half-finished signups and reset requests do the same. Without these the
      // rows would pile up forever in a database with a 512MB ceiling.
      database.collection("pendingSignups").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database.collection("passwordResets").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((err) => {
      indexesPromise = undefined;
      throw err;
    });
  }
  return indexesPromise;
}

// Retention is configurable, and Mongo refuses a createIndex that redefines
// an existing one's options. Fall back to collMod so changing TRASH_DAYS
// takes effect on the next boot instead of throwing on every request.
async function trashTtlIndex(database) {
  const name = "deletedAt_ttl";
  const col = database.collection("artifacts");
  try {
    await col.createIndex({ deletedAt: 1 }, { name, expireAfterSeconds: TRASH_SECONDS });
  } catch (err) {
    // 85 IndexOptionsConflict, 86 IndexKeySpecsConflict
    if (err?.code !== 85 && err?.code !== 86) throw err;
    await database.command({
      collMod: "artifacts",
      index: { name, expireAfterSeconds: TRASH_SECONDS },
    });
  }
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

export async function tokens() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("tokens");
}

export async function pendingAuth() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("pendingAuth");
}

// Keyed by email, which is what makes a re-submitted signup replace the first
// attempt instead of colliding with it.
export async function pendingSignups() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("pendingSignups");
}

export async function passwordResets() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("passwordResets");
}

export async function attempts() {
  const database = await db();
  await ensureIndexes(database);
  return database.collection("attempts");
}

export function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
