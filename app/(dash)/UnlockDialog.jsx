"use client";

import { useEffect, useRef, useState } from "react";
import { registerUnlockPrompt, unlockWithPassword } from "@/lib/account-key";

// The one place the dashboard asks for the password again: a browser that has
// a session but no account key in its store. It stays out of the way until
// something needs the key — sharing an encrypted artifact, encrypting one,
// opening one — and then asks once. The password is used to unwrap the key
// locally and is never sent.
//
// Mounted once by the dashboard layout; anything that needs the key calls
// requestAccountKey() from lib/account-key.js and this appears if it must.
export default function UnlockDialog({ user }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const settle = useRef(null);
  const field = useRef(null);

  useEffect(() => {
    return registerUnlockPrompt(
      () =>
        new Promise((resolve) => {
          settle.current = resolve;
          setPassword("");
          setError("");
          setOpen(true);
        })
    );
  }, []);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function finish(key) {
    setOpen(false);
    const resolve = settle.current;
    settle.current = null;
    resolve?.(key);
  }

  async function submit(e) {
    e.preventDefault();
    if (!password) return;
    setPending(true);
    setError("");
    try {
      const { key } = await unlockWithPassword(user.email, password);
      finish(key);
    } catch (err) {
      setError(err.message || "could not unlock");
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !pending && finish(null)}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title" onSubmit={submit}>
        <h2 id="unlock-title">Unlock your encryption key</h2>
        <p>
          This browser does not have your key yet. Your password opens it here, on this
          device — it is not sent anywhere.
        </p>
        <label className="authfield unlockfield">
          <span>Password</span>
          <input
            ref={field}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
        </label>
        {error && <p className="naverror" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => finish(null)} disabled={pending}>
            Not now
          </button>
          <button type="submit" className="btn btn-accent" disabled={pending || !password}>
            {pending ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
