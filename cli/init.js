#!/usr/bin/env node
import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from "fs";
import { homedir } from "os";
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

  personal-artifact                 interactive setup
  personal-artifact --yes           accept the defaults, no prompts
  personal-artifact --site <url>    the artifact site to publish to
  personal-artifact --token <tok>   your API token, from <site>/settings

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

/* ---------- run ---------- */

async function main() {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    // first run
  }

  // Nothing to prompt with when piped or run from a script.
  const interactive = stdin.isTTY && !yes;
  if (!interactive && !yes && (flag("site") === undefined || flag("token") === undefined)) {
    console.error(
      "No terminal to prompt on. Pass --site and --token, or run this in a terminal."
    );
    process.exitCode = 1;
    return;
  }

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

    const token =
      flag("token") ??
      (await ask(
        existing.token
          ? "API token (enter to keep the current one): "
          : `API token — create one at ${site}/settings: `,
        existing.token || ""
      ));

    if (!site || !token) {
      console.error("\nBoth a site and a token are required.");
      process.exitCode = 1;
      return;
    }

    // Fail here rather than at the user's first publish.
    process.stdout.write("Checking token… ");
    let who;
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
