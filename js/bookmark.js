/**
 * Shared bookmark (favorite) manager for `blog.html` and `post.html`.
 */

const BookmarkManager = (() => {
  const BOOKMARK_KEY = "bookmarked_posts";
  const BOOKMARK_METADATA_VERSION = 4;
  const sharedContent = window.NotionContent || {};
  const siteUtils = window.SiteUtils || {};
  const resolveDisplayImageUrl = siteUtils.resolveDisplayImageUrl;
  const sanitizeImageUrl = siteUtils.sanitizeImageUrl;
  const sanitizeCoverBackground = siteUtils.sanitizeCoverBackground;
  let bookmarksCache = null;
  let metadataHydrationPromise = null;

  function escapeSelectorValue(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
  }

  function normalizeText(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function normalizeTags(value) {
    if (!Array.isArray(value)) return [];

    return value
      .map((tag) => normalizeText(tag).trim())
      .filter(Boolean);
  }

  function buildBookmarkSearchText({ title = "", excerpt = "", tags = [] } = {}) {
    if (typeof sharedContent.buildPostSearchText === "function") {
      return sharedContent.buildPostSearchText({
        title: normalizeText(title),
        excerpt: normalizeText(excerpt),
        tags: normalizeTags(tags),
      });
    }

    return [
      normalizeText(title),
      normalizeText(excerpt),
      ...normalizeTags(tags),
    ].join(" ").toLowerCase().trim().replace(/\s+/g, " ");
  }

  function normalizePersistentCoverImage(value) {
    if (typeof resolveDisplayImageUrl === "function") {
      return resolveDisplayImageUrl(value);
    }

    if (typeof sanitizeImageUrl === "function") {
      return sanitizeImageUrl(value);
    }

    return null;
  }

  function normalizeBookmark(entry) {
    if (!entry || typeof entry !== "object") return null;

    const id = normalizeText(entry.id).trim();
    if (!id) return null;

    const title = normalizeText(entry.title);
    const excerpt = normalizeText(entry.excerpt);
    const tags = normalizeTags(entry.tags);
    const metadataVersion = Number.isFinite(Number(entry.metadataVersion))
      ? Number(entry.metadataVersion)
      : 1;

    return {
      id,
      title,
      category: normalizeText(entry.category),
      excerpt,
      date: normalizeText(entry.date),
      readTime: normalizeText(entry.readTime),
      coverImage: normalizePersistentCoverImage(entry.coverImage),
      coverEmoji: normalizeText(entry.coverEmoji, "📝"),
      coverGradient:
        typeof sanitizeCoverBackground === "function"
          ? sanitizeCoverBackground(entry.coverGradient)
          : null,
      tags,
      metadataVersion,
      _searchText: buildBookmarkSearchText({ title, excerpt, tags }),
      timestamp: Number.isFinite(Number(entry.timestamp)) ? Number(entry.timestamp) : Date.now(),
    };
  }

  function readBookmarks() {
    if (bookmarksCache) return bookmarksCache;

    try {
      const parsed = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]");
      bookmarksCache = Array.isArray(parsed)
        ? parsed.map(normalizeBookmark).filter(Boolean)
        : [];
    } catch (error) {
      bookmarksCache = [];
    }

    return bookmarksCache;
  }

  function getAll() {
    return [...readBookmarks()];
  }

  function save(bookmarks) {
    const nextBookmarks = Array.isArray(bookmarks)
      ? bookmarks.map(normalizeBookmark).filter(Boolean)
      : [];

    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(nextBookmarks));
      bookmarksCache = nextBookmarks;
      return true;
    } catch (error) {
      return false;
    }
  }

  function isBookmarked(id) {
    return readBookmarks().some((bookmark) => bookmark.id === id);
  }

  function needsMetadataHydration(bookmark) {
    return Number(bookmark?.metadataVersion || 0) < BOOKMARK_METADATA_VERSION;
  }

  function hasLegacyMetadata() {
    return readBookmarks().some(needsMetadataHydration);
  }

  function parseSerializedTags(value) {
    if (typeof value !== "string" || !value.trim()) return [];

    try {
      return normalizeTags(JSON.parse(value));
    } catch (error) {
      return [];
    }
  }

  function createBookmarkEntry(source, { timestamp = Date.now() } = {}) {
    return normalizeBookmark({
      id: source?.id,
      title: source?.title || "",
      category: source?.category || "",
      excerpt: source?.excerpt || "",
      date: source?.date || "",
      readTime: source?.readTime || "",
      coverImage: source?.coverImage || null,
      coverEmoji: source?.coverEmoji || "📝",
      coverGradient: source?.coverGradient || null,
      tags: Array.isArray(source?.tags) ? source.tags : [],
      metadataVersion: BOOKMARK_METADATA_VERSION,
      timestamp,
    });
  }

  function buildCardBookmarkSource(card, postId) {
    if (!card || typeof card.querySelector !== "function") {
      return null;
    }

    const coverPlaceholder = card.querySelector(".blog-card-cover-placeholder");
    const title = card.querySelector(".blog-card-title")?.textContent || "";
    const excerpt = card.querySelector(".blog-card-excerpt")?.textContent || "";
    const category = card.querySelector(".blog-card-category")?.textContent || "";
    const tags = parseSerializedTags(card.dataset?.postTags);
    const metaSpans = card.querySelectorAll(".blog-card-meta > span");
    const date = metaSpans[0]?.textContent?.trim() || "";
    const readTime = metaSpans[1]?.textContent?.trim() || "";
    const img = card.querySelector(".blog-card-cover-img img");
    const emoji = card.querySelector(".blog-card-cover-placeholder:not(.blog-card-cover-img) span");

    return {
      id: postId,
      title,
      excerpt,
      category,
      date,
      readTime,
      coverImage: img?.src || null,
      coverEmoji: coverPlaceholder?.dataset?.coverEmoji || emoji?.textContent || "📝",
      coverGradient: coverPlaceholder?.dataset?.coverGradient || null,
      tags,
    };
  }

  function toggle(post) {
    let bookmarks = getAll();
    const exists = bookmarks.some((bookmark) => bookmark.id === post.id);

    if (exists) {
      bookmarks = bookmarks.filter((bookmark) => bookmark.id !== post.id);
    } else {
      const normalizedBookmark = createBookmarkEntry(post);
      if (!normalizedBookmark) return null;
      bookmarks.unshift(normalizedBookmark);
    }

    if (!save(bookmarks)) return null;
    return !exists;
  }

  function toggleById(postId) {
    let bookmarks = getAll();
    const exists = bookmarks.some((bookmark) => bookmark.id === postId);
    let didPersist = false;

    if (exists) {
      bookmarks = bookmarks.filter((bookmark) => bookmark.id !== postId);
      didPersist = true;
    } else {
      const cachedSummary = window.NotionAPI?.getPostSummary?.(postId);
      if (cachedSummary) {
        const normalizedBookmark = createBookmarkEntry(cachedSummary);
        if (normalizedBookmark) {
          bookmarks.unshift(normalizedBookmark);
          didPersist = true;
        }
      } else {
        const card = document.querySelector(`[data-post-id="${escapeSelectorValue(postId)}"]`);
        const normalizedBookmark = createBookmarkEntry(buildCardBookmarkSource(card, postId));
        if (normalizedBookmark) {
          bookmarks.unshift(normalizedBookmark);
          didPersist = true;
        }
      }
    }

    if (!didPersist) return null;
    if (!save(bookmarks)) return null;
    return !exists;
  }

  async function hydrateMissingMetadata() {
    if (metadataHydrationPromise) {
      return metadataHydrationPromise;
    }

    if (typeof window.NotionAPI?.getPost !== "function") {
      return false;
    }

    const bookmarks = getAll();
    const pendingHydration = bookmarks.filter(needsMetadataHydration);
    if (pendingHydration.length === 0) {
      return false;
    }

    metadataHydrationPromise = (async () => {
      let nextBookmarks = bookmarks;
      let didHydrate = false;

      for (const bookmark of pendingHydration) {
        let source = window.NotionAPI?.getPostSummary?.(bookmark.id) || null;
        if (!source) {
          try {
            source = await window.NotionAPI.getPost(bookmark.id);
          } catch (error) {
            source = null;
          }
        }

        if (!source) {
          continue;
        }

        const hydratedBookmark = createBookmarkEntry({
          ...bookmark,
          ...source,
        }, {
          timestamp: bookmark.timestamp,
        });

        if (!hydratedBookmark) {
          continue;
        }

        nextBookmarks = nextBookmarks.map((entry) => (
          entry.id === hydratedBookmark.id ? hydratedBookmark : entry
        ));
        didHydrate = true;
      }

      if (didHydrate) {
        if (!save(nextBookmarks)) {
          return false;
        }
      }

      return didHydrate;
    })().finally(() => {
      metadataHydrationPromise = null;
    });

    return metadataHydrationPromise;
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== BOOKMARK_KEY) return;

    try {
      const parsed = JSON.parse(event.newValue || "[]");
      bookmarksCache = Array.isArray(parsed)
        ? parsed.map(normalizeBookmark).filter(Boolean)
        : [];
    } catch (error) {
      bookmarksCache = [];
    }
  });

  return {
    getAll,
    isBookmarked,
    hasLegacyMetadata,
    hydrateMissingMetadata,
    toggle,
    toggleById,
  };
})();

window.BookmarkManager = BookmarkManager;
