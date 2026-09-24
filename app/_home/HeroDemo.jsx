"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// The hero's moving picture. Someone asks their coding tool for an artifact,
// the tool answers with a link, a pointer clicks it, and the page opens beside
// the chat. No command is ever shown: that is the point. It loops through a
// few tools so "any tool, one place" lands. With reduced motion it sits still
// on the finished state.
const RUNS = [
  {
    tool: "Claude Code",
    ask: "Make a personal artifact of the architecture diagram for our SaaS.",
    work: "Drawing the diagram, publishing…",
    reply: "Done. Here it is:",
    slug: "saas-architecture",
    title: "SaaS architecture",
    kind: "diagram",
  },
  {
    tool: "Cursor",
    ask: "Publish a dashboard of last week's signups as a personal artifact.",
    work: "Charting seven days, publishing…",
    reply: "Published. Open it here:",
    slug: "signups-last-week",
    title: "Signups, last week",
    kind: "chart",
  },
  {
    tool: "Gemini CLI",
    ask: "Turn these release notes into a personal artifact I can share.",
    work: "Laying out the notes, publishing…",
    reply: "Ready to share:",
    slug: "release-notes-v1-6",
    title: "Release notes v1.6",
    kind: "doc",
  },
];

const SITE = "artifacts.pallason.com";

function wait(ms, timers) {
  return new Promise((resolve) => timers.current.push(setTimeout(resolve, ms)));
}

export default function HeroDemo() {
  const [run, setRun] = useState(RUNS[0]);
  const [typed, setTyped] = useState("");
  // typing → thinking → reply → click → open
  const [phase, setPhase] = useState("typing");
  const [still, setStill] = useState(false);
  const [pointer, setPointer] = useState(null);
  const timers = useRef([]);
  const box = useRef(null);
  const link = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      setTyped(RUNS[0].ask);
      setPhase("open");
      return;
    }
    let alive = true;
    const t = timers;

    async function loop() {
      let i = 0;
      await wait(600, t);
      while (alive) {
        const r = RUNS[i % RUNS.length];
        setRun(r);
        setTyped("");
        setPointer(null);
        setPhase("typing");
        for (let n = 1; n <= r.ask.length && alive; n++) {
          setTyped(r.ask.slice(0, n));
          await wait(r.ask[n - 1] === " " ? 55 : 22 + Math.random() * 26, t);
        }
        await wait(500, t);
        setPhase("thinking");
        await wait(1500, t);
        setPhase("reply");
        await wait(1100, t);
        setPhase("click");
        await wait(900, t);
        setPhase("open");
        await wait(4200, t);
        i += 1;
      }
    }
    loop();
    return () => {
      alive = false;
      t.current.forEach(clearTimeout);
      t.current = [];
    };
  }, []);

  // When it is time to click, aim the pointer at the link's real position.
  useLayoutEffect(() => {
    if (phase !== "click" || !box.current || !link.current) return;
    const b = box.current.getBoundingClientRect();
    const l = link.current.getBoundingClientRect();
    setPointer({ x: l.left - b.left + Math.min(l.width * 0.4, 90), y: l.top - b.top + l.height * 0.6 });
  }, [phase]);

  const replied = phase === "reply" || phase === "click" || phase === "open";
  const open = phase === "open";

  return (
    <div className={`lp-demo${still ? " is-still" : ""}${open ? " is-open" : ""}`} ref={box} aria-hidden="true">
      <div className="lp-chat">
        <div className="lp-chat-bar">
          <span /><span /><span />
          <em>{run.tool}</em>
        </div>
        <div className="lp-chat-body">
          <div className="lp-msg lp-msg-user">
            <span className="lp-msg-who">You</span>
            <p>
              {typed}
              {phase === "typing" ? <span className="lp-caret" /> : null}
            </p>
          </div>

          {phase === "thinking" ? (
            <div className="lp-msg lp-msg-ai">
              <span className="lp-msg-who">{run.tool}</span>
              <p className="lp-msg-work">
                <span className="lp-dots"><i /><i /><i /></span>
                {run.work}
              </p>
            </div>
          ) : null}

          {replied ? (
            <div className="lp-msg lp-msg-ai">
              <span className="lp-msg-who">{run.tool}</span>
              <p>
                {run.reply}
                <br />
                <a
                  ref={link}
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className={`lp-msg-link${phase === "click" ? " is-pressed" : ""}${open ? " is-visited" : ""}`}
                >
                  {SITE}/a/{run.slug}
                </a>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`lp-artifact${open ? " is-open" : ""}`}>
        <div className="lp-artifact-bar">
          <span className="lp-artifact-nav">‹ ›</span>
          <span className="lp-artifact-url">{SITE}/a/{run.slug}</span>
          <span className="lp-chip">Private</span>
        </div>
        <div className="lp-artifact-body">
          <div className="lp-artifact-head">
            <div className="lp-artifact-title">{run.title}</div>
            <div className="lp-artifact-by">Published from {run.tool} · just now</div>
          </div>
          <div className="lp-preview-slot">{open ? <Preview kind={run.kind} /> : null}</div>
        </div>
      </div>

      {pointer && !open ? (
        <svg
          className="lp-pointer"
          style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}
          width="20" height="20" viewBox="0 0 24 24" fill="#E9EFEC" stroke="#0C1413" strokeWidth="1.4"
        >
          <path d="M5 3l14 8-6 1.5L17 20l-3 1.5-4-7.5L5 19z" />
        </svg>
      ) : null}
      {open ? (
        <svg
          className="lp-pointer is-clicked"
          style={{ transform: `translate(${pointer?.x ?? 0}px, ${pointer?.y ?? 0}px)` }}
          width="20" height="20" viewBox="0 0 24 24" fill="#E9EFEC" stroke="#0C1413" strokeWidth="1.4"
        >
          <path d="M5 3l14 8-6 1.5L17 20l-3 1.5-4-7.5L5 19z" />
        </svg>
      ) : null}
    </div>
  );
}

