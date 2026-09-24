"use client";

import { useEffect, useRef, useState } from "react";
import * as crypto from "@/cli/crypto";
import { requestAccountKey } from "@/lib/account-key";

// How long a link stays open. "keep" is only offered when the link already
// has an expiry and is still live; "custom" reveals a date picker.
const EXPIRY_CHOICES = [
  { value: "never", label: "Never" },
  { value: "1d", label: "In 24 hours" },
  { value: "7d", label: "In 7 days" },
  { value: "30d", label: "In 30 days" },
  { value: "custom", label: "On a date…" },
];

const MIN_PASSPHRASE = 4;

// Local "YYYY-MM-DDTHH:MM" for a datetime-local input's default: a week out,
// on the hour, so the picker opens on something sensible.
function defaultCustomDate() {
  const d = new Date(Date.now() + 7 * 86400_000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The share sheet for one artifact. It always saves the link as shared; the
// only way out of sharing is the explicit "Stop sharing" button, so a slip of
// the mouse can't close a link a client is looking at.
//
// For an encrypted artifact the link has to carry the key, after the #, or
// the reader gets ciphertext. The key is unwrapped here with the account
// key and never sent; with a passphrase on the link the key is wrapped under
// the passphrase instead and the link carries nothing. Revoking a keyed link
// means re-encrypting, since whoever has the old link still has the old key.
export default function ShareDialog({ artifact, pending, error, onSave, onStop, onReencrypt, onCancel }) {
  const live = artifact.isPublic && !artifact.isExpired;
  const encrypted = Boolean(artifact.encrypted);

  const [expiry, setExpiry] = useState(() => {
    if (live && artifact.expiresAt) return "keep";
    if (artifact.isExpired) return "7d";
    return "never";
  });
  const [customDate, setCustomDate] = useState(defaultCustomDate);
  const [askPass, setAskPass] = useState(artifact.hasPassphrase);
  const [passphrase, setPassphrase] = useState("");
  const [localError, setLocalError] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [artKey, setArtKey] = useState(null); // the artifact's own key, unwrapped here
  const [keyState, setKeyState] = useState(encrypted ? "loading" : "none"); // loading | ready | locked
  const [working, setWorking] = useState("");
  const cancelRef = useRef(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    cancelRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !pending && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [artifact.slug, onCancel, pending]);

  // Unwrap the artifact key as soon as the sheet opens, asking to unlock the
  // browser if it must. Without it the sheet still works for the options,
  // and says the link it shows has no key.
  useEffect(() => {
    if (!encrypted || !artifact.artKeyWrapped) return;
    let gone = false;
    (async () => {
      const account = await requestAccountKey();
      if (gone) return;
      if (!account) return setKeyState("locked");
      try {
        setArtKey(await crypto.unwrap(artifact.artKeyWrapped, account));
        setKeyState("ready");
      } catch {
        setKeyState("locked");
      }
    })();
    return () => {
      gone = true;
    };
  }, [encrypted, artifact.artKeyWrapped]);

  const [fragment, setFragment] = useState("");
  useEffect(() => {
    if (!artKey) return setFragment("");
    crypto.exportKey(artKey).then((bytes) => setFragment(`#k=${crypto.b64u.encode(bytes)}`));
  }, [artKey]);

  // With a passphrase on it the link carries no key: the words are the key.
  const keyed = encrypted && !askPass && fragment;
  const url = `${origin || ""}/a/${artifact.slug}${keyed ? fragment : ""}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the link is still visible to select by hand.
    }
  }

  async function submit(e) {
    e.preventDefault();
    setLocalError("");

    const payload = { visibility: "public" };

    if (expiry === "custom") {
      const at = new Date(customDate);
      if (Number.isNaN(at.getTime())) return setLocalError("Pick a date for the link to expire.");
      if (at <= new Date()) return setLocalError("That date has already passed.");
      payload.expiresAt = at.toISOString();
    } else if (expiry !== "keep") {
      payload.expiresIn = expiry === "never" ? null : expiry;
    }

    if (!askPass) {
      if (artifact.hasPassphrase) payload.passphrase = null;
    } else if (passphrase) {
      if (passphrase.length < MIN_PASSPHRASE) {
        return setLocalError(`A passphrase needs at least ${MIN_PASSPHRASE} characters.`);
      }
      payload.passphrase = passphrase;
      if (encrypted) {
        if (!artKey) return setLocalError("Unlock your key first: the passphrase has to wrap this artifact's key.");
        setWorking("Wrapping…");
        try {
          payload.artKeyByPassphrase = await crypto.wrapWithPassphrase(artKey, passphrase);
        } finally {
          setWorking("");
        }
      }
    } else if (!artifact.hasPassphrase) {
      return setLocalError("Type a passphrase, or untick the box.");
    } else if (encrypted && !artifact.hasPassphraseKey) {
      return setLocalError("Type the passphrase again: this artifact was encrypted after it was set.");
    }
    // Ticked, left blank, one already set: keep it as it is.

    onSave(payload);
  }

  const shown = localError || error;
  const busy = pending || Boolean(working);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onSubmit={submit}>
        <h2 id="share-title">{live ? "Sharing" : "Share"} “{artifact.title}”</h2>
        <p>
          {live
            ? "Anyone with this link can open it. Change how long it stays open, or put a passphrase on it."
            : artifact.isExpired
              ? "This link has expired. Share it again and the same address starts working."
              : "This gives the link to anyone who has it. The address stays the same, so you can close it again later."}
        </p>

        <div className="sharelink">
          <code>{url}</code>
          <button type="button" className="btn" onClick={copy} disabled={busy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {encrypted && (
          <p className={`sharewarn${keyState === "locked" ? " is-bad" : ""}`}>
            {askPass
              ? "Encrypted end to end. With a passphrase the link carries no key: the passphrase is what decrypts the page, so send the two separately."
              : keyState === "ready"
                ? "Encrypted end to end. The key rides in the link after the #, which the browser never sends to this site. Anyone with this exact link can read the page; make it private to stop serving it, or re-encrypt to change the key."
                : keyState === "loading"
                  ? "Encrypted end to end. Unwrapping the key…"
                  : "Encrypted end to end — but this browser is locked, so the link above has no key and opens to ciphertext. Unlock to get the full link."}
          </p>
        )}

        <div className="sharefields">
          <label className="sharefield">
            <span>Stops working</span>
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={busy}>
              {live && artifact.expiresAt && (
                <option value="keep">Keep — {artifact.expiresStamp} UTC</option>
              )}
              {EXPIRY_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>

          {expiry === "custom" && (
            <label className="sharefield">
              <span>Expires on</span>
              <input
                type="datetime-local"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                disabled={busy}
              />
            </label>
          )}

          <label className="sharecheck">
            <input
              type="checkbox"
              checked={askPass}
              onChange={(e) => setAskPass(e.target.checked)}
              disabled={busy}
            />
            <span>Ask for a passphrase before opening</span>
          </label>

          {askPass && (
            <label className="sharefield">
              <span>Passphrase</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={artifact.hasPassphrase ? "Leave blank to keep the current one" : "Something you can say over the phone"}
                disabled={busy}
              />
              <em className="sharehint">
                Shown here in the clear so you can send it to them. It is stored hashed, so it
                can't be read back later — write it down.
                {encrypted && " On this artifact it also unlocks the key, so a wrong guess opens nothing."}
              </em>
            </label>
          )}
        </div>

        {shown && <p className="naverror" role="alert">{shown}</p>}

        <div className="modal-actions">
          {live && (
            <button type="button" className="btn btn-danger" onClick={onStop} disabled={busy}>
              Stop sharing
            </button>
          )}
          {encrypted && keyState === "ready" && (
            <button
              type="button"
              className="btn"
              title="Encrypt this artifact under a new key. Every link handed out so far stops opening, and a passphrase has to be set again."
              onClick={() => onReencrypt(artKey)}
              disabled={busy}
            >
              Re-encrypt
            </button>
          )}
          <span className="spacer" />
          <button type="button" ref={cancelRef} className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-accent" disabled={busy}>
            {working || (pending ? "Saving…" : live ? "Save" : "Share")}
          </button>
        </div>
      </form>
    </div>
  );
}
