import Link from "next/link";
import pkg from "@/cli/package.json";
import CopyCmd from "./CopyCmd";
import HeroDemo from "./HeroDemo";
import Reveal from "./Reveal";

const SITE = "https://artifacts.pallason.com";
const NPM = `https://www.npmjs.com/package/${pkg.name}`;
const REPO = pkg.homepage.replace(/#.*$/, "");

const TOOLS = ["Claude Code", "Codex", "Gemini CLI", "Cursor"];

const FEATURES = [
  {
    title: "Private by default",
    body: "A new artifact is yours alone. Nobody else can open it until you flip it to shared.",
    icon: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
  },
  {
    title: "Share on your terms",
    body: "A shared link can expire after a day or a week, and can ask strangers for a passphrase.",
    icon: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  },
  {
    title: "Projects",
    body: "File artifacts into folders per client or topic. Your agent can pick the folder when it publishes.",
    icon: "M4 7h6l2 2h8v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z",
  },
  {
    title: "Edit in place",
    body: "Fix a word on the page it is published at. The page never reloads, so a reader keeps their place.",
    icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  },
  {
    title: "A trash that forgives",
    body: "A deleted artifact waits seven days before it is really gone. Restore it with one click.",
    icon: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13",
  },
  {
    title: "An API for agents",
    body: "Everything on the screen has a JSON endpoint behind a token, so a tool can list, publish and edit too.",
    icon: "M8 9l-4 3 4 3M16 9l4 3-4 3M13 5l-2 14",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Install once",
    body: "Run one command on your computer. It signs you in through the browser and teaches every AI tool you have how to publish. You never type another command.",
    cmd: `npm install -g ${pkg.name} && personal-artifact`,
  },
  {
    n: "02",
    title: "Ask your AI tool",
    body: "In Claude Code, Cursor, Codex or Gemini CLI, say what you want as a personal artifact: an architecture diagram, a dashboard, a memo. The tool builds the page and publishes it for you.",
    quote: "Make a personal artifact of the architecture diagram for our SaaS.",
  },
  {
    n: "03",
    title: "Click the link",
    body: "The tool replies with a link. Open it to see the page, file it into a project, share it with an expiry or a passphrase, or edit it in place.",
    link: `${SITE}/a/saas-architecture`,
  },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#site`,
      url: SITE,
      name: "Artifacts",
      description:
        "One private home for the HTML artifacts that AI coding tools produce. Publish from Claude Code, Codex, Gemini CLI or Cursor with one command.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#app`,
      name: "Artifacts",
      url: SITE,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description:
        "Store and share the reports, dashboards and pages your AI tools make, in one private place of your own.",
      softwareHelp: `${SITE}/llms.txt`,
      isRelatedTo: { "@id": `${SITE}/#cli` },
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${SITE}/#cli`,
      name: pkg.name,
      version: pkg.version,
      codeRepository: REPO,
      programmingLanguage: "JavaScript",
      runtimePlatform: "Node.js >= 18",
      license: "https://opensource.org/license/mit",
      installUrl: NPM,
      description: pkg.description,
    },
  ],
};

