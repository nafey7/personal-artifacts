import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as c from "../crypto.js";

// The CLI against a stand-in for the site: every request it makes is
// recorded, so the tests can say what left the machine. The point of the
// encrypted tests is the negative: the plaintext must not be in any body.
const here = dirname(fileURLToPath(import.meta.url));
const publish = join(here, "..", "publish.js");

let server;
let site;
let requests = [];
let home;
let accountKey;
let accountKeyB64;

// What the fake site answers with. Tests set `stored` to shape `get`.
let stored = null;

before(async () => {
  accountKey = await c.newKey();
  accountKeyB64 = c.b64u.encode(await c.exportKey(accountKey));

  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, url: req.url, body: parsed, auth: req.headers.authorization });

    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (req.url === "/api/upload") {
      return json(201, {
        slug: "page-abc123",
        url: `${site}/a/page-abc123`,
        updated: false,
        visibility: parsed.visibility || "private",
        isPublic: parsed.visibility === "public",
        hasPassphrase: Boolean(parsed.passphrase),
        encrypted: parsed.enc === 1,
        note: "ok",
      });
    }
    if (req.url.startsWith("/api/artifacts/") && req.method === "GET") {
      if (!stored) return json(404, { error: "not found" });
      const meta = req.url.includes("meta=1");
      const { html, ...rest } = stored;
      return json(200, { artifact: meta ? rest : stored });
    }
    if (req.url.startsWith("/api/artifacts") && req.method === "GET") {
      return json(200, { artifacts: stored ? [stored] : [] });
    }
    json(404, { error: "no such route in the test server" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${server.address().port}`;

  // A home directory of its own, so the real ~/.artifact-publish.json and the
  // installed skills are never touched.
  home = mkdtempSync(join(tmpdir(), "personal-artifact-test-"));
  writeFileSync(join(home, ".artifact-publish.json"), JSON.stringify({ site, token: "pa_test", accountKey: accountKeyB64 }));
  writeFileSync(join(home, "page.html"), "<!doctype html><title>Secret</title><p>the quick brown fox</p>");
});

after(() => {
  server.close();
  rmSync(home, { recursive: true, force: true });
});

// Asynchronous on purpose: the mock server lives in this process, and a
// blocking spawn would keep it from ever answering the CLI.
function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [publish, ...args],
      { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, ...env }, encoding: "utf8" },
      (error, out, err) => resolve({ code: error ? error.code : 0, out, err })
    );
  });
}

test("a publish with no flags is encrypted, and a private one prints a bare URL", async () => {
  requests = [];
  const r = await run(["page.html", "Some page"]);
  assert.equal(r.code, 0, r.err);
  const upload = requests.find((q) => q.url === "/api/upload");
  assert.equal(upload.auth, "Bearer pa_test");
  assert.equal(upload.body.enc, 1);
  assert.doesNotMatch(upload.body.html, /quick brown fox/);
  assert.equal(r.out.trim(), `${site}/a/page-abc123`);
});

test("--plain is refused and --encrypted is accepted as a no-op", async () => {
  const r = await run(["page.html", "Some page", "--plain"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /--plain is gone/);
  const r2 = await run(["page.html", "Some page", "--encrypted"]);
  assert.equal(r2.code, 0, r2.err);
});

test("a public publish sends ciphertext, an iv and a wrapped key, and no plaintext", async () => {
  requests = [];
  const r = await run(["page.html", "Secret page", "--public"]);
  assert.equal(r.code, 0, r.err);
  const upload = requests.find((q) => q.url === "/api/upload");
  const body = upload.body;

  assert.equal(body.enc, 1);
  assert.match(body.html, /^[A-Za-z0-9_-]+$/);
  assert.match(body.iv, /^[A-Za-z0-9_-]{16}$/);
  assert.ok(c.isBlob(body.artKeyWrapped));
  // The title stays in the clear by design; the words of the page must not.
  assert.doesNotMatch(JSON.stringify(requests), /quick brown fox|<title>|<p>/);
  assert.doesNotMatch(JSON.stringify(requests), new RegExp(accountKeyB64));

  // The printed link carries the key after the #, and that key opens the
  // ciphertext that was sent.
  const url = r.out.trim();
  const m = /#k=([A-Za-z0-9_-]{43})$/.exec(url);
  assert.ok(m, `no key in ${url}`);
  const artKey = await c.importKey(c.b64u.decode(m[1]));
  assert.match(await c.decrypt({ v: 1, iv: body.iv, ct: body.html }, artKey), /quick brown fox/);

  // And the wrapped copy opens with the account key to the same artifact key.
  const unwrapped = await c.unwrap(body.artKeyWrapped, accountKey);
  assert.deepEqual(await c.exportKey(unwrapped), await c.exportKey(artKey));
  assert.match(r.err, /everything after the #/);
});

test("--passphrase wraps the key under the passphrase and prints a link with no key", async () => {
  requests = [];
  const r = await run(["page.html", "Gated", "--passphrase", "salt marsh heron"]);
  assert.equal(r.code, 0, r.err);
  const body = requests.find((q) => q.url === "/api/upload").body;
  assert.equal(body.passphrase, "salt marsh heron");
  assert.ok(c.isBlob(body.artKeyByPassphrase, ["salt", "iv", "ct"]));
  const artKey = await c.unwrapWithPassphrase(body.artKeyByPassphrase, "salt marsh heron");
  assert.match(await c.decrypt({ v: 1, iv: body.iv, ct: body.html }, artKey), /quick brown fox/);
  assert.doesNotMatch(r.out, /#k=/);
});

test("publishing without an account key exits 2 and says how to get one", async () => {
  writeFileSync(join(home, ".artifact-publish.json"), JSON.stringify({ site, token: "pa_test" }));
  const r = await run(["page.html", "Secret page"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /run `personal-artifact` again/);
  writeFileSync(join(home, ".artifact-publish.json"), JSON.stringify({ site, token: "pa_test", accountKey: accountKeyB64 }));
});

test("get decrypts an encrypted artifact, and --raw hands back the ciphertext", async () => {
  const artKey = await c.newKey();
  const blob = await c.encrypt("<p>decrypted words</p>", artKey);
  stored = {
    slug: "page-abc123",
    title: "Secret page",
    isPublic: false,
    encrypted: true,
    enc: 1,
    iv: blob.iv,
    html: blob.ct,
    artKeyWrapped: await c.wrap(artKey, accountKey),
  };

  const r = await run(["get", "page-abc123"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "<p>decrypted words</p>");

  const out = join(home, "out.html");
  const r2 = await run(["get", "page-abc123", "--out", out]);
  assert.equal(r2.code, 0, r2.err);
  assert.equal(readFileSync(out, "utf8"), "<p>decrypted words</p>");
  assert.match(r2.err, /encrypted/);

  const r3 = await run(["get", "page-abc123", "--raw"]);
  assert.equal(r3.out, blob.ct);
});

test("--update keeps an artifact under its existing key, and encrypts one from before encryption", async () => {
  requests = [];
  const r = await run(["page.html", "Secret page", "--update", "page-abc123"]);
  assert.equal(r.code, 0, r.err);
  const body = requests.find((q) => q.url === "/api/upload").body;
  assert.equal(body.enc, 1);
  assert.equal(body.slug, "page-abc123");
  const existingKey = await c.unwrap(stored.artKeyWrapped, accountKey);
  const sentKey = await c.unwrap(body.artKeyWrapped, accountKey);
  assert.deepEqual(await c.exportKey(sentKey), await c.exportKey(existingKey));
  assert.match(await c.decrypt({ v: 1, iv: body.iv, ct: body.html }, existingKey), /quick brown fox/);

  // An artifact from before encryption has no key; the update gives it one.
  const wasStored = stored;
  stored = { ...stored, encrypted: false, enc: undefined, artKeyWrapped: undefined };
  requests = [];
  const r2 = await run(["page.html", "Old page", "--update", "page-abc123"]);
  assert.equal(r2.code, 0, r2.err);
  const upgraded = requests.find((q) => q.url === "/api/upload").body;
  assert.equal(upgraded.enc, 1);
  assert.doesNotMatch(upgraded.html, /quick brown fox/);
  stored = wasStored;
});

test("list points out artifacts still stored in the clear", async () => {
  let r = await run(["list"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /page-abc123.*private {2}/);
  stored = { ...stored, encrypted: false };
  r = await run(["list"]);
  assert.match(r.out, /page-abc123.*private plain/);
});
