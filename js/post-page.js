(() => {
  function initPostPage() {
    const notionApi = window.NotionAPI;
    const siteUtils = window.SiteUtils || {};
    const bookmarkManager = window.BookmarkManager || null;
    const defaultShareImageUrl = new URL("favicon.png?v=2", window.location.origin).href;
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

    function getCurrentPostId() {
      if (typeof siteUtils.getPostIdFromUrl === "function") {
        return siteUtils.getPostIdFromUrl(window.location.href);
      }

      const params = new URLSearchParams(window.location.search);
      return params.get("id");
    }

    function readInitialPostData() {
      const script = document.getElementById("initialPostData");
      if (!(script instanceof HTMLScriptElement) || !script.textContent) {
        return null;
      }

      try {
        return JSON.parse(script.textContent);
      } catch (error) {
        return null;
      }
    }

    function getCanonicalPostUrl(postId) {
      if (typeof siteUtils.buildPostUrl === "function") {
        return siteUtils.buildPostUrl(postId);
      }

      return new URL(`/posts/${encodeURIComponent(postId)}`, window.location.origin).href;
    }

    function syncCanonicalLocation(postId) {
      const canonicalUrl = new URL(getCanonicalPostUrl(postId));
      const nextUrl = new URL(canonicalUrl.href);
      const currentUrl = new URL(window.location.href);

      if (currentUrl.hash) {
        nextUrl.hash = currentUrl.hash;
      }

      if (nextUrl.href !== currentUrl.href) {
        history.replaceState(history.state, "", nextUrl.href);
      }

      return canonicalUrl;
    }

    const postId = getCurrentPostId();
    const bookmarkElements = [fab, navBookmark].filter(Boolean);
    const mobileNavQuery =
      typeof siteUtils.createMediaQueryList === "function"
        ? siteUtils.createMediaQueryList("(max-width: 768px)")
        : window.matchMedia("(max-width: 768px)");
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
      window.StructuredData?.clear?.("post-article");
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
        const initialPostData = readInitialPostData();
        const normalizedInitialPostId =
          typeof siteUtils.normalizePostId === "function"
            ? siteUtils.normalizePostId(initialPostData?.id)
            : initialPostData?.id || null;
        const hasMatchingInitialData = normalizedInitialPostId === postId;
        const post = hasMatchingInitialData
          ? initialPostData
          : await notionApi.getPost(postId);
        if (isDisposed) return;

        if (!post) {
          showEmpty();
          return;
        }

        const canonicalUrl = syncCanonicalLocation(post.id);
        const structuredDataImage =
          typeof siteUtils.resolveShareImageUrl === "function"
            ? siteUtils.resolveShareImageUrl(post.coverImage, defaultShareImageUrl)
            : defaultShareImageUrl;
        const title = `${post.title} — Share Everything`;
        const description = post.excerpt || post.title;
        if (typeof window.updateSeoMeta === "function") {
          window.updateSeoMeta({
            title,
            description,
            url: canonicalUrl.href,
            canonicalUrl: canonicalUrl.href,
            ogImage: structuredDataImage,
            ogImageAlt: post.title,
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
        const shouldReuseServerMarkup = hasMatchingInitialData && contentEl.childElementCount > 0;
        if (!shouldReuseServerMarkup) {
          const renderedContent =
            typeof post.renderedContent === "string" && post.renderedContent
              ? post.renderedContent
              : notionApi.renderBlocks(post.content || []);

          contentEl.innerHTML = `
            <div class="post-header">
              <div class="post-category" style="background: ${catColor.bg}; color: ${catColor.color}; border: 1px solid ${catColor.border};">
                ${esc(post.category)}
              </div>
              <h1 class="post-title" data-page-focus>${esc(post.title)}</h1>
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
        }

        skeletonEl.style.display = "none";
        contentEl.style.display = "block";
        contentEl.style.animation = shouldReuseServerMarkup ? "" : "fadeInUp 0.6s ease both";
        window.StructuredData?.set?.("post-article", {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description,
          articleSection: post.category || undefined,
          keywords: Array.isArray(post.tags) ? post.tags.join(", ") : undefined,
          datePublished: post.date || undefined,
          dateModified: post.date || undefined,
          image: [structuredDataImage],
          mainEntityOfPage: canonicalUrl.href,
          url: canonicalUrl.href,
          author: {
            "@type": "Organization",
            name: "Share Everything",
          },
          publisher: {
            "@type": "Organization",
            name: "Share Everything",
            logo: {
            "@type": "ImageObject",
              url: defaultShareImageUrl,
            },
          },
        });
        const spaContent = document.getElementById("spa-content");
        if (spaContent?.dataset.pendingFocus) {
          window.requestAnimationFrame(() => {
            if (!isDisposed) {
              window.focusSpaContent?.({
                root: spaContent,
                preferredSelectors: [".post-title"],
              });
            }
          });
        }

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
      window.StructuredData?.clear?.("post-article");
    };
  }

  window.PageRuntime?.register("post", {
    init: initPostPage,
  });
})();
