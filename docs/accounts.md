# Accounts & private artifacts

Status of this document: **phases 1–2 are implemented, and phase 4's access
control with them.** Phase 3 (per-user API tokens) and phase 4's isolation work
are the agreed direction, not yet built.

## The vision

Today this app is a single-tenant archive: one Mongo database, one upload token,
one implicit owner. The direction is a small multi-tenant tool that developers —
teammates first, then anyone — can run against a shared deployment:

1. Someone installs the `publish` CLI package.
2. They sign up on the site and generate a personal API token.
3. They paste that token into the CLI config once.
4. From then on they have the same "publish a personal artifact" agent skill the
   author has locally, and everything they publish is **private to their
   account**.

The point of the product is privacy. Artifacts are working documents — reports,
dashboards, client one-pagers — and a developer publishing one should not be
handing it to a shared pool or to a vendor's cloud. The tool is deliberately
self-hostable: your deployment, your Mongo, your data.

The CLI and the skill are meant to be **agent-agnostic**. Publishing is a plain
`POST` of `{ title, html, project? }` with a bearer token, so the same skill
definition works from Claude Code, Gemini CLI, or OpenAI Codex. Nothing in the
protocol is specific to one assistant, and that should stay true.

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

## Phase 3 — per-user API tokens (not built)

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
   who opens the link while signed in. Fix before opening signup — serve
   artifact HTML from a separate origin, or render it inside a sandboxed iframe
   without `allow-same-origin`.

## Known gaps

- No rate limiting on `/api/auth/signin`; add attempt throttling per email and
  per IP before the deployment is public.
- No password reset, no email verification, no session list / "sign out
  everywhere".
- Sessions are not rotated on sign in, and there is no CSRF token — `sameSite=lax`
  plus JSON-only endpoints covers the ordinary cross-site case but not the
  same-origin artifact problem described in phase 4.
