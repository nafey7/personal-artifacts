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
token travels straight to the CLI, so you never copy or paste one. Then it:

- writes `~/.artifact-publish.json` (mode `0600`)
- installs the publishing skill for the coding tools you actually have

It writes nothing for tools you have not installed — no vendor directory is
created on spec. Run it again any time you install another tool or rotate a
token.

On a headless machine — a server, a container, CI — there is no browser to
open, so create a token on the **Settings** page and pass it directly:

```
personal-artifact --token pa_...        # skip the browser
personal-artifact --no-browser          # print the URL instead of opening it
```

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
artifact-publish ./page.html "Load Test Report" --update load-test-report-3f9a1c
```

The URL goes to stdout, so piping it still works; one line saying who can open
it goes to stderr.

- `--project` must name a project that already exists.
- `--public` publishes a link anyone can open. Without it the artifact is
  private.
- `--update <slug>` replaces an artifact you already published and keeps its
  URL, instead of minting a second one.

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

The site is a small Next.js app backed by MongoDB, and runs on free tiers. Sign
in against your own deployment with `personal-artifact --site <url>`; it is
saved, so later runs need the flag only to change it.

Source: https://github.com/nafey7/personal-artifacts
