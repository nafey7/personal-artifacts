// The caps a free account runs under. Read from the environment once so the
// upload route (which enforces them) and the settings page (which shows them)
// can never disagree about the numbers.
//
// A page has to fit in a MongoDB document (16MB) but should be nowhere near it.
// A generous HTML page with inlined CSS and fonts is a few hundred KB; the cap
// exists so one embedded video can't take a meaningful slice of the cluster.
export const MAX_BYTES = Number(process.env.MAX_ARTIFACT_BYTES || 2_000_000);
export const MAX_PER_USER = Number(process.env.MAX_ARTIFACTS_PER_USER || 200);

// "12 MB", "340 KB", "0 B" — decimal units, matching how the caps are quoted.
export function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  const mb = n / 1_000_000;
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace(/\.0$/, "")} MB`;
}

// How long a deleted artifact sits in the trash before Mongo removes it for
// good. The same number drives the TTL index and every "N days left" the
// dashboard prints, so the promise the UI makes is the one the database keeps.
export const TRASH_DAYS = Number(process.env.TRASH_RETENTION_DAYS || 7);
export const TRASH_SECONDS = Math.round(TRASH_DAYS * 86400);
