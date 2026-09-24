import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadArtifacts, loadProjects } from "@/lib/data";
import ArtifactList from "./ArtifactList";
import PageHead from "./PageHead";

export const dynamic = "force-dynamic";

export default async function AllArtifacts() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const [items, { projects }] = await Promise.all([
    loadArtifacts(user.id),
    loadProjects(user.id),
  ]);

  return (
    <>
      <PageHead title="All artifacts" count={items.length} latest={items[0]?.stamp} />
      <ArtifactList items={items} projects={projects} />
    </>
  );
}
