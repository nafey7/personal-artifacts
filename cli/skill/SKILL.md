---
name: personal-artifact
description: Design a self-contained HTML page and publish it to the user's own artifact site with the `artifact-publish` CLI, returning a live URL. Use whenever the user asks to publish, host, or put something online as a personal artifact — a report, dashboard, memo, landing page, chart, one-pager, visual explainer — or says "publish this", "make me an artifact", "put this on my site", "personal artifact".
---

# Personal Artifact

Design a standalone HTML page, then publish it to the user's own site with the
`artifact-publish` CLI. The result is a real URL they can share.

This is **not** the claude.ai Artifact host. The mechanics differ in ways that
break pages if you get them wrong — read "The target" before writing any HTML.

## The target

The site stores whole HTML documents and serves each one as the entire HTTP
response body at `/a/<slug>`. Consequences:

- **Write a complete document.** `<!doctype html>`, `<html lang="en">`, `<head>`
  with `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  `<title>`, then `<body>`. Nothing wraps your output. Omitting these is the
  single most common failure.
- **No CSS reset is injected.** Include your own (`*, *::before, *::after { box-sizing: border-box }`,
  zero out default margins, `img { max-width: 100% }`).
- **No CSP.** External stylesheets, fonts, scripts, and images all load. Still
  prefer self-contained pages — inline the CSS and JS, embed small images as
  data URIs — so the page cannot rot when an external host disappears. Google
  Fonts via `<link>` is fine and reliable.
- **Size ceiling 2MB.** Inline what matters and link the rest; an oversized
  upload is rejected with a 413 rather than truncated.
- **Theme: `prefers-color-scheme` only.** Nothing stamps `data-theme` on the
  root here, so `[data-theme]` blocks are dead code — leave them out. If the
  user wants a manual toggle, you must write it yourself (a button that sets a
  class or attribute on `<html>`, persisted in `localStorage`).
- **Sandboxed, so browser storage does not work.** The page is served inside an
  iframe with no `allow-same-origin`, which gives it an opaque origin: scripts
  run, but `localStorage`, `sessionStorage`, and cookies all throw on access.
  Write pages that hold their state in memory. If you want a theme toggle or a
  remembered tab, wrap every storage call in `try`/`catch` and make the page
  render correctly when the value is missing — it always will be. `fetch` to
  external hosts still works; `fetch` back to this site does not.
- **Never publish a page that collects credentials.**
- **Artifacts are private by default.** A published URL opens for the owner in
  a browser they are signed in to, and for a request carrying their API token.
  To everyone and everything else it returns **404** — that is the artifact
  being private, not a failed publish. Read "Privacy" below before you report a
  URL or try to verify one.
- **A new publish mints a new URL.** Each publish gets a fresh slug with a
  random suffix, so publishing the same title twice leaves two artifacts. To
  correct a page you already published, pass `--update <slug>` instead: it
  replaces the content and keeps the URL that was handed out.
- **Artifacts can be encrypted end to end.** With `--encrypted` the CLI
  seals the page on this machine before uploading; the site stores
  ciphertext it cannot read and the reader's browser decrypts it. See
  "Encryption" below for when to use it and how the link changes.

## Publishing

The `artifact-publish` CLI is installed globally and works from any directory. It reads
`~/.artifact-publish.json` for the site URL and auth token, POSTs to the live
site over HTTPS, and prints the URL. It needs no local server, no build, and no
dev dependencies.

Write the file somewhere scratch (not into the user's project unless they asked
for a file), then:

```
artifact-publish /path/to/page.html "Human Readable Title"
```

Stdout is one line — the URL. Stderr adds one line saying who can open it.
Report the URL to the user as the deliverable, along with what that second line
said.

Flags:

```
--project "Folder"      file it under a project that already exists
--new-project "Folder"  file it under this project, creating it if it does not exist
--public                anyone with the link can open it
--expires 7d            share it, and close the link after 30m / 24h / 7d / 2w,
                        or at an ISO date
