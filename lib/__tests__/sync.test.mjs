import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stale, build, GENERATED, INTEGRITY_FILE } from "../../scripts/sync-crypto.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The browser copy is generated from the CLI's crypto module and pinned by
// hash. A hand edit to either generated file — the copy or the hashes — makes
// this fail, which is the whole reason the copy can be trusted.
test("public/artifact-crypto.v1.js and lib/integrity.js match their sources", () => {
  assert.deepEqual(stale(), [], `run node scripts/sync-crypto.mjs to regenerate ${GENERATED} and ${INTEGRITY_FILE}`);
});

test("the generated script defines one global with every export", () => {
  const source = build();
  assert.match(source, /global\.ArtifactCrypto = \{/);
  assert.doesNotMatch(source, /^(import|export) /m);
  for (const name of ["encrypt", "decrypt", "deriveFromPassword", "split", "phrase", "ecdh", "WORDLIST", "b64u"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`));
  }
});

test("the generated script runs and passes the fixed vector", async () => {
  const source = readFileSync(join(root, GENERATED), "utf8");
  const sandbox = {};
  new Function("window", source)(sandbox);
  const c = sandbox.ArtifactCrypto;
  const key = await c.importKey(new Uint8Array(32).map((_, i) => i));
  assert.equal(
    await c.decrypt({ v: 1, iv: "AAECAwQFBgcICQoL", ct: "E2qzO7SQq3jmYfX53p4WTeW5_yhMGRz3iC98dsnUGuRIGqg" }, key),
    "The quick brown fox"
  );
  assert.equal(c.WORDLIST.length, 2048);
});
