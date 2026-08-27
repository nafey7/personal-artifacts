# Artifacts

Tiny Next.js app for publishing self-contained HTML artifacts. Free end to end:
Vercel Hobby + MongoDB Atlas M0.

Artifacts can be filed into projects. A project is just a folder; deleting one
also deletes every artifact inside it.

- `GET /` — dashboard, all artifacts newest first
- `GET /unfiled` — artifacts that belong to no project
- `GET /p/[slug]` — one project's artifacts
- `GET /a/[slug]` — the stored HTML, served as the whole response
- `POST /api/upload` — `Authorization: Bearer <UPLOAD_TOKEN>`, body
  `{ title, html, project? }` (`project` takes an id, slug or exact name)
- `GET|POST /api/projects` — list / create, body `{ name }`
- `PATCH|DELETE /api/projects/[id]` — rename (`{ name }`) / delete with its artifacts
- `PATCH|DELETE /api/artifacts/[id]` — edit (`{ title?, projectId? }`) / delete

## Setup

1. Create a free MongoDB Atlas M0 cluster, a database user, and allow access from
   anywhere (`0.0.0.0/0`) so Vercel can connect.
2. `npm install`, then copy `.env.local.example` to `.env.local` and fill it in.
   Generate a token with `openssl rand -hex 32`.
3. `npm run dev` to run locally.

## Deploy

Push to GitHub, import the repo on Vercel, and set `MONGODB_URI`, `MONGODB_DB`,
and `UPLOAD_TOKEN` as environment variables. Deploy.

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

An artifact page runs its own JavaScript on this domain, so it can read that
domain's cookies. Fine while you are the only uploader and the app has no login.
If you ever let other people upload, move `/a/[slug]` to a separate domain first.

Uploads are token-gated, but the project and artifact routes the dashboard calls
(`/api/projects`, `/api/artifacts`) are not — the app has no login to check
against, so anyone who reaches the deployment can rename or delete things. Put
the deployment behind Vercel password protection, or add auth, before sharing
the URL.
