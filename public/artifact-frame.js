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
