import { artifacts } from "@/lib/mongo";
import { currentUser, verifyPassword } from "@/lib/auth";
import { ownerOfToken } from "@/lib/tokens";
import { clearAttempts, clientIp, tooManyAttempts } from "@/lib/ratelimit";
import { grantCookie, grantMatches, hasExpired, readGrant } from "@/lib/share";

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

function forText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Enough to survive being placed inside a double-quoted attribute.
function forAttribute(html) {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/* ---------- the pages a stranger can see ---------- */

// One small page frame for everything that isn't the artifact itself: not
// found, expired, and the passphrase prompt. The same chrome each time so a
// person who hits two of them in a row reads them as the same site.
function frame(title, inner) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${forText(title)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1a1a1a; --dim: #5c5c5c; --bg: #fff; --line: #e4e4e4; --field: #fff; --bad: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ededed; --dim: #a0a0a0; --bg: #111; --line: #2c2c2c; --field: #181818; --bad: #f2a29b; } }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem;
    background: var(--bg); color: var(--ink);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  main { max-width: 34rem; width: 100%; }
  h1 { margin: 0 0 .75rem; font-size: 1.35rem; letter-spacing: -0.01em; }
  p { margin: 0 0 1rem; color: var(--dim); }
  ul { margin: 0 0 1.25rem; padding-left: 1.1rem; color: var(--dim); }
  li { margin-bottom: .35rem; }
  a { color: inherit; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  .foot { border-top: 1px solid var(--line); padding-top: 1rem; font-size: .9rem; }
  form { display: flex; gap: .5rem; margin: 0 0 1rem; }
  input {
    flex: 1; min-width: 0; font: inherit; color: inherit;
    background: var(--field); border: 1px solid var(--line); border-radius: 6px; padding: .5rem .65rem;
  }
  input:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
  button {
    font: inherit; cursor: pointer; border-radius: 6px; padding: .5rem .9rem;
    border: 1px solid var(--ink); background: var(--ink); color: var(--bg);
  }
  .bad { color: var(--bad); }
  @media (max-width: 26rem) { form { flex-direction: column; } }
</style>
</head>
<body>
<main>
${inner}
</main>
</body>
</html>`;
}

// Agents and scripts fetch with Accept: */* — hand them the message, not a
// page of markup they have to strip tags out of to read.
function wantsHtml(request) {
  return (request.headers.get("accept") || "").includes("text/html");
}

function respond(request, { status, text, html, headers = {} }) {
  const base = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    ...headers,
  };
  if (!wantsHtml(request)) {
    return new Response(text, {
      status,
      headers: { ...base, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(html, {
    status,
    headers: { ...base, "Content-Type": "text/html; charset=utf-8" },
  });
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

function notFound(request) {
  const origin = new URL(request.url).origin;
  return respond(request, {
    status: 404,
    text: MISSING_TEXT,
    html: frame(
      "Not found",
      `  <h1>Not found, or not shared with you</h1>
  <p>Either no artifact lives at this address, or one does and it is private.</p>
  <p>If this artifact is yours:</p>
  <ul>
    <li>Open it in a browser you are <a href="${origin}/signin">signed in</a> to.</li>
    <li>Or fetch it with the same API token you published with, as an
        <code>Authorization: Bearer</code> header.</li>
    <li>To let anyone open this link, mark the artifact <strong>Shared</strong> in
        your <a href="${origin}/">dashboard</a>.</li>
  </ul>
  <p class="foot">New artifacts are private until you share them.</p>`
    ),
  });
}

// A link that was shared for a while and no longer is. This does admit the
// artifact exists, which a plain 404 would not — but the owner chose to hand
// the link out, and the person holding a stale one needs to know to ask for it
// again rather than conclude the site is down.
const EXPIRED_TEXT = `This link has expired.

Whoever shared it set it to stop working after a while, and that time has
passed. Ask them to share it again — the address stays the same. If the
artifact is yours, sign in to open it, or share it again from your dashboard.`;

function expired(request) {
  const origin = new URL(request.url).origin;
  return respond(request, {
    status: 410,
    text: EXPIRED_TEXT,
    html: frame(
      "Link expired",
      `  <h1>This link has expired</h1>
  <p>Whoever shared it set it to stop working after a while, and that time has
     passed. Ask them to share it again — the address stays the same.</p>
  <p class="foot">If this artifact is yours, <a href="${origin}/signin">sign in</a> to
     open it, or share it again from your <a href="${origin}/">dashboard</a>.</p>`
    ),
  });
}

const PASSPHRASE_TEXT = `This link asks for a passphrase.

Whoever shared it set a passphrase on it. Send it as a form POST to this same
URL with a "passphrase" field, or as JSON { "passphrase": "..." }. The response
sets a cookie for this artifact's path; present it on the next GET.`;

function askPassphrase(request, doc, { error = "", status = 401 } = {}) {
  const title = forText(doc.title);
  return respond(request, {
    status,
    text: error ? `${error}\n\n${PASSPHRASE_TEXT}` : PASSPHRASE_TEXT,
    html: frame(
      doc.title,
      `  <h1>This page asks for a passphrase</h1>
  <p>Whoever sent you this link set a passphrase on it. Type it to open
     <strong>${title}</strong>.</p>
  <form method="post" action="">
    <input type="password" name="passphrase" autofocus required autocomplete="off"
           aria-label="Passphrase" placeholder="Passphrase">
    <button type="submit">Open</button>
  </form>
  ${error ? `<p class="bad" role="alert">${forText(error)}</p>` : ""}
  <p class="foot">Don't have it? Ask whoever sent you the link.</p>`
    ),
  });
}

/* ---------- the artifact itself ---------- */

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

function serve(doc) {
  // Only a plainly public page may pass through a shared cache. A passphrase
  // gate or an expiry means the answer depends on who asks and when.
  const cacheable = doc.visibility === "public" && !doc.sharePassHash && !doc.shareExpiresAt;
  return new Response(shell(doc), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nothing published here should be indexed under this domain.
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": cacheable ? "public, max-age=0, must-revalidate" : "private, no-store",
    },
  });
}

export async function GET(request, { params }) {
  const { slug } = await params;
  const col = await artifacts();
  // A trashed artifact does not open for anyone, its owner included: deleting
  // is how a link handed out by mistake gets closed.
  const doc = await col.findOne({ slug, deletedAt: null });
  if (!doc) return notFound(request);

  const now = new Date();
  const isPublic = doc.visibility === "public";
  const isExpired = isPublic && hasExpired(doc, now);
  const gated = isPublic && Boolean(doc.sharePassHash);

  // The owner always gets straight through, whatever the link's state. The
  // lookup is skipped for a plain public page so those stay cheap.
  if (!isPublic || isExpired || gated) {
    const viewer = await viewerId(request);
    const owner = viewer && viewer === doc.userId;
    if (!owner) {
      if (!isPublic) return notFound(request);
      if (isExpired) return expired(request);
      if (!grantMatches(readGrant(request), slug, doc.sharePassHash)) {
        return askPassphrase(request, doc);
      }
    }
  }

  return serve(doc);
}

// The passphrase form posts back here. Wrong answers are counted per address
// and per artifact, so neither one machine nor a crowd of them can grind
// through a word list against a link that was meant for one client.
export async function POST(request, { params }) {
  const { slug } = await params;
  const col = await artifacts();
  const doc = await col.findOne({ slug, deletedAt: null });
  if (!doc || doc.visibility !== "public") return notFound(request);

  const now = new Date();
  if (hasExpired(doc, now)) return expired(request);
  if (!doc.sharePassHash) {
    // Nothing to answer; the page opens on its own.
    return Response.redirect(request.url, 303);
  }

  const contentType = request.headers.get("content-type") || "";
  const asJson = contentType.includes("application/json");
  let passphrase = "";
  try {
    if (asJson) {
      const body = await request.json();
      passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
    } else {
      const form = await request.formData();
      passphrase = String(form.get("passphrase") ?? "");
    }
  } catch {
    passphrase = "";
  }

  const ip = clientIp(request);
  const limited = await Promise.all([
    tooManyAttempts(`share:ip:${ip}:${slug}`, { limit: 10, windowSeconds: 900 }),
    tooManyAttempts(`share:slug:${slug}`, { limit: 200, windowSeconds: 3600 }),
  ]);
  if (limited.some(Boolean)) {
    return askPassphrase(request, doc, {
      status: 429,
      error: "Too many tries — wait a few minutes and try again.",
    });
  }

  const ok = passphrase ? await verifyPassword(passphrase, doc.sharePassHash) : false;
  if (!ok) {
    return askPassphrase(request, doc, { error: "That passphrase is not right." });
  }

  await clearAttempts(`share:ip:${ip}:${slug}`);
  const cookie = grantCookie(slug, doc.sharePassHash, doc, now);

  if (asJson) {
    return Response.json(
      { ok: true, url: request.url },
      { headers: { "Set-Cookie": cookie, "Cache-Control": "private, no-store" } }
    );
  }

  // Redirect rather than render, so a reload of the artifact doesn't re-submit
  // the passphrase.
  return new Response(null, {
    status: 303,
    headers: {
      Location: request.url,
      "Set-Cookie": cookie,
      "Cache-Control": "private, no-store",
    },
  });
}
