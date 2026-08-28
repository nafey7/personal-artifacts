import { notFound, redirect } from "next/navigation";
import { projects as projectCol } from "@/lib/mongo";
import { currentUser } from "@/lib/auth";
import { loadArtifacts, loadProjects } from "@/lib/data";
import ArtifactList from "../../ArtifactList";
import PageHead from "../../PageHead";

export const dynamic = "force-dynamic";

export default async function ProjectView({ params }) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { slug } = await params;
  // Someone else's project slug is a 404 here, not a peek at their name.
  const project = await (await projectCol()).findOne({ slug, userId: user.id });
  if (!project) notFound();

  const [items, { projects }] = await Promise.all([
    loadArtifacts(user.id, { projectId: project._id.toString() }),
    loadProjects(user.id),
  ]);

  return (
    <>
      <PageHead title={project.name} count={items.length} latest={items[0]?.stamp} />
      <ArtifactList items={items} projects={projects} />
    </>
  );
}
