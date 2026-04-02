(() => {
  function initBlogPage() {
    const notionApi = window.NotionAPI;
    const siteUtils = window.SiteUtils || {};
    const bookmarkManager = window.BookmarkManager || {
      getAll: () => [],
      isBookmarked: () => false,
      toggleById: () => null,
    };

    const filtersEl = document.getElementById("blogFilters");
    const searchInput = document.getElementById("blogSearch");
    const gridEl = document.getElementById("blogGrid");
    const emptyEl = document.getElementById("emptyState");
    const paginationEl = document.getElementById("pagination");
    const statusEl = document.getElementById("blogStatus");
    const escapeText = notionApi?.escapeHtml || ((value) => String(value ?? ""));

    if (!filtersEl || !searchInput || !gridEl || !emptyEl || !paginationEl) {
      return null;
    }

    let currentCategory = "全部";
    let currentSearch = "";
    let currentPage = 1;
    let renderToken = 0;
    let searchDebounce = null;
    let detailWarmupHandle = null;
    let revealFrame = null;
    let cleanupCardReveal = null;
    let statusAnnouncementHandle = null;
    let metadataHydrationTask = null;
    let didAttemptHydration = false;
    let isDisposed = false;
    const supportedCategories = new Set(["全部", "精选", "技术", "随想", "教程", "工具", "收藏"]);

    const params = new URLSearchParams(window.location.search);
    if (params.get("category")) currentCategory = params.get("category");
    if (params.get("search")) currentSearch = params.get("search");
    if (params.get("page")) currentPage = Math.max(1, parseInt(params.get("page"), 10) || 1);
    if (!supportedCategories.has(currentCategory)) currentCategory = "全部";

    if (!notionApi) {
      console.error("NotionAPI is unavailable on blog page.");
      searchInput.value = currentSearch;
      updatePageUI();
      if (typeof siteUtils.rememberBlogReturnUrl === "function") {
        siteUtils.rememberBlogReturnUrl(window.location.href);
      }
      filtersEl.replaceChildren();
      showEmptyState({
        title: "加载失败",
        hint: currentSearch
          ? `搜索“${currentSearch}”的文章数据暂时不可用，请稍后重试。`
          : "文章数据暂时不可用，请稍后重试。",
        announcement: currentSearch
          ? `搜索“${currentSearch}”的文章数据暂时不可用。`
          : "文章数据暂时不可用。",
      });
      return null;
    }

    const categories = notionApi.getCategories();
    const pageSize = notionApi.getPageSize?.() || 9;
    const validCategories = new Set([...categories.map((cat) => cat.name), "收藏"]);
    if (!validCategories.has(currentCategory)) currentCategory = "全部";
    searchInput.setAttribute("aria-controls", "blogGrid");

    function clearDetailWarmup() {
      if (detailWarmupHandle == null) return;

      if ("cancelIdleCallback" in window) {
        window.cancelIdleCallback(detailWarmupHandle);
      } else {
        clearTimeout(detailWarmupHandle);
      }

      detailWarmupHandle = null;
    }

    function clearCardReveal() {
      if (revealFrame != null) {
        window.cancelAnimationFrame(revealFrame);
        revealFrame = null;
      }

      if (typeof cleanupCardReveal === "function") {
        cleanupCardReveal();
      }
      cleanupCardReveal = null;
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

    function setGridBusy(isBusy) {
      gridEl.setAttribute("aria-busy", isBusy ? "true" : "false");
    }

    function scheduleLegacyMetadataHydration() {
      if (currentCategory !== "收藏") return;
      if (didAttemptHydration) return;
      if (metadataHydrationTask) return;
      if (typeof bookmarkManager.hasLegacyMetadata !== "function") return;
      if (!bookmarkManager.hasLegacyMetadata()) return;

      didAttemptHydration = true;
      metadataHydrationTask = Promise.resolve(bookmarkManager.hydrateMissingMetadata?.())
        .then((didHydrate) => {
          if (didHydrate && !isDisposed && currentCategory === "收藏") {
            renderPosts();
          }
        })
        .catch(() => {})
        .finally(() => {
          metadataHydrationTask = null;
        });
    }

    function buildResultsAnnouncement(data) {
      const total = Number(data?.total) || 0;
      const currentPageValue = Number(data?.currentPage) || 1;
      const totalPagesValue = Number(data?.totalPages) || 1;

      if (total === 0) {
        return currentSearch
          ? `没有找到与“${currentSearch}”匹配的文章。`
          : "当前没有可显示的文章。";
      }

      if (currentSearch) {
        return `搜索结果已更新，共 ${total} 篇文章，当前第 ${currentPageValue} 页，共 ${totalPagesValue} 页。`;
      }

      return `文章列表已更新，共 ${total} 篇文章，当前第 ${currentPageValue} 页，共 ${totalPagesValue} 页。`;
    }

    function renderEmptyStateMarkup({
      title = "没有找到匹配的文章",
      hint = "试试其他关键词或分类",
      actionLabel = "",
    } = {}) {
      const actionHtml = actionLabel
        ? `<button type="button" class="empty-state-action" data-empty-action="retry">${escapeText(actionLabel)}</button>`
        : "";

      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p>${escapeText(title)}</p>
        <p style="font-size: 0.85rem;">${escapeText(hint)}</p>
        ${actionHtml}
      `;
    }

    function showEmptyState(options = {}) {
      clearCardReveal();
      clearDetailWarmup();
      setGridBusy(false);
      gridEl.innerHTML = "";
      emptyEl.innerHTML = renderEmptyStateMarkup(options);
      emptyEl.style.display = "flex";
      paginationEl.innerHTML = "";
      announceStatus(options.announcement || options.title || "没有找到匹配的文章。");
    }

    function canWarmArticleDetails() {
      const connection =
        navigator.connection ||
        navigator.mozConnection ||
        navigator.webkitConnection;

      return !(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || ""));
    }

    function scheduleDetailWarmup(posts) {
      clearDetailWarmup();

      const firstPostId = posts?.[0]?.id;
      if (!firstPostId || typeof notionApi.getPost !== "function" || !canWarmArticleDetails()) {
        return;
      }

      const warmFirstPost = () => {
        detailWarmupHandle = null;
        notionApi.getPost(firstPostId).catch(() => {});
      };

      if ("requestIdleCallback" in window) {
        detailWarmupHandle = window.requestIdleCallback(warmFirstPost, {
          timeout: 1200,
        });
      } else {
        detailWarmupHandle = window.setTimeout(warmFirstPost, 300);
      }
    }

    function updatePageUI() {
      const titleEl = document.querySelector(".page-title");
      if (titleEl) {
        titleEl.textContent = currentCategory === "全部" ? "总览" : currentCategory;
      }

      const title = `${currentCategory === "全部" ? "总览" : currentCategory} — Share Everything`;
      const description = currentSearch
        ? `搜索“${currentSearch}”的相关文章`
        : currentCategory === "全部"
          ? "探索所有文章，按分类浏览，搜索你感兴趣的内容。"
          : `浏览「${currentCategory}」分类下的文章`;
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

      const topActions = document.querySelectorAll(".top-actions .action-btn");
      topActions.forEach((button) => button.classList.remove("active"));

      topActions.forEach((button) => {
        const text = button.querySelector("span")?.textContent.trim();
        if (currentCategory === "收藏" && text === "收藏") {
          button.classList.add("active");
        } else if (currentCategory !== "收藏" && text === "总览") {
          button.classList.add("active");
        }
      });
    }

    function renderFilters() {
      filtersEl.replaceChildren();

      categories.forEach((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `filter-btn${category.name === currentCategory ? " active" : ""}`;
        button.dataset.category = category.name;
        button.textContent = `${category.emoji} ${category.name}`;
        filtersEl.appendChild(button);
      });
    }

    function updateURL() {
      const nextParams = new URLSearchParams();
      if (currentCategory !== "全部") nextParams.set("category", currentCategory);
      if (currentSearch) nextParams.set("search", currentSearch);
      if (currentPage > 1) nextParams.set("page", String(currentPage));

      const qs = nextParams.toString();
      history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
      if (typeof siteUtils.rememberBlogReturnUrl === "function") {
        siteUtils.rememberBlogReturnUrl(window.location.href);
      }
    }

    function renderCard(post) {
      const esc = notionApi.escapeHtml;
      // Safety: catColor values originate from a hardcoded map (CATEGORY_COLORS),
      // not from user input, so they are safe to inject into style attributes.
      const catColor = notionApi.getCategoryColor(post.category);
      const bookmarked = bookmarkManager.isBookmarked(post.id);
      const defaultCoverGradient = "linear-gradient(135deg, #1a1a2e, #16213e)";

      const safeTitle = esc(post.title);
      const safeExcerpt = esc(post.excerpt);
      const safeCategory = esc(post.category);
      const safeCoverEmoji = esc(post.coverEmoji || "📝");
      const safeCoverGradient =
        typeof siteUtils.sanitizeCoverBackground === "function"
          ? siteUtils.sanitizeCoverBackground(post.coverGradient, defaultCoverGradient)
          : defaultCoverGradient;
      const safeCoverImage =
        typeof siteUtils.sanitizeImageUrl === "function"
          ? siteUtils.sanitizeImageUrl(post.coverImage)
          : null;
      const safePostUrl =
        typeof siteUtils.buildPostPath === "function"
          ? siteUtils.buildPostPath(post.id)
          : `/posts/${encodeURIComponent(post.id)}`;
      const serializedTags = esc(JSON.stringify(Array.isArray(post.tags) ? post.tags : []));
      const bookmarkTitle = bookmarked ? "取消收藏" : "收藏";
      const bookmarkAriaLabel = `${bookmarkTitle}文章：${post.title || "Untitled"}`;
      const coverHtml = safeCoverImage
        ? `<div class="blog-card-cover-placeholder blog-card-cover-img">
             <img src="${esc(safeCoverImage)}" alt="${safeTitle}" loading="lazy" decoding="async">
           </div>`
        : `<div class="blog-card-cover-placeholder" style="background: ${safeCoverGradient}">
             <span>${safeCoverEmoji}</span>
           </div>`;

      return `
        <article class="blog-card" data-reveal data-post-id="${esc(post.id)}" data-post-tags="${serializedTags}" role="listitem">
          <a href="${safePostUrl}" class="blog-card-link" aria-label="阅读文章：${safeTitle}"></a>
          ${coverHtml}
          <div class="blog-card-body">
            <div class="blog-card-category" style="background: ${catColor.bg}; color: ${catColor.color}; border-color: ${catColor.border}">${safeCategory}</div>
            <h3 class="blog-card-title">${safeTitle}</h3>
            <p class="blog-card-excerpt">${safeExcerpt}</p>
            <div class="blog-card-meta">
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
              <button type="button" class="card-bookmark-btn${bookmarked ? " bookmarked" : ""}" data-bookmark-id="${esc(post.id)}" data-bookmark-title="${safeTitle}" title="${bookmarkTitle}" aria-label="${esc(bookmarkAriaLabel)}" aria-pressed="${bookmarked ? "true" : "false"}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          </div>
        </article>
      `;
    }

    function renderPagination(data) {
      if (data.totalPages <= 1) {
        paginationEl.innerHTML = "";
        return;
      }

      let html = "";
      for (let i = 1; i <= data.totalPages; i++) {
        html += `<button type="button" class="page-btn${i === data.currentPage ? " active" : ""}" data-page="${i}">${i}</button>`;
      }
      paginationEl.innerHTML = html;
    }

    async function renderPosts() {
      const currentToken = ++renderToken;
      clearCardReveal();
      setGridBusy(true);
      announceStatus(currentSearch ? "正在更新搜索结果。" : "正在加载文章列表。");

      try {
        let data;

        if (currentCategory === "收藏") {
          scheduleLegacyMetadataHydration();

          let bookmarks = bookmarkManager.getAll();

          if (currentSearch) {
            const query = currentSearch.toLowerCase();
            bookmarks = bookmarks.filter(
              (post) => {
                const searchText = typeof post._searchText === "string" && post._searchText
                  ? post._searchText
                  : `${post.title || ""} ${post.excerpt || ""}`.toLowerCase();
                return searchText.includes(query);
              },
            );
          }

          const total = bookmarks.length;
          const totalPages = Math.max(1, Math.ceil(total / pageSize));
          const safePage = Math.max(1, Math.min(currentPage, totalPages));
          const start = (safePage - 1) * pageSize;
          data = {
            results: bookmarks.slice(start, start + pageSize),
            total,
            totalPages,
            currentPage: safePage,
          };
        } else {
          data = await notionApi.queryPosts({
            category: currentCategory,
            search: currentSearch,
            page: currentPage,
          });
        }

        if (currentToken !== renderToken) return;
        if (currentPage !== data.currentPage) {
          currentPage = data.currentPage;
          updateURL();
        }

        if (data.results.length === 0) {
          showEmptyState();
          return;
        }

        emptyEl.style.display = "none";
        gridEl.innerHTML = data.results.map(renderCard).join("");
        renderPagination(data);
        scheduleDetailWarmup(data.results);
        setGridBusy(false);
        announceStatus(buildResultsAnnouncement(data));

        revealFrame = window.requestAnimationFrame(() => {
          revealFrame = null;
          cleanupCardReveal = window.initBlogCardReveal?.() || null;
        });
      } catch (error) {
        if (currentToken !== renderToken) return;

        console.error("Failed to load posts:", error);
        showEmptyState({
          title: "加载失败",
          hint: "请检查网络后重试",
          actionLabel: "重试",
          announcement: "文章加载失败，请重试。",
        });
      }
    }

    function handleFilterClick(event) {
      const button = event.target.closest(".filter-btn");
      if (!button || !filtersEl.contains(button)) return;

      currentCategory = button.dataset.category || "全部";
      currentPage = 1;
      updateURL();
      updatePageUI();
      renderFilters();
      renderPosts();
    }

    function handleSearchInput() {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchDebounce = null;
        currentSearch = searchInput.value.trim();
        currentPage = 1;
        updateURL();
        renderPosts();
      }, 300);
    }

    function handlePaginationClick(event) {
      const button = event.target.closest(".page-btn");
      if (!button || !paginationEl.contains(button)) return;

      currentPage = parseInt(button.dataset.page || "1", 10) || 1;
      updateURL();
      renderPosts();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function handleGridClick(event) {
      const button = event.target.closest(".card-bookmark-btn");
      if (!button || !gridEl.contains(button)) return;

      event.preventDefault();
      event.stopPropagation();

      const postId = button.dataset.bookmarkId;
      const nowBookmarked = bookmarkManager.toggleById(postId);
      const postTitle = button.dataset.bookmarkTitle || "Untitled";
      if (nowBookmarked === null) {
        announceStatus(`收藏失败，请稍后重试：${postTitle}。`);
        return;
      }
      const bookmarkAriaLabel = `${nowBookmarked ? "取消收藏" : "收藏"}文章：${postTitle}`;

      button.classList.toggle("bookmarked", nowBookmarked);
      button.title = nowBookmarked ? "取消收藏" : "收藏";
      button.setAttribute("aria-pressed", nowBookmarked ? "true" : "false");
      button.setAttribute("aria-label", bookmarkAriaLabel);
      button.classList.remove("bounce");
      void button.offsetWidth;
      button.classList.add("bounce");
      announceStatus(nowBookmarked ? `已收藏文章：${postTitle}。` : `已取消收藏文章：${postTitle}。`);

      if (!nowBookmarked && currentCategory === "收藏") {
        setTimeout(() => renderPosts(), 300);
      }
    }

    function handleGridMediaError(event) {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;

      const placeholder = image.closest(".blog-card-cover-placeholder.blog-card-cover-img");
      if (!placeholder || !gridEl.contains(placeholder)) return;

      placeholder.classList.remove("blog-card-cover-img");
      image.remove();
    }

    function handleEmptyStateClick(event) {
      const button = event.target.closest("[data-empty-action='retry']");
      if (!button || !emptyEl.contains(button)) return;
      renderPosts();
    }

    updatePageUI();
    renderFilters();
    searchInput.value = currentSearch;
    if (typeof siteUtils.rememberBlogReturnUrl === "function") {
      siteUtils.rememberBlogReturnUrl(window.location.href);
    }

    filtersEl.addEventListener("click", handleFilterClick);
    searchInput.addEventListener("input", handleSearchInput);
    paginationEl.addEventListener("click", handlePaginationClick);
    gridEl.addEventListener("click", handleGridClick);
    gridEl.addEventListener("error", handleGridMediaError, true);
    emptyEl.addEventListener("click", handleEmptyStateClick);

    renderPosts();

    return () => {
      isDisposed = true;
      renderToken += 1;
      clearTimeout(searchDebounce);
      searchDebounce = null;
      filtersEl.removeEventListener("click", handleFilterClick);
      searchInput.removeEventListener("input", handleSearchInput);
      paginationEl.removeEventListener("click", handlePaginationClick);
      gridEl.removeEventListener("click", handleGridClick);
      gridEl.removeEventListener("error", handleGridMediaError, true);
      emptyEl.removeEventListener("click", handleEmptyStateClick);
      clearStatusAnnouncement();
      setGridBusy(false);
      if (statusEl) statusEl.textContent = "";
      clearCardReveal();
      clearDetailWarmup();
    };
  }

  window.PageRuntime?.register("blog", {
    init: initBlogPage,
  });
})();
