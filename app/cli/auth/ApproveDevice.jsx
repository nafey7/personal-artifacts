"use client";

import { useState } from "react";

export default function ApproveDevice({ userCode, device, user }) {
  const [state, setState] = useState("asking"); // asking | approved | denied
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function decide(approve) {
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/cli/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, approve }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      setState(approve ? "approved" : "denied");
    } catch {
      setError("network error — nothing was authorized");
    } finally {
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
          {device} can now publish to your account. Head back to your terminal —
          it has already picked this up.
        </p>
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
    <div className="authcard">
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
      </dl>

      <p className="authnote">
        Approve only if you just ran <code>personal-artifact</code> yourself.
      </p>

      {error && <p className="autherror" role="alert">{error}</p>}

      <button className="authsubmit" type="button" disabled={pending} onClick={() => decide(true)}>
        {pending ? "One moment…" : "Approve"}
      </button>
      <button className="devicedeny" type="button" disabled={pending} onClick={() => decide(false)}>
        No, I didn&rsquo;t start this
      </button>
    </div>
  );
}
