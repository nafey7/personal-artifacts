# personal-artifact — accounts & private artifacts

Status of this document: **phases 1–2 are implemented, and phase 4's access
control with them.** Phase 3 (per-user API tokens) and phase 4's isolation work
are the agreed direction, not yet built.

## The vision

**personal-artifact** is a hosted service plus an installable package. A
developer runs one command, signs up, pastes a token once, and from then on any
coding agent they use can design a real HTML page and publish it to a private
URL they own.

The onboarding is four steps, one of which is a copy-paste:

1. Install the `personal-artifact` package.
2. Sign up on the site and generate a personal API token.
3. Paste the token into the package's `init` prompt.
4. Their agent now has the publishing skill, and everything published is
   **private to their account**.

### What the product actually is

The skill is the product; this app is the storage layer underneath it. The skill
file is roughly 12KB, and only a fifth of it is publishing mechanics — the rest
is design judgment: pair typefaces deliberately, define both themes through
tokens, calibrate treatment to the request, avoid the look that AI-generated
pages have converged on. Anyone can write a `POST /api/upload`. What makes the
output worth hosting is that the page is one a developer would send to a client.

The pitch is **private by default**. Artifacts are working documents — reports,
dashboards, client one-pagers. A developer publishing one should not be handing
it to a shared pool or to a vendor's cloud. What "private" means here is a
promise backed by engineering rather than by topology: the service is hosted,
and only the owner can read what they publish unless they choose to share a link.

### Settled decisions

| Question | Decision |
| --- | --- |
| Name | `personal-artifact` — package, skill, and service agree |
| Hosting | Hosted SaaS, run by the author. Not self-hosted per developer |
| URL | `personal-artifacts-three.vercel.app` for now; a real domain when it opens past the team |
| Distribution | npm package with an `init` command, not an MCP server |
| Install scope | Global, into paths that already exist. Never create a vendor directory speculatively |
| Sharing | Private by default plus opt-in public links. No teams, roles, or workspaces |
| Money | Free and open source for now. No billing, but limits that keep the service alive |

### Agent-agnostic by construction

Publishing is a plain `POST` of `{ title, html, project? }` with a bearer token.
Nothing in the protocol belongs to one assistant, and that must stay true.

Every target tool now ships **Agent Skills** — a directory containing a
`SKILL.md` whose frontmatter needs only `name` and `description`, loaded on
demand when a task matches the description. So there is no per-tool wrapper and
no rules file: the same skill directory works everywhere.

`~/.agents/skills/` has become the vendor-neutral convention, and three of the
four tools read it:

