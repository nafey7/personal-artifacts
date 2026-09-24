#!/usr/bin/env node
import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import { readFileSync, writeFileSync, rmSync, rmdirSync, existsSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { homedir, hostname, userInfo } from "os";
import { join } from "path";
import { CONFIG, SKILL_DIRS, detect, plan, writeSkill } from "./skills.js";
import { b64u, ecdh, phrase, unwrap, exportKey } from "./crypto.js";

const DEFAULT_SITE = "https://artifacts.pallason.com";

const argv = process.argv.slice(2);
const flag = (name) => {
  const exact = argv.indexOf(`--${name}`);
  if (exact !== -1) return argv[exact + 1] ?? "";
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
};
const yes = argv.includes("--yes") || argv.includes("-y");

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`personal-artifact — set up artifact publishing for your coding agents.

  personal-artifact                 sign in through your browser
  personal-artifact --site <url>    the artifact site to publish to
  personal-artifact --token <tok>   skip the browser; use a token directly
  personal-artifact --no-browser    print the URL instead of opening it
  personal-artifact --yes           don't ask before writing (or removing) files
  personal-artifact --recovery-phrase "<12 words>"
                                    with --token: unlock your encryption key
                                    from the recovery phrase (or set
                                    ARTIFACT_RECOVERY_PHRASE)

  personal-artifact uninstall       remove every file this program wrote,
                                    then uninstall the npm package itself
    --keep-package                  remove the files but leave the package

Signing in opens your browser, where you approve this machine. The token is
sent straight to this program — you never copy or paste it. Your encryption
key comes with it, sealed in the browser to a key pair this program makes for
the occasion; the site relays a blob it cannot open. Both ends print the same
fingerprint so you can see they match. On a headless box use --token with a
token from <site>/settings, and --recovery-phrase to unlock the key.

Writes ~/.artifact-publish.json, and installs the publishing skill for the
coding tools you already have. Tools you have not installed are left alone.
Safe to run again whenever you install another tool or rotate your token.

The uninstall command undoes all of that in one go. It cannot revoke your token —
that lives on the site, so revoke it at <site>/settings.`);
  process.exit(0);
}

/* ---------- signing in through the browser ---------- */

// Best effort: if the browser can't be opened we just print the URL, which is
// the whole fallback anyone needs.
function openBrowser(url) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function deviceName() {
  const host = hostname().replace(/\.local$/, "");
  try {
    return `${userInfo().username}@${host}`;
  } catch {
    return host;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The device flow: ask the site for a pair of codes, send the person to the
// browser with the short one, and poll with the long one until they approve.
// A sign-in request is only good for ten minutes, and someone signing up for
// the first time has to go and read their email inside that window. So an
// expired request is not fatal here: we start a fresh one and reopen the
// browser, up to ATTEMPTS times.
const ATTEMPTS = 3; // three ten-minute windows

// The site runs on a free host that sleeps when nobody is using it, and its
// database can be just as slow to wake. The first request is what wakes them,
// so it is the one most likely to fail — and it is the only one that has to
// succeed before we send the person to the browser. Give it a few tries with a
// short pause between, so a slow wake-up never shows up as an error.
const START_TRIES = 3;
const START_PAUSE_MS = 3000;

async function startSignIn(site, cliPublicKey) {
  let lastError;
  for (let i = 0; i < START_TRIES; i++) {
    if (i > 0) await wait(START_PAUSE_MS);
    let res;
    try {
      res = await fetch(`${site}/api/cli/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: deviceName(), cliPublicKey }),
      });
      if (res.ok) return await res.json();
    } catch (err) {
      lastError = err; // no connection, or a reply cut off half way
      continue;
    }
    const detail = await res.text().catch(() => "");
    lastError = new Error(`could not start sign-in (${res.status}): ${detail}`);
    // The site answered and said no (rate limit, bad request). Asking again
    // will get the same answer, so stop here and show it.
    if (res.status < 500) throw lastError;
  }
  throw new Error(`${lastError?.message || "could not reach the site"} — is ${site} up?`);
}

async function requestApproval(site, { noBrowser, again }) {
  // A fresh key pair per request. The private half never leaves this
  // process; the browser seals the account key to the public half.
  const pair = await ecdh.generate();
  const { userCode, deviceCode, verifyUrl, expiresIn, pollInterval } = await startSignIn(site, pair.publicKey);

  const opened = noBrowser ? false : openBrowser(verifyUrl);
  if (again) {
    console.log("\n\nThat request expired, so here is a fresh one — use this tab, not the old one.");
  }
  console.log(opened ? "\nOpening your browser to sign in…" : "\nTo sign in, open this in your browser:");
  console.log(`  ${verifyUrl}`);
  console.log(`\n  code: ${userCode}   machine: ${deviceName()}   key fingerprint: ${pair.fingerprint}`);
  process.stdout.write("\nWaiting for you to approve… ");

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await wait(pollInterval * 1000);

    // The browser tab is open by now, so nothing short of an answer from the
    // site may end this loop: a bad status, a dropped connection, or a
    // half-received reply are all treated as "ask again".
    let data;
    try {
      const res = await fetch(`${site}/api/cli/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      });
      if (!res.ok) continue;
      data = await res.json();
    } catch {
      continue;
    }

    if (data.status === "approved") {
      console.log("done.");
      let accountKey = null;
      if (data.accountKeySealed) {
        try {
          accountKey = b64u.encode(await ecdh.open(data.accountKeySealed, pair.privateKey, pair.publicKey));
        } catch {
          console.log("The encryption key the browser sent could not be opened — it was sealed to a different request.");
          console.log("Run this again to get it; the token still works for plain artifacts.");
        }
      }
      return { token: data.token, user: data.user, accountKey };
    }
    if (data.status === "denied") throw new Error("refused in the browser — nothing was written");
    if (data.status === "expired") break;
  }
  return null; // the window closed; the caller decides whether to open another
}

async function signInWithBrowser(site, { noBrowser }) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const result = await requestApproval(site, { noBrowser, again: attempt > 0 });
    if (result) return result;
  }
  throw new Error("gave up waiting for approval — run the command again when you have a moment");
}

