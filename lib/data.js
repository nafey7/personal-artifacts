import { artifacts, projects } from "@/lib/mongo";
import { shareSummary } from "@/lib/share";
import { LIVE, TRASHED, daysLeft, purgesAt } from "@/lib/trash";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function stamp(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Every read is scoped by userId. Callers must pass one — an accidental
// undefined would otherwise match documents with no owner. Trashed artifacts
// are excluded unless the caller is the trash itself, so a soft delete
// disappears from the dashboard the way a hard one used to.
function owned(userId, filter = {}) {
  if (!userId) throw new Error("userId is required");
  return { ...LIVE, ...filter, userId };
}

// Every project the user owns plus how many artifacts sit in it, and the count
// of their artifacts that belong to no project at all.
export async function loadProjects(userId) {
  const [projectCol, artifactCol] = [await projects(), await artifacts()];
  const [docs, counts] = await Promise.all([
    projectCol.find(owned(userId)).sort({ name: 1 }).toArray(),
    artifactCol
      .aggregate([{ $match: owned(userId) }, { $group: { _id: "$projectId", n: { $sum: 1 } } }])
      .toArray(),
  ]);

  const byId = new Map(counts.map((c) => [c._id ?? null, c.n]));
  return {
    projects: docs.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      slug: p.slug,
      count: byId.get(p._id.toString()) || 0,
    })),
    unfiled: byId.get(null) || 0,
    total: counts.reduce((sum, c) => sum + c.n, 0),
  };
}

export async function loadArtifacts(userId, filter = {}) {
  const col = await artifacts();
  const docs = await col
    .find(owned(userId, filter), {
      projection: {
        slug: 1, title: 1, createdAt: 1, projectId: 1,
        visibility: 1, shareExpiresAt: 1, sharePassHash: 1,
      },
    })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  const now = new Date();
  return docs.map((d) => ({
    id: d._id.toString(),
    slug: d.slug,
    title: d.title,
    projectId: d.projectId ?? null,
    // Anything published before sharing existed is private, as promised.
    // shareSummary carries isPublic, expiresAt, isExpired and hasPassphrase —
    // never the hash.
    ...shareSummary(d, now),
    expiresStamp: d.shareExpiresAt ? stamp(d.shareExpiresAt) : null,
    iso: new Date(d.createdAt).toISOString(),
    stamp: stamp(d.createdAt),
  }));
}

// What is waiting in the trash: the rows themselves, newest deletion first,
// each with how many days it has left before Mongo removes it.
export async function loadTrash(userId) {
  const col = await artifacts();
  const docs = await col
    .find(owned(userId, TRASHED), {
      projection: { slug: 1, title: 1, createdAt: 1, deletedAt: 1, bytes: 1, projectId: 1 },
    })
    .sort({ deletedAt: -1 })
    .limit(500)
    .toArray();

  const now = new Date();
  return docs.map((d) => ({
    id: d._id.toString(),
    slug: d.slug,
    title: d.title,
    projectId: d.projectId ?? null,
    bytes: d.bytes ?? null,
    iso: new Date(d.createdAt).toISOString(),
    stamp: stamp(d.createdAt),
    deletedIso: new Date(d.deletedAt).toISOString(),
    deletedStamp: stamp(d.deletedAt),
    purgesStamp: stamp(purgesAt(d)),
    daysLeft: daysLeft(d, now),
  }));
}

// How many artifacts sit in the trash. The sidebar shows this next to the
// link so a full trash is visible without opening it.
export async function countTrash(userId) {
  const col = await artifacts();
  return await col.countDocuments(owned(userId, TRASHED));
}

// How much of the account's allowance is spent: artifact count against the
// per-account cap, and total bytes stored. Artifacts published before `bytes`
// was recorded are measured from the HTML itself so old accounts don't read
// as smaller than they are.
export async function loadUsage(userId) {
  const col = await artifacts();
  const rows = await col
    .aggregate([
      { $match: { userId } },
      {
        $group: {
          // Trashed artifacts still occupy the cluster until the TTL sweep
          // takes them, so they are counted — separately, because they no
          // longer count against the artifact cap.
          _id: { $cond: [{ $ifNull: ["$deletedAt", false] }, "trashed", "live"] },
          count: { $sum: 1 },
          bytes: { $sum: { $ifNull: ["$bytes", { $strLenBytes: { $ifNull: ["$html", ""] } }] } },
        },
      },
    ])
    .toArray();

  const by = (key) => rows.find((r) => r._id === key) || { count: 0, bytes: 0 };
  const live = by("live");
  const trashed = by("trashed");
  return {
    count: live.count,
    bytes: live.bytes,
    trashed: { count: trashed.count, bytes: trashed.bytes },
  };
}