// The artifact's contents: a small page that builds itself when the card
// opens. One per kind, all inline SVG in the site's own palette, sized to a
// 320 by 200 canvas so the card keeps one height.
const W = 320;
const H = 200;

function Preview({ kind }) {
  if (kind === "chart") return <ChartPage />;
  if (kind === "doc") return <DocPage />;
  return <DiagramPage />;
}

function DiagramPage() {
  const cols = [
    { label: "Clients", x: 8, nodes: ["Web app", "Mobile", "CLI"] },
    { label: "Services", x: 122, nodes: ["API", "Auth", "Worker"] },
    { label: "Data", x: 236, nodes: ["Postgres", "Queue", "Object store"] },
  ];
  const NW = 76, NH = 24, Y0 = 34, GAP = 40;
  const at = (c, r) => ({ x: cols[c].x, y: Y0 + r * GAP });
  const mid = (c, r) => ({ x: at(c, r).x + NW / 2, y: at(c, r).y + NH / 2 });
  const edges = [
    { from: mid(0, 0), to: mid(1, 0), label: "HTTPS" },
    { from: mid(0, 1), to: mid(1, 0) },
    { from: mid(0, 2), to: mid(1, 0) },
    { from: mid(1, 0), to: mid(1, 1), vertical: true },
    { from: mid(1, 0), to: mid(2, 0) },
    { from: mid(1, 0), to: mid(2, 1), label: "jobs", dashed: true, lx: 214, ly: 98 },
    { from: mid(2, 1), to: mid(1, 2), dashed: true },
    { from: mid(1, 2), to: mid(2, 2) },
  ];
  function path(e) {
    if (e.vertical) return `M${e.from.x} ${e.from.y + NH / 2} V${e.to.y - NH / 2}`;
    const x1 = e.from.x + NW / 2, x2 = e.to.x - NW / 2;
    if (x2 < x1) {
      const a = e.from.x - NW / 2, b = e.to.x + NW / 2;
      return `M${a} ${e.from.y} C${a - 18} ${e.from.y} ${b + 18} ${e.to.y} ${b} ${e.to.y}`;
    }
    return `M${x1} ${e.from.y} C${x1 + 18} ${e.from.y} ${x2 - 18} ${e.to.y} ${x2} ${e.to.y}`;
  }
  return (
    <svg className="lp-preview" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <marker id="lp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L8 4 0 8z" className="lp-arrowhead" />
        </marker>
      </defs>
      {cols.map((c, i) => (
        <text key={c.label} x={c.x} y={22} className="lp-tier" style={{ "--d": `${i * 120}ms` }}>{c.label.toUpperCase()}</text>
      ))}
      {edges.map((e, i) => (
        <g key={i} className="lp-edge-g" style={{ "--d": `${420 + i * 110}ms` }}>
          <path d={path(e)} className={`lp-edge${e.dashed ? " is-dashed" : ""}`} markerEnd="url(#lp-arrow)" />
          {e.label ? (
            <text x={e.lx ?? (e.from.x + e.to.x) / 2} y={e.ly ?? (e.from.y + e.to.y) / 2 - 4} className="lp-edge-label" textAnchor="middle">{e.label}</text>
          ) : null}
        </g>
      ))}
      {cols.map((c, ci) =>
        c.nodes.map((n, r) => {
          const p = at(ci, r);
          return (
            <g key={n} className={`lp-node${ci === 1 && r === 0 ? " is-key" : ""}`} style={{ "--d": `${ci * 140 + r * 60}ms` }}>
              <rect x={p.x} y={p.y} width={NW} height={NH} rx="5" />
              <circle cx={p.x + 11} cy={p.y + 12} r="3" />
              <text x={p.x + 20} y={p.y + 15.5}>{n}</text>
            </g>
          );
        }),
      )}
      <g className="lp-legend" style={{ "--d": "1300ms" }}>
        <line x1={8} y1={186} x2={26} y2={186} className="lp-edge" />
        <text x={31} y={189} className="lp-edge-label">request</text>
        <line x1={78} y1={186} x2={96} y2={186} className="lp-edge is-dashed" />
        <text x={101} y={189} className="lp-edge-label">async</text>
      </g>
    </svg>
  );
}