/* ---------- the key, with no browser to hand it over ---------- */

// --token gets a machine in without a browser, so nothing can seal the key
// to it. The recovery phrase opens the same key from the wrapped copy the
// site keeps — the phrase is used here and never sent. Returns the key as
// base64url, or null with a note when there is no way to get it.
async function unlockHeadless(site, token, { ask, existing }) {
  let keys;
  try {
    const res = await fetch(`${site}/api/auth/keys`, { headers: { Authorization: `Bearer ${token}` } });
    keys = res.ok ? await res.json() : null;
  } catch {
    keys = null;
  }
  if (!keys || keys.authVersion !== 2 || !keys.accountKeyByRecovery) {
    console.log("This account has no encryption keys yet — sign in on the site once to make them.");
    return null;
  }
  if (existing.accountKey && !flag("recovery-phrase") && !process.env.ARTIFACT_RECOVERY_PHRASE) {
    return existing.accountKey; // already unlocked on a previous run
  }

  let words = flag("recovery-phrase") || process.env.ARTIFACT_RECOVERY_PHRASE || "";
  if (!words) {
    words = await ask(
      "\nRecovery phrase, to unlock your encryption key on this machine\n(twelve words; leave blank to skip and publish plain artifacts only): ",
      ""
    );
  }
  if (!words.trim()) return null;

  try {
    const key = await unwrap(keys.accountKeyByRecovery, await phrase.toKey(words));
    return b64u.encode(await exportKey(key));
  } catch (err) {
    console.error(`Could not unlock the key: ${err.message || "that phrase does not open this account"}`);
    return null;
  }
}

/* ---------- undoing all of it ---------- */

// Everything install can create, listed in one place so uninstall can never
// drift from it: the config, plus the skill in both destinations. We remove
// both destinations regardless of which tools are installed now — a tool the
// person has since deleted still left its skill behind.
function installedPaths() {
  return [CONFIG, SKILL_DIRS.claude, SKILL_DIRS.agents];
}

// Install creates ~/.agents/skills on demand, so uninstall takes it back out —
// but only while it is empty, since another tool's skills may live there too.
// rmdir refuses a non-empty directory, which is exactly the check we want.
function pruneEmpty(dirs) {
  for (const dir of dirs) {
    try {
      rmdirSync(dir);
    } catch {
      // not empty, or never there
    }
  }
}

async function uninstall({ ask, site }) {
  const present = installedPaths().filter((p) => existsSync(p));

  console.log("\npersonal-artifact — uninstall.\n");
  if (present.length === 0) {
    console.log("Nothing to remove — none of these are here:");
    for (const p of installedPaths()) console.log(`  ${p}`);
  } else {
    console.log("Will remove:");
    for (const p of present) console.log(`  ${p}`);
  }

  const keepPackage = argv.includes("--keep-package");
  // Removing the package we are running from is safe: Node has already read
  // this file into memory. Windows can hold a lock on the command shim, so
  // there we print the command instead of running it.
  const canSelfRemove = !keepPackage && process.platform !== "win32";
  if (canSelfRemove) console.log("  the personal-artifact npm package (npm uninstall -g)");

  if (present.length === 0 && !canSelfRemove) return;

  const go = yes ? "y" : await ask("\nProceed? [y/N]: ", "n");
  if (!/^y(es)?$/i.test(go.trim())) {
    console.log("Nothing removed.");
    return;
  }

  for (const p of present) rmSync(p, { recursive: true, force: true });
  pruneEmpty([join(homedir(), ".agents", "skills"), join(homedir(), ".agents")]);
  if (present.length) console.log(`\nRemoved ${present.length} item${present.length > 1 ? "s" : ""}.`);

  if (canSelfRemove) {
    console.log("Uninstalling the npm package…");
    const res = spawnSync("npm", ["uninstall", "-g", "personal-artifact"], { stdio: "inherit" });
    if (res.error || res.status !== 0) {
      console.log("\nThe files are gone, but npm did not finish. Run this yourself:");
      console.log("  npm uninstall -g personal-artifact");
    }
  } else if (!keepPackage) {
    console.log("\nOne step left — run:");
    console.log("  npm uninstall -g personal-artifact");
  }

  console.log(`\nYour artifacts are still on ${site}, and so is your token.`);
  console.log(`Revoke it at ${site}/settings if you are done for good.\n`);
}

