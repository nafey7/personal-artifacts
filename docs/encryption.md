# End-to-end encryption

Status: **built.** An artifact published with `--encrypted`, or encrypted from
the dashboard, is stored as ciphertext this site cannot read. This note is
the design, the reasoning, and the exact promise — what is encrypted, what is
not, and how to check.

## The promise, exactly

**Encrypted:** the page. The HTML of an encrypted artifact is sealed with
AES-256-GCM under a key made on the publisher's machine, and that key is
stored wrapped under the owner's account key, which this site has never
held. Nobody who runs this site, hosts its database, or holds a copy of the
database can read the page.

**Not encrypted:** the owner's email, the artifact's title, which project it
is in, its size in bytes, when it was published and edited, whether it is
shared, for how long and whether behind a passphrase, and which addresses
opened which link. Titles stay in the clear so search, the dashboard and the
trash keep working. Plain artifacts — everything published without
`--encrypted` — are as readable to the site as they always were.

**The one limit no browser design removes:** the script that decrypts in the
browser is served by this site. An operator who wanted to could ship a copy
that posts keys home. This is narrowed, not removed: the script is generated
from `cli/crypto.js` in the open-source `personal-artifact` package, which
npm publishes with provenance; the viewer loads it with an `integrity=` hash
kept in `lib/integrity.js` in the public repository; and `npm test` fails if
the served copy differs from the source. The CLI has no such limit — its
code is on npm to read before it runs.

## How to check

- **The network tab.** Publish with `--encrypted`, open the artifact, and
  watch: the upload body carries `html` as base64url, an `iv` and an
  `artKeyWrapped` blob; the page load carries the same ciphertext in a
  `data-ct` attribute and two scripts. Nothing after the `#` of a shared
  link is ever in a request.
- **The database.** An encrypted artifact's `html` field is base64url with
  `enc: 1` beside it. Nothing else in the document, or in the user's
  document, opens it.
- **The scripts.** `public/artifact-crypto.v1.js` is byte-for-byte what
  `node scripts/sync-crypto.mjs` produces from `cli/crypto.js` and
  `cli/wordlist.js`, and its SHA-384 is the one in `lib/integrity.js` and in
  the `integrity=` attribute the viewer page carries.
- **npm.** `npm view personal-artifact` shows the provenance of each release;
  `npm audit signatures` checks an installed copy against it.

## Keys, and who holds them

```
passKey      = PBKDF2-SHA256(password, salt = "personal-artifact:v1:" + email, 600,000)
authHash     = HKDF(passKey, "personal-artifact auth")      sent instead of the password
wrapKey      = HKDF(passKey, "personal-artifact wrap")      client only
accountKey   = 32 random bytes                              client only
recoveryKey  = HKDF(12 BIP39 words → 16 bytes, "personal-artifact recovery")
artKey       = 32 random bytes per artifact                 client/CLI only
ppKey        = PBKDF2-SHA256(passphrase, random salt, 600,000)   for passphrase links
```

Every wrapping is AES-256-GCM, and every stored blob is `{ v: 1, iv, ct }`
(plus `salt` for a passphrase, plus `epk` for the CLI hand-off) in base64url.
The `v` lets PBKDF2 give way to Argon2id later without a flag day.

Server stores per user: `passwordHash` (scrypt of `authHash`, exactly as it
scrypted the password before), `authVersion: 2`, `accountKeyByPassword`,
`accountKeyByRecovery`, `keysCreatedAt`. Per artifact: `enc: 1`, `html` as
ciphertext, `iv`, `artKeyWrapped` under the account key, and optionally
`artKeyByPassphrase`. It can check the shape of every one of these and open
none of them; `lib/keys.js` is the whole of what the server knows, and must
never grow a function that decrypts.

All of it is WebCrypto on `globalThis.crypto`, so `cli/crypto.js` runs
unchanged in Node 20+ and in the browser. It is the single source; the
browser copy is generated.

### Sign-in

The browser derives `passKey` from the password and email before any request
and sends `authHash` where it used to send the password. The server's scrypt
check is unchanged. The response carries `accountKeyByPassword`; the browser
unwraps it with `wrapKey` and keeps the account key as a non-extractable
`CryptoKey` in IndexedDB (`lib/keystore.js`), so a reload does not ask again
and page script can use the key but never read its bytes. Sign-out clears it.
A second browser with a session but no key is asked for the password once,
by the dashboard's unlock dialog or by the viewer page.

Accounts from before encryption upgrade at their next sign-in: the browser
sends `authHash`, gets a 401 with `legacy: true`, and calls
`POST /api/auth/upgrade` with the plain password one last time together with
`authHash` and freshly wrapped keys. The recovery phrase is shown then. That
`legacy` flag admits a v1 account exists at the address; it disappears with
the last v1 account, and the plain-password path with it.

### Recovery

