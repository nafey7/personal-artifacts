import { artifacts } from "@/lib/mongo";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function notFound() {
  // The same response whether the slug is unknown or simply not yours, so a
  // stranger can't probe for which artifacts exist.
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_request, { params }) {
  const { slug } = await params;
  const col = await artifacts();
  const doc = await col.findOne({ slug });
  if (!doc) return notFound();

  if (doc.visibility !== "public") {
    const user = await currentUser();
    if (!user || user.id !== doc.userId) return notFound();
  }

  return new Response(doc.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Private pages must never land in a shared cache.
      "Cache-Control":
        doc.visibility === "public"
          ? "public, max-age=0, must-revalidate"
          : "private, no-store",
    },
  });
}
