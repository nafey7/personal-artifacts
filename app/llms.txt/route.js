import pkg from "@/cli/package.json";

// A plain-text summary for agents and crawlers, in the llms.txt convention.
export function GET() {
  const body = `# Artifacts

> One private site for every HTML artifact your AI coding tools produce.
> Claude Code, Codex, Gemini CLI and Cursor can all publish to it through one
> CLI. Private by default; share a link when you choose, with an optional
> expiry and passphrase. Encrypt an artifact end to end and the site stores
> ciphertext it cannot read. Free and open source (MIT).

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
    artifact-publish ./page.html "Title" --encrypted --public

Each call prints the artifact's URL. For an encrypted public artifact the URL
ends in #k=<key>; pass on the whole link, since the part after # is the key
and the browser never sends it to the site.

## Encryption, exactly

Encrypted: the page (AES-256-GCM under a key made on the publisher's machine,
stored wrapped under an account key the site never holds).
Not encrypted: the owner's email, the title, the project, the size, dates,
visibility, and which addresses opened which link. Plain artifacts stay plain.
Limit: the decrypting script is served by the site, pinned by an integrity
hash and generated from the CLI package on npm, where it can be read. The CLI
itself has no such limit.
Recovery: a twelve-word phrase shown once. Lose it and the password and the
encrypted artifacts are gone; the site cannot help.

## HTTP API (Authorization: Bearer <API token>, tokens are issued at /settings)

- POST /api/upload  body { title, html, project?, createProject?, visibility?, slug?, expiresIn?, passphrase? }
                    encrypted: add enc: 1, iv, artKeyWrapped (html is base64url ciphertext), artKeyByPassphrase?
- GET  /api/artifacts            list, newest first; ?project=, ?q=, ?limit=, ?trashed=1; rows carry encrypted
- GET  /api/artifacts/[id-or-slug]   one artifact with its html (ciphertext plus enc, iv, artKeyWrapped when encrypted);
                                     ?format=html for the html alone (409 on an encrypted one)
- PATCH /api/artifacts/[id]     edit title, html, project, visibility, expiry, passphrase; encrypted html needs enc, iv, artKeyWrapped
- GET  /api/auth/keys           the account's wrapped keys, for unlocking with the password or recovery phrase
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
