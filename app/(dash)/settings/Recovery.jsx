"use client";

import { useState } from "react";
import { rewrapForRecovery, unlockWithPassword } from "@/lib/account-key";
import RecoveryPhrase from "../../(auth)/RecoveryPhrase";

// The encryption section of Settings: what the account's state is, and a way
// to get a new recovery phrase. Making one costs the password, because it
// needs the raw account key and because a borrowed, still-signed-in laptop
// must not be able to mint a phrase for itself.
// `since` arrives formatted by the server, so the markup hydrates identically
// whatever locale the browser has.
export default function Recovery({ user, since }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [words, setWords] = useState(null);
  const [asking, setAsking] = useState(false);

  const encrypted = user.authVersion === 2;

  async function regenerate(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      setBusy("Unlocking…");
      const { key, authHash } = await unlockWithPassword(user.email, password, { extractable: true });
      setBusy("Wrapping…");
      const { words: fresh, accountKeyByRecovery } = await rewrapForRecovery(key);
      const res = await fetch("/api/auth/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authHash, accountKeyByRecovery }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      setPassword("");
      setAsking(false);
      setWords(fresh);
    } catch (err) {
      setError(err.message || "could not make a new phrase");
    } finally {
      setBusy("");
      setPending(false);
    }
  }

  if (words) {
    return (
      <section className="recovery">
        <RecoveryPhrase
          words={words}
          heading="Your new recovery phrase"
          note="The old phrase no longer works. These twelve words are now the only way back into your encrypted artifacts if you forget your password. Write them down; this site never sees them and cannot show them again."
          doneLabel="Done"
          onDone={() => setWords(null)}
        />
      </section>
    );
  }

  return (
    <section className="recovery">
      {!encrypted ? (
        <p className="settingslede">
          This account has no encryption keys yet. Sign out and sign in again: the first
          sign-in makes them and shows you a recovery phrase.
        </p>
      ) : (
        <>
          <p className="settingslede">
            Encryption is on for this account
            {since ? ` since ${since} UTC` : ""}.
            An artifact you publish with <code>--encrypted</code>, or encrypt from the list, is
            unreadable to everyone but you — this site&rsquo;s operator included. Your recovery
            phrase is the only way back in if you forget your password; if you have lost it,
            make a new one now.
          </p>

          {asking ? (
            <form className="tokenform recoveryform" onSubmit={regenerate}>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                aria-label="Password"
                autoFocus
                disabled={pending}
              />
              <button type="submit" disabled={pending || !password}>
                {pending ? busy || "One moment…" : "Show me a new phrase"}
              </button>
              <button type="button" className="btn" onClick={() => { setAsking(false); setError(""); }} disabled={pending}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="tokenactions">
              <button type="button" onClick={() => setAsking(true)}>
                Make a new recovery phrase
              </button>
            </div>
          )}
          {error && <p className="naverror" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
