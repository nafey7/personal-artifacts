"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Confirm from "./Confirm";

function Icon({ name }) {
  const props = {
    width: 15, height: 15, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.9,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  };
  if (name === "all") {
    return (
      <svg {...props}>
        <path d="M12 3 21 8v8l-9 5-9-5V8z" />
        <path d="M3 8l9 5 9-5" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...props}>
        <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

export default function Sidebar({ projects, total, trash, user }) {
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null); // project id being renamed
  const [editDraft, setEditDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null); // project pending deletion
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef(null);

  // The account menu is a popup: a click anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e) {
      if (!accountRef.current?.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      router.replace("/signin");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  async function send(url, options) {
    setPending(true);
    setError("");
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("network error — nothing was changed");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function createProject(e) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    const data = await send("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (data) {
      setDraft("");
      setCreating(false);
    }
  }

  async function renameProject(e, id) {
    e.preventDefault();
    const name = editDraft.trim();
    if (!name) return;
    const data = await send(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    if (data) setEditing(null);
  }

  async function deleteProject(project) {
    const data = await send(`/api/projects/${project.id}`, { method: "DELETE" });
    setConfirming(null);
    // Leaving the page we just deleted, otherwise it renders an empty shell.
    if (data && pathname === `/p/${project.slug}`) router.push("/");
  }

  return (
    <>
      <button
        className="navtoggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
        Menu
      </button>

      <aside className={`sidebar${open ? " is-open" : ""}`} onClick={() => setOpen(false)}>
        <div className="sidebar-inner" onClick={(e) => e.stopPropagation()}>
          <Link href="/" className="brand">
            <span className="mark" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 21 8v8l-9 5-9-5V8z" />
                <path d="M3 8l9 5 9-5" />
                <path d="M12 13v8" />
              </svg>
            </span>
            <span className="name">Artifacts</span>
          </Link>

          <nav>
            <p className="navlabel">Artifacts</p>
            <ul className="navlist">
              <li>
                <Link href="/" className={`navitem${pathname === "/" ? " is-active" : ""}`}>
                  <Icon name="all" />
                  <span className="label">All artifacts</span>
                  <span className="count">{total}</span>
                </Link>
              </li>
            </ul>

            <p className="navlabel">
              Projects
              <button
                type="button"
                className="addbtn"
                onClick={() => { setCreating(true); setError(""); }}
                aria-label="New project"
                title="New project"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </p>

            {creating && (
              <form className="navform" onSubmit={createProject}>
                <input
                  autoFocus
                  value={draft}
                  maxLength={80}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
                  placeholder="Project name"
                  aria-label="New project name"
                />
                <button type="submit" disabled={pending || !draft.trim()}>Add</button>
              </form>
            )}

            <ul className="navlist">
              {projects.length === 0 && !creating && (
                <li className="navnote">No projects yet.</li>
              )}
              {projects.map((p) =>
                editing === p.id ? (
                  <li key={p.id}>
                    <form className="navform" onSubmit={(e) => renameProject(e, p.id)}>
                      <input
                        autoFocus
                        value={editDraft}
                        maxLength={80}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                        aria-label={`Rename ${p.name}`}
                      />
                      <button type="submit" disabled={pending || !editDraft.trim()}>Save</button>
                    </form>
                  </li>
                ) : (
                  <li key={p.id} className="navrow">
                    <Link
                      href={`/p/${p.slug}`}
                      className={`navitem${pathname === `/p/${p.slug}` ? " is-active" : ""}`}
                    >
                      <Icon name="folder" />
                      <span className="label">{p.name}</span>
                      <span className="count">{p.count}</span>
                    </Link>
                    <span className="navtools">
                      <button
                        type="button"
                        onClick={() => { setEditing(p.id); setEditDraft(p.name); setError(""); }}
                        aria-label={`Rename ${p.name}`}
                        title="Rename"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 20h4l10-10a2.5 2.5 0 0 0-4-4L4 16v4z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => { setConfirming(p); setError(""); }}
                        aria-label={`Delete ${p.name}`}
                        title="Delete"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                        </svg>
                      </button>
                    </span>
                  </li>
                )
              )}
            </ul>

            <ul className="navlist navlist-tail">
              <li>
                <Link
                  href="/trash"
                  className={`navitem${pathname === "/trash" ? " is-active" : ""}`}
                >
                  <Icon name="trash" />
                  <span className="label">Trash</span>
                  <span className="count">{trash}</span>
                </Link>
              </li>
            </ul>
          </nav>

          {error && <p className="naverror" role="alert">{error}</p>}

          <div className="sidefoot">
            {user && (
              <div className={`account${menuOpen ? " is-open" : ""}`} ref={accountRef}>
                {menuOpen && (
                  <div className="accountmenu" role="menu">
                    <p className="accountmail" title={user.email}>{user.email}</p>
                    <Link
                      href="/settings"
                      role="menuitem"
                      className={`accountitem${pathname === "/settings" ? " is-active" : ""}`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.5a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                      </svg>
                      <span className="label">Settings</span>
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      className="accountitem"
                      onClick={signOut}
                      disabled={signingOut}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M15 17l5-5-5-5" />
                        <path d="M20 12H9" />
                        <path d="M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
                      </svg>
                      <span className="label">{signingOut ? "Signing out…" : "Sign out"}</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="accountbtn"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <span className="avatar" aria-hidden="true">
                    {(user.name || user.email || "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="who" title={user.email}>{user.name || user.email}</span>
                  <svg className="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {confirming && (
        <Confirm
          title={`Delete “${confirming.name}”?`}
          body={
            confirming.count > 0
              ? `The project goes for good; the ${confirming.count} artifact${
                  confirming.count === 1 ? "" : "s"
                } inside move to the trash, where you can restore ${
                  confirming.count === 1 ? "it" : "them"
                } for the next few days. Their /a/ links stop working now.`
              : "This project is empty. Deleting it cannot be undone."
          }
          confirmLabel={confirming.count > 0 ? `Delete project and trash ${confirming.count} artifact${confirming.count === 1 ? "" : "s"}` : "Delete project"}
          requireText={confirming.count > 0 ? confirming.name : null}
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => deleteProject(confirming)}
        />
      )}
    </>
  );
}
