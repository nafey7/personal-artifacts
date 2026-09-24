"use client";

import { useMemo, useState } from "react";

// Shows the twelve words once and will not let go until three of them, picked
// at random, have been typed back. The server never sees them; nothing can
// show them again. Reached from signup, from the first sign-in that upgrades
// an old account, and from Settings when a new phrase is made.
export default function RecoveryPhrase({ words, heading, note, doneLabel = "I've saved it", onDone }) {
  const [stage, setStage] = useState("show");
  const [typed, setTyped] = useState({});
  const [copied, setCopied] = useState(false);
  const [wrong, setWrong] = useState(false);

  // Three distinct positions, chosen once.
  const checks = useMemo(() => {
    const picks = new Set();
    while (picks.size < 3) picks.add(Math.floor(Math.random() * words.length));
    return [...picks].sort((a, b) => a - b);
  }, [words]);

  const text = words.join(" ");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the words are on screen to copy by hand.
    }
  }

  function confirm(e) {
    e.preventDefault();
    const ok = checks.every((i) => (typed[i] || "").trim().toLowerCase() === words[i]);
    if (!ok) {
      setWrong(true);
      return;
    }
    onDone();
  }

  if (stage === "check") {
    return (
      <form className="authcard" onSubmit={confirm}>
        <h1>Check three words</h1>
        <p className="authnote">
          Type the words from your phrase at these positions, so you know the copy you saved is
          right.
        </p>
        {checks.map((i) => (
          <label className="authfield" key={i}>
            <span>Word {i + 1}</span>
            <input
              required
              autoFocus={i === checks[0]}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed[i] || ""}
              onChange={(e) => {
                setWrong(false);
                setTyped((t) => ({ ...t, [i]: e.target.value }));
              }}
            />
          </label>
        ))}
        {wrong && (
          <p className="autherror" role="alert">
            One of those is not the word at that position. Check your copy and try again.
          </p>
        )}
        <button className="authsubmit" type="submit">
          {doneLabel}
        </button>
        <p className="authswap">
          <button type="button" className="authlink" onClick={() => setStage("show")}>
            Show the phrase again
          </button>
        </p>
      </form>
    );
  }

  return (
    <div className="authcard">
      <span className="authmark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L19 3l2 2-4 4-2-2" />
        </svg>
      </span>
      <h1>{heading || "Your recovery phrase"}</h1>
      <p className="authnote">
        {note ||
          "These twelve words are the only way back into your encrypted artifacts if you forget your password. Write them down and keep them somewhere safe. This site never sees them and cannot show them again."}
      </p>

      <ol className="phrase" aria-label="Recovery phrase">
        {words.map((w, i) => (
          <li key={i}>
            <span className="phrase-n">{i + 1}</span>
            <span className="phrase-w">{w}</span>
          </li>
        ))}
      </ol>

      <div className="tokenactions">
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy phrase"}
        </button>
      </div>

      <button className="authsubmit" type="button" onClick={() => setStage("check")}>
        I&rsquo;ve written it down
      </button>
    </div>
  );
}
