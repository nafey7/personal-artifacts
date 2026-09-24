"use client";

import { useEffect } from "react";

// Fades sections in as they scroll into view. It renders nothing: the
// content is already in the HTML, and the CSS only hides it once this has
// marked the page as scripted, so crawlers and no-JS readers see everything.
export default function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = Array.from(document.querySelectorAll("[data-reveal]"));
    if (reduce || !("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    root.classList.add("lp-js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => {
      io.disconnect();
      root.classList.remove("lp-js");
    };
  }, []);
  return null;
}
