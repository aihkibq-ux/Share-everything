(() => {
  const FONT_LINK_SELECTOR = 'link[data-deferred-fonts][rel="stylesheet"]';
  const FALLBACK_DELAY = 3000;

  function activateFontLink(link) {
    if (!(link instanceof HTMLLinkElement)) return;
    if (link.dataset.fontsActivated === "true") return;

    link.media = "all";
    link.dataset.fontsActivated = "true";
  }

  function prepareFontLink(link) {
    if (!(link instanceof HTMLLinkElement)) return;
    if (link.dataset.fontsPrepared === "true") {
      activateFontLink(link);
      return;
    }

    link.dataset.fontsPrepared = "true";

    let fallbackTimer = null;
    const finish = () => {
      if (fallbackTimer != null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      activateFontLink(link);
    };
    if (link.sheet) {
      finish();
      return;
    }

    link.addEventListener("load", finish, { once: true });
    link.addEventListener("error", finish, { once: true });
    fallbackTimer = window.setTimeout(finish, FALLBACK_DELAY);
  }

  function initDeferredFonts() {
    document.querySelectorAll(FONT_LINK_SELECTOR).forEach(prepareFontLink);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDeferredFonts, {
      once: true,
    });
  } else {
    initDeferredFonts();
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      initDeferredFonts();
    }
  });
})();