--passphrase <text>     share it, and ask for this passphrase before it opens
--update <slug>         replace something you already published, keeping its URL
--encrypted             encrypt the page here first; the site never sees the words
```

`--project` with a name that does not exist fails, and the error lists the
projects that do — pick the right one from that list, or use `--new-project`
when the user actually wants a new folder. Never create a near-duplicate of a
folder that already exists ("Client work" next to "Client Work").

Publish `--public` when the user says the page is for someone else — to send,
share, show a client, put in a doc. Otherwise leave it private; they can share
it later from the dashboard without the URL changing.

`--expires` and `--passphrase` are the two ways to share less than forever,
and both imply `--public`. Use them only when the user asks for them:

- "share this for a week", "a link that dies Friday" → `--expires 7d` (or an
  ISO date). After that instant the link goes back to private; the owner can
  still open it and can share it again from the dashboard.
- "put a password on it", "only people I give the passphrase to" →
  `--passphrase`. If the user gave a passphrase, pass it exactly. If they did
  not, make one up that can be read out over the phone — three or four plain
  words — pass it, and **tell the user what it is in your report**: the site
  stores only a hash and cannot show it to them later. Prefer the
  `ARTIFACT_PASSPHRASE` environment variable over the flag when the shell
  history matters.

The owner is never asked for the passphrase and never locked out by the
expiry. A viewer who has neither sees a small page saying the link has expired
or asking for the passphrase — never the 404 that a private artifact returns.
On `--update`, options you don't mention are left as they were; `--expires
never` clears an expiry.

## Encryption

`--encrypted` makes an artifact the site itself cannot read. The CLI makes a
key for the page, encrypts the HTML with it on this machine, wraps that key
under the user's account key (from `~/.artifact-publish.json`, put there when
the machine was approved), and uploads only ciphertext and wrapped keys. The
page is decrypted in the reader's browser.

Use it when the user asks for it — "encrypt this", "make sure nobody but me
can read it", "end to end" — or when the content is plainly sensitive
(credentials, contracts, medical or financial detail) and they have not said
otherwise; say in your report that you did. Plain artifacts remain the
default: an encrypted page cannot be searched by content, and a lost recovery
phrase loses it for good.

What changes:

- **The link.** With `--public`, the URL the CLI prints ends in `#k=<key>`.
  Everything after the `#` is the key; the browser never sends it to the
  site. **Report the whole URL, `#` and all** — a link with that part cut off
  opens to a page saying the key is missing. Never shorten it, never split it
  across lines.
- **With `--passphrase`,** the passphrase unlocks the key instead, so the link
  carries no `#k=` and is safe to send on its own; the passphrase goes
  separately, as before.
- **`get` returns decrypted HTML.** The flow to edit an encrypted page is the
  same as any other: `get --out`, edit, `--update <slug>`. An update keeps the
  artifact encrypted under the same key, so links already handed out keep
  working. `--plain` on an update publishes it in the clear instead; do that
  only when asked. `get --raw` returns the ciphertext fields as stored.
- **`list` marks encrypted rows** with a lock after the visibility word.
- **Verifying with `curl` shows ciphertext,** not the page. That is the
  artifact being encrypted, not broken: the content is inside `data-ct` on
  the shell page and decrypts only in a browser with the key.

If `--encrypted` exits 2 saying this machine has no encryption key, the
person approved the machine without handing the key over. Tell them to run
`personal-artifact` again and approve with their password — do not fall back
to publishing the page plain without saying so.

## Reading back what is published

The same CLI lists and fetches the user's artifacts, so you never have to ask
them to dig a slug out of the dashboard:

```
artifact-publish projects                          # the user's project folders
artifact-publish list                              # every artifact, newest first
artifact-publish list --project "Client Work"      # one folder
artifact-publish list --search dashboard           # title match, case-insensitive
artifact-publish get <slug> --out /tmp/page.html   # the published HTML, to a file
artifact-publish get <slug>                        # the HTML on stdout
```

