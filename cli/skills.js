// Where the skill goes, and what version of it is sitting there.
//
// The skill file is a copy, not a link: `npm install -g personal-artifact`
// replaces the package and leaves the copy exactly as it was. An agent then
// reads last release's instructions while running this release's CLI, which
// fails silently — the commands are all there, and nothing tells the agent
// they exist. So every copy we write carries the version that wrote it, and
// both `postinstall` and `artifact-publish` compare it against this package.

import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CONFIG = join(homedir(), ".artifact-publish.json");

export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

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

export const TOOLS = [
  { name: "Claude Code", home: ".claude", binary: "claude", reads: "claude" },
  { name: "Codex", home: ".codex", binary: "codex", reads: "agents" },
  { name: "Gemini CLI", home: ".gemini", binary: "gemini", reads: "agents" },
  { name: "Cursor", home: ".cursor", binary: "cursor", reads: "agents" },
];

export function detect() {
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
const CLAUDE_CAVEAT = " Not for claude.ai Artifacts (use the Artifact tool for those).";

export const SKILL_DIRS = {
  agents: join(homedir(), ".agents", "skills", "personal-artifact"),
  claude: join(homedir(), ".claude", "skills", "personal-artifact"),
};

// The stamp goes on its own line straight after the frontmatter, so reading it
// back never costs more than the first few hundred bytes of the file.
const STAMP = /<!-- personal-artifact v([0-9][^ ]*) -->/;

function stamp(source) {
  const marker = `<!-- personal-artifact v${VERSION} -->`;
  if (STAMP.test(source)) return source.replace(STAMP, marker);
  // After the closing --- of the frontmatter; at the top if there is none.
  const end = source.indexOf("\n---\n", source.startsWith("---\n") ? 3 : 0);
  if (end === -1) return `${marker}\n\n${source}`;
  const at = end + "\n---\n".length;
  return `${source.slice(0, at)}\n${marker}\n${source.slice(at)}`;
}

export function skillFor(target) {
  const source = readFileSync(join(HERE, "skill", "SKILL.md"), "utf8");
  const described =
    target === "claude"
      ? source.replace(/^(description: .*)$/m, (_m, line) => `${line}${CLAUDE_CAVEAT}`)
      : source;
  return stamp(described);
}

export function plan(tools) {
  const wanted = [];
  if (tools.some((t) => t.installed && t.reads === "agents")) {
    wanted.push({
      target: "agents",
      dir: SKILL_DIRS.agents,
      serves: tools.filter((t) => t.installed && t.reads === "agents").map((t) => t.name),
    });
  }
  if (tools.some((t) => t.installed && t.reads === "claude")) {
    wanted.push({ target: "claude", dir: SKILL_DIRS.claude, serves: ["Claude Code"] });
  }
  return wanted;
}

export function writeSkill({ dir, target }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillFor(target));
}

/* ---------- reading back what is installed ---------- */

// The version stamped on an installed copy, or null if the file is absent or
// predates stamping. An unstamped file is stale by definition — stamping came
// in with the check that reads it.
export function installedVersion(dir) {
  try {
    return readFileSync(join(dir, "SKILL.md"), "utf8").slice(0, 2000).match(STAMP)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Every copy we have written that no longer matches this package. Only files
// that already exist count: a tool the user never set up is not out of date.
export function staleSkills() {
  return Object.entries(SKILL_DIRS)
    .filter(([, dir]) => existsSync(join(dir, "SKILL.md")))
    .map(([target, dir]) => ({ target, dir, version: installedVersion(dir) }))
    .filter((s) => s.version !== VERSION);
}
