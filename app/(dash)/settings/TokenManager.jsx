"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Confirm from "../Confirm";

function when(iso) {
  if (!iso) return "never used";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default function TokenManager({ tokens, site }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(null); // the one time a token is visible
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(null);

  async function create(e) {
    e.preventDefault();
    const name = label.trim();
    if (!name) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      setFresh(data.token);
      setLabel("");
      setCopied(false);
      router.refresh();
    } catch {
      setError("network error — nothing was created");
    } finally {
      setPending(false);
    }
  }

  async function revoke(token) {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/tokens/${token.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      if (fresh?.id === token.id) setFresh(null);
      setConfirming(null);
      router.refresh();
    } catch {
      setError("network error — nothing was changed");
    } finally {
      setPending(false);
    }
  }

  const config = fresh
    ? JSON.stringify({ site, token: fresh.secret }, null, 2)
    : null;

  return (
    <section className="tokens">
      <form className="tokenform" onSubmit={create}>
        <input
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What is this token for? e.g. Work laptop"
          aria-label="Token name"
        />
        <button type="submit" disabled={pending || !label.trim()}>
          Create token
        </button>
      </form>

      {error && <p className="naverror" role="alert">{error}</p>}

      {fresh && (
        <div className="tokenfresh">
          <p className="tokenwarn">
            Copy this now — it is never shown again. Revoke it and make a new one
            if you lose it.
          </p>
          <code className="tokensecret">{fresh.secret}</code>
          <div className="tokenactions">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(fresh.secret);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy token"}
            </button>
            <button type="button" onClick={() => setFresh(null)}>Done</button>
          </div>
          <p className="tokenhint">
            Run <code>personal-artifact init</code> and paste it, or write{" "}
            <code>~/.artifact-publish.json</code> yourself:
          </p>
          <pre className="tokenconfig">{config}</pre>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="tokenempty">
          No tokens yet. Create one to publish from the <code>publish</code> CLI.
        </p>
      ) : (
        <ul className="tokenlist">
          {tokens.map((t) => (
            <li key={t.id}>
              <span className="tokenlabel">{t.label}</span>
              <code className="tokenprefix">{t.prefix}…</code>
              <span className="tokenmeta">
                created {when(t.createdAt)} · {t.lastUsedAt ? `last used ${when(t.lastUsedAt)}` : "never used"}
              </span>
              <button
                type="button"
                className="danger"
                disabled={pending}
                onClick={() => { setConfirming(t); setError(""); }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <Confirm
          title={`Revoke “${confirming.label}”?`}
          body="Anything still publishing with this token will start failing immediately. This cannot be undone, but you can create a new token."
          confirmLabel="Revoke token"
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => revoke(confirming)}
        />
      )}
    </section>
  );
}
