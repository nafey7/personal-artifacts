#!/usr/bin/env node
// Runs after `npm install -g personal-artifact`. Upgrading replaces the
// package but not the skill copies it wrote last time, so an agent would go
// on reading the old instructions — new commands present, nothing telling it
// they exist. This brings those copies up to date.
//
// Deliberately narrow: it only rewrites files we already wrote. A first
// install has nothing to refresh and prints nothing; `personal-artifact` is
// still what sets things up, because only that can sign in.
//
// Nothing here may fail an install, so every step is guarded and the exit
// code is always 0.

import { existsSync } from "fs";
import { join } from "path";
import { CONFIG, VERSION, staleSkills, writeSkill } from "./skills.js";

try {
  // No config means this machine has never been set up. Nothing to refresh,
  // and writing skills for someone who has not signed in would be a surprise.
  if (existsSync(CONFIG)) {
    const stale = staleSkills();
    for (const s of stale) writeSkill(s);

    if (stale.length) {
      const where = stale.map((s) => join(s.dir, "SKILL.md")).join("\n  ");
      console.log(`personal-artifact ${VERSION} — refreshed the skill for your agents:\n  ${where}`);
      console.log("Restart running agent sessions to pick it up.");
    }
  }
} catch {
  // An install must not fail over this. `artifact-publish` warns about a
  // stale skill on its own, which is the backstop for every path that skips
  // scripts — --ignore-scripts, some CI images, and plain file copies.
}
