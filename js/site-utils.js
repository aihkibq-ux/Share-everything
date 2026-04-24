(() => {
  const sharedContent = window.NotionContent || {};
  const BLOG_RETURN_URL_STORAGE_KEY = "spa:last-blog-url";
  const BOOKMARK_HASH_PREFIX = "#bookmarks";

  function createMediaQueryList(query) {
    if (typeof window.matchMedia === "function") {
      return window.matchMedia(query);
    }

    return {
      matches: false,
      addEventListener: null,
      removeEventListener: null,
      addListener: () => {},
      removeListener: () => {},
    };
  }

  function sanitizeImageUrl(candidate) {
    if (typeof sharedContent.resolveDisplayImageUrl === "function") {
      return sharedContent.resolveDisplayImageUrl(candidate, window.location.origin);
    }

    if (!candidate || typeof candidate !== "string") return null;

    try {
      const parsed = new URL(candidate, window.location.origin);
      return parsed.protocol === "https:" || parsed.origin === window.location.origin
        ? parsed.href
        : null;
    } catch (error) {
      return null;
    }
  }

  function resolveDisplayImageUrl(candidate) {
    return sanitizeImageUrl(candidate);
  }

  function resolveProxiedDisplayImageUrl(candidate) {
    if (typeof sharedContent.resolveProxiedDisplayImageUrl === "function") {
      return sharedContent.resolveProxiedDisplayImageUrl(candidate, window.location.origin);
    }

    return sanitizeImageUrl(candidate);
  }

  function sanitizeCoverBackground(value, fallback = null) {
    if (typeof value !== "string") return fallback;

    const trimmed = value.trim();
    const isGradient = /^(linear-gradient|radial-gradient)\([#(),.%\sa-zA-Z0-9+-]+\)$/.test(trimmed);
    if (!trimmed || !isGradient) return fallback;
    if (trimmed.includes(";") || /url\s*\(/i.test(trimmed)) return fallback;
    return trimmed;
  }

  function isLikelyEphemeralAssetUrl(candidate) {
    if (typeof sharedContent.isLikelyEphemeralAssetUrl === "function") {
      return sharedContent.isLikelyEphemeralAssetUrl(candidate, window.location.origin);
    }

    if (!candidate || typeof candidate !== "string") return false;

    try {
      const parsed = new URL(candidate, window.location.href);
      const expiringQueryKeys = [
        "X-Amz-Algorithm",
        "X-Amz-Credential",
        "X-Amz-Date",
        "X-Amz-Expires",
        "X-Amz-Signature",
        "Expires",
        "Signature",
      ];

      return expiringQueryKeys.some((key) => parsed.searchParams.has(key));
    } catch (error) {
      return false;
    }
  }

  function resolveShareImageUrl(candidate, fallback = null) {
    if (typeof sharedContent.resolveShareImageUrl === "function") {
      return sharedContent.resolveShareImageUrl(candidate, fallback, window.location.origin);
    }

    const safeUrl = sanitizeImageUrl(candidate);
    if (!safeUrl || isLikelyEphemeralAssetUrl(safeUrl)) {
      return fallback;
    }

    return safeUrl;
  }

  function normalizePostId(value) {
    if (value == null) return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  function getPostIdFromUrl(url = window.location.href) {
    try {
      const resolved = new URL(url, window.location.origin);
      const pathMatch = resolved.pathname.match(/^\/posts\/([^/?#]+)/);
      if (pathMatch?.[1]) {
        return normalizePostId(decodeURIComponent(pathMatch[1]));
      }

      if (resolved.pathname.endsWith("/post.html")) {
        return normalizePostId(resolved.searchParams.get("id"));
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  function buildPostPath(postId) {
    const normalizedPostId = normalizePostId(postId);
    return normalizedPostId ? `/posts/${encodeURIComponent(normalizedPostId)}` : "/post.html";
  }

  function buildPostUrl(postId) {
    return new URL(buildPostPath(postId), window.location.origin).href;
  }

  function normalizePageNumber(value, fallback = 1) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function buildBookmarkListingHash({ search = "", page = 1 } = {}) {
    const params = new URLSearchParams();
    const normalizedSearch = typeof search === "string" ? search.trim() : "";
    const normalizedPage = normalizePageNumber(page, 1);

    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    }
    if (normalizedPage > 1) {
      params.set("page", String(normalizedPage));
    }

    const hashQuery = params.toString();
    return `${BOOKMARK_HASH_PREFIX}${hashQuery ? `?${hashQuery}` : ""}`;
  }

  function buildBookmarkListingUrl({ search = "", page = 1, pathname = "/blog.html" } = {}) {
    const resolvedPathname = typeof pathname === "string" && pathname.trim()
      ? pathname.trim()
      : "/blog.html";

    return `${resolvedPathname}${buildBookmarkListingHash({ search, page })}`;
  }

  function parseBookmarkListingHash(hash = window.location.hash) {
    const rawHash = typeof hash === "string" ? hash.trim() : "";
    if (!rawHash.startsWith(BOOKMARK_HASH_PREFIX)) {
      return {
        active: false,
        search: "",
        page: 1,
        normalizedHash: "",
      };
    }

    const rawQuery = rawHash.slice(BOOKMARK_HASH_PREFIX.length).replace(/^\?/, "");
    const params = new URLSearchParams(rawQuery);
    const search = (params.get("search") || "").trim();
    const page = normalizePageNumber(params.get("page"), 1);

    return {
      active: true,
      search,
      page,
      normalizedHash: buildBookmarkListingHash({ search, page }),
    };
  }

  function isBlogPageUrl(url = window.location.href) {
    try {
      const resolved = new URL(url, window.location.origin);
      if (resolved.origin !== window.location.origin) {
        return false;
      }

      const normalizedPath =
        resolved.pathname === "/"
          ? "/index.html"
          : resolved.pathname.endsWith("/")
            ? `${resolved.pathname}index.html`
            : resolved.pathname;

      return normalizedPath.endsWith("/blog.html");
    } catch (error) {
      return false;
    }
  }

  function rememberBlogReturnUrl(url = window.location.href) {
    if (!isBlogPageUrl(url)) {
      return null;
    }

    const resolved = new URL(url, window.location.origin).href;

    try {
      sessionStorage.setItem(BLOG_RETURN_URL_STORAGE_KEY, resolved);
    } catch (error) {
      // sessionStorage unavailable
    }

    return resolved;
  }

  function readStoredBlogReturnUrl() {
    try {
      const storedUrl = sessionStorage.getItem(BLOG_RETURN_URL_STORAGE_KEY);
      if (!storedUrl || !isBlogPageUrl(storedUrl)) {
        return null;
      }

      return new URL(storedUrl, window.location.origin).href;
    } catch (error) {
      return null;
    }
  }

  function getPreferredBlogReturnUrl({ fallback = "/blog.html" } = {}) {
    const rememberedUrl = readStoredBlogReturnUrl();
    if (rememberedUrl) {
      return rememberedUrl;
    }

    if (typeof document.referrer === "string" && isBlogPageUrl(document.referrer)) {
      try {
        return new URL(document.referrer, window.location.origin).href;
      } catch (error) {
        // Ignore invalid referrer and fall through to the default route.
      }
    }

    return new URL(fallback, window.location.origin).href;
  }

  window.SiteUtils = Object.freeze({
    buildBookmarkListingHash,
    buildBookmarkListingUrl,
    buildPostPath,
    buildPostUrl,
    createMediaQueryList,
    getPreferredBlogReturnUrl,
    getPostIdFromUrl,
    isBlogPageUrl,
    isLikelyEphemeralAssetUrl,
    normalizePageNumber,
    normalizePostId,
    parseBookmarkListingHash,
    rememberBlogReturnUrl,
    resolveDisplayImageUrl,
    resolveProxiedDisplayImageUrl,
    resolveShareImageUrl,
    sanitizeCoverBackground,
    sanitizeImageUrl,
  });

  if (isBlogPageUrl(window.location.href)) {
    rememberBlogReturnUrl(window.location.href);
  }
})();
