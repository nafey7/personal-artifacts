#!/usr/bin/env node
// One-off: artifacts and projects created before accounts existed have no
// userId and no visibility. This assigns them to one account and marks them
// private. Safe to re-run — it only touches documents that still lack a userId.
//
//   node scripts/claim-existing.mjs you@example.com
//   node scripts/claim-existing.mjs you@example.com --dry-run
//
// With no email it picks the oldest account.

import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

// .env.local is Next's file, not Node's, so read it here rather than adding a
// dependency just to load it.
function loadEnv(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Environment may already be populated (CI, `vercel env pull`, etc).
  }
}

loadEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}

const client = await new MongoClient(uri).connect();
try {
  const db = client.db(process.env.MONGODB_DB || "artifacts");

  const user = email
    ? await db.collection("users").findOne({ email })
    : await db.collection("users").find({}).sort({ createdAt: 1 }).limit(1).next();

  if (!user) {
    console.error(email ? `no account with email ${email}` : "no accounts exist yet — sign up first");
    process.exit(1);
  }

  const userId = user._id.toString();
  const orphaned = { userId: { $exists: false } };

  const [artifactCount, projectCount] = await Promise.all([
    db.collection("artifacts").countDocuments(orphaned),
    db.collection("projects").countDocuments(orphaned),
  ]);

  console.log(`account:   ${user.email} (${userId})`);
  console.log(`artifacts: ${artifactCount} unowned`);
  console.log(`projects:  ${projectCount} unowned`);

  if (dryRun) {
    console.log("\n--dry-run — nothing was written");
    process.exit(0);
  }
  if (!artifactCount && !projectCount) {
    console.log("\nnothing to do");
    process.exit(0);
  }

  const now = new Date();
  const [artifactResult, projectResult] = await Promise.all([
    db.collection("artifacts").updateMany(orphaned, {
      $set: { userId, visibility: "private", updatedAt: now },
    }),
    db.collection("projects").updateMany(orphaned, { $set: { userId, updatedAt: now } }),
  ]);

  console.log(`\nclaimed ${artifactResult.modifiedCount} artifacts, ${projectResult.modifiedCount} projects`);
  console.log("existing /a/ links now require signing in as this account;");
  console.log('use the "Private" toggle in the dashboard to re-share any of them.');
} finally {
  await client.close();
}
