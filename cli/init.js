#!/usr/bin/env node
import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from "fs";
import { spawn } from "child_process";
import { homedir, hostname, userInfo } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(homedir(), ".artifact-publish.json");
const DEFAULT_SITE = "https://personal-artifacts-three.vercel.app";

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
  personal-artifact --yes           don't ask before writing files

Signing in opens your browser, where you approve this machine. The token is
sent straight to this program — you never copy or paste it. On a headless box
use --token with a token from <site>/settings.

Writes ~/.artifact-publish.json, and installs the publishing skill for the
coding tools you already have. Tools you have not installed are left alone.
Safe to run again whenever you install another tool or rotate your token.`);
  process.exit(0);
}

/* ---------- which coding tools are actually here ---------- */

// A tool counts as installed if it keeps a home directory or is on PATH. We
// never create a vendor directory on spec: an empty ~/.claude on a machine
// without Claude Code does nothing except get in the way of that tool's own
// first run, and litters a home directory with tools its owner declined.
function onPath(binary) {
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

const TOOLS = [
  { name: "Claude Code", home: ".claude", binary: "claude", reads: "claude" },
  { name: "Codex", home: ".codex", binary: "codex", reads: "agents" },
  { name: "Gemini CLI", home: ".gemini", binary: "gemini", reads: "agents" },
  { name: "Cursor", home: ".cursor", binary: "cursor", reads: "agents" },
];

function detect() {
  return TOOLS.map((tool) => ({
    ...tool,
    installed: existsSync(join(homedir(), tool.home)) || onPath(tool.binary),
  }));
}

/* ---------- writing the skill ---------- */

// Two destinations cover all four tools. ~/.agents/skills is the vendor-neutral
// convention that Codex, Gemini CLI and Cursor all read; Claude Code has its
// own. The guidance is one file — only the description differs, because the
// claude.ai caveat is noise everywhere else.
const CLAUDE_CAVEAT =
  " Not for claude.ai Artifacts (use the Artifact tool for those).";

function skillFor(target) {
  const source = readFileSync(join(HERE, "skill", "SKILL.md"), "utf8");
  if (target !== "claude") return source;
  return source.replace(
    /^(description: .*)$/m,
    (_match, line) => `${line}${CLAUDE_CAVEAT}`
  );
}

function plan(tools) {
  const wanted = [];
  if (tools.some((t) => t.installed && t.reads === "agents")) {
    wanted.push({
      target: "agents",
      dir: join(homedir(), ".agents", "skills", "personal-artifact"),
      serves: tools.filter((t) => t.installed && t.reads === "agents").map((t) => t.name),
    });
  }
  if (tools.some((t) => t.installed && t.reads === "claude")) {
    wanted.push({
      target: "claude",
      dir: join(homedir(), ".claude", "skills", "personal-artifact"),
      serves: ["Claude Code"],
    });
  }
  return wanted;
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
async function signInWithBrowser(site, { noBrowser }) {
  const started = await fetch(`${site}/api/cli/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: deviceName() }),
  });
  if (!started.ok) {
    const detail = await started.text();
    throw new Error(`could not start sign-in (${started.status}): ${detail}`);
  }
  const { userCode, deviceCode, verifyUrl, expiresIn, pollInterval } = await started.json();

  const opened = noBrowser ? false : openBrowser(verifyUrl);
  console.log(opened ? "\nOpening your browser to sign in…" : "\nTo sign in, open this in your browser:");
  console.log(`  ${verifyUrl}`);
  console.log(`\n  code: ${userCode}   machine: ${deviceName()}`);
  process.stdout.write("\nWaiting for you to approve… ");

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await wait(pollInterval * 1000);

    const res = await fetch(`${site}/api/cli/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    if (!res.ok) continue; // a blip shouldn't end the sign-in

    const data = await res.json();
    if (data.status === "approved") {
      console.log("done.");
      return { token: data.token, user: data.user };
    }
    if (data.status === "denied") throw new Error("refused in the browser — nothing was written");
    if (data.status === "expired") break;
  }
  throw new Error("timed out waiting for approval — run the command again");
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
    console.log("\npersonal-artifact — publish artifacts from your coding agent.\n");

    const site = (
      flag("site") ??
      (await ask(`Site [${existing.site || DEFAULT_SITE}]: `, existing.site || DEFAULT_SITE))
    ).replace(/\/$/, "");

    if (!site) {
      console.error("\nA site is required.");
      process.exitCode = 1;
      return;
    }

    let token = flag("token");
    let who;

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
    } else {
      try {
        ({ token, user: who } = await signInWithBrowser(site, {
          noBrowser: argv.includes("--no-browser"),
        }));
      } catch (err) {
        console.error(`\n${err.message}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Signed in as ${who.name ? `${who.name} <${who.email}>` : who.email}`);
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

    writeFileSync(CONFIG, `${JSON.stringify({ site, token }, null, 2)}\n`, { mode: 0o600 });
    for (const t of targets) {
      mkdirSync(t.dir, { recursive: true });
      writeFileSync(join(t.dir, "SKILL.md"), skillFor(t.target));
    }

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
