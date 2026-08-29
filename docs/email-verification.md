# personal-artifact — email verification & password reset

Status: **built.** This was the last item in the build order from
[accounts.md](accounts.md) — the one that was waiting on a mail provider.
Phases 1–7 below are implemented; phase 8 is the manual pass, and the parts of
it that need a real inbox are still to be run.

## The problem

Anyone can type any email address into the signup form and get a working
account. Nothing checks that the address is real or that the person typing it
owns it. Today that is survivable only because signup is closed: `SIGNUP_CODE`
gates the whole deployment, so the only people creating accounts are people who
were handed a code.

That gate is also what stops the product from being usable. The pitch is that a
developer installs a package, runs one command, and is publishing a minute
later. Handing out invite codes by hand is not that. And a person who mistypes
their own address during signup gets an account they can never recover, because
there is no password reset either — both gaps have the same cause and the same
fix.

## What we're building

**Signup sends a six-character code to the email address, and the account is
only created once that code comes back.** Password reset works the same way,
with the same code, the same email sender, and the same screens.

The shape: someone fills in the signup form as they do today, the server holds
what they typed in a short-lived pending record instead of creating an account,
emails a code, and creates the account when the code is confirmed. Sign-in,
sessions, ownership, and publishing are untouched. Once this ships, the invite
gate comes out and signup is open to anyone with a real address.

## How it behaves

- **A code, not a link.** The person stays on the page they are already on and
  types six characters. A link would move them into a fresh browser tab, which
  breaks the command-line sign-in flow — that tab is holding a pending machine
  approval that a new tab knows nothing about. Codes also survive corporate mail
  scanners, which routinely follow links and burn single-use tokens before a
  human ever clicks.

- **One form, then the code.** Name, email and password are collected in a
  single step exactly as today; the code screen comes after. This keeps the
  existing form intact and adds one screen rather than restructuring signup into
  three.

- **Nothing is created until the code is confirmed.** An unverified person has
  no account, no session, and no row in the users collection. There is therefore
  no such thing as a signed-in-but-unverified state, and no gate to enforce
  anywhere else in the app.

- **Ten minutes, five guesses.** The code expires on the same clock as the
  command-line sign-in code, so the two windows can never disagree. Five wrong
  guesses kills the pending signup and the person starts over.

- **Saying an email is already taken is deliberate.** Signup keeps today's
  plain "an account with that email already exists". This is a knowing trade:
  it makes the form a way to test whether somebody has an account here, which
  is why sign-in refuses to do the same thing. Clarity for the honest user was
  judged worth more, and the existing per-address rate limit blunts bulk
  probing.

- **Emails come from one sender for every product.** `Pallason
  <noreply@pallason.com>`. The domain is verified once and covers every future
  product on a subdomain, so no product ever needs its own mail setup.

- **The command line recovers on its own.** If the sign-in window lapses while
  someone is reading their email, the tool mints a fresh one and carries on
  rather than dying with "run the command again".

- **The invite gate goes away.** Verification replaces it. `SIGNUP_CODE` stops
  being read and the invite field disappears from the form.

- **The shared upload secret goes away too.** `UPLOAD_TOKEN` is a credential
  with no owner. It was tolerable while every account was hand-issued; the day
  signup opens is the day it stops being tolerable.

## What changes, in seven places

1. **A way to send mail.** One small routine that posts a message to the mail
   provider. Nothing else in the app knows how mail is sent, so swapping
   providers later touches one file. If the provider key is missing, sending
   fails loudly in development and is reported as a plain error to the user
   rather than silently succeeding.

2. **A place to park half-finished signups.** A new short-lived record holding
   the name, email, hashed password and hashed code. It expires on its own after
   ten minutes and is deleted the moment the account is created.

3. **The signup endpoint stops creating accounts.** It now validates, stores the
   pending record, sends the code, and reports that mail is on the way. A second
   endpoint takes the code, checks it, and does the account creation and sign-in
   that signup used to do.