function ChartPage() {
  const tiles = [
    { label: "Signups", value: "1,284", delta: "+18%" },
    { label: "Conversion", value: "4.2%", delta: "+0.6" },
    { label: "Trials", value: "312", delta: "+41" },
  ];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const vals = [142, 168, 151, 203, 189, 219, 212];
  const max = 240, top = 78, base = 168, x0 = 30, step = 41, bw = 26;
  const best = vals.indexOf(Math.max(...vals));
  const avgY = base - (150 / max) * (base - top);
  return (
    <svg className="lp-preview" viewBox={`0 0 ${W} ${H}`}>
      {tiles.map((t, i) => (
        <g key={t.label} className="lp-tile" style={{ "--d": `${i * 100}ms` }}>
          <rect x={8 + i * 104} y={6} width={96} height={52} rx="6" />
          <text x={18 + i * 104} y={22} className="lp-tile-label">{t.label.toUpperCase()}</text>
          <text x={18 + i * 104} y={46} className="lp-tile-value">{t.value}</text>
          <text x={96 + i * 104} y={46} className="lp-tile-delta" textAnchor="end">{t.delta}</text>
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={x0 - 14} x2={W - 8} y1={base - (i * (base - top)) / 3} y2={base - (i * (base - top)) / 3} className="lp-grid" />
      ))}
      <line x1={x0 - 14} x2={W - 8} y1={avgY} y2={avgY} className="lp-avg" style={{ "--d": "900ms" }} />
      <text x={x0 - 14} y={avgY - 4} className="lp-edge-label" style={{ "--d": "900ms" }}>last week avg</text>
      {vals.map((v, i) => {
        const h = (v / max) * (base - top);
        return (
          <g key={i} style={{ "--d": `${350 + i * 80}ms` }}>
            <rect className={`lp-bar${i === best ? " is-best" : ""}`} x={x0 + i * step} y={base - h} width={bw} height={h} rx="4" style={{ "--d": `${350 + i * 80}ms` }} />
            <text x={x0 + i * step + bw / 2} y={base + 14} className="lp-axis-label" textAnchor="middle">{days[i]}</text>
            {i === best ? (
              <g className="lp-callout" style={{ "--d": "1100ms" }}>
                <rect x={x0 + i * step - 6} y={base - h - 22} width={38} height={16} rx="4" />
                <text x={x0 + i * step + 13} y={base - h - 10.5} textAnchor="middle">{v}</text>
              </g>
            ) : null}
          </g>
        );
      })}
      <line x1={x0 - 14} y1={base} x2={W - 8} y2={base} className="lp-axis" />
    </svg>
  );
}

function DocPage() {
  const blocks = [
    { kind: "h", w: 88, y: 12, text: "v1.6.1 · 24 September 2026" },
    { kind: "s", y: 40, text: "Added" },
    { kind: "b", y: 56, w: 200 },
    { kind: "b", y: 68, w: 168 },
    { kind: "b", y: 80, w: 214 },
    { kind: "s", y: 106, text: "Fixed" },
    { kind: "b", y: 122, w: 178 },
    { kind: "b", y: 134, w: 142 },
    { kind: "s", y: 160, text: "Upgrading" },
    { kind: "b", y: 176, w: 196 },
  ];
  return (
    <svg className="lp-preview" viewBox={`0 0 ${W} ${H}`}>
      <g className="lp-doc-btn" style={{ "--d": "700ms" }}>
        <rect x={W - 78} y={6} width={70} height={20} rx="5" />
        <text x={W - 43} y={19.5} textAnchor="middle">Copy link</text>
      </g>
      {blocks.map((b, i) => {
        const d = `${i * 70}ms`;
        if (b.kind === "h") return <text key={i} x={10} y={b.y + 8} className="lp-doc-meta" style={{ "--d": d }}>{b.text}</text>;
        if (b.kind === "s") return <text key={i} x={10} y={b.y + 6} className="lp-doc-h" style={{ "--d": d }}>{b.text}</text>;
        return (
          <g key={i} className="lp-line" style={{ "--d": d }}>
            <circle cx={14} cy={b.y + 3} r="1.6" />
            <rect x={22} y={b.y} width={b.w} height="6" rx="3" />
          </g>
        );
      })}
    </svg>
  );
}