export default function Landing() {
  return (
    <div className="lp">
      <Reveal />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <header className="lp-nav">
        <Link href="/" className="brand" aria-label="Artifacts home">
          <span className="mark" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 21 8v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5" />
            </svg>
          </span>
          <span className="name">Artifacts</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href={NPM} rel="noopener">npm</a>
          <Link href="/signin" className="lp-nav-signin">Sign in</Link>
          <Link href="/signup" className="lp-btn lp-btn-primary lp-btn-sm">Get started</Link>
        </nav>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">For people who use more than one AI tool</p>
            <h1 id="hero-title">
              Every artifact your AI tools make, <em>in one private place.</em>
            </h1>
            <p className="lp-lede">
              Claude Code, Codex, Gemini CLI and Cursor all leave reports, dashboards and one-pagers behind.
              Artifacts gives them one home: a site of your own, private by default, shareable when you choose.
            </p>
            <div className="lp-cta">
              <Link href="/signup" className="lp-btn lp-btn-primary">
                Create a free account
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
              <Link href="/signin" className="lp-btn lp-btn-ghost">Sign in</Link>
            </div>
            <div className="lp-hero-install">
              <span>Already have an account? Install once, then ask any tool:</span>
              <CopyCmd cmd={`npm install -g ${pkg.name}`} />
            </div>
          </div>
          <div className="lp-hero-demo">
            <HeroDemo />
            <p className="lp-visually-hidden">
              Animation: someone asks their AI coding tool for a personal artifact, the tool replies with a link, and clicking it opens the published page.
            </p>
          </div>
        </section>

        <section className="lp-tools" aria-label="Works with" data-reveal>
          <p className="lp-tools-label">Publishes from</p>
          <ul className="lp-tools-list">
            {TOOLS.map((t) => (
              <li key={t}>{t}</li>
            ))}
            <li className="lp-tools-more">and any tool that can run a command</li>
          </ul>
        </section>

        <section className="lp-section lp-why" aria-labelledby="why-title" data-reveal>
          <div className="lp-section-head">
            <p className="lp-eyebrow">Why</p>
            <h2 id="why-title">The pages pile up. The links get lost.</h2>
          </div>
          <div className="lp-why-grid">
            <p>
              Agents are good at making self-contained HTML: a load test write-up, a chart of last week's numbers,
              a memo for a client. Each tool leaves those files in a different folder, and the good ones are
              gone by the time someone asks for them.
            </p>
            <p>
              Artifacts is one place they all publish to. Your own account, your own list, a real URL for each
              page. A team that shares AI tools gets a private shelf instead of a pile of attachments.
            </p>
          </div>
        </section>

        <section className="lp-section" id="how" aria-labelledby="how-title" data-reveal>
          <div className="lp-section-head">
            <p className="lp-eyebrow">How it works</p>
            <h2 id="how-title">Install once. Then just ask.</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="lp-step">
                <span className="lp-step-n" aria-hidden="true">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.cmd ? <CopyCmd cmd={s.cmd} /> : null}
                {s.quote ? <blockquote className="lp-step-quote">“{s.quote}”</blockquote> : null}
                {s.link ? <span className="lp-step-link">{s.link}</span> : null}
              </li>
            ))}
          </ol>
          <p className="lp-note">
            Needs Node.js 18 or newer. Prefer the command line? <code>artifact-publish ./page.html "Title"</code> publishes any HTML file by hand.
          </p>
        </section>

        <section className="lp-section" id="features" aria-labelledby="features-title" data-reveal>
          <div className="lp-section-head">
            <p className="lp-eyebrow">What you get</p>
            <h2 id="features-title">Built for keeping, not just hosting.</h2>
          </div>
          <ul className="lp-features">
            {FEATURES.map((f) => (
              <li key={f.title} className="lp-feature">
                <span className="lp-feature-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon} /></svg>
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-section lp-pkg" id="npm" aria-labelledby="pkg-title" data-reveal>
          <div className="lp-pkg-card">
            <div className="lp-pkg-main">
              <p className="lp-eyebrow">Open source, on npm</p>
              <h2 id="pkg-title">
                <code>{pkg.name}</code>
                <span className="lp-pkg-version">v{pkg.version}</span>
              </h2>
              <p>{pkg.description} MIT licensed. Run it, read it, or host your own copy.</p>
              <div className="lp-cta">
                <a href={NPM} className="lp-btn lp-btn-primary" rel="noopener">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 2h20v20H2zm4 4v12h6v-9h3v9h3V6z" /></svg>
                  View on npm
                </a>
                <a href={REPO} className="lp-btn lp-btn-ghost" rel="noopener">Source on GitHub</a>
              </div>
            </div>
            <dl className="lp-pkg-facts">
              <div><dt>Installs</dt><dd><code>personal-artifact</code>, <code>artifact-publish</code></dd></div>
              <div><dt>Skills for</dt><dd>{TOOLS.join(", ")}</dd></div>
              <div><dt>Runs on</dt><dd>Node.js 18+ on macOS, Linux, Windows</dd></div>
              <div><dt>Hosting</dt><dd>Free tier of Vercel and MongoDB Atlas</dd></div>
            </dl>
          </div>
        </section>

        <section className="lp-section lp-agents" id="for-agents" aria-labelledby="agents-title" data-reveal>
          <div className="lp-section-head">
            <p className="lp-eyebrow">Reading this as an agent?</p>
            <h2 id="agents-title">The whole site is an API.</h2>
          </div>
          <div className="lp-agents-grid">
            <div>
              <p>
                Tokens are issued at <code>/settings</code>. Send one as a bearer token and every screen has a
                matching endpoint: publish, list, edit, file into a project, share, restore from the trash.
                The short version lives at <a href="/llms.txt">/llms.txt</a>.
              </p>
              <ul className="lp-endpoints">
                <li><code>POST /api/upload</code> <span>publish {"{ title, html, project?, visibility? }"}</span></li>
                <li><code>GET /api/artifacts</code> <span>list, newest first</span></li>
                <li><code>PATCH /api/artifacts/[id]</code> <span>edit, share, expire, restore</span></li>
                <li><code>GET|POST /api/projects</code> <span>list or make a folder</span></li>
              </ul>
            </div>
            <pre className="lp-code"><code>{`curl -X POST ${SITE}/api/upload \\
  -H "Authorization: Bearer $ARTIFACT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Load test report","html":"<!doctype html>…"}'`}</code></pre>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="final-title" data-reveal>
          <h2 id="final-title">Give your artifacts a home.</h2>
          <p>Free to use. One command to connect. Every tool you already have.</p>
          <div className="lp-cta lp-cta-center">
            <Link href="/signup" className="lp-btn lp-btn-primary lp-btn-lg">Create a free account</Link>
            <Link href="/signin" className="lp-btn lp-btn-ghost lp-btn-lg">Sign in</Link>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span>Artifacts by Pallason</span>
        <nav aria-label="Footer">
          <a href={NPM} rel="noopener">npm</a>
          <a href={REPO} rel="noopener">GitHub</a>
          <a href="/llms.txt">llms.txt</a>
          <Link href="/signin">Sign in</Link>
          <Link href="/signup">Sign up</Link>
        </nav>
      </footer>
    </div>
  );
}
