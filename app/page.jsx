import { artifacts } from "@/lib/mongo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const col = await artifacts();
  const docs = await col
    .find({}, { projection: { slug: 1, title: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  return (
    <>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1.5rem" }}>Artifacts</h1>
      {docs.length === 0 && <p style={{ color: "#666" }}>Nothing published yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {docs.map((d) => (
          <li
            key={d.slug}
            style={{ padding: "0.75rem 0", borderBottom: "1px solid #eee" }}
          >
            <a
              href={`/a/${d.slug}`}
              style={{ color: "#0645ad", textDecoration: "none" }}
            >
              {d.title}
            </a>
            <div style={{ color: "#888", fontSize: "0.85rem", marginTop: 2 }}>
              {new Date(d.createdAt).toISOString().slice(0, 16).replace("T", " ")}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
