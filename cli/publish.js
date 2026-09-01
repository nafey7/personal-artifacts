#!/usr/bin/env node
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`artifact-publish — publish an HTML page to your artifact site.

  artifact-publish ./page.html "Title"
    --project <name>     file it under a project that already exists
    --public             anyone with the link can open it
    --private            only you can open it (the default)
    --update <slug>      replace an artifact you already published, keeping its URL

Prints the URL on stdout and a line about who can open it on stderr, so
piping still gets you just the URL.

New artifacts are private. A private URL returns 404 unless the request
carries your browser session or your API token as an Authorization: Bearer
header — that is the artifact being private, not a failed publish.`);
  process.exit(0);
}

// Pull the flags out before the positional args.
let project = "";
let visibility = "";
let updateSlug = "";
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--project" || arg === "-p") {
    project = argv[++i] || "";
  } else if (arg.startsWith("--project=")) {
    project = arg.slice("--project=".length);
  } else if (arg === "--public") {
    visibility = "public";
  } else if (arg === "--private") {
    visibility = "private";
  } else if (arg === "--update" || arg === "-u") {
    updateSlug = argv[++i] || "";
  } else if (arg.startsWith("--update=")) {
    updateSlug = arg.slice("--update=".length);
  } else {
    positional.push(arg);
  }
}

const [file, ...rest] = positional;
if (!file) {
  console.error(
    'usage: artifact-publish ./artifact.html "Title" [--project "Folder"] [--public] [--update <slug>]'
  );
  process.exit(1);
}

if ((updateSlug === "" && argv.includes("--update")) || (argv.includes("-u") && !updateSlug)) {
  console.error("--update needs the slug of an artifact you already published");
  process.exit(1);
}

const configPath = join(homedir(), ".artifact-publish.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  console.error(`missing or invalid config: ${configPath}`);
  console.error("run `personal-artifact` to set it up");
  process.exit(1);
}

const html = readFileSync(file, "utf8");
const title = rest.join(" ").trim() || basename(file).replace(/\.html?$/i, "");

const payload = { title, html };
if (project) payload.project = project;
if (visibility) payload.visibility = visibility;
if (updateSlug) payload.slug = updateSlug;

const res = await fetch(`${config.site.replace(/\/$/, "")}/api/upload`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
if (!res.ok) {
  let detail = text;
  try {
    detail = JSON.parse(text).error || text;
  } catch {
    // not JSON — show what came back
  }
  console.error(`publish failed (${res.status}): ${detail}`);
  if (res.status === 401) {
    console.error("the token is not valid for this site — run `personal-artifact` again");
  }
  process.exit(1);
}

const result = JSON.parse(text);

// The URL alone on stdout, so `artifact-publish ... | pbcopy` still works. Who
// can open it goes to stderr, because a caller that doesn't know the page is
// private reads the 404 it gets back as a broken site.
console.log(result.url);
if (result.note) {
  console.error(`${result.updated ? "Updated" : "Published"}, ${result.note}`);
}
