# Artifacts

Tiny Next.js app for publishing self-contained HTML artifacts. Free end to end:
Vercel Hobby + MongoDB Atlas M0.

Artifacts can be filed into projects. A project is just a folder; deleting one
also deletes every artifact inside it.

The dashboard is behind a login. See [docs/accounts.md](docs/accounts.md) for
the account model and the phases still to come.

- `GET /signin`, `GET /signup` — account screens
- `POST /api/auth/signin|signup|signout` — `{ email, password, name?, code? }`
- `GET /` — dashboard, all artifacts newest first
- `GET /unfiled` — artifacts that belong to no project
- `GET /p/[slug]` — one project's artifacts
- `GET /a/[slug]` — the stored HTML, served as the whole response. Private by
  default: only the owner's session gets it, unless the artifact is toggled to
  Shared in the dashboard.
- `POST /api/upload` — `Authorization: Bearer <UPLOAD_TOKEN>`, body
  `{ title, html, project? }` (`project` takes an id, slug or exact name)
- `GET|POST /api/projects` — list / create, body `{ name }` (session required)
- `PATCH|DELETE /api/projects/[id]` — rename (`{ name }`) / delete with its artifacts (session required)
- `PATCH|DELETE /api/artifacts/[id]` — edit (`{ title?, projectId?, visibility? }`) / delete (session required)

## Setup

1. Create a free MongoDB Atlas M0 cluster, a database user, and allow access from
   anywhere (`0.0.0.0/0`) so Vercel can connect.
2. `npm install`, then copy `.env.local.example` to `.env.local` and fill it in.
   Generate a token with `openssl rand -hex 32`.
3. `npm run dev` to run locally.

## Deploy

Push to GitHub, import the repo on Vercel, and set `MONGODB_URI`, `MONGODB_DB`,
and `UPLOAD_TOKEN` as environment variables. Set `SIGNUP_CODE` too if you want
signup to be invite-only, and `UPLOAD_USER_EMAIL` to say which account the CLI
publishes into. Deploy.

Artifacts and projects created before accounts existed have no owner. After
signing up, claim them:

```
node scripts/claim-existing.mjs you@example.com --dry-run
node scripts/claim-existing.mjs you@example.com
```

## CLI

```
cd cli && npm link
```

Then create `~/.artifact-publish.json`:

```json
{ "site": "https://your-app.vercel.app", "token": "same value as UPLOAD_TOKEN" }
```

Publish:

```
publish ./artifact.html "Load test report"
publish ./artifact.html "Load test report" --project "Client Work"
```

It prints the public URL. `--project` must name a project that already exists.

## Security note

Do not open signup on a shared deployment yet. One thing is still missing:

**An artifact page runs its own JavaScript on this origin.** It cannot read
the `httpOnly` session cookie, but it can call the dashboard API with the
viewer's cookie attached. Harmless while you are the only uploader; with other
uploaders, serve `/a/[slug]` from a separate domain or a sandboxed iframe first.
Phase 4 in [docs/accounts.md](docs/accounts.md).

Until that lands, keep `SIGNUP_CODE` set (or the deployment behind Vercel
password protection) and treat it as single-tenant.
