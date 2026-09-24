# Artifacts

Tiny Next.js app for publishing self-contained HTML artifacts. Free end to end:
Vercel Hobby + MongoDB Atlas M0.

Artifacts can be filed into projects. A project is just a folder; deleting one
moves every artifact inside it to the trash.

Deleting an artifact moves it to the trash rather than removing it. Its `/a/`
link stops opening straight away, and it disappears from every listing, but the
page itself is kept for seven days (`TRASH_RETENTION_DAYS`) so a mistake costs
nothing. A MongoDB TTL index on `deletedAt` removes it when the window is up.
Nothing else destroys an artifact: only "Delete for good" or "Empty trash" on
`/trash` does, and both refuse to touch anything that is not already there.

The dashboard is behind a login. See [docs/accounts.md](docs/accounts.md) for
the account model.

Every artifact is encrypted end to end: the page is sealed in the CLI or the
browser before it is uploaded, the site stores ciphertext and wrapped keys it
cannot open, and the reader's browser decrypts it. Artifacts from before
encryption are still stored in the clear until their owner clicks the lock
or publishes over them. See
[docs/encryption.md](docs/encryption.md) for what that promise covers, what
it does not, and how to check it.

- `GET /signin`, `GET /signup` — account screens. The password never leaves
  the browser: it is turned into an `authHash` (PBKDF2, 600,000 rounds, salted
  with the email, then HKDF) that the server scrypt-hashes as it used to hash
  the password, and a `wrapKey` the server never sees.
- `POST /api/auth/signup` — `{ email, name?, authVersion: 2, authHash,
  accountKeyByPassword, accountKeyByRecovery }`: the account key, made in the
  browser, wrapped once under the password and once under the recovery
  phrase. Sends a code; `POST /api/auth/verify` `{ email, code }` creates the
  account; `POST /api/auth/resend` re-sends. The old `{ email, password }`
  body still works for one release and makes a v1 account.