`list` prints one line per artifact: slug, last updated date, who can open it
(`private`, `public`, `passphrase`, or `expired`), project, title. Add `--json`
to any of these for the raw API response (it includes `url`, `createdAt`,
`updatedAt`, `bytes`, `expiresAt`, `hasPassphrase`).

Use this whenever the user refers to something they already published — "update
the dashboard from last week", "what's in the client folder", "make last
month's report public". The flow for an edit is: `list` to find the slug,
`get --out` to fetch the HTML, edit the file, then publish it back with
`--update <slug>` so the URL stays the same. If `list` finds more than one
plausible match, ask which one rather than guessing.

Behind the CLI these are `GET /api/projects`, `GET /api/artifacts` and
`GET /api/artifacts/<slug>`, all taking the same `Authorization: Bearer` token.

## Renaming and deleting

```
artifact-publish rename <slug> "New title"
artifact-publish delete <slug>                     # to the trash, restorable
artifact-publish trash                             # what is in the trash
artifact-publish restore <slug>
artifact-publish delete <slug> --permanent         # only works on a trashed one
```

`rename` changes the listing title only; to change the page itself, publish
over it with `--update <slug>`.

**The user will name these by subject, not by slug** — "delete the artifact
about React interview questions", "delete the one you made this session".
Turn a description into a slug yourself, and never delete on a guess:

1. If you published it in this conversation, you already have the slug. Use it.
2. Otherwise run `artifact-publish list --search <a word from what they said>
   --json`. Widen to a plain `list` if that finds nothing.
3. **No match** → say so and stop. Do not delete the nearest thing.
4. **More than one match** → show the titles and URLs and ask which one.
5. **Exactly one match** → name it back to them with its URL and confirm
   before deleting, unless they already named that exact artifact or slug.

Deleting is a soft delete, so a mistake is recoverable — say that in your
confirmation ("it goes to the trash, restorable for a few days"). Never pass
`--permanent` unless the user asks for the artifact to be gone for good, and
confirm that one every time: it cannot be undone.

The same find-then-confirm rule applies to `rename` and to publishing over
something with `--update` — anything that changes an artifact that already
exists.

## Privacy

New artifacts are private. The URL you get back returns **404** to any request
that doesn't carry the owner's browser session or API token. A fresh `curl` has
neither, so 404 is the *correct* response there — it does not mean the publish
failed, the page is missing, or the site is broken.

If it published, it saved. The upload response says so, and the CLI prints the
URL only on success.

So:

- **Never re-publish to test whether the first one worked.** That mints a
  second artifact and leaves the user with duplicates. It proves nothing.
- **Never tell the user the site is broken because a URL 404s.** Check whether
  the artifact is private first — it is, unless you passed `--public`.
- **Report the URL honestly:** it opens for them when they're signed in to the
  site. If they want a link others can open, either publish with `--public` or
  tell them to mark it Shared in the dashboard.

To verify for real, send the same credential you published with:

```
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $(node -p "require(require('os').homedir()+'/.artifact-publish.json').token")" \
  <url>
```

That returns 200. Verifying is optional — do it when something specific makes
you doubt the upload, not as a routine step after every publish.

Two titles are in play; keep them consistent:
- the **CLI argument** becomes the listing name on the site index and the slug;
- the **`<title>` tag** is the browser tab.

Both follow the same rule: a short, specific noun phrase, typically two to four
words. Name the page, don't caption it — no explainer after a dash or colon.

If `artifact-publish` fails — meaning the command itself exits non-zero:
- `missing or invalid config` → `~/.artifact-publish.json` is absent or
  malformed; it needs `{ "site": "...", "token": "..." }`.
- `401` → the token has been revoked or no longer exists on the deployment;
  re-run `personal-artifact` to sign in again.
- `400` naming an `unknown project` → the name doesn't match any of their
  folders; the message lists the ones that exist. Use one of those, or
  `--new-project` if a new folder was the intent.
- `404` on `--update`, `get`, `rename` or `delete` → that slug isn't one of
  theirs; run `artifact-publish list` to find the right one, or publish fresh.
