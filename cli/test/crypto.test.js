import { test } from "node:test";
import assert from "node:assert/strict";
import * as c from "../crypto.js";

const bytes = (n, fill) => new Uint8Array(n).map((_, i) => (fill === undefined ? i : fill));

// Fixed vectors, so the browser copy of this module can be checked against
// exactly the same numbers (see cli/test/browser-vector.html).
export const VECTOR = {
  key: bytes(32),
  iv: "AAECAwQFBgcICQoL",
  text: "The quick brown fox",
  ct: "E2qzO7SQq3jmYfX53p4WTeW5_yhMGRz3iC98dsnUGuRIGqg",
  password: "correct horse battery",
  email: "Test@Example.com",
  authHash: "OP1ErEf6MgahNYBzvZ36tFSsGEB3vENn0tqf_41Tg0M",
};

test("base64url round trips and rejects padding or other alphabets", () => {
  for (const n of [0, 1, 2, 3, 31, 32, 100_000]) {
    const input = c.randomBytes(n);
    const text = c.b64u.encode(input);
    assert.doesNotMatch(text, /[+/=]/);
    assert.deepEqual(c.b64u.decode(text), input);
  }
  assert.throws(() => c.b64u.decode("abc="));
  assert.throws(() => c.b64u.decode("ab+c"));
});

test("encrypt and decrypt round trip, including a 2MB page", async () => {
  const key = await c.newKey();
  for (const text of ["", "hello", "héllo 🌍", "x".repeat(2_000_000)]) {
    const blob = await c.encrypt(text, key);
    assert.equal(blob.v, 1);
    assert.equal(c.b64u.decode(blob.iv).length, 12);
    assert.equal(await c.decrypt(blob, key), text);
  }
});

test("a fixed key and iv give the fixed ciphertext", async () => {
  const key = await c.importKey(VECTOR.key);
  const blob = { v: 1, iv: VECTOR.iv, ct: VECTOR.ct };
  assert.equal(await c.decrypt(blob, key), VECTOR.text);
});

test("the wrong key and a tampered ciphertext both fail", async () => {
  const key = await c.newKey();
  const other = await c.newKey();
  const blob = await c.encrypt("secret", key);
  await assert.rejects(c.decrypt(blob, other));
  const bad = c.b64u.decode(blob.ct);
  bad[0] ^= 1;
  await assert.rejects(c.decrypt({ ...blob, ct: c.b64u.encode(bad) }, key));
  await assert.rejects(c.decrypt({ v: 2, iv: blob.iv, ct: blob.ct }, key));
});

test("wrap and unwrap carry a key intact; extractable is the caller's choice", async () => {
  const account = await c.newKey();
  const art = await c.newKey();
  const wrapped = await c.wrap(art, account);
  const back = await c.unwrap(wrapped, account);
  assert.deepEqual(await c.exportKey(back), await c.exportKey(art));
  const locked = await c.unwrap(wrapped, account, { extractable: false });
  assert.equal(locked.extractable, false);
  await assert.rejects(c.exportKey(locked));
});

test("the password derivation is deterministic and splits into unrelated halves", async () => {
  const passKey = await c.deriveFromPassword(VECTOR.password, VECTOR.email);
  const { authHash, wrapKey } = await c.split(passKey);
  assert.equal(authHash, VECTOR.authHash);
  assert.equal(authHash.length, 43);
  assert.equal(wrapKey.extractable, false);

  // Same password, same email in a different case: same key.
  const again = await c.split(await c.deriveFromPassword(VECTOR.password, "test@example.com"));
  assert.equal(again.authHash, authHash);

  // A different email is a different salt.
  const other = await c.split(await c.deriveFromPassword(VECTOR.password, "other@example.com"));
  assert.notEqual(other.authHash, authHash);

  const account = await c.newKey();
  const wrapped = await c.wrap(account, wrapKey);
  assert.deepEqual(await c.exportKey(await c.unwrap(wrapped, again.wrapKey)), await c.exportKey(account));
  await assert.rejects(c.unwrap(wrapped, other.wrapKey));
});