- `POST /api/auth/signin` — `{ email, authHash }` (or `{ email, password }` for
  a v1 account). Answers `{ user, authVersion, accountKeyByPassword }`. A v1
  account sent an `authHash` gets a 401 with `legacy: true`, which is the
  browser's cue to call `POST /api/auth/upgrade` `{ email, password, authHash,
  accountKeyByPassword, accountKeyByRecovery }` once: the last time the plain
  password crosses the wire.
- `POST /api/auth/signout`
- `GET /api/auth/keys` — both wrapped copies of the account key plus the
  email (the salt), for a browser or CLI that has a credential but not the
  key. Session or API token. `PATCH` `{ authHash, accountKeyByRecovery }`
  replaces the recovery wrapping after a new phrase (session).
- `POST /api/auth/reset/request` `{ email }`, then `POST /api/auth/reset/confirm`
  twice: `{ email, code }` checks the code and answers with
  `accountKeyByRecovery`; `{ email, code, authHash, accountKeyByPassword }`
  changes the password with the key carried over (the browser unwrapped it
  with the recovery phrase and wrapped it again). Without the phrase,
  `replaceKeys: true` with a fresh `accountKeyByPassword` and
  `accountKeyByRecovery` starts over and leaves every encrypted artifact
  unreadable. A v1 account is upgraded by a reset.
- `GET /` — the public home page when signed out (with `/llms.txt`,
  `/robots.txt` and `/sitemap.xml` beside it for crawlers and agents); the
  dashboard, all artifacts newest first, when signed in
- `GET /trash` — deleted artifacts, with the days each has left; restore one, or
  delete it for good
- `GET /p/[slug]` — one project's artifacts
- `GET /a/[slug]` — the artifact, rendered inside a sandboxed iframe, with the
  editor dormant inside the same page: its owner gets an Edit button, and
  clicking it swaps the frame for one that can be typed into rather than
  loading another page, so the artifact is never reloaded and the reader keeps
  their place. `?edit=1` opens straight into it. Private by
  default: the owner's session or their `Authorization: Bearer <API token>` gets
  it, unless the artifact is toggled to Shared in the dashboard. Anything else
  gets a 404 that reads the same whether the slug is unknown or simply not
  yours, and says how to open it if it is. A shared link can also carry an
  expiry (after which strangers get a 410 "this link has expired" page) and a
  passphrase (strangers get a 401 prompt; `POST /a/[slug]` with a `passphrase`
  form field or JSON body sets a cookie scoped to that one artifact). The
  owner is never asked and never locked out. Wrong passphrases are rate
  limited per address and per artifact.
- `GET /settings` — API tokens
- `POST /api/upload` — `Authorization: Bearer <your API token>`, body
  `{ title, html, project?, createProject?, visibility?, slug? }` (`project`
  takes an id, slug or exact name, and an unknown one is a 400 that lists your
  projects; `createProject: true` makes the named project instead of failing;
  `visibility` is `private` by default; `slug` replaces that artifact of yours
  in place rather than minting a new one). The response carries `url`,
  `project`, `visibility`, `encrypted` and a plain-language `note` saying who
  can open it. Every upload is encrypted: `enc: 1`, `iv` and `artKeyWrapped`
  together, with `html` as base64url ciphertext, and optionally
  `artKeyByPassphrase` beside `passphrase`; the size cap applies to the
  ciphertext. A body without them is a 400 with `encryptionRequired: true`
  that says to upgrade the CLI. With `slug`, an upload over an artifact from
  before encryption encrypts it.
- `GET /api/artifacts` — your artifacts without their HTML, newest first.
  `?project=<id|slug|name>` (or `unfiled`), `?q=<title text>`, `?limit=<n>`,
  `?trashed=1` for the trash instead. Session or API token.
- `GET /api/artifacts/[id-or-slug]` — one artifact with its `html`;
  `?format=html` returns the HTML alone as `text/plain` (409 on an encrypted
  artifact, which has none); `?meta=1` leaves the HTML out, which is how the
  artifact page asks whether the reader owns it without pulling a whole page
  out of the database. An encrypted artifact answers `encrypted: true` with
  `enc`, `iv`, `artKeyWrapped`, `artKeyByPassphrase` and ciphertext in
  `html`. Session or API token.
- `GET /api/trash` — what is in the trash, with `daysLeft` and `retentionDays`
  (session or API token); `DELETE /api/trash` empties it for good (session)
- `GET /api/me` — the token's owner, used by `personal-artifact` to validate a token
- `POST /api/cli/start|poll` — browser sign-in for the CLI. `start` takes
  `{ device?, cliPublicKey? }` (an ECDH P-256 public key, base64url) and
  answers with its `fingerprint`; `POST /api/cli/approve` (session required)
  takes `{ userCode, approve, accountKeySealed? }`, the account key sealed in
  the browser to that public key; `poll` hands it back once with the token.
- `GET /cli/auth?code=` — the page where a machine is approved
- `GET|POST /api/tokens`, `DELETE /api/tokens/[id]` — issue, list, revoke (session required)
- `GET|POST /api/projects` — list (with counts) / create, body `{ name }` (session or API token)
- `PATCH|DELETE /api/projects/[id]` — rename (`{ name }`) / delete, trashing its artifacts (session required)
- `PATCH|DELETE /api/artifacts/[id]` — edit (`{ title?, html?, projectId?, visibility?, expiresIn?, expiresAt?, passphrase? }`) / move to the trash (session required).
  `html` replaces the page itself, under the same size cap `POST /api/upload`
  enforces; it is what the in-place editor saves through. On an encrypted
  artifact `html` must arrive as ciphertext with `enc: 1`, `iv` and
  `artKeyWrapped`; an artifact from before encryption takes plain `html`
  from the editor, or the same three to become encrypted (the lock in the
  dashboard), and nothing turns encryption off.
  `artKeyByPassphrase` rides beside `passphrase` on an encrypted artifact and
  is cleared with it. Responses carry `encrypted`.
  `{ restore: true }` is the one edit a trashed artifact accepts — it lifts it
  back out, Unfiled if the project it was in has since been deleted; every
  other edit on one is a 409. `DELETE ...?permanent=1` removes it outright, and
  only works on something already in the trash.
  `expiresIn` is a duration (`30m`, `24h`, `7d`, `2w`) or `null`; `expiresAt`
  an ISO instant or `null`; `passphrase` a string of 4–200 characters or `null`
  to remove it. Setting either implies `visibility: "public"`; setting
  `"private"` clears both. Responses carry `isPublic`, `expiresAt`, `isExpired`
  and `hasPassphrase`, never the passphrase. `POST /api/upload` takes the same
  three fields.

## Setup

1. Create a free MongoDB Atlas M0 cluster, a database user, and allow access from
   anywhere (`0.0.0.0/0`) so Vercel can connect.
2. `npm install`, then copy `.env.local.example` to `.env.local` and fill it in:
   the Atlas connection string, a database name, and a sending-only Resend key
   with the address mail comes from.
3. `npm run dev` to run locally. Node 20 or newer, for WebCrypto.

## Tests

```
npm test               # the site: pure modules, and the generated crypto copy
cd cli && npm test     # the CLI: crypto vectors, and publish against a mock API
```

The site's suite also holds integration tests that need a running server and
its database: set `ARTIFACT_TEST_SITE` (for example `http://localhost:3000`),
`MONGODB_URI` and `MONGODB_DB` to the database that server uses — never
production; they insert and delete users — and they run. Without those they
skip.

`public/artifact-crypto.v1.js` and `lib/integrity.js` are generated from
`cli/crypto.js` and `cli/wordlist.js` by `npm run sync-crypto`. `npm test` and
`prebuild` fail if either was edited by hand or is out of date.

## Deploy

Push to GitHub, import the repo on Vercel, and set `MONGODB_URI`, `MONGODB_DB`,
`RESEND_API_KEY` and `MAIL_FROM` as environment variables. Deploy.

