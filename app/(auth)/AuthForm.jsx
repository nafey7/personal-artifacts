"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import * as keystore from "@/lib/keystore";
import { deriveAuth, lockedCopy, makeKeys, remember } from "@/lib/account-key";
import RecoveryPhrase from "./RecoveryPhrase";

// One form for both screens; `mode` decides the extra fields and the endpoint.
// Signup has a second stage: the emailed code. It lives here rather than on its
// own route so the typed details survive a resend without being retyped or
// passed through the URL.
//
// The password never leaves this form. Before any request it is turned into
// an `authHash` the server checks and a `wrapKey` the server never sees; a new
// account also makes its account key and recovery phrase here. The one
// exception is an account from before encryption: its first sign-in sends the
// password one last time, to /api/auth/upgrade, and comes out the other side
// as a v2 account with a phrase to write down.
export default function AuthForm({ mode, next }) {
  const signup = mode === "signup";
  const router = useRouter();

  const [fields, setFields] = useState({ name: "", email: "", password: "", code: "" });
  const [stage, setStage] = useState("form"); // form | code | phrase
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(""); // what the button says while it works
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [made, setMade] = useState(null); // { accountKey, words, accountKeyByPassword, accountKeyByRecovery }
  const [upgraded, setUpgraded] = useState(false);

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

  // The slow derivation, named on the button while it runs.
  async function derive() {
    setBusy("Unlocking…");
    try {
      return await deriveAuth(fields.email, fields.password);
    } finally {
      setBusy("");
    }
  }

  async function submit(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    setNote("");
    try {
      if (signup && stage === "form") {
        const { authHash, wrapKey } = await derive();
        const keys = await makeKeys(wrapKey);
        const { res, data } = await post("/api/auth/signup", {
          name: fields.name,
          email: fields.email,
          authVersion: 2,
          authHash,
          accountKeyByPassword: keys.accountKeyByPassword,
          accountKeyByRecovery: keys.accountKeyByRecovery,
        });
        if (!res.ok) {
          setError(data.error || `request failed (${res.status})`);
          return;
        }
        setMade(keys);
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
        // The key made before the code was sent is still in memory. If the
        // page was reloaded meanwhile it is not, and the dashboard will ask
        // for the password once to unlock it instead.
        if (made) {
          try {
            await keystore.put(await lockedCopy(made.accountKey));
          } catch {
            // The keystore is unavailable (some private windows). The
            // dashboard asks for the password once instead.
          }
          setStage("phrase");
          return;
        }
        enter();
        return;
      }

      const { authHash, wrapKey } = await derive();
      const { res, data } = await post("/api/auth/signin", { email: fields.email, authHash });

      if (res.ok) {
        if (data.accountKeyByPassword) {
          try {
            await remember(data.accountKeyByPassword, wrapKey);
          } catch {
            // The keystore is unavailable (some private windows). Signing in
            // still works; the dashboard asks again when a key is needed.
          }
        }
        enter();
        return;
      }

      if (data.legacy) {
        // An account from before encryption. Make its keys now, prove the
        // password one last time, and show the phrase.
        const keys = await makeKeys(wrapKey);
        const up = await post("/api/auth/upgrade", {
          email: fields.email,
          password: fields.password,
          authHash,
          accountKeyByPassword: keys.accountKeyByPassword,
          accountKeyByRecovery: keys.accountKeyByRecovery,
        });
        if (!up.res.ok) {
          setError(up.data.error || `request failed (${up.res.status})`);
          return;
        }
        try {
          await remember(keys.accountKeyByPassword, wrapKey);
        } catch {
          // As above.
        }
        setMade(keys);
        setUpgraded(true);
        setStage("phrase");
        return;
      }

      setError(data.error || `request failed (${res.status})`);
    } catch (err) {
      setError(err?.message ? `something went wrong — ${err.message}` : "network error — try again");
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

  if (stage === "phrase" && made) {
    return (
      <div className="authwrap">
        <RecoveryPhrase
          words={made.words}
          heading={upgraded ? "Your account is now encrypted" : "Your recovery phrase"}
          note={
            upgraded
              ? "Artifacts you encrypt from now on are unreadable to everyone but you, this site's operator included. These twelve words are the only way back into them if you forget your password. Write them down; this site never sees them and cannot show them again."
              : undefined
          }
          doneLabel="Continue to my artifacts"
          onDone={enter}
        />
      </div>
    );
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
              ? "Your artifacts are private to your account, and can be encrypted so that only you can read them."
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
                minLength={10}
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
            ? busy || "One moment…"
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
