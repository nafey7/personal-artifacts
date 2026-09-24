"use client";

import { useEffect, useState } from "react";

// A command line with a copy button. The text itself is plain HTML, so it
// reads the same with or without JavaScript.
export default function CopyCmd({ cmd, prompt = "$" }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  }

  return (
    <div className={`lp-cmd${copied ? " is-copied" : ""}`}>
      <span className="lp-cmd-prompt" aria-hidden="true">{prompt}</span>
      <code>{cmd}</code>
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : `Copy “${cmd}”`}>
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
          </svg>
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