Artifacts and projects created before accounts existed have no owner. After
signing up, claim them:

```
node scripts/claim-existing.mjs you@example.com --dry-run
node scripts/claim-existing.mjs you@example.com
```

## CLI

```
npm install -g personal-artifact
personal-artifact
```

`personal-artifact` asks nothing up front — it prints the site it will use and
opens your browser to sign in. Approve the machine there and the token comes
back on its own. Then it writes `~/.artifact-publish.json` and installs the
publishing skill for whichever coding tools you have — Claude Code, Codex,
Gemini CLI, Cursor. It writes nothing for tools you have not installed, and is
safe to re-run whenever you install another one or rotate a token. Publishing
somewhere else takes `--site <url>`.

Publish:

```
artifact-publish ./artifact.html "Load test report"
artifact-publish ./artifact.html "Load test report" --project "Client Work"
artifact-publish ./artifact.html "Load test report" --public
artifact-publish ./artifact.html "Load test report" --expires 7d
artifact-publish ./artifact.html "Load test report" --passphrase "salt marsh heron"
artifact-publish ./artifact.html "Load test report" --update load-test-report-3f9a1c
artifact-publish ./artifact.html "Load test report" --new-project "New Client"
```

It prints the URL on stdout and one line on stderr saying who can open it.
`--project` must name a project that already exists, and the error for one
that doesn't lists the projects that do; `--new-project` creates the folder if
needed. `--public` publishes a link anyone can open; without it the artifact is
private, and fetching its URL without your session or token returns 404 by
design. `--expires` and `--passphrase` share the link for a limited time or
behind a passphrase, and imply `--public`. `--update` replaces an artifact you
already published, keeping its URL. Every publish seals the page on the
machine before upload; with `--public` the printed link ends in `#k=<key>`,
which the browser never sends to the site, and `--update` keeps the artifact
under the same key so links handed out keep opening.

Read back what is there:

```
artifact-publish projects
artifact-publish list [--project "Client Work"] [--search dashboard] [--json]
artifact-publish get <slug> [--out ./page.html] [--raw]
```

`get` decrypts with the key in `~/.artifact-publish.json`; `--raw` returns the
ciphertext fields as stored.

Artifacts are capped at 2MB (`MAX_ARTIFACT_BYTES`) and 200 per account
(`MAX_ARTIFACTS_PER_USER`). `/settings` shows how much of that allowance an
account has used, so the cap is visible before a publish is refused.

Undo all of it — config, skills, and the package — with `personal-artifact
uninstall`. It leaves the token on the server; revoke that at `/settings`.

## Releasing the CLI

Publishing runs from GitHub Actions over OIDC trusted publishing — no npm token
lives in this repo, and no 2FA prompt has to be answered. Provenance signing
(`npm publish --provenance`, which lets `npm audit signatures` tie a release to
the commit that built it) needs a public source repository; add the flag in
`.github/workflows/publish.yml` once the repo is public.

```
cd cli
npm version patch      # or minor / major — bumps the file only
cd .. && git commit -am "2.0.1" && git push
```

Any change to `cli/crypto.js` or `cli/wordlist.js` needs `npm run sync-crypto`
before the commit, or the build fails.

`npm version` looks for `.git` beside the package it is bumping, and this
repo keeps it at the root — so it edits `cli/package.json` and stops there. The
commit is yours to make.

Pushing to `main` triggers `.github/workflows/publish.yml`, which publishes
when `cli/package.json` names a version npm does not have yet, then tags the
release itself. A push that changes nothing about the version publishes
nothing and still passes — so a CLI change with no bump ships nowhere. Pushing
a `v*` tag by hand still works, and is refused if it disagrees with
`cli/package.json`.

One-time setup on npmjs.com, under the package's **Settings → Trusted
Publisher** (all fields are case-sensitive):

| Field | Value |
| --- | --- |
| Organization or user | `nafey7` |
| Repository | `personal-artifacts` |
| Workflow filename | `publish.yml` |
| Environment | leave blank |
| Allowed actions | `npm publish` |

## Security note

Artifacts render inside an iframe with no `allow-same-origin`, so a published
page cannot read this site's cookies, call its API with a viewer's session, or
reach another artifact's storage. The cost is that browser storage does not work
inside an artifact at all — `localStorage` throws on an opaque origin.

Every artifact is one this site cannot read. What is encrypted: the page.
What is not: your email, the title, the project, the size, dates,
visibility, and which addresses opened which link. Artifacts from before
encryption stay in the clear until their owner encrypts them. How to check it: the
network tab shows ciphertext and wrapped keys leaving and arriving, and
nothing after the `#` of a link; the scripts that decrypt are pinned by hash
in `lib/integrity.js` and generated from `cli/crypto.js`, which is published
on npm where it can be read. [docs/encryption.md](docs/encryption.md) has the full
account, including the one limit no browser-based design removes.
