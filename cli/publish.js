#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { VERSION, staleSkills } from "./skills.js";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`artifact-publish — publish an HTML page to your artifact site.

  artifact-publish ./page.html "Title"
    --project <name>       file it under a project that already exists
    --new-project <name>   file it under this project, creating it if needed
    --public               anyone with the link can open it
    --private              only you can open it (the default)
    --expires <when>       share it, and close the link after 30m, 24h, 7d, 2w,
                           or at an ISO date; "never" clears an expiry on --update
    --passphrase <text>    share it, and ask for this passphrase before opening
                           (or set ARTIFACT_PASSPHRASE to keep it out of shell history)
    --update <slug>        replace an artifact you already published, keeping its URL

Prints the URL on stdout and a line about who can open it on stderr, so
piping still gets you just the URL.

--expires and --passphrase both imply --public: they describe how a shared
link behaves. The owner is never asked for the passphrase and never locked
out by the expiry.

Read back what you have published:

  artifact-publish list [--project <name>] [--search <text>] [--limit <n>] [--json]
  artifact-publish get <slug> [--out <file>] [--json]
  artifact-publish projects [--json]

Change or remove what you have published:

  artifact-publish rename <slug> "New title"
  artifact-publish delete <slug> [--permanent]
  artifact-publish trash [--json]
  artifact-publish restore <slug>

\`delete\` moves the artifact to the trash: its link stops opening straight
away, and \`restore\` brings it back for a few days afterwards. \`--permanent\`
removes something already in the trash, for good. To change an artifact's
HTML, publish over it with --update <slug> instead.

\`list\` prints one artifact per line: slug, updated date, who can open it,
project, title. \`get\` prints the artifact's HTML (or writes it to --out) so
you can edit it and publish it back with --update. \`projects\` lists your
project folders. --json prints the API response instead.

New artifacts are private. A private URL returns 404 unless the request
carries your browser session or your API token as an Authorization: Bearer
header — that is the artifact being private, not a failed publish.`);
  process.exit(0);
}

/* ---------- flags ---------- */

// Pull the flags out before the positional args.
let project = "";
let createProject = false;
let visibility = "";
let updateSlug = "";
let expires = "";
let passphrase = process.env.ARTIFACT_PASSPHRASE || "";
let search = "";
let limit = "";
let outFile = "";
let permanent = false;
let json = false;
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--project" || arg === "-p") {
    project = argv[++i] || "";
  } else if (arg.startsWith("--project=")) {
    project = arg.slice("--project=".length);
  } else if (arg === "--new-project") {
    project = argv[++i] || "";
    createProject = true;
  } else if (arg.startsWith("--new-project=")) {
    project = arg.slice("--new-project=".length);
    createProject = true;
  } else if (arg === "--public") {
    visibility = "public";
  } else if (arg === "--private") {
    visibility = "private";
  } else if (arg === "--expires" || arg === "-e") {
    expires = argv[++i] || "";
  } else if (arg.startsWith("--expires=")) {
    expires = arg.slice("--expires=".length);
  } else if (arg === "--passphrase") {
    passphrase = argv[++i] || "";
  } else if (arg.startsWith("--passphrase=")) {
    passphrase = arg.slice("--passphrase=".length);
  } else if (arg === "--update" || arg === "-u") {
    updateSlug = argv[++i] || "";
  } else if (arg.startsWith("--update=")) {
    updateSlug = arg.slice("--update=".length);
  } else if (arg === "--search" || arg === "-s" || arg === "--q") {
    search = argv[++i] || "";
  } else if (arg.startsWith("--search=")) {
    search = arg.slice("--search=".length);
  } else if (arg === "--limit" || arg === "-n") {
    limit = argv[++i] || "";
  } else if (arg.startsWith("--limit=")) {
    limit = arg.slice("--limit=".length);
  } else if (arg === "--out" || arg === "-o") {
    outFile = argv[++i] || "";
  } else if (arg.startsWith("--out=")) {
    outFile = arg.slice("--out=".length);
  } else if (arg === "--permanent") {
    permanent = true;
  } else if (arg === "--json") {
    json = true;
  } else {
    positional.push(arg);
  }
}

if (createProject && !project) {
  console.error("--new-project needs a name");
  process.exit(1);
}

/* ---------- is the agent reading an old copy of the skill? ---------- */

