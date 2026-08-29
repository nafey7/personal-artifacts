"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Request and confirm as two stages of one screen, matching signup: the address
// stays in memory, so the second stage needs nothing from the URL.
export default function ResetForm() {
  const router = useRouter();

  const [fields, setFields] = useState({ email: "", code: "", password: "" });
  const [stage, setStage] = useState("request");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function post(path, payload) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  async function submit(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      if (stage === "request") {
        const { res, data } = await post("/api/auth/reset/request", { email: fields.email });
        if (!res.ok) {
          setError(data.error || `request failed (${res.status})`);
          return;
        }
        // Success either way — the response says nothing about whether that
        // address has an account.
        setStage("confirm");
        return;
      }

      const { res, data } = await post("/api/auth/reset/confirm", {
        email: fields.email,
        code: fields.code,
        password: fields.password,
      });
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        if (data.restart) {
          setStage("request");
          setFields((f) => ({ ...f, code: "" }));
        }
        return;
      }
      // The reset deleted every session for the account, this browser's
      // included, so there is nothing to do but sign in again.
      setDone(true);
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="authcard">
        <h1>Password changed</h1>
        <p className="authnote">
          You have been signed out everywhere else. Sign in with your new
          password.
        </p>
        <button className="authsubmit" type="button" onClick={() => router.push("/signin")}>
          Sign in
        </button>
      </div>
    );
  }

  const confirm = stage === "confirm";

  return (
    <form className="authcard" onSubmit={submit}>
      <h1>{confirm ? "Choose a new password" : "Reset your password"}</h1>
      <p className="authnote">
        {confirm
          ? `If ${fields.email} has an account, a six-character code is on its way. It expires in ten minutes.`
          : "We'll email you a code to confirm it's you."}
      </p>

      {confirm ? (
        <>
          <label className="authfield">
            <span>Code</span>
            <input
              required
              value={fields.code}
              onChange={set("code")}
              autoFocus
              autoComplete="one-time-code"
              maxLength={6}
              className="authcode"
              placeholder="XXXXXX"
            />
          </label>

          <label className="authfield">
            <span>New password</span>
            <input
              required
              type="password"
              value={fields.password}
              onChange={set("password")}
              autoComplete="new-password"
              minLength={10}
              placeholder="at least 10 characters"
            />
          </label>
        </>
      ) : (
        <label className="authfield">
          <span>Email</span>
          <input
            required
            type="email"
            value={fields.email}
            onChange={set("email")}
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
      )}

      {error && <p className="autherror" role="alert">{error}</p>}

      <button className="authsubmit" type="submit" disabled={pending}>
        {pending ? "One moment…" : confirm ? "Set new password" : "Email me a code"}
      </button>

      <p className="authswap">
        {confirm ? (
          <>
            Wrong address?{" "}
            <button
              type="button"
              className="authlink"
              onClick={() => {
                setStage("request");
                setError("");
              }}
            >
              Start again
            </button>
          </>
        ) : (
          <>Remembered it? <Link href="/signin">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
