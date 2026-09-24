# personal-artifact

Publish self-contained HTML pages to your own private artifact site, from
whichever coding agent you already use.

You ask your agent to "publish this as an artifact". It designs a real HTML
page, runs `artifact-publish`, and hands you back a URL. The page is private to
your account unless you share it — see **Private by default** below.

Works with **Claude Code, Codex, Gemini CLI and Cursor** — the same skill is
installed for each one you have, in that tool's own skills directory.

## Install

```
npm install -g personal-artifact
personal-artifact
```

That asks nothing. It prints the site it will publish to, then opens your
browser — sign in, or sign up, it works the same, and approve the machine. The
token travels straight to the CLI, so you never copy or paste one. Your
encryption key comes with it: the CLI makes a key pair for the occasion, the
browser seals the account key to it with your password, and the site relays a
blob it cannot open. Both ends print the same fingerprint so you can check
they match. Then it:

- writes `~/.artifact-publish.json` (mode `0600`) with the token and the key
- installs the publishing skill for the coding tools you actually have

It writes nothing for tools you have not installed — no vendor directory is
created on spec. Run it again any time you install another tool or rotate a
token.

On a headless machine — a server, a container, CI — there is no browser to
open, so create a token on the **Settings** page and pass it directly:

```
personal-artifact --token pa_...        # skip the browser
personal-artifact --no-browser          # print the URL instead of opening it
personal-artifact --token pa_... --recovery-phrase "twelve words ..."
                                        # and unlock the encryption key from
                                        # the recovery phrase, since no
                                        # browser can hand it over
```

Needs Node.js 20 or newer.

## Upgrading

```
npm install -g personal-artifact@latest
```

The skill is a copy in your agent's own directory, not a link into the
package, so an upgrade would otherwise leave your agent reading the previous
release's instructions — new commands installed, and nothing telling the agent
they exist. Installing refreshes any copy this program wrote, and
`artifact-publish` says so if it ever finds one that is out of date. Restart
running agent sessions afterwards to pick up the new file.

## Uninstall

```
personal-artifact uninstall
```

One command. It removes the config file and the skill from both destinations,
prunes `~/.agents` if nothing else is left in it, then uninstalls the npm
package itself. Add `--keep-package` to remove the files but leave the package
installed, and `--yes` to skip the confirmation.

It cannot revoke your token — that lives on the site. Revoke it on the
**Settings** page if you are done for good.

## Publish

Usually you don't run this yourself; your agent does. But it's a normal CLI:

```
artifact-publish ./page.html "Load Test Report"
artifact-publish ./page.html "Load Test Report" --project "Client Work"
artifact-publish ./page.html "Load Test Report" --public
artifact-publish ./page.html "Load Test Report" --expires 7d
artifact-publish ./page.html "Load Test Report" --passphrase "salt marsh heron"
artifact-publish ./page.html "Load Test Report" --update load-test-report-3f9a1c
```

The URL goes to stdout, so piping it still works; one line saying who can open
it goes to stderr.

- `--project` must name a project that already exists. If it doesn't, the
  error lists the projects that do.
- `--new-project` files the artifact under a project, creating it first if
  there is no project by that name.
- `--public` publishes a link anyone can open. Without it the artifact is
  private.
- `--expires <when>` shares the link and closes it again after `30m`, `24h`,
  `7d`, `2w`, or at an ISO date. Past that moment the link goes private; you
  can still open it, and can share it again from the dashboard.
- `--passphrase <text>` shares the link but asks for the passphrase before the
  page opens. Set `ARTIFACT_PASSPHRASE` instead to keep it out of your shell
  history. Only a hash is stored, so write the passphrase down.
- `--update <slug>` replaces an artifact you already published and keeps its
  URL, instead of minting a second one. Share options you don't mention stay
  as they were; `--expires never` clears an expiry.

Both `--expires` and `--passphrase` imply `--public`. You, the owner, are never
asked for the passphrase and never locked out by the expiry.

