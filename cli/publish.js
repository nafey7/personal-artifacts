#!/usr/bin/env node
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

const argv = process.argv.slice(2);

// Pull --project <name> (or --project=<name>) out before the positional args.
let project = "";
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--project" || arg === "-p") {
    project = argv[++i] || "";
  } else if (arg.startsWith("--project=")) {
    project = arg.slice("--project=".length);
  } else {
    positional.push(arg);
  }
}

const [file, ...rest] = positional;
if (!file) {
  console.error('usage: publish ./artifact.html "Title" [--project "Folder"]');
  process.exit(1);
}

const configPath = join(homedir(), ".artifact-publish.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  console.error(`missing or invalid config: ${configPath}`);
  console.error('expected: { "site": "https://example.vercel.app", "token": "..." }');
  process.exit(1);
}

const html = readFileSync(file, "utf8");
const title = rest.join(" ").trim() || basename(file).replace(/\.html?$/i, "");

const res = await fetch(`${config.site.replace(/\/$/, "")}/api/upload`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
  },
  body: JSON.stringify(project ? { title, html, project } : { title, html }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`upload failed (${res.status}): ${text}`);
  process.exit(1);
}
console.log(JSON.parse(text).url);
