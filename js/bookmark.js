/**
 * bookmark.js — 共享书签（收藏）管理模块
 * 供 blog.html 与 post.html 共用
 */

const BookmarkManager = (() => {
  const BOOKMARK_KEY = "bookmarked_posts";

  function getAll() {
    try {
      return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]");
    } catch (e) { return []; }
  }

  function save(bookmarks) {
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
    } catch (e) {}
  }

  function isBookmarked(id) {
    return getAll().some(b => b.id === id);
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
      bookmarks.unshift({
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

    if (exists) {
      bookmarks = bookmarks.filter(b => b.id !== postId);
    } else {
      const card = document.querySelector(`[data-post-id="${postId}"]`);
      if (card) {
        const title = card.querySelector('.blog-card-title')?.textContent || '';
        const excerpt = card.querySelector('.blog-card-excerpt')?.textContent || '';
        const category = card.querySelector('.blog-card-category')?.textContent || '';
        const metaSpans = card.querySelectorAll('.blog-card-meta > span');
        const date = metaSpans[0]?.textContent?.trim() || '';
        const readTime = metaSpans[1]?.textContent?.trim() || '';
        const img = card.querySelector('.blog-card-cover-img img');
        const emoji = card.querySelector('.blog-card-cover-placeholder:not(.blog-card-cover-img) span');
        bookmarks.unshift({
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
      }
    }

    save(bookmarks);
    return !exists;
  }

  return { getAll, isBookmarked, toggle, toggleById };
})();
