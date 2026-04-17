(() => {
  const siteUtils = window.SiteUtils || {};
  const cursorGlow = document.getElementById("cursorGlow");
  const finePointerQuery =
    typeof siteUtils.createMediaQueryList === "function"
      ? siteUtils.createMediaQueryList("(hover: hover) and (pointer: fine)")
      : window.matchMedia?.("(hover: hover) and (pointer: fine)") || {
        matches: false,
        addEventListener: null,
        removeEventListener: null,
        addListener: () => {},
        removeListener: () => {},
      };
  const reducedMotionQuery =
    typeof siteUtils.createMediaQueryList === "function"
      ? siteUtils.createMediaQueryList("(prefers-reduced-motion: reduce)")
      : window.matchMedia?.("(prefers-reduced-motion: reduce)") || {
        matches: false,
        addEventListener: null,
        removeEventListener: null,
        addListener: () => {},
        removeListener: () => {},
      };
  let mouseAF = null;
  let cursorTrackingEnabled = false;
  let latestPointerX = 0;
  let latestPointerY = 0;

  function bindMediaQueryChange(mediaQueryList, handler) {
    if (!mediaQueryList) return;

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handler);
      return;
    }

    mediaQueryList.addListener?.(handler);
  }

  function canUseCursorGlow() {
    return Boolean(cursorGlow) && finePointerQuery.matches && !reducedMotionQuery.matches;
  }

  function syncParticlePointer(clientX, clientY) {
    if (typeof window.ParticlesRuntime?.setPointerTarget === "function") {
      window.ParticlesRuntime.setPointerTarget(clientX, clientY);
    }
  }

  function handleMouseMove(event) {
    latestPointerX = event.clientX;
    latestPointerY = event.clientY;
    syncParticlePointer(latestPointerX, latestPointerY);

    if (mouseAF) return;
    mouseAF = requestAnimationFrame(() => {
      if (cursorGlow && cursorTrackingEnabled) {
        cursorGlow.style.transform = `translate(${latestPointerX - 200}px, ${latestPointerY - 200}px)`;
      }
      mouseAF = null;
    });
  }

  function syncCursorGlowState() {
    const enabled = canUseCursorGlow();
    document.body?.classList.toggle("has-cursor-glow", enabled);

    if (enabled === cursorTrackingEnabled) return;
    cursorTrackingEnabled = enabled;

    if (!enabled && cursorGlow) {
      cursorGlow.style.transform = "";
    }
  }

  function initBlogCardReveal() {
    const blogCards = document.querySelectorAll(".blog-card");
    if (blogCards.length === 0) return () => {};

    if (typeof IntersectionObserver !== "function") {
      blogCards.forEach((card) => card.classList.add("visible"));
      return () => {};
    }

    const revealTimeouts = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const card = entry.target;
          const index = Number(card.dataset.revealIndex || 0);
          const timeoutId = window.setTimeout(() => {
            revealTimeouts.delete(timeoutId);
            card.classList.add("visible");
          }, index * 80);
          revealTimeouts.add(timeoutId);
          observer.unobserve(card);
        });
      },
      { threshold: 0.1 },
    );

    blogCards.forEach((element, index) => {
      element.dataset.revealIndex = String(index);
      observer.observe(element);
    });

    return () => {
      observer.disconnect();
      revealTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      revealTimeouts.clear();
    };
  }

  document.addEventListener("mousemove", handleMouseMove, { passive: true });
  bindMediaQueryChange(finePointerQuery, syncCursorGlowState);
  bindMediaQueryChange(reducedMotionQuery, syncCursorGlowState);
  syncCursorGlowState();

  document.addEventListener("mousedown", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".post-content")) return;
    if (event.target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;

    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
  });

  window.initBlogCardReveal = initBlogCardReveal;
})();
