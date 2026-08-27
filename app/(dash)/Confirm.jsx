"use client";

import { useEffect, useRef, useState } from "react";

// Destructive confirmation. When `requireText` is given the confirm button
// stays disabled until the user types that exact string, so a project holding
// artifacts can't be wiped out by a stray double-click.
export default function Confirm({
  title,
  body,
  confirmLabel = "Delete",
  requireText = null,
  pending = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState("");
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ready = !pending && (!requireText || typed.trim() === requireText);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>

        {requireText && (
          <label className="confirmtype">
            <span>
              Type <b>{requireText}</b> to confirm
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              aria-label="Confirm by typing the project name"
            />
          </label>
        )}

        <div className="modal-actions">
          <button type="button" ref={cancelRef} className="btn" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={!ready}>
            {pending ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
