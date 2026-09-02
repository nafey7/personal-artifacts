import { artifacts } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { findProject, listProjects } from "@/lib/projects";
import { shareSummary } from "@/lib/share";
import { LIVE, TRASHED, trashSummary } from "@/lib/trash";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lists the caller's artifacts, newest first, without their HTML. Session or
// API token. This is what lets an agent find "the dashboard from last week"
// by title instead of asking the user to dig the slug out of the dashboard.
//
//   ?project=<id|slug|name>   only artifacts in that project; "unfiled" for
//                             artifacts that belong to no project
//   ?q=<text>                 case-insensitive title match
//   ?limit=<n>                default 100, at most 500
//   ?trashed=1                the trash instead: deleted artifacts still
//                             inside their recovery window
export async function GET(request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const url = new URL(request.url);
  // Deleted artifacts are in the trash, not in the list, unless asked for.
  const wantTrash = ["1", "true", "yes"].includes(
    (url.searchParams.get("trashed") || "").toLowerCase()
  );
  const filter = { userId: user.id, ...(wantTrash ? TRASHED : LIVE) };

  const projectKey = (url.searchParams.get("project") || "").trim();
  if (projectKey === "unfiled") {
    filter.projectId = null;
  } else if (projectKey) {
    const project = await findProject(projectKey, user.id);
    if (!project) {
      const names = (await listProjects(user.id)).map((p) => p.name);
      const have = names.length ? `your projects: ${names.join(", ")}` : "you have no projects yet";
      return Response.json(
        { error: `unknown project: ${projectKey} — ${have}`, projects: names },
        { status: 400 }
      );
    }
    filter.projectId = project._id.toString();
  }

  const q = (url.searchParams.get("q") || "").trim();
  if (q) filter.title = { $regex: escapeRegex(q), $options: "i" };

  let limit = Number(url.searchParams.get("limit")) || DEFAULT_LIMIT;
  limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));

  const [docs, projectDocs] = await Promise.all([
    (await artifacts())
      .find(filter, { projection: { html: 0 } })
      .sort(wantTrash ? { deletedAt: -1 } : { createdAt: -1 })
      .limit(limit)
      .toArray(),
    listProjects(user.id),
  ]);

  const projectsById = new Map(projectDocs.map((p) => [p._id.toString(), p]));
  const origin = url.origin;
  const now = new Date();

  return Response.json({
    artifacts: docs.map((d) => {
      const project = d.projectId ? projectsById.get(d.projectId) : null;
      return {
        id: d._id.toString(),
        slug: d.slug,
        title: d.title,
        url: `${origin}/a/${d.slug}`,
        project: project ? { id: project._id.toString(), name: project.name, slug: project.slug } : null,
        visibility: d.visibility === "public" ? "public" : "private",
        // isPublic, expiresAt, isExpired, hasPassphrase — never the hash.
        ...shareSummary(d, now),
        ...trashSummary(d, now),
        bytes: d.bytes ?? null,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt || d.createdAt).toISOString(),
      };
    }),
  });
}
