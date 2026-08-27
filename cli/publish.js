#!/usr/bin/env node
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: publish ./artifact.html "Title"');
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
  body: JSON.stringify({ title, html }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`upload failed (${res.status}): ${text}`);
  process.exit(1);
}
console.log(JSON.parse(text).url);
