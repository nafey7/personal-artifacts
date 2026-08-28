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

// Enough to survive being placed inside a double-quoted attribute.
function forAttribute(html) {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function forText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The artifact runs inside a sandboxed iframe with no allow-same-origin, so the
// browser gives it an opaque origin: it cannot read this site's cookies, call
// its API with the viewer's session, or reach another artifact's storage.
// Inlining through srcdoc rather than serving the HTML from its own endpoint
// means there is no raw URL left to route around this shell.
function shell(doc) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${forText(doc.title)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
  @media (prefers-color-scheme: dark) { html, body { background: #111; } }
</style>
</head>
<body>
<iframe
  title="${forText(doc.title)}"
  sandbox="allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox"
  srcdoc="${forAttribute(doc.html)}"></iframe>
</body>
</html>`;
}

export async function GET(_request, { params }) {
  const { slug } = await params;
  const col = await artifacts();
  const doc = await col.findOne({ slug });
  if (!doc) return notFound();

  const isPublic = doc.visibility === "public";
  if (!isPublic) {
    const user = await currentUser();
    if (!user || user.id !== doc.userId) return notFound();
  }

  return new Response(shell(doc), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nothing published here should be indexed under this domain.
      "X-Robots-Tag": "noindex, nofollow",
      // Private pages must never land in a shared cache.
      "Cache-Control": isPublic ? "public, max-age=0, must-revalidate" : "private, no-store",
    },
  });
}
