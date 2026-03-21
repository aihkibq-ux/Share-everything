(() => {
  function initPostPage() {
    const notionApi = window.NotionAPI;
    const bookmarkManager = window.BookmarkManager || null;

    const params = new URLSearchParams(window.location.search);
    const postId = params.get("id");
    const skeletonEl = document.getElementById("postSkeleton");
    const contentEl = document.getElementById("postContent");
    const emptyEl = document.getElementById("postEmpty");
    const articleEl = document.getElementById("postArticle");
    const fab = document.getElementById("fabBookmark");
    const postBack = document.getElementById("postBack");

    if (!skeletonEl || !contentEl || !emptyEl || !articleEl || !fab) {
      return null;
    }

    if (!notionApi) {
      console.error("NotionAPI is unavailable on post page.");
      showEmpty();
      return null;
    }

    let isDisposed = false;
    let bookmarkClickHandler = null;
    let backClickHandler = null;

    function cleanupBookmarkHandler() {
      if (bookmarkClickHandler) {
        fab.removeEventListener("click", bookmarkClickHandler);
        bookmarkClickHandler = null;
      }
    }

    function cleanupBackHandler() {
      if (postBack && backClickHandler) {
        postBack.removeEventListener("click", backClickHandler);
        backClickHandler = null;
      }
    }

    function initBackButton() {
      if (!postBack) return;

      cleanupBackHandler();
      backClickHandler = (event) => {
        event.preventDefault();
        if (window.SPARouter?.navigate) {
          window.SPARouter.navigate("blog.html");
        } else {
          window.location.href = "blog.html";
        }
      };
      postBack.addEventListener("click", backClickHandler);
    }

    function showEmpty() {
      skeletonEl.style.display = "none";
      articleEl.querySelector(".post-back")?.style.setProperty("display", "none");
      fab.style.display = "none";
      emptyEl.style.display = "flex";
    }

    function saveReadingHistory(post) {
      try {
        const entries = JSON.parse(localStorage.getItem("reading_history") || "[]");
        const filtered = entries.filter((historyItem) => historyItem.id !== post.id);
        filtered.unshift({
          id: post.id,
          title: post.title,
          category: post.category,
          timestamp: Date.now(),
        });
        localStorage.setItem("reading_history", JSON.stringify(filtered.slice(0, 100)));
      } catch (error) {
        // localStorage unavailable
      }
    }

    function initBookmark(post) {
      const label = fab.querySelector(".fab-bookmark-label");
      if (!label || !bookmarkManager) {
        fab.style.display = "none";
        return;
      }

      cleanupBookmarkHandler();
      fab.style.display = "flex";

      const initialBookmarked = bookmarkManager.isBookmarked(post.id);
      fab.classList.toggle("bookmarked", initialBookmarked);
      label.textContent = initialBookmarked ? "已收藏" : "收藏";

      bookmarkClickHandler = () => {
        const nowBookmarked = bookmarkManager.toggle(post);
        fab.classList.toggle("bookmarked", nowBookmarked);
        label.textContent = nowBookmarked ? "已收藏" : "收藏";
        fab.classList.remove("bounce");
        void fab.offsetWidth;
        fab.classList.add("bounce");
      };

      fab.addEventListener("click", bookmarkClickHandler);
    }

    async function loadPost() {
      if (!postId) {
        showEmpty();
        return;
      }

      try {
        const post = await notionApi.getPost(postId);
        if (isDisposed) return;

        if (!post) {
          showEmpty();
          return;
        }

        document.title = `${post.title} — Share Everything`;
        document.querySelector('meta[name="description"]').content = post.excerpt || post.title;

        const catColor = notionApi.getCategoryColor(post.category);
        const esc = notionApi.escapeHtml;
        const renderedContent = notionApi.renderBlocks(post.content || []);

        contentEl.innerHTML = `
          <div class="post-header">
            <div class="post-category" style="background: ${catColor.bg}; color: ${catColor.color}; border: 1px solid ${catColor.border};">
              ${esc(post.category)}
            </div>
            <h1 class="post-title">${esc(post.title)}</h1>
            <div class="post-meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                ${esc(post.date)}
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${esc(post.readTime)}
              </span>
              ${post.tags ? `<span>${post.tags.map((tag) => `#${esc(tag)}`).join(" ")}</span>` : ""}
            </div>
          </div>
          <div class="post-content">
            ${renderedContent}
          </div>
        `;

        skeletonEl.style.display = "none";
        contentEl.style.display = "block";
        contentEl.style.animation = "fadeInUp 0.6s ease both";

        saveReadingHistory(post);
        initBookmark(post);
      } catch (error) {
        if (isDisposed) return;
        console.error("Failed to load post:", error);
        showEmpty();
      }
    }

    initBackButton();
    loadPost();

    return () => {
      isDisposed = true;
      cleanupBookmarkHandler();
      cleanupBackHandler();
    };
  }

  window.PageRuntime?.register("post", {
    init: initPostPage,
  });
})();
