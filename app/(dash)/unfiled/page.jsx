import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadArtifacts, loadProjects } from "@/lib/data";
import ArtifactList from "../ArtifactList";
import PageHead from "../PageHead";

export const dynamic = "force-dynamic";

export default async function Unfiled() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  // Artifacts published before projects existed have no projectId field at all.
  const [items, { projects }] = await Promise.all([
    loadArtifacts(user.id, { $or: [{ projectId: null }, { projectId: { $exists: false } }] }),
    loadProjects(user.id),
  ]);

  return (
    <>
      <PageHead title="Unfiled" count={items.length} latest={items[0]?.stamp} />
      <ArtifactList items={items} projects={projects} />
    </>
  );
}
