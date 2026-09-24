"use client";

import { useEffect, useState } from "react";
import * as crypto from "@/cli/crypto";
import { unlockWithPassword } from "@/lib/account-key";

// A signed-in person approves (or refuses) the machine that asked. Approving
// mints the token; on an encrypted account it also hands the machine the
// account key, sealed here in the browser to the public key the CLI sent
// with its request. That needs the raw key, so it costs the password once —
// which is also the right price for giving another machine everything.
//
// The fingerprint shown is of the CLI's public key; the terminal printed the
// same one. If they differ, someone else's request got here first.
export default function ApproveDevice({ userCode, device, user, cliPublicKey }) {
  const [state, setState] = useState("asking"); // asking | approved | denied
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [withoutKey, setWithoutKey] = useState(false);
  const [fingerprint, setFingerprint] = useState("");
  const [handedOver, setHandedOver] = useState(false);

  const canSeal = Boolean(cliPublicKey) && user.authVersion === 2;

  useEffect(() => {
    if (cliPublicKey) crypto.ecdh.fingerprint(cliPublicKey).then(setFingerprint).catch(() => {});
  }, [cliPublicKey]);

  async function decide(approve) {
    setPending(true);
    setError("");
    try {
      let accountKeySealed = null;
      if (approve && canSeal && !withoutKey) {
        if (!password) {
          setError("Type your password to hand this machine your encryption key, or approve without it.");
          return;
        }
        setBusy("Unlocking…");
        const { key } = await unlockWithPassword(user.email, password, { extractable: true });
        setBusy("Sealing…");
        accountKeySealed = await crypto.ecdh.seal(await crypto.exportKey(key), cliPublicKey);
        setBusy("");
      }
      const res = await fetch("/api/cli/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, approve, accountKeySealed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      setHandedOver(Boolean(data.keyHandedOver));
      setState(approve ? "approved" : "denied");
    } catch (err) {
      setError(err?.message || "network error — nothing was authorized");
    } finally {
      setBusy("");
      setPending(false);
    }
  }

  if (state === "approved") {
    return (
      <div className="authcard">
        <span className="authmark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h1>You&rsquo;re signed in</h1>
        <p className="authnote">
          {device} can now publish to your account
          {handedOver ? ", encrypted artifacts included" : ""}. Head back to your terminal —
          it has already picked this up.
        </p>
        {canSeal && !handedOver && (
          <p className="authnote">
            It did not get your encryption key, so it can publish plain artifacts only. Run{" "}
            <code>personal-artifact</code> again to hand it over.
          </p>
        )}
        <p className="authswap">You can close this tab.</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="authcard">
        <h1>Refused</h1>
        <p className="authnote">
          Nothing was authorized and no token was created. If you didn&rsquo;t
          start this, someone else ran the command — nothing of yours was
          exposed.
        </p>
      </div>
    );
  }

  return (
    <form
      className="authcard"
      onSubmit={(e) => {
        e.preventDefault();
        decide(true);
      }}
    >
      <span className="authmark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </span>

      <h1>Authorize this machine?</h1>
      <p className="authnote">
        A machine calling itself <strong>{device}</strong> is asking to publish
        artifacts as {user.name ? `${user.name} (${user.email})` : user.email}.
      </p>

      <dl className="devicefacts">
        <div><dt>Machine</dt><dd>{device}</dd></div>
        <div><dt>Code</dt><dd>{userCode}</dd></div>
        {fingerprint && (
          <div><dt>Key fingerprint</dt><dd className="fingerprint">{fingerprint}</dd></div>
        )}
      </dl>

      {canSeal ? (
        <>
          <p className="authnote">
            To publish encrypted artifacts the machine needs your encryption key. Your
            password unlocks it here and seals it to the key whose fingerprint is above —
            the same one your terminal printed. Neither leaves this browser in the clear.
          </p>
          {!withoutKey && (
            <label className="authfield">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                autoFocus
              />
            </label>
          )}
          <label className="sharecheck">
            <input
              type="checkbox"
              checked={withoutKey}
              onChange={(e) => setWithoutKey(e.target.checked)}
              disabled={pending}
            />
            <span>Approve without the key (plain artifacts only)</span>
          </label>
        </>
      ) : (
        <p className="authnote">
          Approve only if you just ran <code>personal-artifact</code> yourself.
          {cliPublicKey && user.authVersion !== 2
            ? " This account has no encryption keys yet, so the machine gets a token only; sign out and in to make them."
            : ""}
        </p>
      )}

      {error && <p className="autherror" role="alert">{error}</p>}

      <button className="authsubmit" type="submit" disabled={pending}>
        {pending ? busy || "One moment…" : "Approve"}
      </button>
      <button className="devicedeny" type="button" disabled={pending} onClick={() => decide(false)}>
        No, I didn&rsquo;t start this
      </button>
    </form>
  );
}
