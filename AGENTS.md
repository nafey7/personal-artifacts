# AGENTS.md

Guidance for AI coding agents working in this repository. Humans: start with [README.md](README.md).

## What this repo is

personal-artifact lets a coding agent design a self-contained HTML page and publish it to a private URL the developer owns. The skill is the product; the site is the storage layer under it. Live at `https://artifacts.pallason.com`.

| Folder | What it is | Stack |
|---|---|---|
| `app/`, `lib/`, `public/` | The site: dashboard, auth, `/a/<slug>` viewer, `/api/*` | Next.js 15 App Router, React 19, plain JavaScript, one `globals.css` |
| `cli/` | The `personal-artifact` npm package and the skill it installs (`cli/skill/SKILL.md`) | Node 18+, ESM |
| `docs/` | Design notes: why things are the way they are | Markdown |

The site's only runtime dependency is `mongodb`; the CLI has none. Passwords use `node:crypto` scrypt, mail is one `fetch` to Resend, and all end-to-end encryption is WebCrypto in `cli/crypto.js`. Don't add a dependency for something the standard library does.

**Before working in an area, read the matching doc in `docs/`** — see [Documentation map](#documentation-map).

## Commands

Setup, run and release steps live in [README.md](README.md); update it if they change. What an agent needs beyond that:

```bash
npm test                                            # site: pure modules, generated crypto copy, integration tests (env-gated)
cd cli && npm test                                  # CLI: crypto vectors, publish against a mock API
npm run build                                       # prebuild checks the generated crypto copy is current
npm run sync-crypto                                 # after any change to cli/crypto.js or cli/wordlist.js
node cli/publish.js --help                          # the CLI has no build; smoke-test it this way
node cli/init.js --site http://localhost:3000       # point the CLI at a local server
node cli/publish.js ./page.html "Title"             # then publish to it (site comes from ~/.artifact-publish.json)
cd cli && npm version patch                         # bump before any CLI or skill change ships
```

- Local dev needs a real Atlas cluster and Resend key in `.env.local` (see `.env.local.example`). There is no local database, and signup sends real email. Run local tests against a `MONGODB_DB` that is not production.
- The integration tests in `lib/__tests__/server.test.mjs` run only with `ARTIFACT_TEST_SITE`, `MONGODB_URI` and `MONGODB_DB` set; they insert and delete users, so never point them at production.
- `GET /a/<slug>` on a private artifact returns 404 without a credential. That is the design, not a bug. Verify with `Authorization: Bearer <token>` or a signed-in browser.
- Mongo indexes are created at runtime in `ensureIndexes` (`lib/mongo.js`). A new collection or TTL field goes there; there is no migration step. There is no migration for encryption either: a v1 account upgrades at its next sign-in.

## Deployment and releases

- Every push to `main` deploys the site to production through Vercel. There is no staging. Environment variables live in the Vercel project, never in the repo.
- `.github/workflows/publish.yml` publishes the CLI to npm on push to `main` only when `cli/package.json` names a version npm lacks. **A CLI or skill change without a version bump ships nowhere.** Commit the bump with the bare version as the message (`1.6.2`). Publishing uses OIDC; there is no npm token.
- The installed skill copies carry the CLI version that wrote them, and `postinstall` refreshes stale ones. Editing `cli/skill/SKILL.md` without a bump leaves every installed copy on the old text.

## Invariants

- **Every artifact and project read is scoped by owner.** Go through `owned(userId, …)` in `lib/data.js`; it throws on a missing id because undefined would match ownerless documents.
- **Session cookie and `pa_…` API token are the same level of trust.** `requireUser(request)` in `lib/guard.js` accepts either. Don't invent a third path.
- **Artifacts render sandboxed**: `allow-scripts`, never `allow-same-origin`. Inside one, storage and cookies throw and `fetch` to this site fails. If the sandbox changes, `cli/skill/SKILL.md` and `public/artifact-frame.js` change with it.
- **Slugs are minted once and never rewritten.** `--update <slug>` replaces content under the same URL.
- **Delete is soft.** `deletedAt` plus a TTL index; only "Delete for good" and "Empty trash" hard-delete, and only what is already trashed.
- **Counters and rate limits live in Mongo, not memory.** Each request may hit a different Vercel instance.
- **Caps are read once in `lib/limits.js`** so the route that enforces one and the page that shows it never disagree. Don't read them from `process.env` elsewhere.
- **The server never decrypts.** `lib/keys.js` validates the shape of wrapped keys and ciphertext and nothing more; no server file may import a decrypting function. The password never reaches the server on a v2 account (`authHash` does, and `POST /api/auth/upgrade` is the one exception, once per legacy account).
- **`cli/crypto.js` is the only crypto code.** The browser copy `public/artifact-crypto.v1.js` and the hashes in `lib/integrity.js` are generated by `scripts/sync-crypto.mjs`; never edit them by hand. Any change to the viewer scripts needs `npm run sync-crypto` or the build fails.
- **Encryption fields travel together.** `enc: 1`, `iv` and `artKeyWrapped` arrive as a set with ciphertext in `html`, or not at all. An encrypted artifact refuses plain `html` on PATCH; only `POST /api/upload` with a slug can make it plain again.
- **The keystore names are shared.** `lib/keystore.js` and `public/artifact-view.v1.js` both open IndexedDB `artifact-keys`, store `keys`, id `account`. Change one and change both.

## Gotchas

- `plans/` is git-ignored scratch. Nothing tracked may link to or cite a file under it; write what a tracked file needs into that file.
- `SIGNUP_CODE`, `UPLOAD_TOKEN` and `UPLOAD_USER_EMAIL` no longer exist in code or docs. Don't reintroduce them.
- Encryption is opt-in per artifact. Plain artifacts are stored in the clear and always will be; never describe the site as encrypting everything.
- The sign-in 401 carries `legacy: true` for a v1 account sent an `authHash`. It is the upgrade cue and a small, temporary membership leak; drop it with the plain-password path once no v1 accounts remain.
- `cli/skills.js` appends "Not for claude.ai Artifacts…" to the Claude Code copy of the skill description. Keep that line out of the source `SKILL.md`.
- `init` never creates a vendor directory speculatively. It writes a skill only where the tool's home directory exists or its binary is on `PATH`; `~/.agents/skills/` is the one path it may create.
- `.env.local`, `atlas-credentials.env` and `.vercel/` hold real credentials. Never copy their contents into a commit, doc or memory file.

## Conventions

- **Commits**: one plain sentence, imperative, describing the user-visible outcome, no prefix. `Delete to a trash that empties itself after seven days`.
- **Comments explain why, not what.** Every `lib/` file opens with the reasoning behind its design; keep that habit.
- **Plain JavaScript, ESM, no TypeScript, no CSS framework.** `@/` maps to the repo root. Both themes come from `prefers-color-scheme`; nothing sets `data-theme`.
- **Route handlers export `dynamic = "force-dynamic"`** and return early with `Response.json({ error }, { status })`; they never throw past the handler.
- **API responses say what the caller needs in plain language** (`note` on upload, `daysLeft` on trash, a 404 that explains how to open a private page).
- **A protocol change is one commit**: `/api/*` route, `cli/publish.js`, `cli/skill/SKILL.md`, the README's route list, and the CLI version bump together.
- **A crypto change is one commit**: `cli/crypto.js`, the regenerated `public/artifact-crypto.v1.js` and `lib/integrity.js`, the tests in `cli/test/crypto.test.js`, and a CLI version bump.

## Documentation map

- [README.md](README.md) — every route and its contract, setup, deploy, CLI commands, releasing
- [docs/accounts.md](docs/accounts.md) — product decisions: private by default, agent-agnostic skill install, which tools read which paths
- [docs/email-verification.md](docs/email-verification.md) — signup verification and password reset: pending records, codes, rate limits, the mail sender
- [docs/encryption.md](docs/encryption.md) — end-to-end encryption: the exact promise, the key hierarchy, sign-in and recovery, sharing, the CLI hand-off, and how to verify it
- [cli/README.md](cli/README.md) and [cli/skill/SKILL.md](cli/skill/SKILL.md) — what users and their agents see; the source of truth for the host's behaviour from the outside

**Keep docs current:** when a change alters a route's contract, the sandbox, the auth flow, what encryption covers, or a gotcha above, edit the relevant section inline (no changelogs). Route and command changes go in the README; CLI-facing changes also go in `cli/README.md` and `cli/skill/SKILL.md`; anything that changes what the site can or cannot read goes in `docs/encryption.md`, the home page and `/llms.txt`.