4. **One new screen.** After the signup form submits, the same page swaps to a
   code entry box with a resend option. It is the existing form component in a
   second state, not a new route, so the typed details are still in memory if
   the code has to be re-sent.

5. **Password reset, start to finish.** Two endpoints and one screen, reusing
   the code generator, the mail routine and the rate limiter that verification
   introduces. Requesting a reset always reports success whether or not the
   address exists — reset has no reason to leak membership even though signup
   now does.

6. **The command-line tool learns to restart.** Instead of throwing when the
   approval window closes, it starts a fresh request and reopens the browser, up
   to a small number of times, so a slow trip to an inbox is survivable.

7. **The gates come out.** The invite code and the shared upload secret are
   removed, and the canonical address of the service moves to the real domain
   now that it exists.

## Details worth getting right

**Two browser tabs during command-line signup.** When the tool restarts an
expired request it opens a *new* tab. The old tab, which the person was
signing up in, will land on the "that code has expired" screen when they
finish. That screen currently tells them to run the command again — which is
now wrong, because the tool already did. Its wording has to change to point at
the newer tab instead.

**Re-submitting the signup form.** Someone who does not receive the mail will
retype the form. The pending record is keyed by email, so the second attempt
must replace the first rather than collide with it, and it must issue a new
code rather than resurrecting the old one.

**The password is hashed before it is parked.** A pending signup holds a real
password. It is hashed with the same routine the users collection uses, so a
dump of half-finished signups is worth no more than a dump of accounts.

**Codes are stored hashed and compared in constant time.** Same reasoning as
sessions and machine approvals: the database should never hold anything that can
be replayed. This also means a code cannot be read back out to be shown again —
resending means issuing a new one.

**Resending has to be limited separately.** Sending mail is the expensive
action, and it is triggered by an unauthenticated stranger. The limit belongs on
the address and the network address, not on the signup attempt, or one person
can spend the whole day's mail allowance.

**Expired records must actually disappear.** The pending collections need the
same automatic-expiry index the sessions and machine approvals already have,
declared in the same place, or dead signups accumulate forever in a database
with a 512MB ceiling.

**Existing accounts are verified by definition.** Everyone in the users
collection predates this and was hand-invited. No backfill, no flag, no
migration — the absence of a concept of "unverified account" is what makes this
free.

**Mail failure must not create an account.** If the provider is down, the
person should be told plainly and no pending record should be left behind that
they cannot complete.

## Known limitations

- **The signup form reveals who has an account.** Accepted deliberately, as
  above. The way out, if it ever matters, is to return the same "check your
  email" screen either way and send a "you already have an account" mail
  instead. Not part of this work.

- **New sending domains land in spam at first.** Reputation builds over the
  first week of real sending. A DMARC record would help and is not yet present.
  Adding one is a single DNS record and is not part of this work.

- **No way to change the email on an account.** Verification proves the address
  at signup and never again. Changing it later would need the same machinery
  pointed at an existing account. Not part of this work.

- **The daily sending allowance is finite.** The free tier permits 100 messages
  a day across verification and reset. Judged a non-issue at current volume and
  explicitly set aside.

---

# Technical implementation, phase by phase

Everything below has been checked against the code as it stands.

## Phase 1 — sending mail

**Where it lives.** A new `lib/email.js`. Nothing else imports the provider.

**No new dependency.** Resend publishes an SDK; we do not use it. A single
`fetch` to `https://api.resend.com/emails` with a bearer header keeps the app's
dependency-free property, which the rest of `lib/` deliberately maintains —
`lib/auth.js` hashes with `node:crypto` for the same reason.

**What it exports.** One function that takes `{ to, subject, html }` and sends.
Two callers wrap it: one for a verification code, one for a reset code. Keep the
message bodies in this file so copy changes never touch route code.

**Configuration.** Two new environment variables, both needed in `.env.local`
and in Vercel:

```
RESEND_API_KEY=...          # sending-only key, not the full-access one
MAIL_FROM=Pallason <noreply@pallason.com>
```

