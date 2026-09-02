"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Confirm from "../Confirm";

export default function TrashList({ items, retentionDays }) {
  const router = useRouter();
  const [pending, setPending] = useState(null); // row id, or "all" while emptying
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null); // one row, or "all"

  async function send(id, url, options) {
    setPending(id);
    setError("");
    try {
      const res = await fetch(url, options);
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

  function restore(d) {
    return send(d.id, `/api/artifacts/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: true }),
    });
  }

  return (
    <section>
      <div className="listhead">
        <h2>
          {items.length} artifact{items.length === 1 ? "" : "s"} in the trash
        </h2>
        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending !== null}
            onClick={() => { setConfirming("all"); setError(""); }}
          >
            Empty trash
          </button>
        )}
      </div>

      {error && <p className="naverror" role="alert">{error}</p>}

      {items.length === 0 ? (
        <div className="empty">
          <p>The trash is empty.</p>
        </div>
      ) : (
        <div className="rows">
          {items.map((d) => (
            <div className={`row trashrow${pending === d.id ? " is-pending" : ""}`} key={d.id}>
              <div className="rowmain">
                <span className="title">{d.title}</span>
              </div>

              <time dateTime={d.deletedIso} title={`Deleted ${d.deletedStamp} UTC`}>
                {d.deletedStamp}
              </time>

              <span
                className={`trashleft${d.daysLeft <= 1 ? " is-soon" : ""}`}
                title={`Removed for good on ${d.purgesStamp} UTC`}
              >
                {d.daysLeft === 0
                  ? "going now"
                  : `${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left`}
              </span>

              <div className="trashtools">
                <button
                  type="button"
                  className="btn"
                  disabled={pending !== null}
                  onClick={() => restore(d)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="rowdelete"
                  disabled={pending !== null}
                  onClick={() => { setConfirming(d); setError(""); }}
                  aria-label={`Delete ${d.title} for good`}
                  title="Delete for good"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirming === "all" && (
        <Confirm
          title="Empty the trash?"
          body={`This removes all ${items.length} artifact${
            items.length === 1 ? "" : "s"
          } in the trash for good, ${retentionDays}-day window and all. This cannot be undone.`}
          confirmLabel={`Delete ${items.length} artifact${items.length === 1 ? "" : "s"}`}
          requireText={items.length > 1 ? "empty trash" : null}
          pending={pending === "all"}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const ok = await send("all", "/api/trash", { method: "DELETE" });
            if (ok) setConfirming(null);
          }}
        />
      )}

      {confirming && confirming !== "all" && (
        <Confirm
          title={`Delete “${confirming.title}” for good?`}
          body={`This removes the artifact and its HTML now, rather than in ${
            confirming.daysLeft === 1 ? "a day" : `${confirming.daysLeft} days`
          }. This cannot be undone.`}
          confirmLabel="Delete for good"
          pending={pending === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const ok = await send(
              confirming.id,
              `/api/artifacts/${confirming.id}?permanent=1`,
              { method: "DELETE" }
            );
            if (ok) setConfirming(null);
          }}
        />
      )}
    </section>
  );
}