The phrase is twelve BIP39 words from 128 random bits with a 4-bit checksum,
shown once at signup, at the upgrade, and whenever Settings makes a new one.
The person must type three of them back before the screen lets go.

Password reset asks for it. The emailed code proves the address;
`POST /api/auth/reset/confirm` with just the code answers with
`accountKeyByRecovery`; the browser opens it with the phrase, wraps the key
again under the new password, and sends that. Without the phrase, the reset
screen says what happens before it does it: `replaceKeys: true` with fresh
wrappings gives the account a new key, and every artifact encrypted under the
old one becomes unreadable for good. Plain artifacts are unaffected.

### Publish, view, edit

- **CLI publish** (`--encrypted`): make `artKey`, encrypt the HTML, wrap
  `artKey` under the account key from `~/.artifact-publish.json`, `POST
  /api/upload` with `{ enc: 1, html: <ciphertext>, iv, artKeyWrapped }`. The
  size cap applies to the ciphertext. `--update` of an encrypted artifact
  reuses its key so handed-out links keep working; `--plain` publishes it in
  the clear. `get` decrypts; `--raw` does not.
- **Viewer** (`/a/<slug>`): for `enc: 1` the route sends the ciphertext and
  wrapped keys in `data-` attributes on the frame's parent and two pinned
  scripts, `/artifact-crypto.v1.js` and `/artifact-view.v1.js`. The viewer
  takes the key from `#k=` in the fragment, else unwraps `artKeyWrapped` with
  the account key in IndexedDB, else unwraps `artKeyByPassphrase` with the
  passphrase (handed over from the server's gate through `sessionStorage`, so
  the reader is asked once, or typed in place), else — if the meta endpoint
  says the reader owns the page — unlocks from the password. A wrong or
  missing key shows a page that says so, never a blank one. The iframe
  sandbox is unchanged.
- **Editor:** already in the page; it takes the words and the key from the
  viewer, edits, encrypts under the same key, and `PATCH`es ciphertext with
  the iv. Nothing about the key changes on an edit.
- **Dashboard:** "Encrypt this" on a plain row fetches the HTML, encrypts it
  in the browser and `PATCH`es all three fields; one way from the dashboard.
  Encrypted rows carry a lock.

### Sharing

- **Public link:** the share sheet unwraps `artKey` with the account key and
  builds `/a/<slug>#k=<base64url artKey>`. Anyone with the exact link can
  read the page; making it private stops the site serving the ciphertext,
  and **Re-encrypt** changes the key so every old link stops working.
- **Passphrase:** the sheet (or the CLI) derives `ppKey` from the passphrase
  with a random salt, wraps `artKey` under it, and stores
  `artKeyByPassphrase` beside the passphrase's hash. The server keeps its
  gate and rate limit as a second wall against offline guessing; the link
  itself carries no key. Removing the passphrase clears both.
- **Expiry** is unchanged: the server stops serving the ciphertext.

### Getting the account key onto a CLI machine

The CLI makes an ephemeral ECDH P-256 key pair and sends the public half in
`POST /api/cli/start`, printing its fingerprint (the first eight hex digits
of its SHA-256). The approval page shows the same fingerprint, asks for the
password, unwraps the account key extractable, seals it to the public key
(ECDH → HKDF → AES-GCM) and sends the blob with the approval. The poll hands
it back with the token, once, and the CLI opens it with the private half that
never left the machine and writes it as `accountKey` in
`~/.artifact-publish.json`, mode 0600. A headless `--token` sign-in unlocks
the same key from the recovery phrase instead, through `GET /api/auth/keys`.

The password is asked for on the approval page because handing another
machine the key to everything should cost it, and because the browser's
stored copy is non-extractable by design.

## Decisions, and why

- **Opt-in per artifact.** Plain artifacts keep working forever and stay
  the default. Encrypted pages cannot be searched by content and cannot be
  recovered without the phrase; that is a trade a person should make on
  purpose.
- **Titles in the clear.** Search, the list and the trash keep working.
- **PBKDF2 at 600,000 rounds**, native to WebCrypto everywhere, about a
  second on a phone. Shown as "Unlocking…". Argon2id if it ever matters; the
  version byte is there for it.
- **A recovery phrase before anything can be encrypted.** No phrase, no
  keys, no toggle.
- **The CLI package is the source of truth for crypto code.** npm carries
  the code people can inspect; the browser copy is generated from it and
  pinned by hash.
- **A random salt in the passphrase blob** rather than the slug, so a
  passphrase can be set before an artifact has a slug and two artifacts with
  the same passphrase get different keys.

## Risks accepted

- A person who loses both the phrase and the password loses the data. The
  reset page says so before it starts. Support cannot help, which is the
  point.
- A modified deploy could serve a hostile viewer script. Narrowed by the
  pinned hash and the public source, not removed.
- PBKDF2 is slow on old phones. Named on the button.
- Search on encrypted content: never. Titles only. Stated up front.
- The `legacy` flag on sign-in, for the migration window only.
