import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import * as c from "../../cli/crypto.js";

// Integration tests against a running server and the database behind it.
// They need:
//
//   ARTIFACT_TEST_SITE   e.g. http://localhost:3000, started with the same
//                        MONGODB_URI and a MONGODB_DB that is not production
//   MONGODB_URI          to plant and remove the test account directly, since
//                        signup sends real email
//   MONGODB_DB           the database that server is using
//
// Without them every test here is skipped, so `npm test` stays green on a
// laptop with no server up. Never point these at the production database:
// the tests insert and delete users.
const SITE = (process.env.ARTIFACT_TEST_SITE || "").replace(/\/$/, "");
const URI = process.env.MONGODB_URI;
const DB = process.env.MONGODB_DB;
const enabled = Boolean(SITE && URI && DB);
const skip = enabled ? false : "set ARTIFACT_TEST_SITE, MONGODB_URI and MONGODB_DB to run";

const email = `e2e-test-${Date.now()}@example.invalid`;
const password = "correct horse battery staple";
let client;
let db;
let cookie = "";
let token = "";
let userId = "";

// The session cookie the way a browser would carry it.
function jar(res) {
  const set = res.headers.get("set-cookie") || "";
  const m = /artifact_session=([^;]+)/.exec(set);
  if (m) cookie = `artifact_session=${m[1]}`;
}

async function call(path, { method = "GET", body, auth } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth === "token") headers.Authorization = `Bearer ${token}`;
  else if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${SITE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  jar(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, res };
}

before(async () => {
  if (!enabled) return;
  client = await new MongoClient(URI).connect();
  db = client.db(DB);
});

after(async () => {
  if (!enabled) return;
  if (userId) {
    await db.collection("artifacts").deleteMany({ userId });
    await db.collection("sessions").deleteMany({ userId });
    await db.collection("tokens").deleteMany({ userId });
  }
  await db.collection("users").deleteMany({ email });
  await db.collection("attempts").deleteMany({ _id: { $regex: email } });
  await client.close();
});

/* ---------- accounts: v1 upgrades to v2 ---------- */

