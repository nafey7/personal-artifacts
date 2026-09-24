// Opens an encrypted artifact in the browser. The page around this carries
// the ciphertext and the wrapped keys in data- attributes on #ae-stage; the
// server that sent them could not read them, and this script is what turns
// them back into the page. It is loaded with an integrity hash from
// lib/integrity.js, so a changed copy does not run.
//
// Where the key comes from, in order:
//
//   1. the link itself: #k=<key> after the hash, which the browser never
//      sends to the server
//   2. this browser's keystore: the account key an owner unlocked on sign-in,
//      which opens `data-wrapped`
//   3. a passphrase: the one the server's gate just accepted, handed over in
//      sessionStorage, or typed here; it opens `data-passphrase`
//   4. the owner's password, if the meta endpoint says the reader owns the
//      page: unlocks the keystore for next time, then as 2
//
// Anything else is told, in words, that the link is missing its key — never
// a blank page.
//
// The keystore names match lib/keystore.js. Change one and change both.
(function () {
  "use strict";

  var C = window.ArtifactCrypto;
  var stage = document.getElementById("ae-stage");
  var frame = document.getElementById("ae-view");
  var lock = document.getElementById("ae-lock");
  var message = document.getElementById("ae-lock-msg");
  var form = document.getElementById("ae-lock-form");
  var field = document.getElementById("ae-lock-field");
  var label = document.getElementById("ae-lock-label");
  var button = document.getElementById("ae-lock-go");

  var slug = stage.getAttribute("data-slug");
  var ct = stage.getAttribute("data-ct");
  var iv = stage.getAttribute("data-iv");
  var wrapped = parse(stage.getAttribute("data-wrapped"));
  var byPassphrase = parse(stage.getAttribute("data-passphrase"));

  var BRIDGE = '<script src="/artifact-frame.js"></' + 'script>';
  var HANDOFF = "artifact-pass:" + slug;

  function parse(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch (err) {
      return null;
    }
  }

  function withBridge(html) {
    var at = html.toLowerCase().lastIndexOf("</body>");
    return at === -1 ? html + BRIDGE : html.slice(0, at) + BRIDGE + html.slice(at);
  }

  /* ---------- the keystore, read-only here ---------- */

  var DB = "artifact-keys";
  var STORE = "keys";
  var ID = "account";

  function openStore() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function storeGet() {
    return openStore().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(ID);
        tx.oncomplete = function () { db.close(); resolve(req.result instanceof CryptoKey ? req.result : null); };
        tx.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function storePut(key) {
    return openStore().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(key, ID);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  /* ---------- the ways in ---------- */

  function fromFragment() {
    var m = /[#&]k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
    if (!m) return Promise.resolve(null);
    return C.importKey(C.b64u.decode(m[1])).catch(function () { return null; });
  }

  function fromKeystore() {
    if (!wrapped) return Promise.resolve(null);
    return storeGet().then(function (account) {
      if (!account) return null;
      return C.unwrap(wrapped, account).catch(function () { return null; });
    });
  }

  function fromPassphrase(text) {
    if (!byPassphrase || !text) return Promise.resolve(null);
    return C.unwrapWithPassphrase(byPassphrase, text).catch(function () { return null; });
  }

  // The server's gate asked for the passphrase a moment ago and the form
  // left it here for us, so the reader is not asked twice.
  function handedOver() {
    try {
      var text = sessionStorage.getItem(HANDOFF);
      if (text !== null) sessionStorage.removeItem(HANDOFF);
      return text || "";
    } catch (err) {
      return "";
    }
  }

  function isOwner() {
    return fetch("/api/artifacts/" + encodeURIComponent(slug) + "?meta=1", { credentials: "same-origin" })
      .then(function (res) { return res.ok; })
      .catch(function () { return false; });
  }

  // The owner on a browser that has not been unlocked: the password opens
  // the account key here and keeps it for next time, as the dashboard would.
  function unlockOwner(password) {
    return fetch("/api/auth/keys", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (keys) {
        if (!keys || keys.authVersion !== 2 || !keys.accountKeyByPassword || !keys.email) return null;
        return C.deriveFromPassword(password, keys.email)
          .then(C.split)
          .then(function (parts) {
            return C.unwrap(keys.accountKeyByPassword, parts.wrapKey, { extractable: false });
          })
          .then(function (account) {
            return storePut(account).then(function () {
              return wrapped ? C.unwrap(wrapped, account) : null;
            });
          })
          .catch(function () { return null; });
      })
      .catch(function () { return null; });
  }

  /* ---------- showing things ---------- */

  function say(text, bad) {
    message.textContent = text;
    message.className = bad ? "bad" : "";
  }

  function ask(kind, prompt, placeholder, onSubmit) {
    label.textContent = prompt;
    field.value = "";
    field.placeholder = placeholder;
    field.setAttribute("autocomplete", kind === "password" ? "current-password" : "off");
    form.hidden = false;
    button.disabled = false;
    form.onsubmit = function (e) {
      e.preventDefault();
      var value = field.value;
      if (!value) return;
      button.disabled = true;
      say(kind === "password" ? "Unlocking…" : "Checking…");
      onSubmit(value);
    };
    setTimeout(function () { field.focus(); }, 0);
  }

  function reveal(html, key) {
    frame.srcdoc = withBridge(html);
    lock.hidden = true;
    frame.classList.remove("ae-staging");
    // What the editor needs: the page as words, and the key to seal it again.
    window.ArtifactView = { encrypted: true, key: key, html: html, wrapped: wrapped, slug: slug };
    window.dispatchEvent(new Event("artifact-view:ready"));
  }

  function tryKey(key) {
    if (!key) return Promise.resolve(false);
    return C.decrypt({ v: 1, iv: iv, ct: ct }, key).then(
      function (html) { reveal(html, key); return true; },
      function () { return false; }
    );
  }

  function missing() {
    say("This link is missing its key.", true);
    var hint = document.getElementById("ae-lock-hint");
    hint.hidden = false;
    hint.textContent = /[#&]k=/.test(location.hash)
      ? "The part after # in the address is not the key for this page — it may have been cut short or changed. Ask whoever shared it for the full link."
      : "This page is encrypted end to end, and the key travels in the link after the #. Ask whoever shared it for the full link, including everything after the #.";
  }

  function askPassphrase(retry) {
    say(retry ? "That passphrase is not right." : "This page asks for a passphrase to decrypt it.", retry);
    ask("passphrase", "Passphrase", "Passphrase", function (value) {
      fromPassphrase(value).then(tryKey).then(function (ok) {
        if (!ok) askPassphrase(true);
      });
    });
  }

  function askOwner(retry) {
    say(retry ? "That password is not right." : "Unlock this browser to open your encrypted artifact.", retry);
    ask("password", "Your password", "Password", function (value) {
      unlockOwner(value).then(tryKey).then(function (ok) {
        if (!ok) askOwner(true);
      });
    });
  }

  /* ---------- go ---------- */

  if (!C || !ct || !iv) {
    say("This page could not be decrypted in this browser.", true);
    return;
  }

  say("Decrypting…");

  fromFragment()
    .then(tryKey)
    .then(function (ok) { return ok || fromKeystore().then(tryKey); })
    .then(function (ok) { return ok || fromPassphrase(handedOver()).then(tryKey); })
    .then(function (ok) {
      if (ok) return;
      if (byPassphrase) return askPassphrase(false);
      return isOwner().then(function (owner) {
        if (owner && wrapped) askOwner(false);
        else missing();
      });
    })
    .catch(function () { missing(); });
})();
