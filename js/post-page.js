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
    const statusEl = document.getElementById("postStatus");

    if (!skeletonEl || !contentEl || !emptyEl || !articleEl || !fab) {
      return null;
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
    let statusAnnouncementHandle = null;

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

    function cleanupBookmarkHandlers() {
      if (!bookmarkBindings.length) return;

      bookmarkBindings.forEach(({ element, handler }) => {
        element.removeEventListener("click", handler);
      });
      bookmarkBindings = [];
    }

    function clearStatusAnnouncement() {
      if (statusAnnouncementHandle == null) return;
      clearTimeout(statusAnnouncementHandle);
      statusAnnouncementHandle = null;
    }

    function announceStatus(message) {
      if (!statusEl || typeof message !== "string" || !message.trim()) return;

      clearStatusAnnouncement();
      statusEl.textContent = "";
      statusAnnouncementHandle = window.setTimeout(() => {
        statusEl.textContent = message;
        statusAnnouncementHandle = null;
      }, 30);
    }

    function isMissingPostError(error) {
      const status = Number(error?.status);
      return status === 404 || (status === 400 && error?.notionCode === "validation_error");
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
        const blogIndexUrl =
          typeof siteUtils.getPreferredBlogReturnUrl === "function"
            ? siteUtils.getPreferredBlogReturnUrl()
            : new URL("/blog.html", window.location.origin).href;
        if (window.SPARouter?.navigate) {
          window.SPARouter.navigate(blogIndexUrl);
        } else {
          window.location.href = blogIndexUrl;
        }
      };
      postBack.addEventListener("click", backClickHandler);
    }

    function getEmptySeoState(kind = "not-found") {
      if (kind === "unavailable") {
        return {
          title: "文章暂时不可用 - Share Everything",
          description: "文章内容暂时无法加载，请稍后再试。",
          message: "文章暂时不可用",
        };
      }

      return {
        title: "文章不存在 - Share Everything",
        description: "未找到对应的文章内容。",
        message: "文章不存在",
      };
    }

    function hasServerRenderedContent() {
      return Boolean(contentEl.innerHTML.trim());
    }

    function showServerRenderedFallback() {
      skeletonEl.style.display = "none";
      contentEl.style.display = "block";
      articleEl.querySelector(".post-back")?.style.removeProperty("display");
      setBookmarkControlsVisible(false);
      emptyEl.style.display = "none";
      announceStatus("文章内容已加载，部分互动功能暂时不可用。");
    }

    function showEmpty(kind = "not-found") {
      const emptyState = getEmptySeoState(kind);
      const emptyMessage = emptyEl.querySelector("p");
      const emptyLink = emptyEl.querySelector('a[href="/blog.html"]');

      skeletonEl.style.display = "none";
      contentEl.style.display = "none";
      articleEl.querySelector(".post-back")?.style.setProperty("display", "none");
      setBookmarkControlsVisible(false);
      emptyEl.style.display = "flex";
      if (emptyMessage) {
        emptyMessage.textContent = emptyState.message;
      }
      if (emptyLink) {
        emptyLink.textContent = "返回博客列表";
      }
      announceStatus(emptyState.message);

      const fallbackCanonicalUrl = postId
        ? getCanonicalPostUrl(postId)
        : new URL("/post.html", window.location.origin).href;
      if (typeof window.updateSeoMeta === "function") {
        window.updateSeoMeta({
          title: emptyState.title,
          description: emptyState.description,
          url: window.location.href,
          canonicalUrl: fallbackCanonicalUrl,
          ogType: "website",
          ogImage: defaultShareImageUrl,
          ogImageAlt: "Share Everything",
          robots: "noindex, nofollow",
        });
      }
      window.StructuredData?.clear?.("post-article");
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
          if (nowBookmarked === null) {
            console.warn("Failed to persist bookmark state for post:", post.id);
            announceStatus(`收藏失败，请稍后重试：${post.title || "Untitled"}。`);
            return;
          }
          syncBookmarkControls(nowBookmarked);
          element.classList.remove("bounce");
          void element.offsetWidth;
          element.classList.add("bounce");
          announceStatus(nowBookmarked ? `已收藏文章：${post.title || "Untitled"}。` : `已取消收藏文章：${post.title || "Untitled"}。`);
        };

        element.addEventListener("click", handler);
        bookmarkBindings.push({ element, handler });
      });
    }

    if (!notionApi) {
      console.error("NotionAPI is unavailable on post page.");
      initBackButton();
      setBookmarkControlsVisible(false);

      if (hasServerRenderedContent()) {
        showServerRenderedFallback();
      } else {
        showEmpty("unavailable");
      }

      return () => {
        cleanupBackHandler();
        clearStatusAnnouncement();
        if (statusEl) statusEl.textContent = "";
      };
    }

    async function loadPost() {
      if (!postId) {
        showEmpty("not-found");
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
          showEmpty("not-found");
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
            ogType: "article",
            robots: "index, follow",
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

        initBookmark(post);
      } catch (error) {
        if (isDisposed) return;
        console.error("Failed to load post:", error);
        showEmpty(isMissingPostError(error) ? "not-found" : "unavailable");
      }
    }

    initBackButton();
    bindResponsiveBookmarkVisibility();
    loadPost();

    return () => {
      isDisposed = true;
      cleanupBookmarkHandlers();
      cleanupBackHandler();
      clearStatusAnnouncement();
      if (statusEl) statusEl.textContent = "";
      mediaQueryCleanup?.();
      window.StructuredData?.clear?.("post-article");
    };
  }

  window.PageRuntime?.register("post", {
    init: initPostPage,
  });
})();