// The skill is a copy, so an upgrade can leave an agent following last
// release's instructions. postinstall refreshes it, but --ignore-scripts and
// some CI images skip that, and the failure is otherwise silent.
try {
  const stale = staleSkills();
  if (stale.length) {
    const seen = stale[0].version;
    console.error(
      `note: the installed skill is ${seen ? `v${seen}` : "from an older release"}, but this CLI is v${VERSION} —\n` +
        "      run `personal-artifact` to refresh it, or your agent will not know about newer commands."
    );
  }
} catch {
  // Never let this stop a publish.
}

/* ---------- config and the API ---------- */

const configPath = join(homedir(), ".artifact-publish.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  console.error(`missing or invalid config: ${configPath}`);
  console.error("run `personal-artifact` to set it up");
  process.exit(1);
}

const site = String(config.site || "").replace(/\/$/, "");

// One call to the site. Exits with the server's message on any failure, so
// each command below only has to deal with the happy path.
async function api(path, { method = "GET", body, verb = "request" } = {}) {
  const headers = { Authorization: `Bearer ${config.token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${site}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).error || text;
    } catch {
      // not JSON — show what came back
    }
    console.error(`${verb} failed (${res.status}): ${detail}`);
    if (res.status === 401) {
      console.error("the token is not valid for this site — run `personal-artifact` again");
    }
    process.exit(1);
  }
  return JSON.parse(text);
}

function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value !== undefined && value !== null) q.set(key, value);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function day(iso) {
  return String(iso).slice(0, 10);
}

// Who can open an artifact, in one word for the list.
function who(a) {
  if (!a.isPublic) return "private";
  if (a.isExpired) return "expired";
  return a.hasPassphrase ? "passphrase" : "public";
}

/* ---------- subcommands ---------- */

const [command] = positional;

if (command === "projects") {
  const data = await api(`/api/projects`, { verb: "listing projects" });
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!data.projects.length) {
    console.error("no projects yet — publish with --new-project <name> to create one");
  } else {
    for (const p of data.projects) {
      const n = p.count ?? 0;
      console.log(`${p.name}  (${n} artifact${n === 1 ? "" : "s"})`);
    }
    if (data.unfiled) {
      console.error(`${data.unfiled} artifact${data.unfiled === 1 ? "" : "s"} in no project`);
    }
  }
  process.exit(0);
}

if (command === "list") {
  const data = await api(`/api/artifacts${query({ project, q: search, limit })}`, {
    verb: "listing artifacts",
  });
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!data.artifacts.length) {
    console.error("no artifacts match");
  } else {
    // Slug first because that is what --update and get take. Fixed-width
    // columns so the eye can run down them; the title last since it is the
    // only field with no natural width.
    const slugWidth = Math.max(...data.artifacts.map((a) => a.slug.length));
    const projWidth = Math.max(1, ...data.artifacts.map((a) => (a.project?.name || "-").length));
    for (const a of data.artifacts) {
      console.log(
        [
          a.slug.padEnd(slugWidth),
          day(a.updatedAt),
          who(a).padEnd(10),
          (a.project?.name || "-").padEnd(projWidth),
          a.title,
        ].join("  ")
      );
    }
  }
  process.exit(0);
}

if (command === "get") {
  const slug = positional[1];
  if (!slug) {
    console.error("usage: artifact-publish get <slug> [--out <file>] [--json]");
    process.exit(1);
  }
  const data = await api(`/api/artifacts/${encodeURIComponent(slug)}`, {
    verb: "fetching artifact",
  });
  const a = data.artifact;
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (outFile) {
    writeFileSync(outFile, a.html);
    console.log(outFile);
    console.error(`${a.title} (${a.slug}) — ${a.isPublic ? "public" : "private"}, edit and publish back with --update ${a.slug}`);
  } else {
    process.stdout.write(a.html);
  }
  process.exit(0);
}


// Deleting moves the artifact to the trash — the link stops opening at once,
// but it can be restored for a few days. That is what makes it safe for an
// agent to run on the user's word: the wrong page is recoverable.
if (command === "delete" || command === "rm") {
  const slug = positional[1];
  if (!slug) {
    console.error("usage: artifact-publish delete <slug> [--permanent]");
    console.error("run `artifact-publish list --search <text>` to find the slug");
    process.exit(1);
  }
  const data = await api(
    `/api/artifacts/${encodeURIComponent(slug)}${permanent ? "?permanent=1" : ""}`,
    { method: "DELETE", verb: "deleting artifact" }
  );
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }
  const name = data.artifact ? `${data.artifact.title} (${data.artifact.slug})` : slug;
  if (data.permanent) {
    console.log(`deleted for good: ${name}`);
  } else {
    console.log(`moved to the trash: ${name}`);
    console.error(
      `restore it with \`artifact-publish restore ${data.artifact?.slug || slug}\`` +
        (data.daysLeft ? ` within ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"}` : "")
    );
  }
  process.exit(0);
}

