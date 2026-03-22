(() => {
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
    const navBookmark = document.getElementById("navBookmark");
    const postBack = document.getElementById("postBack");

    if (!skeletonEl || !contentEl || !emptyEl || !articleEl || !fab) {
      return null;
    }

    if (!notionApi) {
      console.error("NotionAPI is unavailable on post page.");
      showEmpty();
      return null;
    }

    const bookmarkElements = [fab, navBookmark].filter(Boolean);
    const mobileNavQuery = createMediaQueryList("(max-width: 768px)");
    let isDisposed = false;
    let bookmarkBindings = [];
    let backClickHandler = null;
    let bookmarkControlsVisible = false;
    let mediaQueryCleanup = null;
    let readingHistoryHandle = null;

    function cleanupBookmarkHandlers() {
      if (!bookmarkBindings.length) return;

      bookmarkBindings.forEach(({ element, handler }) => {
        element.removeEventListener("click", handler);
      });
      bookmarkBindings = [];
    }

    function clearReadingHistoryTask() {
      if (readingHistoryHandle == null) return;

      if ("cancelIdleCallback" in window) {
        window.cancelIdleCallback(readingHistoryHandle);
      } else {
        clearTimeout(readingHistoryHandle);
      }

      readingHistoryHandle = null;
    }

    function setBookmarkControlsVisible(isVisible) {
      bookmarkControlsVisible = isVisible;

      bookmarkElements.forEach((element) => {
        if (!isVisible) {
          element.style.display = "none";
          return;
        }

        if (element === navBookmark) {
          element.style.display = mobileNavQuery.matches ? "inline-flex" : "none";
        } else {
          element.style.display = "flex";
        }
      });
    }

    function syncBookmarkControls(isBookmarked) {
      const labelText = isBookmarked ? "已收藏" : "收藏";

      bookmarkElements.forEach((element) => {
        element.classList.toggle("bookmarked", isBookmarked);
        element.setAttribute("aria-pressed", isBookmarked ? "true" : "false");
        element.setAttribute("aria-label", labelText);
        element.setAttribute("title", labelText);

        const label = element.querySelector(".fab-bookmark-label");
        if (label) {
          label.textContent = labelText;
        }
      });
    }

    function cleanupBackHandler() {
      if (postBack && backClickHandler) {
        postBack.removeEventListener("click", backClickHandler);
        backClickHandler = null;
      }
    }

    function bindResponsiveBookmarkVisibility() {
      const handleMediaChange = () => {
        setBookmarkControlsVisible(bookmarkControlsVisible);
      };

      if (typeof mobileNavQuery.addEventListener === "function") {
        mobileNavQuery.addEventListener("change", handleMediaChange);
        mediaQueryCleanup = () => {
          mobileNavQuery.removeEventListener("change", handleMediaChange);
          mediaQueryCleanup = null;
        };
        return;
      }

      mobileNavQuery.addListener(handleMediaChange);
      mediaQueryCleanup = () => {
        mobileNavQuery.removeListener(handleMediaChange);
        mediaQueryCleanup = null;
      };
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
      setBookmarkControlsVisible(false);
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

    function scheduleReadingHistorySave(post) {
      clearReadingHistoryTask();

      const persistHistory = () => {
        readingHistoryHandle = null;
        if (!isDisposed) {
          saveReadingHistory(post);
        }
      };

      if ("requestIdleCallback" in window) {
        readingHistoryHandle = window.requestIdleCallback(persistHistory, {
          timeout: 900,
        });
      } else {
        readingHistoryHandle = window.setTimeout(persistHistory, 180);
      }
    }

    function initBookmark(post) {
      if (!bookmarkManager || !bookmarkElements.length) {
        setBookmarkControlsVisible(false);
        return;
      }

      cleanupBookmarkHandlers();
      setBookmarkControlsVisible(true);
      syncBookmarkControls(bookmarkManager.isBookmarked(post.id));

      bookmarkElements.forEach((element) => {
        const handler = () => {
          const nowBookmarked = bookmarkManager.toggle(post);
          syncBookmarkControls(nowBookmarked);
          element.classList.remove("bounce");
          void element.offsetWidth;
          element.classList.add("bounce");
        };

        element.addEventListener("click", handler);
        bookmarkBindings.push({ element, handler });
      });
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

        const title = `${post.title} — Share Everything`;
        const description = post.excerpt || post.title;
        if (typeof window.updateSeoMeta === "function") {
          window.updateSeoMeta({
            title,
            description,
            url: window.location.href,
          });
        } else {
          document.title = title;
          const metaDescription = document.querySelector('meta[name="description"]');
          if (metaDescription) {
            metaDescription.content = description;
          }
        }

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
              ${Array.isArray(post.tags) && post.tags.length > 0 ? `<span>${post.tags.map((tag) => `#${esc(tag)}`).join(" ")}</span>` : ""}
            </div>
          </div>
          <div class="post-content">
            ${renderedContent}
          </div>
        `;

        skeletonEl.style.display = "none";
        contentEl.style.display = "block";
        contentEl.style.animation = "fadeInUp 0.6s ease both";

        scheduleReadingHistorySave(post);
        initBookmark(post);
      } catch (error) {
        if (isDisposed) return;
        console.error("Failed to load post:", error);
        showEmpty();
      }
    }

    initBackButton();
    bindResponsiveBookmarkVisibility();
    loadPost();

    return () => {
      isDisposed = true;
      cleanupBookmarkHandlers();
      cleanupBackHandler();
      mediaQueryCleanup?.();
      clearReadingHistoryTask();
    };
  }

  window.PageRuntime?.register("post", {
    init: initPostPage,
  });
})();