The key currently in `~/.resend-token` is full-access because domain setup
needed it. **Issue a separate sending-only key for the deployment** — the app
must not hold a credential that can reconfigure the sending domain.

**On failure.** Return an error rather than throwing past the route, so callers
can decide. A failed send must leave no pending record behind.

## Phase 2 — codes and storage

**Reuse the existing alphabet.** `lib/device.js` already exports the reasoning
and the character set — `ALPHABET`, with no `O`/`0` and no `I`/`1`/`L` — plus
`hashCode`, a SHA-256 helper. Both are exactly what verification codes need.
Add a six-character generator beside the existing `makeUserCode`, which produces
eight with a dash and is shaped for a different job.

**Do not reuse `CODE_TTL_SECONDS` by importing it into the mail path.** Declare
the verification window as its own constant that happens to equal ten minutes.
They are the same today for a reason explained in the plan above, but they are
not the same thing, and a future change to one must not silently move the other.

**Two new collections.** Registered in `lib/mongo.js` alongside the existing
accessors, with their indexes added to the single `ensureIndexes` block so there
is still no migration step:

```
pendingSignups  { _id: email, name, passwordHash, codeHash,
                  attempts, createdAt, expiresAt }
passwordResets  { _id: <random id>, userId, codeHash,
                  attempts, createdAt, expiresAt }
```

Keying pending signups by email is what makes a re-submission replace rather
than collide — an upsert on `_id` is the whole mechanism.

**Indexes to add.** An expiry index on `expiresAt` for each, mirroring the two
that already exist for `sessions` and `pendingAuth`.

## Phase 3 — signup becomes two steps

**Change `app/api/auth/signup/route.js`.** Keep every existing check in place
and in order: the invite gate (until phase 6 removes it), the per-network rate
limit, `looksLikeEmail`, the ten-character minimum, and the duplicate-email
check that returns 409. Then, instead of inserting into `users` and calling
`createSession`, upsert a pending signup and send the code.

**Add `app/api/auth/verify/route.js`.** Takes `{ email, code }`. Loads the
pending record, rejects an expired one, compares the hashed code, increments
`attempts` on a miss and deletes the record at five. On success it does exactly
what signup used to do — insert into `users`, then `createSession(insertedId)` —
and deletes the pending record.

**Keep the duplicate check in both places.** Two people can hold pending
signups for the same address only if the unique index is the real guard. It is:
the insert in the verify route must keep the existing `err?.code === 11000`
handling that signup has today.

**Add `app/api/auth/resend/route.js`.** Issues a new code for an existing
pending signup. Rate limited on the address, not just the network.

**Rate limit keys.** Reuse `tooManyAttempts` from `lib/ratelimit.js`. New keys
alongside the existing `signup:ip:` one:

```
verify:send:<email>     3 per 15 min     # covers signup send + resend
verify:try:<email>      5 per 10 min     # wrong-code guesses
reset:send:<email>      3 per 15 min
```

## Phase 4 — the code screen

**Extend `app/(auth)/AuthForm.jsx`.** It already holds `name`, `email`,
`password` and `code` in one `fields` object and switches behaviour on a `mode`
prop. Add a `stage` state: on a successful signup response, swap the form body
for a code input and a resend link, keeping `fields` intact so a resend needs no
retyping.

**Do not add a route for this.** `/signup` stays one page. A separate route
would lose the typed details on navigation and would need the pending email
passed through the URL.

**Where it goes on success.** The verify response sets the session cookie, so
the existing `router.replace(next || "/")` and `router.refresh()` at the end of
`submit` are already correct — the `next` value that carries a person back to a
machine approval flows through unchanged.

## Phase 5 — password reset

**Three pieces.** `app/api/auth/reset/request/route.js` takes an email and
always responds success. `app/api/auth/reset/confirm/route.js` takes
`{ email, code, password }`, validates the same way verification does, and
updates `passwordHash` with `hashPassword`. A new `app/(auth)/reset/page.jsx`
renders request and confirm as two stages of one screen, matching the signup
pattern from phase 4.