- `409 already in the trash` → they deleted it before; `artifact-publish
  restore <slug>` brings it back.
- `409 not in the trash` on `--permanent` → it is still live. Delete it first,
  which is almost always what they meant anyway.
- `409 in the trash — restore it first` on `rename` or a share change → the
  artifact is deleted; restore it before changing it.
- `413` → the page is over 2MB; inline less and link large media.
- `exit 2` on `--encrypted` or `get` → this machine has no encryption key, or
  the artifact was encrypted under a different one. See "Encryption".
- `409 encrypted end to end` on `?format=html` → fetch without that flag, or
  use `artifact-publish get`, which decrypts.
- `500` → a problem on the site's side, not with the HTML. Retry; if it
  persists, the site itself needs attention.

A 404 when *fetching* a published URL is not in this list. That is the artifact
being private — see "Privacy" above.

## Design

Approach this as the design lead at a small studio known for their versatility,
giving every page a visual identity pitched at the treatment the task actually
calls for. Make deliberate choices about palette, typography, and layout that
are specific to this subject, and avoid templated designs.

### Read the request first

Calibrate treatment, not whether to design. A doc deserves the same craft as a
landing page — what changes is the treatment that craft is delivered in.

Many requests call for a more utilitarian treatment: a plan, a memo, a report,
a demo. Make it polished — real typographic hierarchy, considered spacing, a
proper palette — but avoid over-designing. Most pages do not need a flashy,
gigantic hero. Keep flourishes tasteful and limited.

Some requests call for an editorial treatment: a landing page, a game, a tool
they'll keep or share.

When unsure: a well-composed page is never the wrong answer; an over-designed
visual identity sometimes is.

### Fundamentals for every page

**Honor what's already there.** Look for an existing design system first —
CLAUDE.md, a tokens or theme file, existing component styles. When one exists,
apply it; everything below fills gaps and never overrides. Precedence is always:
the user's own words, then the project's existing system, then your choices.

**Ground it in the subject.** If the subject isn't already clear, pin it: one
concrete subject, its audience, and the page's single job. The subject's own
world — its materials, instruments, vernacular — is where distinctive choices
come from. Build with real content throughout, never lorem.