// What is in the trash. `list` never shows these, so this is the only way to
// find the slug of something already deleted.
if (command === "trash") {
  const data = await api(`/api/trash`, { verb: "listing the trash" });
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!data.artifacts.length) {
    console.error("the trash is empty");
  } else {
    const slugWidth = Math.max(...data.artifacts.map((a) => a.slug.length));
    for (const a of data.artifacts) {
      console.log(
        [
          a.slug.padEnd(slugWidth),
          day(a.deletedAt),
          `${a.daysLeft}d left`.padEnd(9),
          a.title,
        ].join("  ")
      );
    }
  }
  process.exit(0);
}

if (command === "restore") {
  const slug = positional[1];
  if (!slug) {
    console.error("usage: artifact-publish restore <slug>");
    console.error("run `artifact-publish trash` to see what is in there");
    process.exit(1);
  }
  const data = await api(`/api/artifacts/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: { restore: true },
    verb: "restoring artifact",
  });
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`${site}/a/${data.artifact.slug}`);
    console.error(`restored: ${data.artifact.title}`);
  }
  process.exit(0);
}

// Retitling only. The HTML behind an artifact is replaced by publishing over
// it with --update, which keeps the same URL.
if (command === "rename") {
  const [, slug, ...titleParts] = positional;
  const title = titleParts.join(" ").trim();
  if (!slug || !title) {
    console.error('usage: artifact-publish rename <slug> "New title"');
    process.exit(1);
  }
  const data = await api(`/api/artifacts/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: { title },
    verb: "renaming artifact",
  });
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`${site}/a/${data.artifact.slug}`);
    console.error(`renamed to: ${data.artifact.title}`);
  }
  process.exit(0);
}

/* ---------- publish ---------- */

const [file, ...rest] = positional;
if (!file) {
  console.error(
    'usage: artifact-publish ./artifact.html "Title" [--project "Folder" | --new-project "Folder"] [--public] [--expires 7d] [--passphrase <text>] [--update <slug>]\n' +
      "       artifact-publish list | get <slug> | projects | rename <slug> <title> | delete <slug> | trash | restore <slug>"
  );
  process.exit(1);
}

if ((updateSlug === "" && argv.includes("--update")) || (argv.includes("-u") && !updateSlug)) {
  console.error("--update needs the slug of an artifact you already published");
  process.exit(1);
}

if (argv.some((a) => a === "--expires" || a === "-e" || a === "--expires=") && !expires) {
  console.error("--expires needs a duration like 7d, an ISO date, or never");
  process.exit(1);
}
if (argv.some((a) => a === "--passphrase" || a === "--passphrase=") && !passphrase) {
  console.error("--passphrase needs the passphrase viewers will type");
  process.exit(1);
}

// Sharing options describe a shared link, so asking for one while also asking
// for private is a contradiction worth stopping on rather than guessing at.
const sharing = (expires && expires !== "never") || Boolean(passphrase);
if (sharing && visibility === "private") {
  console.error("--private cannot be combined with --expires or --passphrase");
  process.exit(1);
}
if (sharing) visibility = "public";

const html = readFileSync(file, "utf8");
const title = rest.join(" ").trim() || basename(file).replace(/\.html?$/i, "");

const payload = { title, html };
if (project) payload.project = project;
if (createProject) payload.createProject = true;
if (visibility) payload.visibility = visibility;
if (updateSlug) payload.slug = updateSlug;
if (expires) {
  // A duration is relative to now and the server does the arithmetic; anything
  // else is taken as an instant.
  if (expires === "never") payload.expiresIn = null;
  else if (/^\d+(?:\.\d+)?\s*[mhdw]$/i.test(expires)) payload.expiresIn = expires;
  else payload.expiresAt = expires;
}
if (passphrase) payload.passphrase = passphrase;

const result = await api("/api/upload", { method: "POST", body: payload, verb: "publish" });

// The URL alone on stdout, so `artifact-publish ... | pbcopy` still works. Who
// can open it goes to stderr, because a caller that doesn't know the page is
// private reads the 404 it gets back as a broken site.
console.log(result.url);
if (result.project?.created) {
  console.error(`Created project "${result.project.name}"`);
}
if (result.note) {
  console.error(`${result.updated ? "Updated" : "Published"}, ${result.note}`);
}
