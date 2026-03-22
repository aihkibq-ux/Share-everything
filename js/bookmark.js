/**
 * bookmark.js — 共享书签（收藏）管理模块
 * 供 blog.html 与 post.html 共用
 */

const BookmarkManager = (() => {
  const BOOKMARK_KEY = "bookmarked_posts";
  const BOOKMARK_METADATA_VERSION = 2;
  const siteUtils = window.SiteUtils || {};
  const sanitizeImageUrl = siteUtils.sanitizeImageUrl;
  const sanitizeCoverBackground = siteUtils.sanitizeCoverBackground;
  let bookmarksCache = null;
  let metadataHydrationPromise = null;

  function escapeSelectorValue(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function readBookmarks() {
    if (bookmarksCache) return bookmarksCache;
    try {
      const parsed = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]");
      bookmarksCache = Array.isArray(parsed)
        ? parsed.map(normalizeBookmark).filter(Boolean)
        : [];
    } catch (e) {
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
    } catch (e) {
      return false;
    }
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
    return [
      normalizeText(title),
      normalizeText(excerpt),
      ...normalizeTags(tags),
    ].join(" ").toLowerCase();
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
      : tags.length > 0
        ? BOOKMARK_METADATA_VERSION
        : 1;

    return {
      id,
      title,
      category: normalizeText(entry.category),
      excerpt,
      date: normalizeText(entry.date),
      readTime: normalizeText(entry.readTime),
      coverImage: typeof sanitizeImageUrl === "function" ? sanitizeImageUrl(entry.coverImage) : null,
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

  function isBookmarked(id) {
    return readBookmarks().some(b => b.id === id);
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

  /**
   * 切换书签状态（通过完整的 post 对象）
   * 适用于 post.html 已有完整数据的场景
   * @returns {boolean | null} 切换后的新状态；持久化失败时返回 null
   */
  function toggle(post) {
    let bookmarks = getAll();
    const exists = bookmarks.some(b => b.id === post.id);

    if (exists) {
      bookmarks = bookmarks.filter(b => b.id !== post.id);
    } else {
      const normalizedBookmark = normalizeBookmark({
        id: post.id,
        title: post.title || "",
        category: post.category || "",
        excerpt: post.excerpt || "",
        date: post.date || "",
        readTime: post.readTime || "",
        coverImage: post.coverImage || null,
        coverEmoji: post.coverEmoji || "📝",
        coverGradient: post.coverGradient || null,
        tags: Array.isArray(post.tags) ? post.tags : [],
        metadataVersion: BOOKMARK_METADATA_VERSION,
        timestamp: Date.now(),
      });
      if (!normalizedBookmark) return null;
      bookmarks.unshift(normalizedBookmark);
    }

    if (!save(bookmarks)) return null;
    return !exists;
  }

  /**
   * 从 DOM 卡片元素中提取信息并切换书签
   * 适用于 blog.html 列表页中没有完整 post 对象的场景
   * @returns {boolean | null} 切换后的新状态；失败时返回 null
   */
  function toggleById(postId) {
    let bookmarks = getAll();
    const exists = bookmarks.some(b => b.id === postId);
    let didPersist = false;

    if (exists) {
      bookmarks = bookmarks.filter(b => b.id !== postId);
      didPersist = true;
    } else {
      const cachedSummary = window.NotionAPI?.getPostSummary?.(postId);
      if (cachedSummary) {
        const normalizedBookmark = normalizeBookmark({
          ...cachedSummary,
          metadataVersion: BOOKMARK_METADATA_VERSION,
          timestamp: Date.now(),
        });
        if (normalizedBookmark) {
          bookmarks.unshift(normalizedBookmark);
          didPersist = true;
        }
      } else {
        const card = document.querySelector(`[data-post-id="${escapeSelectorValue(postId)}"]`);
        if (card) {
          const title = card.querySelector('.blog-card-title')?.textContent || '';
          const excerpt = card.querySelector('.blog-card-excerpt')?.textContent || '';
          const category = card.querySelector('.blog-card-category')?.textContent || '';
          const tags = parseSerializedTags(card.dataset.postTags);
          const metaSpans = card.querySelectorAll('.blog-card-meta > span');
          const date = metaSpans[0]?.textContent?.trim() || '';
          const readTime = metaSpans[1]?.textContent?.trim() || '';
          const img = card.querySelector('.blog-card-cover-img img');
          const emoji = card.querySelector('.blog-card-cover-placeholder:not(.blog-card-cover-img) span');
          const normalizedBookmark = normalizeBookmark({
            id: postId,
            title,
            excerpt,
            category,
            date,
            readTime,
            coverImage: img?.src || null,
            coverEmoji: emoji?.textContent || '📝',
            coverGradient: null,
            tags,
            metadataVersion: tags.length > 0 ? BOOKMARK_METADATA_VERSION : 1,
            timestamp: Date.now(),
          });
          if (normalizedBookmark) {
            bookmarks.unshift(normalizedBookmark);
            didPersist = true;
          }
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

        const hydratedBookmark = normalizeBookmark({
          ...bookmark,
          ...source,
          metadataVersion: BOOKMARK_METADATA_VERSION,
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
    } catch (e) {
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
