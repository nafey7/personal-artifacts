"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// One form for both screens; `mode` decides the extra fields and the endpoint.
export default function AuthForm({ mode, next, inviteOnly }) {
  const signup = mode === "signup";
  const router = useRouter();

  const [fields, setFields] = useState({ name: "", email: "", password: "", code: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${signup ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          signup
            ? { name: fields.name, email: fields.email, password: fields.password, code: fields.code }
            : { email: fields.email, password: fields.password }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      // The session cookie is set by the response; refresh so the server
      // components re-render as the signed-in user.
      router.replace(next || "/");
      router.refresh();
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

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

        <h1>{signup ? "Create your account" : "Sign in"}</h1>
        <p className="authnote">
          {signup
            ? "Your artifacts are private to your account."
            : "Welcome back to your artifact archive."}
        </p>

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

        {signup && inviteOnly && (
          <label className="authfield">
            <span>Invite code</span>
            <input
              required
              value={fields.code}
              onChange={set("code")}
              autoComplete="off"
              placeholder="from whoever runs this deployment"
            />
          </label>
        )}

        {error && <p className="autherror" role="alert">{error}</p>}

        <button className="authsubmit" type="submit" disabled={pending}>
          {pending ? "One moment…" : signup ? "Create account" : "Sign in"}
        </button>

        <p className="authswap">
          {signup ? (
            <>Already have an account? <Link href="/signin">Sign in</Link></>
          ) : (
            <>No account yet? <Link href="/signup">Create one</Link></>
          )}
        </p>
      </form>
    </div>
  );
}
