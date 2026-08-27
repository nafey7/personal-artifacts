import { artifacts, projects } from "@/lib/mongo";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function stamp(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Every project plus how many artifacts sit in it, and the count of artifacts
// that belong to no project at all.
export async function loadProjects() {
  const [projectCol, artifactCol] = [await projects(), await artifacts()];
  const [docs, counts] = await Promise.all([
    projectCol.find({}).sort({ name: 1 }).toArray(),
    artifactCol.aggregate([{ $group: { _id: "$projectId", n: { $sum: 1 } } }]).toArray(),
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

export async function loadArtifacts(filter = {}) {
  const col = await artifacts();
  const docs = await col
    .find(filter, { projection: { slug: 1, title: 1, createdAt: 1, projectId: 1 } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  return docs.map((d) => ({
    id: d._id.toString(),
    slug: d.slug,
    title: d.title,
    projectId: d.projectId ?? null,
    iso: new Date(d.createdAt).toISOString(),
    stamp: stamp(d.createdAt),
  }));
}
