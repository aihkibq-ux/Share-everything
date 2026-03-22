/**
 * bookmark.js — 共享书签（收藏）管理模块
 * 供 blog.html 与 post.html 共用
 */

const BookmarkManager = (() => {
  const BOOKMARK_KEY = "bookmarked_posts";
  let bookmarksCache = null;

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
    bookmarksCache = Array.isArray(bookmarks)
      ? bookmarks.map(normalizeBookmark).filter(Boolean)
      : [];
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarksCache));
    } catch (e) {}
  }

  function sanitizeImageUrl(candidate) {
    if (!candidate || typeof candidate !== "string") return null;

    try {
      const parsed = new URL(candidate, window.location.origin);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
    } catch (error) {
      return null;
    }
  }

  function sanitizeCoverBackground(value) {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.includes(";") || /url\s*\(/i.test(trimmed)) return null;
    if (!/^(linear-gradient|radial-gradient)\([#(),.%\sa-zA-Z0-9+-]+\)$/.test(trimmed)) {
      return null;
    }

    return trimmed;
  }

  function normalizeText(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function normalizeBookmark(entry) {
    if (!entry || typeof entry !== "object") return null;

    const id = normalizeText(entry.id).trim();
    if (!id) return null;

    return {
      id,
      title: normalizeText(entry.title),
      category: normalizeText(entry.category),
      excerpt: normalizeText(entry.excerpt),
      date: normalizeText(entry.date),
      readTime: normalizeText(entry.readTime),
      coverImage: sanitizeImageUrl(entry.coverImage),
      coverEmoji: normalizeText(entry.coverEmoji, "📝"),
      coverGradient: sanitizeCoverBackground(entry.coverGradient),
      timestamp: Number.isFinite(Number(entry.timestamp)) ? Number(entry.timestamp) : Date.now(),
    };
  }

  function isBookmarked(id) {
    return readBookmarks().some(b => b.id === id);
  }

  /**
   * 切换书签状态（通过完整的 post 对象）
   * 适用于 post.html 已有完整数据的场景
   * @returns {boolean} 切换后的新状态（true = 已收藏）
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
        timestamp: Date.now(),
      });
      if (!normalizedBookmark) return exists;
      bookmarks.unshift(normalizedBookmark);
    }

    save(bookmarks);
    return !exists;
  }

  /**
   * 从 DOM 卡片元素中提取信息并切换书签
   * 适用于 blog.html 列表页中没有完整 post 对象的场景
   * @returns {boolean} 切换后的新状态（true = 已收藏）
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
            timestamp: Date.now(),
          });
          if (normalizedBookmark) {
            bookmarks.unshift(normalizedBookmark);
            didPersist = true;
          }
        }
      }
    }

    if (!didPersist) return exists;
    save(bookmarks);
    return !exists;
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

  return { getAll, isBookmarked, toggle, toggleById };
})();

window.BookmarkManager = BookmarkManager;
