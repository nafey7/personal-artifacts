import { artifacts } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { loadTrash } from "@/lib/data";
import { TRASHED, TRASH_DAYS } from "@/lib/trash";

export const dynamic = "force-dynamic";

// What is in the trash, newest deletion first, with how long each one has
// left. Session or API token, so an agent that deleted the wrong page can see
// it is recoverable rather than assuming it is gone.
export async function GET(request) {
  const { user, response } = await requireUser(request);
  if (response) return response;

  const items = await loadTrash(user.id);
  const origin = new URL(request.url).origin;

  return Response.json({
    retentionDays: TRASH_DAYS,
    artifacts: items.map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      url: `${origin}/a/${d.slug}`,
      bytes: d.bytes,
      createdAt: d.iso,
      deletedAt: d.deletedIso,
      daysLeft: d.daysLeft,
    })),
  });
}

// Empty the trash: every artifact in it, gone for good. Nothing live is
// touched, whatever goes wrong — the filter names the trash itself.
export async function DELETE(_request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const col = await artifacts();
  const { deletedCount } = await col.deleteMany({ userId: user.id, ...TRASHED });
  return Response.json({ deleted: deletedCount, permanent: true });
}
