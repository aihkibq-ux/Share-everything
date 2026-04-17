/**
 * runtime-core.js — shared runtime primitives
 */

(function initRuntimeCore() {
  function ensureStructuredDataTag(key) {
    const selector = `script[type="application/ld+json"][data-structured-data="${key}"]`;
    let script = document.head?.querySelector(selector);
    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute("data-structured-data", key);
      document.head?.appendChild(script);
    }
    return script;
  }

  function clearStructuredData(key) {
    if (!key) return;
    document.head
      ?.querySelector(`script[type="application/ld+json"][data-structured-data="${key}"]`)
      ?.remove();
  }

  function setStructuredData(key, payload) {
    if (!key) return;
    if (!payload || typeof payload !== "object") {
      clearStructuredData(key);
      return;
    }

    ensureStructuredDataTag(key).textContent = JSON.stringify(payload);
  }

  window.StructuredData = Object.freeze({
    set: setStructuredData,
    clear: clearStructuredData,
  });

  const PageProgress = (() => {
    let root = null;
    let bar = null;
    let trickleTimer = null;
    let hideTimer = null;
    let currentValue = 0;

    function ensureElements() {
      if (root && bar) {
        return { root, bar };
      }

      root = document.getElementById("pageProgress");
      if (!(root instanceof HTMLElement)) {
        root = document.createElement("div");
        root.id = "pageProgress";
        root.className = "page-progress";
        root.setAttribute("aria-hidden", "true");

        bar = document.createElement("span");
        bar.className = "page-progress-bar";
        root.appendChild(bar);
        document.body?.appendChild(root);
      } else {
        bar = root.querySelector(".page-progress-bar");
        if (!(bar instanceof HTMLElement)) {
          bar = document.createElement("span");
          bar.className = "page-progress-bar";
          root.appendChild(bar);
        }
      }

      return { root, bar };
    }

    function setProgress(value) {
      const nextValue = Math.max(0, Math.min(1, value));
      currentValue = nextValue;
      ensureElements().bar.style.transform = `scaleX(${nextValue})`;
    }

    function stopTrickle() {
      if (trickleTimer != null) {
        clearInterval(trickleTimer);
        trickleTimer = null;
      }
    }

    function start() {
      const elements = ensureElements();
      if (hideTimer != null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }

      stopTrickle();
      elements.root.classList.remove("is-complete");
      elements.root.classList.add("is-visible");
      setProgress(0.08);

      trickleTimer = window.setInterval(() => {
        const delta = currentValue < 0.35
          ? 0.14
          : currentValue < 0.65
            ? 0.08
            : 0.03;
        setProgress(Math.min(0.9, currentValue + delta));
      }, 160);
    }

    function finish() {
      const elements = ensureElements();
      stopTrickle();
      elements.root.classList.add("is-visible");
      setProgress(Math.max(currentValue, 0.96));

      window.requestAnimationFrame(() => {
        setProgress(1);
        elements.root.classList.add("is-complete");

        hideTimer = window.setTimeout(() => {
          elements.root.classList.remove("is-visible", "is-complete");
          setProgress(0);
          hideTimer = null;
        }, 260);
      });
    }

    return { start, finish };
  })();

  function findPageFocusTarget(root, preferredSelectors = []) {
    if (!(root instanceof HTMLElement)) return null;

    const selectors = [
      ...preferredSelectors,
      "[data-page-focus]",
      ".page-title",
      ".post-title",
      ".hero-title",
      "h1",
    ];

    for (const selector of selectors) {
      const target = root.querySelector(selector);
      if (target instanceof HTMLElement) {
        return target;
      }
    }

    return root;
  }

  function makeTemporarilyFocusable(target) {
    if (!(target instanceof HTMLElement)) return null;

    const isNaturallyFocusable =
      target.tabIndex >= 0 ||
      target instanceof HTMLAnchorElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable;

    if (!isNaturallyFocusable && !target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
      target.dataset.spaManagedFocus = "true";
    }

    return target;
  }

  function focusSpaContent({ root, preferredSelectors = [], clearPendingFocus = true } = {}) {
    if (!(root instanceof HTMLElement)) return null;

    const target = makeTemporarilyFocusable(findPageFocusTarget(root, preferredSelectors));
    if (!target) return null;

    target.focus({ preventScroll: true });
    if (clearPendingFocus) {
      delete root.dataset.pendingFocus;
    }
    return target;
  }

  const PageRuntime = (() => {
    const registry = new Map();
    let currentCleanup = null;

    function getPageIdFromUrl(url = window.location.href) {
      const { pathname } = new URL(url, window.location.origin);
      const normalizedPath =
        pathname === "/" ? "/index.html" : pathname.endsWith("/") ? `${pathname}index.html` : pathname;

      if (normalizedPath.endsWith("/index.html")) return "index";
      if (normalizedPath.endsWith("/blog.html")) return "blog";
      if (pathname.startsWith("/posts/")) return "post";
      if (normalizedPath.endsWith("/post.html")) return "post";
      return null;
    }

    function cleanupCurrentPage() {
      if (typeof currentCleanup !== "function") {
        currentCleanup = null;
        return;
      }

      try {
        currentCleanup();
      } catch (error) {
        console.error("Page cleanup error:", error);
      } finally {
        currentCleanup = null;
      }
    }

    function initializePage(pageId = getPageIdFromUrl(window.location.href)) {
      cleanupCurrentPage();

      if (document.body) {
        document.body.dataset.page = pageId || "";
      }

      const pageModule = pageId ? registry.get(pageId) : null;
      if (!pageModule?.init) return null;

      try {
        currentCleanup = pageModule.init() || null;
      } catch (error) {
        currentCleanup = null;
        console.error(`Page init error (${pageId || "unknown"}):`, error);
      }

      return currentCleanup;
    }

    function register(pageId, pageModule) {
      registry.set(pageId, pageModule);

      if (pageId === getPageIdFromUrl(window.location.href)) {
        initializePage(pageId);
      }
    }

    return {
      getPageIdFromUrl,
      initializePage,
      cleanupCurrentPage,
      register,
    };
  })();

  window.PageProgress = PageProgress;
  window.PageRuntime = PageRuntime;
  window.focusSpaContent = focusSpaContent;
})();
