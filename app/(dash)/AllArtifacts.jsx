import { loadArtifacts, loadProjects } from "@/lib/data";
import ArtifactList from "./ArtifactList";
import PageHead from "./PageHead";

// The signed-in view of `/`. It is rendered by app/page.jsx, which decides
// between this and the public home page, so the caller hands the user over.
export default async function AllArtifacts({ user }) {
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