## Encrypted end to end

Every artifact is one the site cannot read — not its operator, not its
database host, not anyone with a copy of the database. There is no flag: the
CLI makes a random key for the page, encrypts the HTML with it here, wraps
that key under your account key, and uploads ciphertext and wrapped keys
only. The page is decrypted in the reader's browser by a script the site
serves with an integrity hash, and which is generated from `crypto.js` in
this package so you can read the code that runs.

- A private encrypted artifact opens for you as usual; your browser holds the
  account key after you sign in.
- Shared with `--public`, the printed link ends in `#k=<key>`. The part after
  the `#` never reaches the site. Send the whole link. Anyone with it can read
  the page; making it private stops the site serving the ciphertext, and
  **Re-encrypt** in the share sheet changes the key so old links stop working.
- Shared with `--passphrase`, the passphrase unlocks the key instead, and the
  link carries none.
- `get` decrypts. `--update` keeps the artifact under the same key. `list`
  says `plain` on artifacts from before encryption, which are still stored in
  the clear; updating one, or clicking the lock in the dashboard, encrypts it.
- What the site still sees: your email, the title, the project, the size,
  dates, visibility, and who opened which link. Titles stay in the clear so
  search and the dashboard keep working.

The account key is made in your browser when you first sign in, and shown
once as a twelve-word recovery phrase. Lose the phrase and forget the password
and the encrypted artifacts are gone; nobody can recover them, which is the
point. Settings can make a new phrase at any time.

## Read back

The CLI can also list and fetch what is already on the site, which is what lets
an agent act on "update the dashboard from last week" without anyone hunting
for a slug:

```
artifact-publish projects                          # your project folders
artifact-publish list                              # every artifact, newest first
artifact-publish list --project "Client Work"      # one folder
artifact-publish list --search dashboard           # title match
artifact-publish get <slug> --out ./page.html      # the published HTML, to a file
artifact-publish get <slug>                        # the HTML on stdout
```

`list` prints one line per artifact — slug, last updated, `public` or
`private` (with `plain` after it for the few from before encryption), project,
title. Add `--json` to any of them for the raw API response. `get` decrypts;
`--raw` returns the ciphertext fields as stored.

## Private by default

A new artifact opens for you — in a browser you are signed in to, or for a
request carrying your API token. To anything else the URL returns **404**.

That is worth knowing because agents get it wrong: one publishes, fetches the
URL to check its work, sees 404, and concludes the site is broken. It isn't.
The skill in this package now says so explicitly, and the upload response spells
it out too. To get a link you can send someone, publish with `--public` or mark
the artifact **Shared** in your dashboard — sharing keeps the same URL.

## What the skill tells your agent

The skill is most of this package. Roughly a fifth of it covers the mechanics —
write a complete document, include your own reset, keep state in memory because
artifacts run sandboxed. The rest is design guidance: pair typefaces
deliberately, define both light and dark through tokens, calibrate the treatment
to what was actually asked for, and avoid the handful of looks AI-generated
pages have converged on.

The point is that the page it produces should be one you'd send to a client.

## Limits

- 2MB per artifact — inline what matters, link the rest
- 200 artifacts per account
- 10 API tokens per account

## Notes

- Artifacts render inside a sandboxed iframe with no `allow-same-origin`, so a
  published page cannot read the site's cookies or reach another artifact. The
  cost is that `localStorage` and cookies throw inside an artifact — pages must
  hold their state in memory.
- Each publish mints a new URL. To correct a page you already sent someone, use
  `--update <slug>` rather than publishing again — that keeps the URL and
  avoids leaving a stale duplicate behind.

## Self-hosting

The CLI is not tied to one host. Point it at your own deployment with
`personal-artifact --site <url>`; the choice is saved, so later runs need the
flag only to change it.

Source: https://github.com/nafey7/personal-artifacts
