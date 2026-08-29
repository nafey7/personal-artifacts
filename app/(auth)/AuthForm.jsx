"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// One form for both screens; `mode` decides the extra fields and the endpoint.
// Signup has a second stage: the emailed code. It lives here rather than on its
// own route so the typed details survive a resend without being retyped or
// passed through the URL.
export default function AuthForm({ mode, next }) {
  const signup = mode === "signup";
  const router = useRouter();

  const [fields, setFields] = useState({ name: "", email: "", password: "", code: "" });
  const [stage, setStage] = useState("form");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  // Switching between the two forms must not lose where we were headed.
  const carry = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";

  // The session cookie comes back on the response, so refreshing is enough to
  // re-render the server components as the signed-in person. The `next` value
  // that carries someone back to a machine approval flows through unchanged.
  function enter() {
    router.replace(next || "/");
    router.refresh();
  }

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
    setNote("");
    try {
      if (signup && stage === "form") {
        const { res, data } = await post("/api/auth/signup", {
          name: fields.name,
          email: fields.email,
          password: fields.password,
        });
        if (!res.ok) {
          setError(data.error || `request failed (${res.status})`);
          return;
        }
        setStage("code");
        return;
      }

      if (signup) {
        const { res, data } = await post("/api/auth/verify", {
          email: fields.email,
          code: fields.code,
        });
        if (!res.ok) {
          setError(data.error || `request failed (${res.status})`);
          // The pending signup is gone — retyping the code cannot help.
          if (data.restart) {
            setStage("form");
            setFields((f) => ({ ...f, code: "" }));
          }
          return;
        }
        enter();
        return;
      }

      const { res, data } = await post("/api/auth/signin", {
        email: fields.email,
        password: fields.password,
      });
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      enter();
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setPending(true);
    setError("");
    setNote("");
    try {
      const { res, data } = await post("/api/auth/resend", { email: fields.email });
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        if (data.restart) setStage("form");
        return;
      }
      setFields((f) => ({ ...f, code: "" }));
      setNote("A new code is on its way. The previous one no longer works.");
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  const codeStage = signup && stage === "code";

  return (
    <div className="authwrap">
      <form className="authcard" onSubmit={submit}>
        <span className="authmark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 21 8v8l-9 5-9-5V8z" />
            <path d="M3 8l9 5 9-5" />
            <path d="M12 13v8" />
          </svg>
        </span>

        <h1>{codeStage ? "Check your email" : signup ? "Create your account" : "Sign in"}</h1>
        <p className="authnote">
          {codeStage
            ? `We sent a six-character code to ${fields.email}. It expires in ten minutes.`
            : signup
              ? "Your artifacts are private to your account."
              : "Welcome back to your artifact archive."}
        </p>

        {codeStage ? (
          <label className="authfield">
            <span>Code</span>
            <input
              required
              value={fields.code}
              onChange={set("code")}
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={6}
              className="authcode"
              placeholder="XXXXXX"
            />
          </label>
        ) : (
          <>
            {signup && (
              <label className="authfield">
                <span>Name <em>optional</em></span>
                <input
                  value={fields.name}
                  onChange={set("name")}
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                />
              </label>
            )}

            <label className="authfield">
              <span>Email</span>
              <input
                required
                type="email"
                value={fields.email}
                onChange={set("email")}
                autoComplete="email"
                autoFocus={!signup}
                placeholder="you@example.com"
              />
            </label>

            <label className="authfield">
              <span>Password</span>
              <input
                required
                type="password"
                value={fields.password}
                onChange={set("password")}
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 10 : undefined}
                placeholder={signup ? "at least 10 characters" : "••••••••••"}
              />
            </label>

            {!signup && (
              <p className="authaside">
                <Link href="/reset">Forgot your password?</Link>
              </p>
            )}
          </>
        )}

        {error && <p className="autherror" role="alert">{error}</p>}
        {note && <p className="authok" role="status">{note}</p>}

        <button className="authsubmit" type="submit" disabled={pending}>
          {pending
            ? "One moment…"
            : codeStage
              ? "Confirm and create account"
              : signup
                ? "Create account"
                : "Sign in"}
        </button>

        {codeStage ? (
          <p className="authswap">
            Nothing arrived?{" "}
            <button type="button" className="authlink" onClick={resend} disabled={pending}>
              Send another code
            </button>{" "}
            or{" "}
            <button
              type="button"
              className="authlink"
              onClick={() => {
                setStage("form");
                setError("");
                setNote("");
              }}
            >
              use a different address
            </button>
            .
          </p>
        ) : (
          <p className="authswap">
            {signup ? (
              <>Already have an account? <Link href={`/signin${carry}`}>Sign in</Link></>
            ) : (
              <>No account yet? <Link href={`/signup${carry}`}>Create one</Link></>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
