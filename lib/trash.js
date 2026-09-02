import { TRASH_DAYS, TRASH_SECONDS } from "@/lib/limits";

// Deleting an artifact stamps `deletedAt` on it instead of removing the
// document: it drops out of every listing and its /a/ link stops opening, but
// the HTML is still there to restore. A TTL index on that field is what
// finally removes it, TRASH_DAYS after the stamp.
//
//   deletedAt  Date | null | absent    absent and null both mean "not deleted"
//
// Mongo matches a missing field with { deletedAt: null }, so artifacts
// published before the trash existed need no migration.
export const LIVE = { deletedAt: null };

// Only the ones in the trash. `$ne: null` excludes missing fields too.
export const TRASHED = { deletedAt: { $ne: null } };

export function purgesAt(doc) {
  if (!doc?.deletedAt) return null;
  return new Date(new Date(doc.deletedAt).getTime() + TRASH_SECONDS * 1000);
}

// What a trashed artifact has left, rounded up: 7, 6, … 1, and 0 for one
// that is past due and waiting on the TTL sweep. Coarse on purpose — the
// exact instant is in the row's title attribute.
export function daysLeft(doc, now = new Date()) {
  const at = purgesAt(doc);
  if (!at) return null;
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 86400000));
}

// The trash fields an API hands back for one artifact.
export function trashSummary(doc, now = new Date()) {
  if (!doc?.deletedAt) return { trashed: false };
  return {
    trashed: true,
    deletedAt: new Date(doc.deletedAt).toISOString(),
    purgesAt: purgesAt(doc).toISOString(),
    daysLeft: daysLeft(doc, now),
  };
}

export { TRASH_DAYS };