| Tool | User-level skills path | Reads `~/.agents/skills`? |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` | not documented |
| Codex | `$HOME/.agents/skills` | it is Codex's native user path |
| Gemini CLI | `~/.gemini/skills/`, `~/.agents/skills/` alias | yes |
| Cursor | `~/.cursor/skills/`, `~/.agents/skills/` | yes — and `~/.claude/skills/`, `~/.codex/skills/` for compatibility |

`init` therefore performs **two writes at most**:

- `~/.agents/skills/personal-artifact/SKILL.md` — Codex, Gemini CLI, Cursor
- `~/.claude/skills/personal-artifact/SKILL.md` — Claude Code

The guidance is one source file. The only per-tool variance in 12KB is the
description's closing sentence — "Not for claude.ai Artifacts (use the Artifact
tool for those)" — which is meaningful in Claude Code and noise everywhere else,
so it belongs in that copy alone.

Open question to test before shipping: Cursor reads both `~/.agents/skills/` and
`~/.claude/skills/`, so on a machine with Claude Code installed it may see
`personal-artifact` twice. It likely dedupes by precedence; verify rather than
assume.

### Never create a vendor directory speculatively

`init` writes only into a directory that already exists, or whose tool is
demonstrably installed — the tool's home directory present, or its binary on
`PATH`. It never `mkdir -p`s a vendor path on spec.

Creating `~/.claude/` on a machine without Claude Code can interfere with that
tool's own first-run bootstrap — ownership, permissions, or migration logic that
assumes it created the directory itself. Short of that it is still wrong: an
empty vendor directory does nothing except litter a home directory with the
names of tools its owner chose not to install, and make uninstalling messier.

`~/.agents/skills/` is the single exception worth creating fresh, because it is
vendor-neutral rather than anyone's private namespace — and then only when at
least one tool that reads it is actually installed.

Two consequences:

- **`init` prints what it detected and what it will write, then asks.** No
  silent writes into someone's home directory.
- **`init` is re-runnable.** Installing Codex next month means running it again
  to fill in what is newly present. Re-runnability also covers the day the
  hosted URL changes and every `~/.artifact-publish.json` needs a new `site`.

### Build order

1. **Per-user API tokens** (phase 3 below). Onboarding step 3 is "paste your
   token", and that cannot be the deployment-wide `UPLOAD_TOKEN`. Nothing else
   ships first.
2. **Sandbox the artifact renderer** (phase 4 below). The last thing standing
   between this build and handing the signup link to someone else.
3. **Guardrails.** Per-artifact size cap, per-account quota, rate limiting on
   signin and signup. Free does not mean unlimited — it means limits that exist
   so the service survives. Atlas M0 is 512MB in total and the current ceiling
   on a single artifact is 16MB, so one embedded video is 3% of the cluster.
   Quota fields are free to add now and annoying to migrate onto live accounts
   later.
4. **The npm package.** `init` with tool detection and the two skill writes above.
5. **Open the doors.** Drop `SIGNUP_CODE`, add email verification and password
   reset — the one item on this list that needs a mail provider.

### Abuse surface

Sandboxing stops artifacts from attacking each other; it does not stop someone
publishing a convincing fake login page and sharing that link from this domain.
Share links are opt-in, which bounds it, but artifact responses should carry
`X-Robots-Tag: noindex` so nothing published here is indexed under the domain,
and there has to be a way to kill a slug.

## Phase 1 — sign up and sign in (built)

Hand-rolled, zero new dependencies. The app already talks to Mongo with the raw
driver and hashing lives in Node's standard library, so an auth framework would
have added more surface than it removed.

**Passwords.** `scrypt` from `node:crypto`, 16-byte random salt, 64-byte key,
stored as `scrypt:<salt-hex>:<key-hex>` in `users.passwordHash`. Comparison is
`timingSafeEqual`. Minimum length is 10 characters and there is no composition
rule — length is the thing that matters.

**Sessions.** On sign in the server mints a 32-byte random token, stores only its
SHA-256 hash in `sessions`, and sets it as an `httpOnly`, `sameSite=lax`,
`secure`-in-production cookie named `artifact_session`, good for 30 days. A
database dump therefore cannot be replayed as a login. A TTL index on
`expiresAt` lets Mongo evict dead sessions on its own; `currentUser()` also
deletes an expired session the moment it is presented.

**Collections.**

| Collection | Shape |
| --- | --- |
| `users` | `{ email (unique, lowercased), name, passwordHash, createdAt }` |
| `sessions` | `{ tokenHash (unique), userId, createdAt, expiresAt (TTL) }` |

Indexes are created once per process behind a cached promise in `lib/mongo.js`,
so there is no separate migration step to forget.

**Surface.**

- `GET /signin`, `GET /signup` — outside the dashboard layout, so no sidebar.
  Both redirect to `/` if you already have a session.
- `POST /api/auth/signup` — `{ email, password, name?, code? }`
- `POST /api/auth/signin` — `{ email, password }`
- `POST /api/auth/signout`
- The whole `app/(dash)` group redirects to `/signin` without a session.
- `/api/projects` and `/api/artifacts/[id]` now return 401 without a session.
  These were completely open before; login would have been decorative otherwise.

**Invite gate.** If `SIGNUP_CODE` is set, signup requires a matching `code` and
the form shows an invite-code field. Leave it unset for open signup. This is the
cheap way to run a team-only deployment before proper invitations exist.

**Deliberate choices.**

- Sign-in failures say "wrong email or password" for both unknown accounts and
  bad passwords, so the endpoint can't be used to enumerate members.
- `?next=` on `/signin` only accepts in-app paths, so it can't be pointed at
  another site.
- No email verification and no password reset yet — both need a mail provider,
  which is a phase of its own.
- No rate limiting yet. See "Known gaps".

## Phase 2 — ownership (built)

Auth without ownership is a lobby with no locks. Every artifact and project now
carries a `userId`, and every read and write is scoped by it.

**Reads.** `loadProjects(userId)` and `loadArtifacts(userId, filter)` in
`lib/data.js` take the owner as their first argument and refuse to run without
one — an accidental `undefined` would otherwise match unowned documents. The
`$group` that counts artifacts per project is preceded by a `$match` on the
owner, so the sidebar counts are the caller's own. `/p/[slug]` looks up
`{ slug, userId }`, so another account's project slug is a 404 rather than a
peek at its name.

**Writes.** The project and artifact routes filter on `{ _id, userId }` for
every update and delete, so a guessed id from another account is a 404 and not a
mutation. Re-filing an artifact only accepts a destination project the caller
owns. Project names are unique per account, not globally — two people can both
have a "Client Work".

**Uploads.** `UPLOAD_TOKEN` is still one shared secret, so `/api/upload` has to
be told whose account to publish into: `UPLOAD_USER_EMAIL` if set, otherwise the
oldest account. Uploaded artifacts are stamped `visibility: "private"`. Phase 3
replaces this with real per-user tokens.

**Migration.** `node scripts/claim-existing.mjs [email] [--dry-run]` assigns
every document that still lacks a `userId` to one account and marks the
artifacts private. It defaults to the oldest account, is safe to re-run, and
prints the counts first so `--dry-run` tells you what it would touch.

**Indexes.** `artifacts { userId, createdAt }`, `projects { userId, name }`, and
unique indexes on both slug fields, created alongside the auth indexes.

## Phase 3 — per-user API tokens (not built — next)

`UPLOAD_TOKEN` is a single shared secret today. It becomes a `tokens` collection
of `{ tokenHash, userId, label, createdAt, lastUsedAt }`, issued and revoked from
a settings page, shown once at creation. `/api/upload` looks the presented token
up, resolves the user, and attributes the artifact to them. The CLI config
(`~/.artifact-publish.json`) then holds the user's own token rather than the
deployment's.

## Phase 4 — private artifact pages (access built, isolation not)

1. **Access — built.** Artifacts carry `visibility: "private" | "public"`,
   private by default, and anything without the field counts as private. A
   private `/a/[slug]` is served only to its owner's session; everyone else gets
   the same 404 as an unknown slug, so the endpoint can't be probed for which
   artifacts exist. Private responses are `Cache-Control: private, no-store`.
   Each dashboard row has a Private/Shared toggle that flips the flag through
   `PATCH /api/artifacts/[id]`, for the cases where sharing a link is the point.
2. **Isolation — this one blocks a multi-user launch.** An artifact's own
   JavaScript runs on the app's origin. It cannot read the `httpOnly` session
   cookie, but it *can* call `/api/projects` and `/api/artifacts/[id]` with the
   viewer's cookie attached and delete their work. With one trusted uploader
   that was theoretical; with open signup, one user's artifact can act as
   another user's browser. Sharing an artifact publicly widens this to anyone
   who opens the link while signed in.

   The fix needs no second domain. Serve `/a/<slug>` as a small shell page that
   embeds the stored HTML in `<iframe sandbox="allow-scripts" srcdoc="...">`.
   Without `allow-same-origin` the artifact gets an opaque origin: it cannot
   read cookies, cannot call the API with a viewer's session, and cannot reach
   another artifact's `localStorage`. Inlining through `srcdoc` also means there
   is no raw endpoint left to link around the shell. Same domain, no new
   infrastructure.

## Known gaps

- No rate limiting on `/api/auth/signin`; add attempt throttling per email and
  per IP before the deployment is public.
- No password reset, no email verification, no session list / "sign out
  everywhere".
- Sessions are not rotated on sign in, and there is no CSRF token — `sameSite=lax`
  plus JSON-only endpoints covers the ordinary cross-site case but not the
  same-origin artifact problem described in phase 4.