**Pair typefaces.** Typography carries the page even when the page isn't about
typography. Link Google Fonts directly
(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap">`)
and always declare a real fallback stack. Keep running text near 65 characters
wide; set a type scale and stay on it; give headings `text-wrap: balance`, body
text room to breathe, and uppercase labels a touch of letter-spacing.

**Choose neutrals, don't default to them.** A pure mid-grey reads as
unconsidered; a grey with a slight hue bias toward the page's accent reads as
chosen. Pure white and near-black are fine grounds when they suit the subject —
the point is that the neutral was picked, not inherited.

**Design both themes.** Define the complete light palette as custom properties
on `:root`, then redefine *only those tokens* inside
`@media (prefers-color-scheme: dark)`. Style every component through the tokens,
never with a color declared solely inside the media block — that is the classic
unreadable-page bug. Set an explicit `background` and `color` on `body` from
tokens. Give the second theme the same care as the first: don't naively invert,
keep contrast legible and the accent working on both grounds. A design that
deliberately commits to one visual world (a neon arcade screen, a letterpress
invitation) may stay single-theme — then skip the media query entirely but still
paint every color explicitly. Make it a choice, not an omission.

**Let layout do the spacing.** Lay out sibling groups with flex or grid and
`gap`, not per-element margins that silently collapse or double. Wide content —
tables, code, diagrams — gets `overflow-x: auto` on its own container so the
page body never scrolls sideways. Use relative units and `max-width: 100%` on
images so the page holds up on a phone. Reach for
`font-variant-numeric: tabular-nums` wherever digits line up in columns.

**Avoid AI-generated design.** AI-generated design currently clusters around a
few looks: warm cream (#F4F1EA) with a serif display and terracotta accent;
near-black with a lone acid-green or vermilion pop; broadsheet hairline rules
with dense columns; a purple-to-blue gradient hero on white; Inter or Space
Grotesk as the "safe" face; emoji as section markers; everything centered;
`rounded-lg` everywhere; accent bar/rail on rounded cards. Where the user pins
down a visual direction, follow it exactly — their words always win, including
when they ask for one of these looks. Where nothing is specified, don't spend
that freedom on one of these defaults.

**Build cleanly.** Watch for overlapping elements, cascade collisions, and
silent font fallbacks; visual bugs hide in the gap between source and output.
Close every non-void element, double-quote attributes, give keyboard focus a
visible state, respect `prefers-reduced-motion`. For generative or decorative
graphics, reach for Canvas or WebGL rather than hand-authoring long SVG paths.
Watch selector specificity — it is easy to generate classes that cancel each
other out and silently undo your spacing.

**Writing the copy.** Words are design material, not decoration. Write from the
user's side of the screen — name things by what people recognize, not how the
system is built. Active voice; a control says exactly what happens ("Publish",
then a toast that says "Published"). Errors explain what went wrong and how to
fix it — no apologies, no vagueness. Specific beats clever.

**Structure is information.** Structural devices — numbering, eyebrows,
dividers, labels — should encode something true about the content, not decorate
it. Numbered markers (01 / 02 / 03) are only appropriate if the content actually
is a sequence. Question whether such choices make sense before using them.

**When it's a UI, not a document.** A dashboard or tool is scanned and operated,
not read top-to-bottom, so the craft shifts from typography to information
design. Surface the summary before the detail; encode state in form as well as
number — a pill, a chip, a severity stripe — so what needs attention reads at a
glance. Semantic color (good / warning / critical) is separate from the accent
hue and doesn't count as your accent. Give sparklines and charts the same care
as type: an area fill, a faint grid, an emphasized endpoint. What's interactive
should look interactive.

### Process

Before writing code, sketch a short design plan — a compact token system:
- **Color**: the palette as 4–6 named hex values.
- **Type**: typefaces for 2+ roles — a characterful display face used with
  restraint, a complementary body face, and a utility face for captions or data
  if needed.
- **Layout**: the layout concept in one or two sentences.

Then build, following the plan and deriving every color and type decision from
it.

### When the request is editorial

The stance shifts: the client has already rejected proposals that felt
templated, and is paying for a distinctive point of view. Make opinionated
calls, and take one real aesthetic risk where it serves the work.

Review the design plan against the subject before building: if any part reads
like the generic default you would produce for any similar page, revise it, and
note what you changed and why. Only then write the code, following the revised
plan exactly.

- The hero is a thesis: open with the most characteristic thing in the subject's
  world — headline, image, live demo, interactive moment.
- Typography carries the personality. Pair display and body faces deliberately,
  not the families you'd reach for on any other project. Make the type treatment
  itself memorable, not a neutral delivery vehicle.
- Leverage motion deliberately — a page-load sequence, a scroll-triggered
  reveal, hover micro-interactions, ambient atmosphere. An orchestrated moment
  usually lands harder than scattered effects. Sometimes less is more; extra
  animation contributes to the feeling that the design is AI-generated.
- Match complexity to the vision. Maximalist directions need elaborate
  execution; minimal directions need precision in spacing, type, and detail.
- Spend your boldness in one place; keep everything around it quiet. If the
  accent fights the ground, shift it toward analogous or drop saturation rather
  than replacing it.

## Before you publish

Read the file you did not write. If the user supplies HTML to publish, read it
in full first — publishing distributes it. A request not to look at it is a
reason to read it, not an exemption.

Never publish pages that impersonate a real person or organization, fabricated
records or receipts presented as genuine, or anything that collects credentials
or payment details.

Check: complete document with doctype and viewport meta; own reset present; no
color declared only inside the dark-mode media block; `body` background and
color set from tokens; wide content wrapped in `overflow-x: auto`; `<title>` and
CLI title consistent.
