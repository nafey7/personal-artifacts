// Runs inside the artifact's own frame. That frame has an opaque origin — it
// cannot read this site's cookies or call its API — and the page around it
// cannot read the frame's scroll position either. This is the whole bridge
// across that line, and it carries one number in each direction: how far down
// the artifact is scrolled, and where to scroll it to. Nothing else.
//
// It is what lets Edit open in place at the spot you were reading rather than
// throwing you back to the top.
(function () {
  var root = document.scrollingElement || document.documentElement;

  function report() {
    try {
      parent.postMessage({ artifactFrame: "scroll", y: root.scrollTop }, "*");
    } catch (err) {
      // A frame with no parent to talk to has nothing to report.
    }
  }

  addEventListener("scroll", report, { passive: true });
  addEventListener("load", report);
  report();

  // A document that has only just loaded may not have laid out far enough to
  // accept a scroll: images and fonts are still arriving, and the page is
  // briefly shorter than it will be. Keep asking across a few frames, and stop
  // as soon as the position lands or the page turns out to be shorter than it.
  function settle(y, tries) {
    // An artifact asking for smooth scrolling means it for its reader, not for
    // this: a position being restored should simply be there.
    root.style.setProperty("scroll-behavior", "auto", "important");
    root.scrollTop = y;
    if (tries > 0 && root.scrollTop < y - 1) {
      requestAnimationFrame(function () { settle(y, tries - 1); });
      return;
    }
    // The page around this is holding the frame unpainted until it hears back.
    try {
      parent.postMessage({ artifactFrame: "settled" }, "*");
    } catch (err) {}
  }

  addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.artifactFrame !== "scrollTo") return;
    settle(Number(data.y) || 0, 30);
  });
})();

// In-page links, kept in the page.
//
// This document is srcdoc, so its base URL is the page around it, not itself:
// an artifact's own <a href="#section"> resolves to /a/<slug>#section and
// navigates the whole frame there. The frame's origin is opaque, so that
// request carries no session cookie and the site answers it as a stranger —
// which is how a contents list came to land on "Not found, or not shared with
// you". Nothing is wrong with the link; it just needs to be read as what the
// author meant, a jump within this document.
(function () {
  var root = document.scrollingElement || document.documentElement;

  function targetFor(hash) {
    var id = hash.slice(1);
    if (!id || id === "top") return root;
    var found = null;
    try {
      found = document.getElementById(decodeURIComponent(id));
    } catch (err) {
      // A hash that isn't valid percent-encoding: take it literally.
    }
    if (!found) found = document.getElementById(id);
    if (!found) {
      found = document.querySelector('[name="' + id.replace(/["\\]/g, "\\$&") + '"]');
    }
    return found;
  }

  function jump(node) {
    if (node === root) {
      root.scrollTop = 0;
      return;
    }
    // scrollIntoView honours the artifact's own scroll-behavior, so a page
    // that asked for smooth scrolling still gets it.
    node.scrollIntoView();
    // Send the keyboard along with the eye. Elements that can't normally hold
    // focus are made able to just for this, the way a browser's own fragment
    // navigation does.
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    try {
      node.focus({ preventScroll: true });
    } catch (err) {
      // Nothing focusable here; the scroll already did the useful part.
    }
  }

  addEventListener(
    "click",
    function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target && event.target.closest && event.target.closest("a[href]");
      if (!link || (link.target && link.target !== "_self")) return;
      if (link.hasAttribute("download")) return;

      // Resolved, not as written: this catches "#x" and the "/a/<slug>#x" an
      // artifact may have written out in full, and lets a genuinely external
      // link through untouched.
      // Compared against the base URL, not location: inside srcdoc the
      // document's own address is "about:srcdoc" while links resolve against
      // the page around it, so the base is the only thing a "#x" agrees with.
      var here = document.baseURI.split("#")[0];
      var url = link.href;
      var cut = url.indexOf("#");
      if (cut === -1 || url.slice(0, cut) !== here) return;

      var hash = url.slice(cut);
      // A bare "#" is a button wearing a link's clothes. Swallow the
      // navigation — it would reload the frame — and leave the rest alone.
      if (hash === "#") {
        event.preventDefault();
        return;
      }

      var node = targetFor(hash);
      if (!node) return; // No such anchor: let the browser do whatever it would.
      event.preventDefault();
      jump(node);
    },
    true
  );

  // An artifact that navigates itself — location.hash = "...", or a router
  // pushing a fragment — would take the frame with it for the same reason.
  // Catch that at the last moment and scroll instead.
  addEventListener("hashchange", function (event) {
    var to = String(event.newURL || "");
    var cut = to.indexOf("#");
    if (cut === -1) return;
    var node = targetFor(to.slice(cut));
    if (node) jump(node);
  });

  // A link the reader was handed with a fragment already on it: the page
  // around this one passes it down as the frame's URL, but the browser has no
  // fragment to act on inside srcdoc.
  addEventListener("load", function () {
    var hash = location.hash;
    if (!hash || hash === "#") return;
    var node = targetFor(hash);
    if (node && node !== root) jump(node);
  });
})();
