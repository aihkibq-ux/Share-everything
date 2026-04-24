(() => {
  const siteUtils = window.SiteUtils || {};
  const updateSeoMeta =
    typeof window.updateSeoMeta === "function"
      ? window.updateSeoMeta
      : () => {};
  const PageProgress = window.PageProgress || Object.freeze({
    start() {},
    finish() {},
  });
  const PageRuntime = window.PageRuntime || Object.freeze({
    getPageIdFromUrl: () => null,
    initializePage: () => null,
    cleanupCurrentPage: () => {},
    register: () => {},
  });
  const focusSpaContent = typeof window.focusSpaContent === "function"
    ? window.focusSpaContent
    : () => null;
  const DEFAULT_OG_IMAGE_URL = new URL("favicon.png?v=2", window.location.origin).href;
  const DEFAULT_OG_IMAGE_ALT = "Share Everything";
  const connectionInfo =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection ||
    null;
  const getPostIdFromUrl =
    typeof siteUtils.getPostIdFromUrl === "function"
      ? siteUtils.getPostIdFromUrl
      : () => null;
  const buildPostUrl =
    typeof siteUtils.buildPostUrl === "function"
      ? siteUtils.buildPostUrl
      : (postId) => new URL(`/posts/${encodeURIComponent(postId)}`, window.location.origin).href;
  const rememberBlogReturnUrl =
    typeof siteUtils.rememberBlogReturnUrl === "function"
      ? siteUtils.rememberBlogReturnUrl
      : () => null;
  const ROUTE_EXIT_TRANSITION = "opacity 0.2s ease, transform 0.2s var(--transition-smooth)";
  const ROUTE_ENTER_TRANSITION = "opacity 0.34s ease, transform 0.34s var(--transition-smooth)";
  const ROUTE_EXIT_TRANSFORM = "translateY(-14px) scale(0.985)";
  const ROUTE_ENTER_START_TRANSFORM = "translateY(22px) scale(0.985)";
  const ROUTE_ENTER_END_TRANSFORM = "translateY(0) scale(1)";
  const ROUTE_TRANSITION_RESET_MS = 380;

  const SPARouter = (() => {
    let navigationToken = 0;
    let activeNavigationController = null;
    const loadedScripts = new Set();
    const loadedStylesheets = new Set();
    const MAX_PAGE_CACHE_ENTRIES = 6;
    const PAGE_CACHE_TTL_MS = 1000 * 60 * 5;
    const pageCache = new Map();
    const prefetched = new Map();
    const pendingPageFetches = new Map();

    function canWarmResources() {
      return !(connectionInfo?.saveData || /(^|-)2g$/.test(connectionInfo?.effectiveType || ""));
    }

    function normalizeSiteUrl(url) {
      const resolved = new URL(url, window.location.href);
      if (resolved.origin === window.location.origin && resolved.pathname === "/index.html") {
        resolved.pathname = "/";
      }
      return resolved;
    }

    function resolveUrl(url) {
      return normalizeSiteUrl(url);
    }

    function getRouteKey(url) {
      const resolved = resolveUrl(url);
      const postId = getPostIdFromUrl(resolved.href);
      if (postId) {
        return buildPostUrl(postId);
      }
      resolved.hash = "";
      return resolved.href;
    }

    function getPageCacheKey(url) {
      const resolved = resolveUrl(getRouteKey(url));
      const pageId = PageRuntime.getPageIdFromUrl(resolved.href);
      if (pageId && pageId !== "post") {
        resolved.search = "";
      }

      return resolved.href;
    }

    function isRouteHtmlCacheable(url) {
      return PageRuntime.getPageIdFromUrl(url) !== "post";
    }

    function buildPostTemplateFallbackUrl(url) {
      const resolved = resolveUrl(url);
      const postId = getPostIdFromUrl(resolved.href);
      if (!postId) return null;

      const templateUrl = new URL("/post.html", resolved.origin);
      templateUrl.searchParams.set("id", postId);
      return templateUrl.href;
    }

    async function requestPageHtml(url, { signal, ignoreSignal = false } = {}) {
      const response = await fetch(url, {
        cache: "no-store",
        signal: ignoreSignal ? undefined : signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.url = url;
        throw error;
      }

      return response.text();
    }

    async function requestRouteHtml(routeKey, { signal, ignoreSignal = false } = {}) {
      try {
        return await requestPageHtml(routeKey, { signal, ignoreSignal });
      } catch (error) {
        const fallbackUrl = error?.status === 404
          ? buildPostTemplateFallbackUrl(routeKey)
          : null;
        if (!fallbackUrl) throw error;

        return requestPageHtml(fallbackUrl, { signal, ignoreSignal: false });
      }
    }

    function rememberPageHtml(cacheKey, html) {
      if (pageCache.has(cacheKey)) {
        pageCache.delete(cacheKey);
      }
      pageCache.set(cacheKey, {
        html,
        cachedAt: Date.now(),
      });

      while (pageCache.size > MAX_PAGE_CACHE_ENTRIES) {
        const oldestCacheKey = pageCache.keys().next().value;
        if (!oldestCacheKey) break;
        pageCache.delete(oldestCacheKey);
        prefetched.delete(oldestCacheKey);
      }
    }

    function readPageHtmlFromCache(cacheKey) {
      const entry = pageCache.get(cacheKey);
      if (!entry) return null;

      if (
        typeof entry.html !== "string" ||
        !Number.isFinite(entry.cachedAt) ||
        Date.now() - entry.cachedAt >= PAGE_CACHE_TTL_MS
      ) {
        pageCache.delete(cacheKey);
        prefetched.delete(cacheKey);
        return null;
      }

      rememberPageHtml(cacheKey, entry.html);
      return entry.html;
    }

    function rememberPrefetchedPage(cacheKey) {
      if (prefetched.has(cacheKey)) {
        prefetched.delete(cacheKey);
      }
      prefetched.set(cacheKey, Date.now());

      while (prefetched.size > MAX_PAGE_CACHE_ENTRIES) {
        const oldestPrefetchedKey = prefetched.keys().next().value;
        if (!oldestPrefetchedKey) break;
        prefetched.delete(oldestPrefetchedKey);
      }
    }

    function hasFreshPrefetch(cacheKey) {
      const prefetchedAt = prefetched.get(cacheKey);
      if (!Number.isFinite(prefetchedAt)) {
        prefetched.delete(cacheKey);
        return false;
      }

      if (Date.now() - prefetchedAt >= PAGE_CACHE_TTL_MS) {
        prefetched.delete(cacheKey);
        return false;
      }

      return true;
    }

    function ensureScript(src) {
      const resolvedSrc = resolveUrl(src).href;
      const hasLoadedScript =
        loadedScripts.has(resolvedSrc) ||
        Array.from(document.scripts || []).some((script) => script.src === resolvedSrc);

      if (hasLoadedScript) {
        loadedScripts.add(resolvedSrc);
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = resolvedSrc;
        script.onload = () => {
          loadedScripts.add(resolvedSrc);
          resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    function ensureStylesheet(href) {
      const resolvedHref = resolveUrl(href).href;
      const existingLink = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(
        (link) => link.href === resolvedHref,
      );
      const hasStylesheet = loadedStylesheets.has(resolvedHref) || Boolean(existingLink);

      if (hasStylesheet) {
        loadedStylesheets.add(resolvedHref);
        if (
          existingLink instanceof HTMLLinkElement &&
          existingLink.hasAttribute("data-deferred-fonts") &&
          existingLink.media === "print"
        ) {
          existingLink.media = "all";
          existingLink.dataset.fontsActivated = "true";
        }
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = resolvedHref;
        link.onload = () => {
          loadedStylesheets.add(resolvedHref);
          resolve();
        };
        link.onerror = () => {
          loadedStylesheets.add(resolvedHref);
          resolve();
        };
        document.head.appendChild(link);
      });
    }

    async function fetchPageHtml(url, { signal } = {}) {
      const routeKey = getRouteKey(url);
      const cacheKey = getPageCacheKey(routeKey);
      const canCacheHtml = isRouteHtmlCacheable(routeKey);
      if (!canCacheHtml) {
        pageCache.delete(cacheKey);
        prefetched.delete(cacheKey);
      }

      const cachedHtml = canCacheHtml ? readPageHtmlFromCache(cacheKey) : null;
      if (cachedHtml) {
        return cachedHtml;
      }

      if (canCacheHtml) {
        const pendingFetch = pendingPageFetches.get(cacheKey);
        if (pendingFetch) {
          return pendingFetch;
        }
      }

      const loadPageHtml = async () => {
        const html = await requestRouteHtml(routeKey, {
          signal,
          ignoreSignal: canCacheHtml,
        });
        if (canCacheHtml) {
          rememberPageHtml(cacheKey, html);
        }
        return html;
      };

      if (canCacheHtml) {
        const pendingFetch = loadPageHtml().finally(() => {
          if (pendingPageFetches.get(cacheKey) === pendingFetch) {
            pendingPageFetches.delete(cacheKey);
          }
        });
        pendingPageFetches.set(cacheKey, pendingFetch);
        return pendingFetch;
      }

      return requestRouteHtml(routeKey, {
        signal,
      });
    }

    function warmPage(url) {
      if (!canWarmResources()) return;
      const routeKey = getRouteKey(url);
      if (!isRouteHtmlCacheable(routeKey)) return;

      const cacheKey = getPageCacheKey(routeKey);
      if (hasFreshPrefetch(cacheKey) || readPageHtmlFromCache(cacheKey)) return;

      rememberPrefetchedPage(cacheKey);
      fetchPageHtml(routeKey).catch(() => {
        prefetched.delete(cacheKey);
      });
    }

    function waitForPaintOpportunity() {
      return new Promise((resolve) => {
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => resolve());
          return;
        }

        setTimeout(resolve, 16);
      });
    }

    async function navigate(url, pushState = true) {
      const content = document.getElementById("spa-content");
      if (!content) {
        window.location.href = url;
        return;
      }

      const targetUrl = resolveUrl(url);
      const currentRouteKey = getRouteKey(window.location.href);
      const targetRouteKey = getRouteKey(targetUrl.href);
      if (pushState && targetRouteKey === currentRouteKey) return;

      PageProgress.start();

      const currentPageId = PageRuntime.getPageIdFromUrl(window.location.href);
      const targetPageId = PageRuntime.getPageIdFromUrl(targetRouteKey);
      const currentToken = ++navigationToken;

      if (currentPageId === "blog" && targetPageId === "post") {
        rememberBlogReturnUrl(window.location.href);
      }

      activeNavigationController?.abort();
      activeNavigationController = new AbortController();

      PageRuntime.cleanupCurrentPage();

      content.style.pointerEvents = "none";
      content.style.willChange = "opacity, transform";
      content.style.transition = ROUTE_EXIT_TRANSITION;
      content.style.opacity = "0";
      content.style.transform = ROUTE_EXIT_TRANSFORM;

      try {
        const html = await fetchPageHtml(targetRouteKey, {
          signal: activeNavigationController.signal,
        });
        if (currentToken !== navigationToken) return;

        await waitForPaintOpportunity();
        if (currentToken !== navigationToken) return;

        const doc = new DOMParser().parseFromString(html, "text/html");
        const newContent = doc.getElementById("spa-content");
        if (!newContent) {
          window.location.href = targetRouteKey;
          return;
        }

        const extStylesheets = doc.querySelectorAll(
          'link[rel="stylesheet"][href]:not([href*="style.css"])',
        );
        for (const link of extStylesheets) {
          const styleHref = link.getAttribute("href");
          if (styleHref) {
            await ensureStylesheet(styleHref);
          }
        }
        if (currentToken !== navigationToken) return;

        const extScripts = doc.querySelectorAll('script[src]:not([data-spa-runtime])');
        for (const scriptElement of extScripts) {
          const scriptSrc = scriptElement.getAttribute("src");
          if (scriptSrc) {
            await ensureScript(scriptSrc);
          }
        }
        if (currentToken !== navigationToken) return;

        if (pushState) {
          history.pushState(null, "", targetUrl.href);
        }

        const nextTitle = doc.title || "Share Everything";
        const nextDescription = doc.querySelector('meta[name="description"]')?.content || "";
        const nextOgTitle = doc.querySelector('meta[property="og:title"]')?.content || nextTitle;
        const nextOgDescription =
          doc.querySelector('meta[property="og:description"]')?.content || nextDescription;
        const nextOgImage =
          doc.querySelector('meta[property="og:image"]')?.content || DEFAULT_OG_IMAGE_URL;
        const nextOgImageAlt =
          doc.querySelector('meta[property="og:image:alt"]')?.content || nextTitle || DEFAULT_OG_IMAGE_ALT;
        const nextOgType = doc.querySelector('meta[property="og:type"]')?.content || "website";
        const nextRobots = doc.querySelector('meta[name="robots"]')?.content ?? null;
        const nextCanonicalUrl = doc.querySelector('link[rel="canonical"]')?.href || targetUrl.href;

        updateSeoMeta({
          title: nextTitle,
          description: nextDescription,
          url: targetUrl.href,
          canonicalUrl: nextCanonicalUrl,
          ogTitle: nextOgTitle,
          ogDescription: nextOgDescription,
          ogImage: nextOgImage,
          ogImageAlt: nextOgImageAlt,
          ogType: nextOgType,
          robots: nextRobots,
        });

        content.innerHTML = newContent.innerHTML;
        content.dataset.pendingFocus = targetPageId || "page";
        window.StructuredData?.clear?.("post-article");

        content.querySelectorAll(".page-transition-wrapper").forEach((element) => {
          element.style.animation = "none";
        });
        content.querySelectorAll(".top-actions").forEach((element) => {
          element.style.animation = "none";
          element.style.opacity = "1";
          element.style.transform = "none";
        });

        PageRuntime.initializePage(targetPageId);

        window.scrollTo({ top: 0, behavior: "auto" });
        window.requestAnimationFrame(() => {
          if (currentToken !== navigationToken) return;
          focusSpaContent({
            root: content,
            clearPendingFocus: targetPageId !== "post",
          });
        });

        content.style.opacity = "0";
        content.style.transform = ROUTE_ENTER_START_TRANSFORM;
        void content.offsetHeight;
        content.style.transition = ROUTE_ENTER_TRANSITION;
        content.style.opacity = "1";
        content.style.transform = ROUTE_ENTER_END_TRANSFORM;

        setTimeout(() => {
          if (currentToken !== navigationToken) return;
          content.style.transition = "";
          content.style.opacity = "";
          content.style.transform = "";
          content.style.pointerEvents = "";
          content.style.willChange = "";
        }, ROUTE_TRANSITION_RESET_MS);
      } catch (error) {
        if (error?.name === "AbortError" || currentToken !== navigationToken) {
          return;
        }
        console.error("SPA navigation failed, falling back:", error);
        window.location.href = targetRouteKey;
        return;
      } finally {
        if (currentToken === navigationToken) {
          activeNavigationController = null;
          PageProgress.finish();
        }
      }
    }

    document.addEventListener("click", (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest("a");
      if (!link || !link.href || link.target === "_blank" || link.hasAttribute("download")) return;

      const nextUrl = resolveUrl(link.href);
      const currentUrl = resolveUrl(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) {
        if (nextUrl.hash !== currentUrl.hash) return;
        if (nextUrl.hash) return;
      }

      event.preventDefault();
      navigate(nextUrl.href);
    });

    window.addEventListener("popstate", () => navigate(window.location.href, false));

    document.addEventListener(
      "pointerover",
      (event) => {
        if (event.pointerType === "touch" || !canWarmResources()) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const link = target.closest("a");
        if (link && link.href && link.href.startsWith(window.location.origin)) {
          warmPage(link.href);
        }
      },
      {
        passive: true,
      },
    );

    document.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest("a");
      if (link && link.href && link.href.startsWith(window.location.origin)) {
        warmPage(link.href);
      }
    });

    history.replaceState(null, "", resolveUrl(window.location.href).href);
    return { navigate };
  })();

  window.SPARouter = SPARouter;
})();
