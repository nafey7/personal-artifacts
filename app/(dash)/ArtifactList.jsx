"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as crypto from "@/cli/crypto";
import { requestAccountKey } from "@/lib/account-key";
import Confirm from "./Confirm";
import ShareDialog from "./ShareDialog";

// "6d", "23h", "40m" — how long a shared link has left. Coarse on purpose:
// the exact instant is in the share sheet.
function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "0m";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function LockIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function shareTitle(d) {
  if (!d.isPublic) return "Only you can open this. Click to share the link.";
  if (d.isExpired) return "This link has expired. Click to share it again.";
  const parts = ["Anyone with the link can open this"];
  if (d.hasPassphrase) parts.push("after typing the passphrase");
  if (d.expiresStamp) parts.push(`until ${d.expiresStamp} UTC`);
  return `${parts.join(" ")}. Click to change.`;
}

export default function ArtifactList({ items, projects, showProject = true }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null); // id of the row being mutated
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [encrypting, setEncrypting] = useState(null); // row waiting for "Encrypt this" to be confirmed

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

  async function patch(id, body) {
    return mutate(id, { method: "PATCH", body: JSON.stringify(body) });
  }

  // Turns a plain artifact into an encrypted one, here in the browser: a new
  // key for the page, the page sealed under it, the key sealed under the
  // account key, and only those sent. One way — the CLI can `get` it and
  // publish it back plain if that is ever wanted. A passphrase the link had
  // cannot be carried over (the site holds only its hash), so it is cleared
  // and the share sheet asks for it again.
  async function encrypt(d) {
    setPending(d.id);
    setError("");
    try {
      const account = await requestAccountKey();
      if (!account) {
        setError("Unlock your encryption key first — nothing was changed.");
        return false;
      }
      const res = await fetch(`/api/artifacts/${d.id}`, { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return false;
      }
      const artKey = await crypto.newKey();
      const [blob, artKeyWrapped] = await Promise.all([
        crypto.encrypt(data.artifact.html, artKey),
        crypto.wrap(artKey, account),
      ]);
      const body = { enc: 1, html: blob.ct, iv: blob.iv, artKeyWrapped };
      if (d.hasPassphrase) body.passphrase = null;
      return await patch(d.id, body);
    } catch (err) {
      setError(err?.message ? `could not encrypt — ${err.message}` : "could not encrypt");
      return false;
    } finally {
      setPending(null);
    }
  }

  // A new key for an artifact that already has one. Whoever holds an old link
  // holds the old key, so this is how a keyed link is revoked.
  async function reencrypt(d, oldKey) {
    setPending(d.id);
    setError("");
    try {
      const account = await requestAccountKey();
      if (!account) {
        setError("Unlock your encryption key first — nothing was changed.");
        return false;
      }
      const res = await fetch(`/api/artifacts/${d.id}`, { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return false;
      }
      const a = data.artifact;
      const html = await crypto.decrypt({ v: 1, iv: a.iv, ct: a.html }, oldKey);
      const artKey = await crypto.newKey();
      const [blob, artKeyWrapped] = await Promise.all([
        crypto.encrypt(html, artKey),
        crypto.wrap(artKey, account),
      ]);
      const body = { enc: 1, html: blob.ct, iv: blob.iv, artKeyWrapped, artKeyByPassphrase: null };
      if (d.hasPassphrase) body.passphrase = null;
      return await patch(d.id, body);
    } catch (err) {
      setError(err?.message ? `could not re-encrypt — ${err.message}` : "could not re-encrypt");
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

      {error && !sharing && <p className="naverror" role="alert">{error}</p>}

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
                {d.encrypted && (
                  <span className="rowenc" title="Encrypted end to end: the site stores only ciphertext">
                    <LockIcon />
                  </span>
                )}
                <span className="title">{d.title}</span>
              </a>

              <time dateTime={d.iso}>{d.stamp}</time>

              <button
                type="button"
                className={`rowshare${d.isPublic && !d.isExpired ? " is-public" : ""}${d.isExpired ? " is-expired" : ""}`}
                disabled={pending === d.id}
                onClick={() => { setSharing(d); setError(""); }}
                title={shareTitle(d)}
                aria-label={`Sharing for ${d.title}`}
              >
                {d.isPublic && !d.isExpired && d.hasPassphrase && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                )}
                {!d.isPublic ? "Private" : d.isExpired ? "Expired" : "Shared"}
                {d.isPublic && !d.isExpired && d.expiresAt && (
                  <span className="left" suppressHydrationWarning>{timeLeft(d.expiresAt)}</span>
                )}
              </button>

              {showProject && (
                <select
                  className="rowproject"
                  value={d.projectId ?? ""}
                  disabled={pending === d.id}
                  aria-label={`Project for ${d.title}`}
                  onChange={(e) => patch(d.id, { projectId: e.target.value || null })}
                >
                  <option value="">Unfiled</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}

              {!d.encrypted && (
                <button
                  type="button"
                  className="rowlock"
                  disabled={pending === d.id}
                  onClick={() => { setEncrypting(d); setError(""); }}
                  aria-label={`Encrypt ${d.title}`}
                  title="Encrypt this artifact end to end"
                >
                  <LockIcon size={14} />
                </button>
              )}

              <a
                className="rowedit"
                href={`/a/${d.slug}?edit=1`}
                aria-label={`Edit ${d.title}`}
                title="Edit the text"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
                  <path d="M14.5 6.5l3 3" />
                </svg>
              </a>

              <button
                type="button"
                className="rowdelete"
                disabled={pending === d.id}
                onClick={() => { setConfirming(d); setError(""); }}
                aria-label={`Delete ${d.title}`}
                title="Move to trash"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {sharing && (
        <ShareDialog
          artifact={sharing}
          pending={pending === sharing.id}
          error={error}
          onCancel={() => { setSharing(null); setError(""); }}
          onSave={async (body) => {
            const ok = await patch(sharing.id, body);
            if (ok) setSharing(null);
          }}
          onStop={async () => {
            const ok = await patch(sharing.id, { visibility: "private" });
            if (ok) setSharing(null);
          }}
          onReencrypt={async (oldKey) => {
            const ok = await reencrypt(sharing, oldKey);
            if (ok) setSharing(null);
          }}
        />
      )}

      {encrypting && (
        <Confirm
          title={`Encrypt “${encrypting.title}”?`}
          body={`The page is encrypted here in your browser with a key of its own, and only ciphertext is kept on the site — nobody who runs it can read the page. You open it as usual; sharing it hands out a link that carries the key.${
            encrypting.hasPassphrase
              ? " The passphrase on its link cannot be carried over and is removed; set it again from the share sheet."
              : ""
          } This cannot be undone from the dashboard.`}
          confirmLabel="Encrypt"
          pendingLabel="Encrypting…"
          pending={pending === encrypting.id}
          onCancel={() => setEncrypting(null)}
          onConfirm={async () => {
            const ok = await encrypt(encrypting);
            if (ok) setEncrypting(null);
          }}
        />
      )}

      {confirming && (
        <Confirm
          title={`Delete “${confirming.title}”?`}
          body={`This moves the artifact${
            confirming.projectId && names.has(confirming.projectId)
              ? ` out of ${names.get(confirming.projectId)}`
              : ""
          } to the trash. The link /a/${confirming.slug} stops working right away; you can restore it from the trash for the next few days, after which it goes for good.`}
          confirmLabel="Move to trash"
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
