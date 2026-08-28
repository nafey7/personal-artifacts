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
- `GET /a/[slug]` — the artifact, rendered inside a sandboxed iframe. Private by
  default: only the owner's session gets it, unless the artifact is toggled to
  Shared in the dashboard.
- `GET /settings` — API tokens
- `POST /api/upload` — `Authorization: Bearer <your API token>`, body
  `{ title, html, project? }` (`project` takes an id, slug or exact name)
- `GET /api/me` — the token's owner, used by `personal-artifact` to validate a token
- `POST /api/cli/start|poll` — browser sign-in for the CLI; `POST /api/cli/approve` (session required)
- `GET /cli/auth?code=` — the page where a machine is approved
- `GET|POST /api/tokens`, `DELETE /api/tokens/[id]` — issue, list, revoke (session required)
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
npm install -g personal-artifact
personal-artifact
```

`personal-artifact` asks for the site and an API token (create one at
`/settings`), checks the token works, then writes `~/.artifact-publish.json` and
installs the publishing skill for whichever coding tools you have — Claude Code,
Codex, Gemini CLI, Cursor. It writes nothing for tools you have not installed,
and is safe to re-run whenever you install another one or rotate a token.

Publish:

```
artifact-publish ./artifact.html "Load test report"
artifact-publish ./artifact.html "Load test report" --project "Client Work"
```

It prints the URL. `--project` must name a project that already exists.

Artifacts are capped at 2MB (`MAX_ARTIFACT_BYTES`) and 200 per account
(`MAX_ARTIFACTS_PER_USER`).

Undo all of it — config, skills, and the package — with `personal-artifact
uninstall`. It leaves the token on the server; revoke that at `/settings`.

## Releasing the CLI

Publishing runs from GitHub Actions over OIDC trusted publishing — no npm token
lives in this repo, and no 2FA prompt has to be answered.

```
cd cli
npm version patch      # or minor / major — this commits and tags
git push && git push --tags
```

The tag triggers `.github/workflows/publish.yml`, which refuses to publish if
the tag and `cli/package.json` disagree.

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

Two things remain before signup should be opened to strangers: email
verification and password reset (both need a mail provider), and deleting the
ownerless `UPLOAD_TOKEN` fallback. Until then keep `SIGNUP_CODE` set. See
[docs/accounts.md](docs/accounts.md).
