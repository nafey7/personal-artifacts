import { randomBytes } from "crypto";

// Slugs are minted once and never rewritten, so a rename can't break a link.
export function slugify(text, fallback = "item") {
  const base = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || fallback}-${randomBytes(3).toString("hex")}`;
}
