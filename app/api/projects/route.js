import { artifacts } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { loadProjects } from "@/lib/data";
import { createProject } from "@/lib/projects";
import { LIVE } from "@/lib/trash";

export const dynamic = "force-dynamic";

// Session or API token: the agent uses this to see which folders exist before
// it picks one, instead of guessing a name and failing at publish time.
export async function GET(request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const { projects, unfiled, total } = await loadProjects(user.id);
  return Response.json({ projects, unfiled, total });
}

export async function POST(request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const created = await createProject(body.name, user.id);
  if (created.error) {
    return Response.json({ error: created.error }, { status: created.status });
  }

  const { project } = created;
  // Report the count so the freshly created project renders like the rest.
  const art = await artifacts();
  const count = await art.countDocuments({
    projectId: project._id.toString(),
    userId: user.id,
    ...LIVE,
  });

  return Response.json(
    { project: { id: project._id.toString(), name: project.name, slug: project.slug, count } },
    { status: 201 }
  );
}