test("a v1 account signs in once with its password, upgrades, and never takes the plain password again", { skip }, async () => {
  // Planted as the old code would have stored it: scrypt of the plain password.
  const { scrypt, randomBytes } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const salt = randomBytes(16);
  const key = await promisify(scrypt)(password, salt, 64);
  const { insertedId } = await db.collection("users").insertOne({
    email,
    name: "E2E",
    passwordHash: `scrypt:${salt.toString("hex")}:${key.toString("hex")}`,
    createdAt: new Date(),
  });
  userId = insertedId.toString();

  // The new browser sends authHash first and learns the account is legacy.
  const { authHash, wrapKey } = await c.split(await c.deriveFromPassword(password, email));
  let r = await call("/api/auth/signin", { method: "POST", body: { email, authHash } });
  assert.equal(r.status, 401);
  assert.equal(r.data.legacy, true);

  // Then upgrades with the plain password one last time.
  const accountKey = await c.newKey();
  const words = await c.phrase.generate();
  const accountKeyByPassword = await c.wrap(accountKey, wrapKey);
  const accountKeyByRecovery = await c.wrap(accountKey, await c.phrase.toKey(words));
  r = await call("/api/auth/upgrade", {
    method: "POST",
    body: { email, password, authHash, accountKeyByPassword, accountKeyByRecovery },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.authVersion, 2);
  assert.ok(cookie, "a session cookie was set");

  // A second upgrade is refused, and the plain password no longer signs in.
  r = await call("/api/auth/upgrade", {
    method: "POST",
    body: { email, password, authHash, accountKeyByPassword, accountKeyByRecovery },
  });
  assert.equal(r.status, 409);
  const saved = cookie;
  cookie = "";
  r = await call("/api/auth/signin", { method: "POST", body: { email, password } });
  assert.equal(r.status, 401);
  assert.equal(r.data.legacy, undefined);

  // authHash does, and hands back the wrapped key, which the wrapKey opens.
  r = await call("/api/auth/signin", { method: "POST", body: { email, authHash } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.authVersion, 2);
  const opened = await c.unwrap(r.data.accountKeyByPassword, wrapKey);
  assert.deepEqual(await c.exportKey(opened), await c.exportKey(accountKey));
  cookie = cookie || saved;

  // The stored blobs are exactly what was sent, and nothing in the user
  // document could open them.
  const doc = await db.collection("users").findOne({ email });
  assert.equal(doc.authVersion, 2);
  assert.deepEqual(doc.accountKeyByPassword, accountKeyByPassword);
  assert.deepEqual(doc.accountKeyByRecovery, accountKeyByRecovery);
  assert.doesNotMatch(JSON.stringify(doc), /"password"/);

  // GET /api/auth/keys answers with both blobs and the email (the salt).
  r = await call("/api/auth/keys");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.accountKeyByRecovery, accountKeyByRecovery);
  assert.equal(r.data.email, email);

  // A token for the artifact tests below.
  r = await call("/api/tokens", { method: "POST", body: { label: "e2e" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  token = r.data.token.secret;

  // The recovery phrase can be replaced, with authHash as the proof.
  const fresh = await c.phrase.generate();
  const rewrapped = await c.wrap(accountKey, await c.phrase.toKey(fresh));
  r = await call("/api/auth/keys", { method: "PATCH", body: { authHash: "A".repeat(43), accountKeyByRecovery: rewrapped } });
  assert.equal(r.status, 401);
  r = await call("/api/auth/keys", { method: "PATCH", body: { authHash, accountKeyByRecovery: rewrapped } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call("/api/auth/keys", { auth: "token" });
  assert.deepEqual(r.data.accountKeyByRecovery, rewrapped);
});

/* ---------- encrypted artifacts ---------- */

test("an encrypted upload round-trips its fields and the server never holds the words", { skip }, async () => {
  assert.ok(token, "the account test ran first");
  const { wrapKey } = await c.split(await c.deriveFromPassword(password, email));
  const keys = await call("/api/auth/keys", { auth: "token" });
  const accountKey = await c.unwrap(keys.data.accountKeyByPassword, wrapKey);

  const words = "<!doctype html><title>Secret</title><p>the quick brown fox</p>";
  const artKey = await c.newKey();
  const blob = await c.encrypt(words, artKey);
  const artKeyWrapped = await c.wrap(artKey, accountKey);

  let r = await call("/api/upload", {
    method: "POST",
    auth: "token",
    body: { title: "Secret page", enc: 1, html: blob.ct, iv: blob.iv, artKeyWrapped },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.encrypted, true);
  const slug = r.data.slug;

  const stored = await db.collection("artifacts").findOne({ slug });
  assert.equal(stored.enc, 1);
  assert.equal(stored.html, blob.ct);
  assert.doesNotMatch(JSON.stringify(stored), /quick brown fox/);

  r = await call(`/api/artifacts/${slug}`, { auth: "token" });
  assert.equal(r.status, 200);
  assert.equal(r.data.artifact.encrypted, true);
  assert.equal(r.data.artifact.iv, blob.iv);
  assert.deepEqual(r.data.artifact.artKeyWrapped, artKeyWrapped);
  assert.equal(await c.decrypt({ v: 1, iv: r.data.artifact.iv, ct: r.data.artifact.html }, artKey), words);

  r = await call(`/api/artifacts/${slug}?format=html`, { auth: "token" });
  assert.equal(r.status, 409);
  assert.equal(r.data.encrypted, true);

  r = await call("/api/artifacts", { auth: "token" });
  assert.equal(r.data.artifacts.find((a) => a.slug === slug).encrypted, true);

  // Mismatched fields are refused, and so is a plain upload — the server
  // cannot encrypt for anyone.
  r = await call("/api/upload", { method: "POST", auth: "token", body: { title: "x", enc: 1, html: blob.ct } });
  assert.equal(r.status, 400);
  r = await call("/api/upload", { method: "POST", auth: "token", body: { title: "x", html: "<p>hi</p>", iv: blob.iv } });
  assert.equal(r.status, 400);
  r = await call("/api/upload", { method: "POST", auth: "token", body: { title: "x", html: "<p>plain words</p>" } });
  assert.equal(r.status, 400);
  assert.equal(r.data.encryptionRequired, true);
  assert.match(r.data.error, /npm install -g personal-artifact/);
  r = await call(`/api/artifacts/${slug}`, { method: "PATCH", body: { html: "<p>plain</p>" } });
  assert.equal(r.status, 400, "an encrypted artifact refuses plain html");
  r = await call(`/api/artifacts/${slug}`, { method: "PATCH", body: { enc: 1, iv: blob.iv, artKeyWrapped } });
  assert.equal(r.status, 400, "iv without html is refused");

  // The viewer shell for the owner: ciphertext in a data attribute, the two
  // pinned scripts, and no plaintext.
  r = await call(`/a/${slug}`, { auth: "token" });
  assert.equal(r.status, 200);
  assert.match(r.data, /data-ct="/);
  assert.match(r.data, /artifact-crypto\.v1\.js" integrity="sha384-/);
  assert.match(r.data, /artifact-view\.v1\.js" integrity="sha384-/);
  assert.doesNotMatch(r.data, /quick brown fox/);

  // A stranger sees nothing until it is shared; then the same ciphertext.
  const saved = cookie;
  cookie = "";
  r = await call(`/a/${slug}`);
  assert.equal(r.status, 404);
  cookie = saved;
  r = await call(`/api/artifacts/${slug}`, { method: "PATCH", body: { visibility: "public" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cookie = "";
  r = await call(`/a/${slug}`);
  assert.equal(r.status, 200);
  assert.match(r.data, new RegExp(`data-ct="${blob.ct.slice(0, 40)}`));
  cookie = saved;

  // The editor's save: new ciphertext under the same key.
  const edited = await c.encrypt(words.replace("fox", "dog"), artKey);
  r = await call(`/api/artifacts/${slug}`, {
    method: "PATCH",
    body: { enc: 1, html: edited.ct, iv: edited.iv, artKeyWrapped },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call(`/api/artifacts/${slug}`, { auth: "token" });
  assert.match(await c.decrypt({ v: 1, iv: r.data.artifact.iv, ct: r.data.artifact.html }, artKey), /brown dog/);

  // Passphrase sharing stores the passphrase wrapping beside the hash, and
  // removing the passphrase clears it.
  const byPassphrase = await c.wrapWithPassphrase(artKey, "salt marsh heron");
  r = await call(`/api/artifacts/${slug}`, {
    method: "PATCH",
    body: { passphrase: "salt marsh heron", artKeyByPassphrase: byPassphrase },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.artifact.hasPassphrase, true);
  assert.deepEqual(r.data.artifact.artKeyByPassphrase, byPassphrase);
  cookie = "";
  r = await call(`/a/${slug}`);
  assert.equal(r.status, 401);
  r = await call(`/a/${slug}`, { method: "POST", body: { passphrase: "salt marsh heron" } });
  assert.equal(r.status, 200);
  cookie = saved;
  r = await call(`/api/artifacts/${slug}`, { method: "PATCH", body: { passphrase: null } });
  assert.equal(r.data.artifact.artKeyByPassphrase, null);

  // An artifact from before encryption — planted as the old code stored it
  // — becomes encrypted through PATCH (what the lock in the dashboard sends),
  // and nothing makes it plain again: an upload over it must be encrypted.
  const plainSlug = `plain-e2e-${Date.now()}`;
  await db.collection("artifacts").insertOne({
    slug: plainSlug, title: "Plain", html: "<p>plain words</p>", projectId: null, userId,
    visibility: "private", shareExpiresAt: null, sharePassHash: null, bytes: 18, deletedAt: null, createdAt: new Date(),
  });
  r = await call("/api/artifacts", { auth: "token" });
  assert.equal(r.data.artifacts.find((a) => a.slug === plainSlug).encrypted, false);
  r = await call(`/api/artifacts/${plainSlug}`, { method: "PATCH", body: { html: "<p>plain edit</p>" } });
  assert.equal(r.status, 200, "the editor still saves a plain artifact from before encryption");
  const key2 = await c.newKey();
  const blob2 = await c.encrypt("<p>plain words</p>", key2);
  r = await call(`/api/artifacts/${plainSlug}`, {
    method: "PATCH",
    body: { enc: 1, html: blob2.ct, iv: blob2.iv, artKeyWrapped: await c.wrap(key2, accountKey) },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.artifact.encrypted, true);
  r = await call("/api/upload", { method: "POST", auth: "token", body: { title: "Plain", html: "<p>plain again</p>", slug: plainSlug } });
  assert.equal(r.status, 400);
  assert.equal(r.data.encryptionRequired, true);
  const back = await db.collection("artifacts").findOne({ slug: plainSlug });
  assert.equal(back.enc, 1);
});

/* ---------- the CLI hand-off ---------- */

test("the device flow relays a sealed account key it cannot open", { skip }, async () => {
  assert.ok(cookie, "signed in");
  const pair = await c.ecdh.generate();
  let r = await call("/api/cli/start", { method: "POST", body: { device: "e2e box", cliPublicKey: pair.publicKey } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.fingerprint, pair.fingerprint);
  const { userCode, deviceCode } = r.data;

  const secret = c.randomBytes(32);
  const accountKeySealed = await c.ecdh.seal(secret, pair.publicKey);
  r = await call("/api/cli/approve", { method: "POST", body: { userCode, approve: true, accountKeySealed } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.keyHandedOver, true);

  const saved = cookie;
  cookie = "";
  r = await call("/api/cli/poll", { method: "POST", body: { deviceCode } });
  cookie = saved;
  assert.equal(r.data.status, "approved");
  assert.match(r.data.token, /^pa_/);
  assert.deepEqual(await c.ecdh.open(r.data.accountKeySealed, pair.privateKey, pair.publicKey), secret);

  // Once handed over, gone.
  cookie = "";
  r = await call("/api/cli/poll", { method: "POST", body: { deviceCode } });
  cookie = saved;
  assert.equal(r.data.status, "expired");
  await db.collection("tokens").deleteMany({ userId, label: "e2e box" });
});

/* ---------- password reset ---------- */

test("a reset carries the account key over with the recovery phrase, or replaces it on request", { skip }, async () => {
  // A code is emailed in production; here it is planted directly, the way
  // the request route stores it.
  const { createHash, randomBytes } = await import("node:crypto");
  const code = "ABCDEF";
  await db.collection("passwordResets").deleteMany({ userId });
  await db.collection("passwordResets").insertOne({
    _id: randomBytes(16).toString("hex"),
    userId,
    codeHash: createHash("sha256").update(code).digest("hex"),
    attempts: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
  });

  cookie = "";
  let r = await call("/api/auth/reset/confirm", { method: "POST", body: { email, code } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.authVersion, 2);
  assert.ok(c.isBlob(r.data.accountKeyByRecovery));

  // Without the phrase-derived wrapping the reset is refused and says why.
  const next = "a brand new password";
  const { authHash: nextHash, wrapKey: nextWrap } = await c.split(await c.deriveFromPassword(next, email));
  r = await call("/api/auth/reset/confirm", { method: "POST", body: { email, code, authHash: nextHash } });
  assert.equal(r.status, 400);
  assert.equal(r.data.needsRecovery, true);

  // Starting over with fresh keys is allowed only when said out loud.
  const fresh = await c.newKey();
  const words = await c.phrase.generate();
  r = await call("/api/auth/reset/confirm", {
    method: "POST",
    body: {
      email,
      code,
      authHash: nextHash,
      replaceKeys: true,
      accountKeyByPassword: await c.wrap(fresh, nextWrap),
      accountKeyByRecovery: await c.wrap(fresh, await c.phrase.toKey(words)),
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.keysReplaced, true);

  r = await call("/api/auth/signin", { method: "POST", body: { email, authHash: nextHash } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const opened = await c.unwrap(r.data.accountKeyByPassword, nextWrap);
  assert.deepEqual(await c.exportKey(opened), await c.exportKey(fresh));
});