test("a passphrase wraps with its own salt and opens only with the same words", async () => {
  const art = await c.newKey();
  const blob = await c.wrapWithPassphrase(art, "salt marsh heron");
  assert.equal(c.b64u.decode(blob.salt).length, 16);
  assert.ok(c.isBlob(blob, ["salt", "iv", "ct"]));
  assert.deepEqual(await c.exportKey(await c.unwrapWithPassphrase(blob, "salt marsh heron")), await c.exportKey(art));
  await assert.rejects(c.unwrapWithPassphrase(blob, "salt marsh herons"));
  const twice = await c.wrapWithPassphrase(art, "salt marsh heron");
  assert.notEqual(twice.salt, blob.salt);
});

test("recovery phrases follow BIP39", async () => {
  assert.equal(
    (await c.phrase.fromEntropy(bytes(16, 0))).join(" "),
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  );
  assert.equal(
    (await c.phrase.fromEntropy(bytes(16, 0x7f))).join(" "),
    "legal winner thank year wave sausage worth useful legal winner thank yellow"
  );
  assert.equal(
    (await c.phrase.fromEntropy(bytes(16, 0x80))).join(" "),
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"
  );
  assert.equal(
    (await c.phrase.fromEntropy(bytes(16, 0xff))).join(" "),
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
  );
  assert.deepEqual(await c.phrase.toEntropy("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"), bytes(16, 0xff));
});

test("a phrase with a swapped or misspelt word is refused, and case and spacing are forgiven", async () => {
  const words = await c.phrase.generate();
  assert.equal(words.length, 12);
  const key = await c.phrase.toKey(words);
  assert.equal(key.extractable, false);

  const account = await c.newKey();
  const wrapped = await c.wrap(account, key);
  const loud = words.map((w) => w.toUpperCase()).join("   \n ");
  assert.deepEqual(await c.exportKey(await c.unwrap(wrapped, await c.phrase.toKey(loud))), await c.exportKey(account));

  const swapped = [...words];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  if (swapped[0] !== swapped[1]) {
    await assert.rejects(c.phrase.toKey(swapped), /not a valid recovery phrase/);
  }
  await assert.rejects(c.phrase.toKey([...words.slice(0, 11), "notaword"]), /"notaword" is not a word/);
  await assert.rejects(c.phrase.toKey(words.slice(0, 11)), /twelve words/);
});

test("ECDH seals to a public key and opens with the matching private one", async () => {
  const cli = await c.ecdh.generate();
  assert.ok(c.ecdh.isPublicKey(cli.publicKey));
  assert.equal(cli.fingerprint.length, 8);
  assert.equal(await c.ecdh.fingerprint(cli.publicKey), cli.fingerprint);

  const secret = c.randomBytes(32);
  const sealed = await c.ecdh.seal(secret, cli.publicKey);
  assert.ok(c.isBlob(sealed, ["epk", "iv", "ct"]));
  assert.deepEqual(await c.ecdh.open(sealed, cli.privateKey, cli.publicKey), secret);

  const stranger = await c.ecdh.generate();
  await assert.rejects(c.ecdh.open(sealed, stranger.privateKey, stranger.publicKey));
  assert.equal(c.ecdh.isPublicKey("AAAA"), false);
});

test("isBlob is strict about shape", () => {
  assert.equal(c.isBlob(null), false);
  assert.equal(c.isBlob({ v: 1, iv: "AAECAwQFBgcICQoL", ct: "AA" }), true);
  assert.equal(c.isBlob({ v: 1, iv: "AAECAwQF", ct: "AA" }), false);
  assert.equal(c.isBlob({ v: 1, iv: "AAECAwQFBgcICQoL", ct: "" }), false);
  assert.equal(c.isBlob({ v: 1, iv: "AAECAwQFBgcICQoL", ct: "A+A" }), false);
  assert.equal(c.isBlob({ v: 0, iv: "AAECAwQFBgcICQoL", ct: "AA" }), false);
});