/* ---------- run ---------- */

async function main() {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    // first run
  }

  // Signing in through the browser needs no terminal of its own, so the only
  // thing a pipe can't answer is the confirmation prompt.
  const interactive = stdin.isTTY && !yes;

  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;
  const ask = async (question, fallback) => {
    if (!rl) return fallback || "";
    const answer = (await rl.question(question)).trim();
    return answer || fallback || "";
  };

  try {
    if (argv[0] === "uninstall") {
      await uninstall({ ask, site: (existing.site || DEFAULT_SITE).replace(/\/$/, "") });
      return;
    }

    console.log("\npersonal-artifact — publish artifacts from your coding agent.\n");

    // Nobody has an opinion about this on a first run, so we don't ask: the
    // flag wins, then whatever the last run saved, then the hosted site. We
    // still print it, because silently publishing somewhere is worse than one
    // keypress — and the line is where self-hosters learn the flag exists.
    const chosen = flag("site") || existing.site || DEFAULT_SITE;
    const site = chosen.replace(/\/$/, "");

    if (!site) {
      console.error("A site is required — pass --site <url>.");
      process.exitCode = 1;
      return;
    }

    console.log(`Site: ${site}`);
    if (!existing.site && flag("site") === undefined) {
      console.log("      (self-hosting? re-run with --site <url>)");
    }

    let token = flag("token");
    let who;
    let accountKey = null;

    if (token) {
      // Headless path: verify the pasted token rather than trusting it.
      process.stdout.write("Checking token… ");
      try {
        const res = await fetch(`${site}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          console.error(
            res.status === 401
              ? `rejected.\n\nThat token is not valid for ${site}. Create a new one at ${site}/settings.`
              : `failed (${res.status}).`
          );
          process.exitCode = 1;
          return;
        }
        who = (await res.json()).user;
      } catch {
        console.error(`could not reach ${site}.`);
        process.exitCode = 1;
        return;
      }
      console.log(`ok — ${who.name ? `${who.name} <${who.email}>` : who.email}`);
      accountKey = await unlockHeadless(site, token, { ask, existing });
    } else {
      try {
        ({ token, user: who, accountKey } = await signInWithBrowser(site, {
          noBrowser: argv.includes("--no-browser"),
        }));
      } catch (err) {
        console.error(`\n${err.message}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Signed in as ${who.name ? `${who.name} <${who.email}>` : who.email}`);
    }

    // A machine that was set up before had a key; keep it unless a new one
    // arrived, so re-running to add a tool never loses it.
    if (!accountKey && existing.accountKey) accountKey = existing.accountKey;
    if (accountKey) {
      console.log("Encryption key: saved — this machine can publish with --encrypted.");
    } else {
      console.log("Encryption key: none — this machine publishes plain artifacts only.");
      console.log("  (approve with your password next time, or use --token with --recovery-phrase)");
    }

    const tools = detect();
    const found = tools.filter((t) => t.installed);
    const missing = tools.filter((t) => !t.installed);
    const targets = plan(tools);

    console.log("\nCoding tools found:");
    if (found.length === 0) console.log("  none");
    for (const t of found) console.log(`  ${t.name}`);
    if (missing.length) {
      console.log(`\nNot installed, so nothing will be written for them:`);
      console.log(`  ${missing.map((t) => t.name).join(", ")}`);
    }

    console.log("\nWill write:");
    console.log(`  ${CONFIG}`);
    for (const t of targets) {
      console.log(`  ${join(t.dir, "SKILL.md")}  (${t.serves.join(", ")})`);
    }
    if (targets.length === 0) {
      console.log("  — no skill, since none of the supported tools are installed");
      console.log("    Install one and run `personal-artifact init` again.");
    }

    const go = yes ? "y" : await ask("\nProceed? [Y/n]: ", "y");
    if (!/^y(es)?$/i.test(go.trim() || "y")) {
      console.log("Nothing written.");
      return;
    }

    const config = { site, token };
    if (accountKey) config.accountKey = accountKey;
    writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    for (const t of targets) writeSkill(t);

    console.log("\nDone.");
    if (targets.length) {
      console.log("Ask your agent to “publish this as an artifact” and it will use the skill.");
      console.log("Already-running sessions may need a restart to see a new skill directory.");
    }
    console.log(`Your artifacts: ${site}\n`);
  } finally {
    rl?.close();
  }
}

await main();
