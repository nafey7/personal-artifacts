"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import * as crypto from "@/cli/crypto";
import { deriveAuth, makeKeys } from "@/lib/account-key";
import RecoveryPhrase from "../RecoveryPhrase";

// Request, code, then the new password — three stages of one screen, so the
// address stays in memory and nothing rides in the URL.
//
// Resetting a password on an encrypted account is the one place the recovery
// phrase is for. The code alone proves the address; the phrase is what opens
// the account key so it can be wrapped again under the new password. Without
// it the person can still choose a new password, but the old key — and every
// artifact encrypted under it — is gone, and this screen says so before they
// do it.
export default function ResetForm() {
  const router = useRouter();

  const [fields, setFields] = useState({ email: "", code: "", phrase: "", password: "" });
  const [stage, setStage] = useState("request"); // request | code | password | phrase-shown | done
  const [account, setAccount] = useState(null); // { authVersion, accountKeyByRecovery } once the code checks out
  const [lost, setLost] = useState(false); // "I don't have my phrase"
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [words, setWords] = useState(null);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function post(path, payload) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  function restart() {
    setStage("request");
    setFields((f) => ({ ...f, code: "", phrase: "", password: "" }));
    setAccount(null);
    setLost(false);
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
        setStage("code");
        return;
      }

      if (stage === "code") {
        const { res, data } = await post("/api/auth/reset/confirm", {
          email: fields.email,
          code: fields.code,
        });
        if (!res.ok) {
          setError(data.error || `request failed (${res.status})`);
          if (data.restart) restart();
          return;
        }
        setAccount(data);
        setStage("password");
        return;
      }

      // The new password, with the keys carried over or made afresh.
      const encrypted = account?.authVersion === 2 && account.accountKeyByRecovery;
      let accountKey = null;
      if (encrypted && !lost) {
        setBusy("Checking phrase…");
        try {
          const recoveryKey = await crypto.phrase.toKey(fields.phrase);
          accountKey = await crypto.unwrap(account.accountKeyByRecovery, recoveryKey);
        } catch (err) {
          setError(
            /twelve|not a word|not a valid/.test(err?.message || "")
              ? err.message
              : "that phrase does not open this account — check the words and their order"
          );
          return;
        } finally {
          setBusy("");
        }
      }

      setBusy("Unlocking…");
      const { authHash, wrapKey } = await deriveAuth(fields.email, fields.password);
      setBusy("");

      const payload = { email: fields.email, code: fields.code, authHash };
      let fresh = null;
      if (accountKey) {
        payload.accountKeyByPassword = await crypto.wrap(accountKey, wrapKey);
      } else {
        fresh = await makeKeys(wrapKey);
        payload.accountKeyByPassword = fresh.accountKeyByPassword;
        payload.accountKeyByRecovery = fresh.accountKeyByRecovery;
        if (encrypted) payload.replaceKeys = true;
      }

      const { res, data } = await post("/api/auth/reset/confirm", payload);
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        if (data.restart) restart();
        return;
      }
      // The reset deleted every session for the account, this browser's
      // included, so there is nothing to do but sign in again — after the
      // new phrase, if one was made.
      if (fresh) {
        setWords(fresh.words);
        setStage("phrase-shown");
      } else {
        setStage("done");
      }
    } catch (err) {
      setError(err?.message ? `something went wrong — ${err.message}` : "network error — try again");
    } finally {
      setBusy("");
      setPending(false);
    }
  }

  if (stage === "phrase-shown" && words) {
    return (
      <RecoveryPhrase
        words={words}
        heading="Your new recovery phrase"
        note="Your password is changed and your account has a fresh encryption key. These twelve words are the only way back into artifacts you encrypt from now on if you forget your password again. Write them down; this site never sees them."
        doneLabel="Sign in"
        onDone={() => router.push("/signin")}
      />
    );
  }

  if (stage === "done") {
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

  const encrypted = stage === "password" && account?.authVersion === 2 && account.accountKeyByRecovery;

  return (
    <form className="authcard" onSubmit={submit}>
      <h1>
        {stage === "password" ? "Choose a new password" : stage === "code" ? "Enter the code" : "Reset your password"}
      </h1>
      <p className="authnote">
        {stage === "password"
          ? encrypted
            ? lost
              ? "Without the phrase, the key that protects your encrypted artifacts cannot be carried over. You will get a new password and a new key, and every artifact you encrypted before becomes unreadable — for you and for everyone. Plain artifacts are unaffected."
              : "This account is encrypted. Type your twelve-word recovery phrase so your encrypted artifacts stay readable under the new password."
            : "Pick a new password. Your account gets encryption keys and a recovery phrase along with it."
          : stage === "code"
            ? `If ${fields.email} has an account, a six-character code is on its way. It expires in ten minutes.`
            : "We'll email you a code to confirm it's you."}
      </p>

      {stage === "request" && (
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

      {stage === "code" && (
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
      )}

      {stage === "password" && (
        <>
          {encrypted && !lost && (
            <label className="authfield">
              <span>Recovery phrase</span>
              <textarea
                required
                rows={3}
                value={fields.phrase}
                onChange={set("phrase")}
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="phrasefield"
                placeholder="twelve words, in order"
              />
            </label>
          )}

          <label className="authfield">
            <span>New password</span>
            <input
              required
              type="password"
              value={fields.password}
              onChange={set("password")}
              autoFocus={!encrypted || lost}
              autoComplete="new-password"
              minLength={10}
              placeholder="at least 10 characters"
            />
          </label>
        </>
      )}

      {error && <p className="autherror" role="alert">{error}</p>}

      <button className={`authsubmit${lost ? " is-danger" : ""}`} type="submit" disabled={pending}>
        {pending
          ? busy || "One moment…"
          : stage === "password"
            ? lost
              ? "Set new password and lose encrypted artifacts"
              : "Set new password"
            : stage === "code"
              ? "Continue"
              : "Email me a code"}
      </button>

      <p className="authswap">
        {stage === "password" && encrypted ? (
          lost ? (
            <>
              Found it?{" "}
              <button type="button" className="authlink" onClick={() => { setLost(false); setError(""); }}>
                Enter the phrase instead
              </button>
            </>
          ) : (
            <>
              Lost your phrase?{" "}
              <button type="button" className="authlink" onClick={() => { setLost(true); setError(""); }}>
                Start over without it
              </button>
            </>
          )
        ) : stage !== "request" ? (
          <>
            Wrong address?{" "}
            <button type="button" className="authlink" onClick={() => { restart(); setError(""); }}>
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
