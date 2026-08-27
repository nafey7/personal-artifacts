import { notFound } from "next/navigation";
import { projects as projectCol } from "@/lib/mongo";
import { loadArtifacts, loadProjects } from "@/lib/data";
import ArtifactList from "../../ArtifactList";
import PageHead from "../../PageHead";

export const dynamic = "force-dynamic";

export default async function ProjectView({ params }) {
  const { slug } = await params;
  const project = await (await projectCol()).findOne({ slug });
  if (!project) notFound();

  const [items, { projects }] = await Promise.all([
    loadArtifacts({ projectId: project._id.toString() }),
    loadProjects(),
  ]);

  return (
    <>
      <PageHead title={project.name} count={items.length} latest={items[0]?.stamp} />
      <ArtifactList items={items} projects={projects} />
    </>
  );
}
