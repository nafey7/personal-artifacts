import pkg from "@/cli/package.json";

// A plain-text summary for agents and crawlers, in the llms.txt convention.
export function GET() {
  const body = `# Artifacts

> One private site for every HTML artifact your AI coding tools produce.
> Claude Code, Codex, Gemini CLI and Cursor can all publish to it through one
> CLI. Private by default; share a link when you choose, with an optional
> expiry and passphrase. Free and open source (MIT).

Site: https://artifacts.pallason.com
Sign up: https://artifacts.pallason.com/signup
Sign in: https://artifacts.pallason.com/signin
npm package: https://www.npmjs.com/package/${pkg.name} (v${pkg.version})
Source: ${pkg.homepage.replace(/#.*$/, "")}

## Install and connect

    npm install -g ${pkg.name}
    personal-artifact

The second command opens the browser to sign in, approves this machine, saves a
token in ~/.artifact-publish.json and installs a "personal-artifact" skill into
every coding tool it finds on the machine.

## Publish

    artifact-publish ./page.html "Title"
    artifact-publish ./page.html "Title" --project "Client Work"
    artifact-publish ./page.html "Title" --public --expires 7d

Each call prints the artifact's URL.

## HTTP API (Authorization: Bearer <API token>, tokens are issued at /settings)

- POST /api/upload  body { title, html, project?, createProject?, visibility?, slug?, expiresIn?, passphrase? }
- GET  /api/artifacts            list, newest first; ?project=, ?q=, ?limit=, ?trashed=1
- GET  /api/artifacts/[id-or-slug]   one artifact with its html; ?format=html for the html alone
- PATCH /api/artifacts/[id]     edit title, html, project, visibility, expiry, passphrase
- GET|POST /api/projects        list or create projects
- GET  /api/me                  the token's owner

Artifacts are served whole at /a/<slug>, inside a sandboxed iframe: write a
complete HTML document, keep it under 2MB, and keep state in memory (browser
storage throws inside the sandbox).
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
