// Editing an artifact is a mode of the page it is published on, not a page of
// its own. Opening and closing the editor swaps one frame for another inside a
// document that never goes away, so the artifact is never reloaded and you
// stay exactly where you were reading.
//
// The two frames differ only in their sandbox, and that is the reason a swap
// is needed at all: a sandbox is fixed when a frame loads.
//
//   viewing   allow-scripts, no allow-same-origin  — the artifact runs, walled
//             off from this site
//   editing   allow-same-origin, no allow-scripts  — this page can reach in and
//             make text editable, and nothing the artifact ships can run
(function () {
  "use strict";

  // Elements whose text reads as one thing. A click lands on the innermost
  // element under the pointer, so a word inside <strong> would otherwise put
  // just that word in play; walking up to the nearest of these means clicking
  // anywhere in a paragraph edits the paragraph.
  var BLOCKS = ("P H1 H2 H3 H4 H5 H6 LI TD TH DT DD FIGCAPTION BLOCKQUOTE " +
    "CAPTION LABEL BUTTON SUMMARY LEGEND PRE ADDRESS").split(" ");

  // Everything the editor adds to the artifact is marked data-ae*, and every
  // one of those marks is taken back out before the HTML is saved. What lands
  // in the database is the artifact plus the words that were typed.
  var CHROME =
    '[data-ae-hover]:not([data-ae-edit]) { outline: 1px dashed rgba(99,201,183,.6); outline-offset: 2px; cursor: text; }\n' +
    '[data-ae-edit] { outline: 2px solid #63C9B7; outline-offset: 2px; border-radius: 2px; }\n' +
    'html { scroll-behavior: auto !important; }';

  var BRIDGE = '<script src="/artifact-frame.js"></' + 'script>';

  function hasOwnText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3 && node.nodeValue.trim()) return true;
    }
    return false;
  }

  // What a click at `target` should put in play, or null if there is no text
  // there to edit.
  function editableFrom(target) {
    var own = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (!own) return null;

    var el = own;
    for (var hops = 0; el && hops < 8; hops++) {
      if (el.tagName === "BODY" || el.tagName === "HTML") break;
      if (BLOCKS.indexOf(el.tagName) !== -1) return el;
      el = el.parentElement;
    }

    // Div soup — nothing semantic to grab. Take the element the pointer is
    // actually over, as long as it holds text of its own rather than just
    // wrapping other elements that do.
    return hasOwnText(own) ? own : null;
  }

  function caretAt(doc, x, y) {
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    if (doc.caretPositionFromPoint) {
      var pos = doc.caretPositionFromPoint(x, y);
      if (!pos) return null;
      var range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
    return null;
  }

  // The document back as a string, with the editor's own marks stripped.
  // Working on a clone means the page on screen is never disturbed by a save.
  function serialize(doc) {
    var clone = doc.documentElement.cloneNode(true);
    var i;

    var chrome = clone.querySelectorAll("style[data-ae]");
    for (i = 0; i < chrome.length; i++) chrome[i].parentNode.removeChild(chrome[i]);

    var hovered = clone.querySelectorAll("[data-ae-hover]");
    for (i = 0; i < hovered.length; i++) hovered[i].removeAttribute("data-ae-hover");

    var live = clone.querySelectorAll("[data-ae-edit]");
    for (i = 0; i < live.length; i++) {
      live[i].removeAttribute("data-ae-edit");
      live[i].removeAttribute("contenteditable");
      live[i].removeAttribute("spellcheck");
    }

    // The bridge belongs to this site, not to the artifact, so it never gets
    // saved into one.
    var bridge = clone.querySelectorAll('script[src="/artifact-frame.js"]');
    for (i = 0; i < bridge.length; i++) bridge[i].parentNode.removeChild(bridge[i]);

    var dt = doc.doctype;
    var prologue = "";
    if (dt) {
      prologue = "<!DOCTYPE " + dt.name +
        (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : "") +
        (dt.systemId ? (dt.publicId ? "" : " SYSTEM") + ' "' + dt.systemId + '"' : "") +
        ">\n";
    }
    return prologue + clone.outerHTML;
  }

  // The viewing frame needs the bridge to report where it is scrolled. The
  // server adds it when it renders the page; this is the same job for a frame
  // rebuilt here after a save.
  function withBridge(source) {
    var at = source.toLowerCase().lastIndexOf("</body>");
    return at === -1 ? source + BRIDGE : source.slice(0, at) + BRIDGE + source.slice(at);
  }

  // A document that has only just loaded may not have laid out far enough to
  // accept a scroll yet. Keep asking across a few frames, and stop as soon as
  // the position lands — or as soon as it is clear the page is simply shorter,
  // which is what happens when its text was drawn by scripts that are now off.
  function settleScroll(doc, y, tries, done) {
    var root = doc.scrollingElement || doc.documentElement;
    root.scrollTop = y;
    if (tries > 0 && root.scrollTop < y - 1) {
      requestAnimationFrame(function () { settleScroll(doc, y, tries - 1, done); });
      return;
    }
    done();
  }

  function boot(options) {
    var slug = options.slug;
    var api = "/api/artifacts/" + encodeURIComponent(slug);

    var stage = document.getElementById("ae-stage");
    var bar = document.getElementById("ae-bar");
    var openButton = document.getElementById("ae-edit");
    var saveButton = document.getElementById("ae-save");
    var doneButton = document.getElementById("ae-done");
    var stateEl = document.getElementById("ae-state");

    var view = document.getElementById("ae-view");
    var edit = null;      // the editing frame, while it is open
    var html = null;      // what the editing frame started from, and each save
    var viewAt = 0;       // how far the artifact is scrolled, as it reports
    var dirty = false;
    var saving = false;
    var saved = false;    // whether a save happened while this was open
    var timer = null;
    var pending = null;   // a staged frame, waiting until it is in position

    /* ---------- the bar ---------- */

    function rest() {
      stateEl.className = "";
      stateEl.textContent = dirty ? "unsaved" : "";
    }

    function say(text, bad) {
      if (timer) clearTimeout(timer);
      stateEl.textContent = text;
      stateEl.className = bad ? "bad" : "";
      if (text !== "Saving…" && text !== "Opening…") {
        timer = setTimeout(rest, 2400);
      }
    }

    // Holds a frame unpainted until its bridge reports the scroll has landed,
    // so the swap is one step rather than a jump followed by a catch-up. A
    // frame whose bridge was blocked never answers, so it is shown regardless
    // shortly after.
    function onSettled(frame, show) {
      var done = false;
      function fire() {
        if (done) return;
        done = true;
        pending = null;
        show();
      }
      pending = { frame: frame, fire: fire };
      setTimeout(fire, 900);
    }

    function scrollFrame(frame, y) {
      try {
        frame.contentWindow.postMessage({ artifactFrame: "scrollTo", y: y }, "*");
      } catch (err) {
        // A frame whose bridge was blocked simply stays where it loaded.
      }
    }

    // Which mode the page is in is kept in the address bar so a reload comes
    // back to the same place, but written with replaceState: entering the
    // editor is not a navigation, and Back should leave the artifact, not the
    // editor.
    function mark(editing) {
      history.replaceState(null, "", location.pathname + (editing ? "?edit=1" : "") + location.hash);
    }

    // Where the artifact is scrolled, as its own frame reports it — the only
    // way to know, since that frame is walled off from this page. Reports are
    // ignored while the editor is open: hiding a frame resets it to the top,
    // and it would otherwise report that 0 as the reader's place.
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data) return;

      if (data.artifactFrame === "settled") {
        if (pending && event.source === pending.frame.contentWindow) pending.fire();
        return;
      }
      if (edit || !view || event.source !== view.contentWindow) return;
      if (data.artifactFrame === "scroll") viewAt = Number(data.y) || 0;
    });

    /* ---------- opening and closing ---------- */

    function open() {
      if (edit) return;
      say("Opening…");
      fetch(api, { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then(function (data) { mount(data.artifact.html); })
        .catch(function () { say("could not open the editor", true); });
    }

    function mount(source) {
      // Read once, here, before anything on the page moves.
      var at = viewAt;

      html = source;
      dirty = false;
      saved = false;
      saveButton.disabled = true;

      // The bar comes up first, so the editing frame is laid out against the
      // height it will keep and settles to a scroll it will stay at.
      bar.hidden = false;
      openButton.className = "";
      rest();

      edit = document.createElement("iframe");
      edit.id = "ae-editframe";
      edit.className = "ae-frame ae-staging";
      edit.title = view.title;
      edit.setAttribute("sandbox", "allow-same-origin");
      edit.addEventListener("load", function () {
        var doc = edit.contentDocument;
        wire(doc);
        // Brought to the reader's place while it is still unpainted, and only
        // then shown. Painting it first would put the top of the artifact on
        // screen and visibly scroll down to catch up — and a page still laying
        // itself out gains height for several frames, so the catching up would
        // be gradual enough to watch.
        //
        // Scripts are off in here, so a page that draws its own text may be
        // shorter than it was and land higher than this asks for.
        settleScroll(doc, at, 30, function () {
          edit.className = "ae-frame";
          view.className = "ae-frame ae-staging";
        });
      });

      stage.appendChild(edit);
      edit.srcdoc = source;
      mark(true);
    }

    function close() {
      if (!edit) return;
      if (dirty && !window.confirm("You have unsaved edits. Leave without saving?")) return;

      var doc = edit.contentDocument;
      var root = doc ? doc.scrollingElement || doc.documentElement : null;
      var at = root ? root.scrollTop : viewAt;

      var leaving = edit;
      var replaced = null;
      var next = view;

      if (saved) {
        // The viewing frame still shows what was published before the save, so
        // it is rebuilt rather than revealed. Only a frame is replaced — this
        // page, and everything it remembers, carries on.
        replaced = view;
        next = document.createElement("iframe");
        next.id = "ae-view";
        next.className = "ae-frame ae-staging";
        next.title = view.title;
        next.setAttribute("sandbox", view.getAttribute("sandbox"));
        stage.appendChild(next);
      }

      edit = null;
      dirty = false;
      saved = false;
      view = next;
      viewAt = at;

      // The same swap as opening, in reverse: put back where the reader left
      // it while unpainted, then shown.
      onSettled(next, function () {
        next.className = "ae-frame";
        stage.removeChild(leaving);
        if (replaced) stage.removeChild(replaced);
      });

      if (replaced) {
        next.addEventListener("load", function () { scrollFrame(next, at); });
        next.srcdoc = withBridge(html);
      } else {
        // Never hidden with display:none, so it still holds its own scroll —
        // this only follows wherever the editor was left.
        scrollFrame(next, at);
      }

      bar.hidden = true;
      openButton.className = "on";
      rest();
      mark(false);
    }

    /* ---------- saving ---------- */

    function save() {
      if (!edit || saving) return;
      var next = serialize(edit.contentDocument);

      saving = true;
      saveButton.disabled = true;
      say("Saving…");

      fetch(api, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: next })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            saving = false;
            if (!res.ok) {
              saveButton.disabled = false;
              say(body.error || "save failed (" + res.status + ")", true);
              return;
            }
            html = next;
            dirty = false;
            saved = true;
            say("Saved");
          });
        })
        .catch(function () {
          saving = false;
          saveButton.disabled = false;
          say("network error — nothing was saved", true);
        });
    }

    /* ---------- the artifact, while it is being edited ---------- */

    function wire(doc) {
      if (!doc || !doc.body) return;

      var style = doc.createElement("style");
      style.setAttribute("data-ae", "");
      style.textContent = CHROME;
      doc.head.appendChild(style);

      var active = null;
      var hovered = null;

      function release() {
        if (!active) return;
        active.removeAttribute("contenteditable");
        active.removeAttribute("spellcheck");
        active.removeAttribute("data-ae-edit");
        active = null;
      }

      doc.addEventListener("mousemove", function (e) {
        var el = active ? null : editableFrom(e.target);
        if (el === hovered) return;
        if (hovered) hovered.removeAttribute("data-ae-hover");
        hovered = el;
        if (hovered) hovered.setAttribute("data-ae-hover", "");
      }, true);

      doc.addEventListener("click", function (e) {
        // Nothing in the artifact navigates or submits while it is being
        // edited — a link would take the frame somewhere else entirely.
        var link = e.target.closest ? e.target.closest("a[href]") : null;
        if (link) e.preventDefault();

        var el = editableFrom(e.target);
        if (!el || el === active) return;

        release();
        if (hovered) {
          hovered.removeAttribute("data-ae-hover");
          hovered = null;
        }

        active = el;
        el.setAttribute("contenteditable", "true");
        el.setAttribute("spellcheck", "true");
        el.setAttribute("data-ae-edit", "");
        el.focus({ preventScroll: true });

        // Land the caret where the click actually was, rather than at the
        // start of the block.
        var range = caretAt(doc, e.clientX, e.clientY);
        if (range) {
          var sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, true);

      doc.addEventListener("submit", function (e) { e.preventDefault(); }, true);

      doc.addEventListener("input", function () {
        dirty = true;
        saveButton.disabled = false;
        rest();
      }, true);

      doc.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
          return;
        }
        if (!active) return;
        if (e.key === "Escape") {
          e.preventDefault();
          release();
        } else if (e.key === "Enter" && !e.shiftKey) {
          // A line break inside the block, not a new block: the structure of
          // the page is not what this editor is for.
          e.preventDefault();
          doc.execCommand("insertLineBreak");
        }
      }, true);

      // Pasted markup would smuggle in styling and structure from wherever it
      // was copied, so only the words come through.
      doc.addEventListener("paste", function (e) {
        if (!active) return;
        e.preventDefault();
        var text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
        doc.execCommand("insertText", false, text);
      }, true);

      doc.addEventListener("focusout", function () {
        // Let a click that moves straight to another block settle first.
        setTimeout(function () {
          if (active && doc.activeElement !== active) release();
        }, 0);
      }, true);
    }

    /* ---------- wiring ---------- */

    openButton.addEventListener("click", function (e) { e.preventDefault(); open(); });
    saveButton.addEventListener("click", save);
    doneButton.addEventListener("click", close);

    window.addEventListener("keydown", function (e) {
      if (!edit) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    });

    window.addEventListener("beforeunload", function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });

    // The button is owner-only, but a plainly public page is served from a
    // shared cache and never asks who is reading — so the markup ships
    // identical for everyone and the button asks for itself afterwards.
    // Anyone else's request is a 401 or a 404 and it simply stays hidden.
    fetch(api + "?meta=1", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) return;
        openButton.className = "on";
        // Arriving straight into the editor — the pencil in the dashboard.
        if (/[?&]edit=1(&|$)/.test(location.search)) open();
      })
      .catch(function () {});
  }

  window.ArtifactEditor = { boot: boot };
})();
