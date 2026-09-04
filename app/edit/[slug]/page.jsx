import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Editing used to be a page of its own. It is a mode of the artifact's own
// page now — opening it there swaps the frame instead of loading a new
// document, so the reader keeps their place — and this stays behind so that
// links and bookmarks made while it was a page still land somewhere useful.
export default async function EditArtifact({ params }) {
  const { slug } = await params;
  redirect(`/a/${encodeURIComponent(String(slug))}?edit=1`);
}
