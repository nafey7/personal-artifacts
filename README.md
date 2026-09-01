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
  `project`, `visibility` and a plain-language `note` saying who can open it.
- `GET /api/artifacts` — your artifacts without their HTML, newest first.
  `?project=<id|slug|name>` (or `unfiled`), `?q=<title text>`, `?limit=<n>`.
  Session or API token.
- `GET /api/artifacts/[id-or-slug]` — one artifact with its `html`;
  `?format=html` returns the HTML alone as `text/plain`. Session or API token.
- `GET /api/me` — the token's owner, used by `personal-artifact` to validate a token
- `POST /api/cli/start|poll` — browser sign-in for the CLI; `POST /api/cli/approve` (session required)
- `GET /cli/auth?code=` — the page where a machine is approved
- `GET|POST /api/tokens`, `DELETE /api/tokens/[id]` — issue, list, revoke (session required)
- `GET|POST /api/projects` — list (with counts) / create, body `{ name }` (session or API token)
- `PATCH|DELETE /api/projects/[id]` — rename (`{ name }`) / delete with its artifacts (session required)
- `PATCH|DELETE /api/artifacts/[id]` — edit (`{ title?, projectId?, visibility?, expiresIn?, expiresAt?, passphrase? }`) / delete (session required).
  `expiresIn` is a duration (`30m`, `24h`, `7d`, `2w`) or `null`; `expiresAt`
  an ISO instant or `null`; `passphrase` a string of 4–200 characters or `null`
  to remove it. Setting either implies `visibility: "public"`; setting
  `"private"` clears both. Responses carry `isPublic`, `expiresAt`, `isExpired`
  and `hasPassphrase`, never the passphrase. `POST /api/upload` takes the same
  three fields.

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
already published, keeping its URL.

Read back what is there:

```
artifact-publish projects
artifact-publish list [--project "Client Work"] [--search dashboard] [--json]
artifact-publish get <slug> [--out ./page.html]
```

Artifacts are capped at 2MB (`MAX_ARTIFACT_BYTES`) and 200 per account
(`MAX_ARTIFACTS_PER_USER`). `/settings` shows how much of that allowance an
account has used, so the cap is visible before a publish is refused.

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
