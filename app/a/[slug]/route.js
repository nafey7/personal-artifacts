import { artifacts } from "@/lib/mongo";
import { currentUser } from "@/lib/auth";
import { ownerOfToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// Who is asking: the browser session if there is one, otherwise the API token
// the CLI publishes with. Accepting the token here is what lets the agent that
// just published verify its own URL — the same credential that wrote the
// artifact can read it back, which is the same level of trust, not more.
async function viewerId(request) {
  const user = await currentUser();
  if (user) return user.id;

  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return await ownerOfToken(auth.slice(7).trim());
}

// One response for "no such slug" and for "not yours", identical down to the
// body, so a stranger can't probe for which artifacts exist. It still says
// enough for the person holding the link to work out what to do — the old bare
// "Not found" read as a broken site to anyone fetching a private artifact.
const MISSING_TEXT = `Not found, or not shared with you.

If this artifact is yours, it is private: open it in a browser you are signed
in to, or send the same API token you published with as an Authorization:
Bearer header. To let anyone open this link, mark the artifact Shared in your
dashboard.`;

function missingPage(origin) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not found</title>
<style>
  :root { color-scheme: light dark; --ink: #1a1a1a; --dim: #5c5c5c; --bg: #fff; --line: #e4e4e4; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ededed; --dim: #a0a0a0; --bg: #111; --line: #2c2c2c; } }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem;
    background: var(--bg); color: var(--ink);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  main { max-width: 34rem; }
  h1 { margin: 0 0 .75rem; font-size: 1.35rem; letter-spacing: -0.01em; }
  p { margin: 0 0 1rem; color: var(--dim); }
  ul { margin: 0 0 1.25rem; padding-left: 1.1rem; color: var(--dim); }
  li { margin-bottom: .35rem; }
  a { color: inherit; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  .foot { border-top: 1px solid var(--line); padding-top: 1rem; font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>Not found, or not shared with you</h1>
  <p>Either no artifact lives at this address, or one does and it is private.</p>
  <p>If this artifact is yours:</p>
  <ul>
    <li>Open it in a browser you are <a href="${origin}/signin">signed in</a> to.</li>
    <li>Or fetch it with the same API token you published with, as an
        <code>Authorization: Bearer</code> header.</li>
    <li>To let anyone open this link, mark the artifact <strong>Shared</strong> in
        your <a href="${origin}/">dashboard</a>.</li>
  </ul>
  <p class="foot">New artifacts are private until you share them.</p>
</main>
</body>
</html>`;
}

function notFound(request) {
  // Agents and scripts fetch with Accept: */* — hand them the message, not a
  // page of markup they have to strip tags out of to read.
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };

  if (!wantsHtml) {
    return new Response(MISSING_TEXT, {
      status: 404,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(missingPage(new URL(request.url).origin), {
    status: 404,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
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

export async function GET(request, { params }) {
  const { slug } = await params;
  const col = await artifacts();
  const doc = await col.findOne({ slug });
  if (!doc) return notFound(request);

  const isPublic = doc.visibility === "public";
  if (!isPublic) {
    const viewer = await viewerId(request);
    if (!viewer || viewer !== doc.userId) return notFound(request);
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
