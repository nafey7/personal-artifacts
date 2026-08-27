"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Confirm from "./Confirm";

export default function ArtifactList({ items, projects, showProject = true }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null); // id of the row being mutated
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null);

  const names = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (d) => d.title.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)
    );
  }, [items, query]);

  async function mutate(id, options) {
    setPending(id);
    setError("");
    try {
      const res = await fetch(`/api/artifacts/${id}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("network error — nothing was changed");
      return false;
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <div className="listhead">
        <h2>
          {visible.length}
          {visible.length !== items.length ? ` of ${items.length}` : ""} shown
        </h2>
        <div className="search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or slug"
            aria-label="Filter artifacts"
          />
        </div>
      </div>

      {error && <p className="naverror" role="alert">{error}</p>}

      {visible.length === 0 ? (
        <div className="empty">
          <p>{query ? `No artifact matches “${query}”.` : "Nothing here yet."}</p>
          {!query && <code>publish ./page.html &quot;Human Readable Title&quot;</code>}
        </div>
      ) : (
        <div className="rows">
          {visible.map((d) => (
            <div className={`row${pending === d.id ? " is-pending" : ""}`} key={d.id}>
              <a className="rowmain" href={`/a/${d.slug}`}>
                <span className="title">{d.title}</span>
                <span className="slug">/a/{d.slug}</span>
              </a>

              <time dateTime={d.iso}>{d.stamp}</time>

              {showProject && (
                <select
                  className="rowproject"
                  value={d.projectId ?? ""}
                  disabled={pending === d.id}
                  aria-label={`Project for ${d.title}`}
                  onChange={(e) =>
                    mutate(d.id, {
                      method: "PATCH",
                      body: JSON.stringify({ projectId: e.target.value || null }),
                    })
                  }
                >
                  <option value="">Unfiled</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}

              <button
                type="button"
                className="rowdelete"
                disabled={pending === d.id}
                onClick={() => { setConfirming(d); setError(""); }}
                aria-label={`Delete ${d.title}`}
                title="Delete artifact"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <Confirm
          title={`Delete “${confirming.title}”?`}
          body={`This permanently removes the artifact${
            confirming.projectId && names.has(confirming.projectId)
              ? ` from ${names.get(confirming.projectId)}`
              : ""
          }. The link /a/${confirming.slug} will stop working. This cannot be undone.`}
          confirmLabel="Delete artifact"
          pending={pending === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const ok = await mutate(confirming.id, { method: "DELETE" });
            if (ok) setConfirming(null);
          }}
        />
      )}
    </section>
  );
}