**Destroy other sessions on reset.** Deleting that user's rows from `sessions`
is the point of a reset — otherwise whoever prompted it stays signed in. This is
a direct `deleteMany({ userId })`; `destroySession` in `lib/auth.js` only clears
the caller's own cookie and is the wrong tool here.

**Link it from sign-in.** One line in `AuthForm.jsx` beneath the password field,
visible in sign-in mode only.

## Phase 6 — remove the gates, move the domain

**Invite code.** Delete the `SIGNUP_CODE` block from the signup route, the
`inviteOnly` prop threaded from `app/(auth)/signup/page.jsx`, and the invite
field in `AuthForm.jsx`. Unset the variable in Vercel.

**Shared upload secret.** Remove the `UPLOAD_TOKEN` fallback and its
`UPLOAD_USER_EMAIL` companion from `app/api/upload/route.js`, so a bearer token
must resolve to a real owner in the `tokens` collection. **This is a breaking
change** for any install still on the old shared config; those users re-run
`personal-artifact` to get a per-user token.

**Canonical address.** `DEFAULT_SITE` moves to
`https://artifacts.pallason.com`, and the URL row in
[accounts.md](accounts.md) moves with it.

Changing the constant is not enough on its own, in two ways that only showed up
once it shipped. The default lives in the *published npm package*, so nothing
reaches anyone until a release is cut — the constant in the repo is not what
people run. And a stored `site` beat the default unconditionally, so an install
that already had a config would have stayed on the old address forever; the
first draft of this plan claimed re-running `init` would move them, which was
simply wrong. A `RETIRED_SITES` list fixes it: a stored value that is only a
superseded default counts as no opinion, while a self-hoster's own `--site` is
never touched.

**The old address — decided: no redirect.** Vercel keeps serving the
`.vercel.app` URL alongside the custom domain, so every install that still holds
the old `site` keeps publishing without being touched. A redirect would buy
nothing, and refusing non-canonical hosts would break exactly those installs.
`DEFAULT_SITE` moves, and re-running `init` moves an install with it.

## Phase 7 — the command line survives a slow inbox

**Change `signInWithBrowser` in `cli/init.js`.** Today the polling loop runs to
a deadline and then throws `"timed out waiting for approval — run the command
again"`, and breaks early when the server reports `expired`. Wrap the whole
request-and-poll body in an outer loop that restarts up to twice — three
windows, thirty minutes total — printing a short line and reopening the browser
each time. Throw only when the restarts are exhausted.

**Fix the expired screen.** `app/cli/auth/page.jsx` renders "That code has
expired… run `personal-artifact` again". With automatic restart that advice is
wrong. Reword it to say a fresh request has probably already opened in another
tab.

**No server change.** `app/api/cli/start/route.js` already mints a new pair on
every call, and `app/api/cli/poll/route.js` already reports `expired`. The tool
simply stops treating that answer as fatal.

## Phase 8 — verification

Local, in this order:

1. **Nothing sent, nothing created.** Sign up, then stop. Confirm no `users`
   row exists and the pending record disappears on its own after ten minutes.
2. **The happy path.** Sign up, read the code from the real inbox, confirm the
   account exists, the session cookie is set, and the dashboard loads.
3. **The wrong path.** Five bad codes kills the pending signup. An expired code
   is refused. A resend issues a different code and the old one stops working.
4. **Reset.** Request a reset, confirm the new password signs in, and confirm a
   session opened before the reset no longer works.
5. **The command line, slowly.** Run `personal-artifact` as a brand-new user and
   deliberately wait past ten minutes before finishing signup. Confirm it
   restarts, the browser reopens, and approval still yields a token.

Then on the real deployment: the same happy path end to end, plus **where the
mail lands** — inbox or spam — which is the only check that cannot be made
locally and the only one that decides whether the feature actually works for
strangers.

## Not in scope

- Changing the email address on an existing account
- Sign-out-everywhere and a visible session list, still open from accounts.md
- Two-factor authentication, or codes on sign-in
- Magic-link sign-in
- A DMARC record, though it is one DNS row and worth doing separately
