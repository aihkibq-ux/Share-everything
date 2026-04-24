(() => {
  const SHARED_CONTENT = window.NotionContent || {};
  const ALL_CATEGORY = SHARED_CONTENT.ALL_CATEGORY || "全部";
  const BOOKMARK_CATEGORY = SHARED_CONTENT.BOOKMARK_CATEGORY || "收藏";
  const DEFAULT_PAGE_SIZE = 9;
  const FALLBACK_BOOKMARK_ONLY_CATEGORIES = Object.freeze([
    { name: BOOKMARK_CATEGORY, emoji: "📚" },
  ]);
  const DEFAULT_SUPPORTED_CATEGORIES = Object.freeze(
    typeof SHARED_CONTENT.getSupportedBlogCategories === "function"
      ? SHARED_CONTENT.getSupportedBlogCategories()
      : [
        ALL_CATEGORY,
        "精选",
        "技术",
        "随想",
        "教程",
        "工具",
        BOOKMARK_CATEGORY,
      ],
  );
  const BOOKMARK_ONLY_CATEGORIES = Object.freeze(
    typeof SHARED_CONTENT.getBookmarkOnlyCategories === "function"
      ? SHARED_CONTENT.getBookmarkOnlyCategories()
      : FALLBACK_BOOKMARK_ONLY_CATEGORIES,
  );
  const FALLBACK_CATEGORY_COLOR = Object.freeze({
    bg: "rgba(0, 229, 255, 0.1)",
    color: "#00e5ff",
    border: "rgba(0, 229, 255, 0.2)",
  });
  const DEFAULT_COVER_GRADIENT = "linear-gradient(135deg, #1a1a2e, #16213e)";
  const sanitizeCssColor = typeof SHARED_CONTENT.sanitizeCssColorValue === "function"
    ? SHARED_CONTENT.sanitizeCssColorValue
    : (value) => value;
  const normalizeBookmarkSearchQuery = typeof SHARED_CONTENT.normalizeSearchText === "function"
    ? SHARED_CONTENT.normalizeSearchText
    : (value) => String(value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  const buildSharedPostSearchText = typeof SHARED_CONTENT.buildPostSearchText === "function"
    ? SHARED_CONTENT.buildPostSearchText
    : (post) => [
      post?.title || "",
      post?.excerpt || "",
      ...(Array.isArray(post?.tags) ? post.tags : []),
    ].join(" ").toLowerCase().trim().replace(/\s+/g, " ");
  const HISTORY_MODE_REPLACE = "replace";
  const HISTORY_MODE_PUSH = "push";
  const BOOKMARK_HASH_PREFIX = "#bookmarks";

  function normalizeBookmarkListingPage(value, fallback = 1) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function buildBookmarkListingHashFallback({ search = "", page = 1 } = {}) {
    const params = new URLSearchParams();
    const normalizedSearch = typeof search === "string" ? search.trim() : "";
    const normalizedPage = normalizeBookmarkListingPage(page, 1);

    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    }
    if (normalizedPage > 1) {
      params.set("page", String(normalizedPage));
    }

    const hashQuery = params.toString();
    return `${BOOKMARK_HASH_PREFIX}${hashQuery ? `?${hashQuery}` : ""}`;
  }

  function buildBookmarkListingUrlFallback({ search = "", page = 1, pathname = "/blog.html" } = {}) {
    const resolvedPathname = typeof pathname === "string" && pathname.trim()
      ? pathname.trim()
      : "/blog.html";

    return `${resolvedPathname}${buildBookmarkListingHashFallback({ search, page })}`;
  }

  function parseBookmarkListingHashFallback(hash = "") {
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
    const page = normalizeBookmarkListingPage(params.get("page"), 1);

    return {
      active: true,
      search,
      page,
      normalizedHash: buildBookmarkListingHashFallback({ search, page }),
    };
  }

  function buildBookmarkSearchText(post) {
    return typeof post?._searchText === "string" && post._searchText
      ? post._searchText
      : buildSharedPostSearchText(post);
  }

  function buildBookmarkPageData({ bookmarkManager, search, page, pageSize, onBeforeRead } = {}) {
    if (typeof onBeforeRead === "function") {
      onBeforeRead();
    }

    let bookmarks = bookmarkManager.getAll();
    if (search) {
      const query = normalizeBookmarkSearchQuery(search);
      bookmarks = bookmarks.filter((post) => buildBookmarkSearchText(post).includes(query));
    }

    const total = bookmarks.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const start = (currentPage - 1) * pageSize;

    return {
      results: bookmarks.slice(start, start + pageSize),
      total,
      totalPages,
      currentPage,
    };
  }

  function initBlogPage() {
    const notionApi = window.NotionAPI;
    const sharedContent = SHARED_CONTENT;
    const siteUtils = window.SiteUtils || {};
    const parseBookmarkListingHash =
      typeof siteUtils.parseBookmarkListingHash === "function"
        ? siteUtils.parseBookmarkListingHash
        : parseBookmarkListingHashFallback;
    const buildBookmarkListingUrl =
      typeof siteUtils.buildBookmarkListingUrl === "function"
        ? siteUtils.buildBookmarkListingUrl
        : buildBookmarkListingUrlFallback;
    const bookmarkManager = window.BookmarkManager || {
      getAll: () => [],
      isBookmarked: () => false,
      toggleById: () => null,
    };
    const hasRemoteSource = Boolean(notionApi);
    const defaultCategory = hasRemoteSource ? ALL_CATEGORY : BOOKMARK_CATEGORY;

    const filtersEl = document.getElementById("blogFilters");
    const searchInput = document.getElementById("blogSearch");
    const gridEl = document.getElementById("blogGrid");
    const emptyEl = document.getElementById("emptyState");
    const paginationEl = document.getElementById("pagination");
    const statusEl = document.getElementById("blogStatus");
    const escapeText =
      notionApi?.escapeHtml ||
      sharedContent.escapeHtml ||
      ((value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;"));
    const getCategoryColor =
      notionApi?.getCategoryColor ||
      sharedContent.getCategoryColor ||
      (() => FALLBACK_CATEGORY_COLOR);

    if (!filtersEl || !searchInput || !gridEl || !emptyEl || !paginationEl) {
      return null;
    }

    let currentCategory = defaultCategory;
    let currentSearch = "";
    let currentPage = 1;
    let renderToken = 0;
    let searchDebounce = null;
    let revealFrame = null;
    let cleanupCardReveal = null;
    let statusAnnouncementHandle = null;
    let metadataHydrationTask = null;
    let didAttemptHydration = false;
    let isDisposed = false;
    let didNormalizeRoute = false;
    let hashChangeHandler = null;
    const supportedCategories = new Set(DEFAULT_SUPPORTED_CATEGORIES);

    const params = new URLSearchParams(window.location.search);
    const rawCategory = params.get("category");
    const rawSearch = params.get("search");
    const rawPage = params.get("page");
    const bookmarkHashState = parseBookmarkListingHash(window.location.hash);

    if (rawCategory) {
      currentCategory = rawCategory.trim();
      if (currentCategory !== rawCategory) {
        didNormalizeRoute = true;
      }
    }
    if (rawSearch) {
      currentSearch = rawSearch.trim();
      if (currentSearch !== rawSearch) {
        didNormalizeRoute = true;
      }
    }
    if (rawPage) {
      currentPage = Math.max(1, parseInt(rawPage, 10) || 1);
      if (String(currentPage) !== rawPage) {
        didNormalizeRoute = true;
      }
    }
    if (bookmarkHashState.active) {
      currentCategory = BOOKMARK_CATEGORY;
      currentSearch = bookmarkHashState.search;
      currentPage = bookmarkHashState.page;
      if (
        rawCategory ||
        rawSearch ||
        rawPage ||
        (window.location.hash || "") !== bookmarkHashState.normalizedHash
      ) {
        didNormalizeRoute = true;
      }
    } else if (currentCategory === BOOKMARK_CATEGORY) {
      didNormalizeRoute = true;
    }
    if (!supportedCategories.has(currentCategory)) {
      currentCategory = defaultCategory;
      didNormalizeRoute = true;
    }

    if (!hasRemoteSource && currentCategory !== BOOKMARK_CATEGORY) {
      console.error("NotionAPI is unavailable on blog page.");
      if (didNormalizeRoute) {
        syncListingUrl();
      }
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

    const categories = hasRemoteSource ? notionApi.getCategories() : BOOKMARK_ONLY_CATEGORIES;
    const pageSize = notionApi?.getPageSize?.() || DEFAULT_PAGE_SIZE;
    const validCategories = new Set([...categories.map((cat) => cat.name), BOOKMARK_CATEGORY]);
    if (!validCategories.has(currentCategory)) {
      currentCategory = defaultCategory;
      didNormalizeRoute = true;
    }
    searchInput.setAttribute("aria-controls", "blogGrid");

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

    function describeLoadFailure(error) {
      const status = Number(error?.status);
      const code = typeof error?.code === "string" ? error.code : "";
      const notionCode = typeof error?.notionCode === "string" ? error.notionCode : "";
      const detail = typeof error?.detail === "string"
        ? error.detail.trim()
        : typeof error?.message === "string"
          ? error.message.trim()
          : "";
      const normalizedDetail = detail.toLowerCase();
      const isDatabaseObjectNotFound =
        notionCode === "object_not_found" && normalizedDetail.includes("database");

      if (code === "notion_config_error") {
        if (detail.includes("NOTION_DATABASE_ID")) {
          return "文章数据库 ID 未配置，请检查 Vercel 环境变量。";
        }
        if (detail.includes("NOTION_TOKEN")) {
          return "Notion Token 未配置，请检查 Vercel 环境变量。";
        }
        return "站点的 Notion 环境变量配置不完整。";
      }

      if (code === "notion_public_config_error") {
        return "Notion 公开字段或发布状态配置异常，请检查数据库里的公开/已发布列。";
      }

      if (status === 401 || status === 403 || notionCode === "unauthorized" || notionCode === "restricted_resource") {
        return "Notion integration 暂无数据库访问权限，请确认已把集成邀请到该数据库。";
      }

      if (
        (status === 404 || isDatabaseObjectNotFound) &&
        (normalizedDetail.includes("database") || notionCode === "object_not_found")
      ) {
        return "NOTION_DATABASE_ID 无效，或当前 integration 无权访问这个数据库。";
      }

      if (status === 429 || notionCode === "rate_limited") {
        return "Notion API 当前限流，请稍后重试。";
      }

      if (status === 504 || code === "notion_timeout_error") {
        return "Notion API 响应超时，请稍后重试。";
      }

      return "请检查网络后重试";
    }

    function isBookmarkView() {
      return currentCategory === BOOKMARK_CATEGORY;
    }

    function scheduleLegacyMetadataHydration() {
      if (!isBookmarkView()) return;
      if (didAttemptHydration) return;
      if (metadataHydrationTask) return;
      if (typeof bookmarkManager.hasLegacyMetadata !== "function") return;
      if (!bookmarkManager.hasLegacyMetadata()) return;

      didAttemptHydration = true;
      metadataHydrationTask = Promise.resolve(bookmarkManager.hydrateMissingMetadata?.())
        .then((didHydrate) => {
          if (didHydrate && !isDisposed && isBookmarkView()) {
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
      setGridBusy(false);
      gridEl.innerHTML = "";
      emptyEl.innerHTML = renderEmptyStateMarkup(options);
      emptyEl.style.display = "flex";
      paginationEl.innerHTML = "";
      announceStatus(options.announcement || options.title || "没有找到匹配的文章。");
    }

    function updatePageUI() {
      const titleEl = document.querySelector(".page-title");
      if (titleEl) {
        titleEl.textContent = currentCategory === ALL_CATEGORY ? "总览" : currentCategory;
      }

      const isLocalBookmarkView = isBookmarkView();
      const title = `${currentCategory === ALL_CATEGORY ? "总览" : currentCategory} — Share Everything`;
      const description = isLocalBookmarkView
        ? "浏览当前浏览器中保存的本地收藏文章。"
        : currentSearch
        ? `搜索“${currentSearch}”的相关文章`
        : currentCategory === ALL_CATEGORY
          ? "探索所有文章，按分类浏览，搜索你感兴趣的内容。"
          : `浏览「${currentCategory}」分类下的文章`;
      const seoUrl = isLocalBookmarkView ? "/blog.html" : window.location.href;
      const seoRobots = isLocalBookmarkView ? "noindex, nofollow" : null;
      if (typeof window.updateSeoMeta === "function") {
        window.updateSeoMeta({
          title,
          description,
          url: seoUrl,
          canonicalUrl: seoUrl,
          robots: seoRobots,
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
        if (isBookmarkView() && text === BOOKMARK_CATEGORY) {
          button.classList.add("active");
        } else if (!isBookmarkView() && text === "总览") {
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

    function buildListingUrl() {
      if (isBookmarkView()) {
        return buildBookmarkListingUrl({
          pathname: window.location.pathname,
          search: currentSearch,
          page: currentPage,
        });
      }

      const nextParams = new URLSearchParams();
      if (currentCategory !== ALL_CATEGORY) nextParams.set("category", currentCategory);
      if (currentSearch) nextParams.set("search", currentSearch);
      if (currentPage > 1) nextParams.set("page", String(currentPage));

      const qs = nextParams.toString();
      return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    }

    function syncListingUrl(historyMode = HISTORY_MODE_REPLACE) {
      const resolvedHistoryMode = historyMode === HISTORY_MODE_PUSH
        ? HISTORY_MODE_PUSH
        : HISTORY_MODE_REPLACE;
      const nextUrl = buildListingUrl();
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl !== currentUrl) {
        if (resolvedHistoryMode === HISTORY_MODE_PUSH) {
          history.pushState(null, "", nextUrl);
        } else {
          history.replaceState(null, "", nextUrl);
        }
      }

      if (typeof siteUtils.rememberBlogReturnUrl === "function") {
        siteUtils.rememberBlogReturnUrl(window.location.href);
      }
    }

    function renderCard(post) {
      const esc = escapeText;
      // Defense-in-depth: catColor values originate from a hardcoded map but are
      // sanitized for consistency with the shared renderPostArticle pipeline.
      const catColor = getCategoryColor(post.category);
      const bookmarked = bookmarkManager.isBookmarked(post.id);

      const safeTitle = esc(post.title);
      const safeExcerpt = esc(post.excerpt);
      const safeCategory = esc(post.category);
      const safeCoverEmoji = esc(post.coverEmoji || "📝");
      const safeCoverGradient =
        typeof siteUtils.sanitizeCoverBackground === "function"
          ? siteUtils.sanitizeCoverBackground(post.coverGradient, DEFAULT_COVER_GRADIENT)
          : DEFAULT_COVER_GRADIENT;
      const safeCoverImage =
        typeof siteUtils.resolveShareImageUrl === "function"
          ? siteUtils.resolveShareImageUrl(post.coverImage, null)
          : typeof siteUtils.sanitizeImageUrl === "function"
            ? siteUtils.sanitizeImageUrl(post.coverImage)
          : null;
      const safePostUrl =
        typeof siteUtils.buildPostPath === "function"
          ? siteUtils.buildPostPath(post.id)
          : `/posts/${encodeURIComponent(post.id)}`;
      const serializedTags = esc(JSON.stringify(Array.isArray(post.tags) ? post.tags : []));
      const bookmarkTitle = bookmarked ? "取消收藏" : "收藏";
      const bookmarkAriaLabel = `${bookmarkTitle}文章：${post.title || "Untitled"}`;
      const categoryHtml = post.category
        ? `<div class="blog-card-category" style="background: ${sanitizeCssColor(catColor.bg, FALLBACK_CATEGORY_COLOR.bg)}; color: ${sanitizeCssColor(catColor.color, FALLBACK_CATEGORY_COLOR.color)}; border-color: ${sanitizeCssColor(catColor.border, FALLBACK_CATEGORY_COLOR.border)}">${safeCategory}</div>`
        : "";
      const metaItems = [];

      if (post.date) {
        metaItems.push(`
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                ${esc(post.date)}
              </span>
        `);
      }

      if (post.readTime) {
        metaItems.push(`
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${esc(post.readTime)}
              </span>
        `);
      }
      const coverHtml = safeCoverImage
        ? `<div class="blog-card-cover-placeholder blog-card-cover-img" data-cover-gradient="${esc(safeCoverGradient)}" data-cover-emoji="${safeCoverEmoji}">
             <img src="${esc(safeCoverImage)}" alt="${safeTitle}" loading="lazy" decoding="async">
           </div>`
        : `<div class="blog-card-cover-placeholder" data-cover-gradient="${esc(safeCoverGradient)}" data-cover-emoji="${safeCoverEmoji}" style="background: ${safeCoverGradient}">
             <span>${safeCoverEmoji}</span>
           </div>`;

      return `
        <article class="blog-card" data-reveal data-post-id="${esc(post.id)}" data-post-tags="${serializedTags}" role="listitem">
          <a href="${safePostUrl}" class="blog-card-link" aria-label="阅读文章：${safeTitle}"></a>
          ${coverHtml}
          <div class="blog-card-body">
            ${categoryHtml}
            <h3 class="blog-card-title">${safeTitle}</h3>
            <p class="blog-card-excerpt">${safeExcerpt}</p>
            <div class="blog-card-meta">
              ${metaItems.join("")}
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

    function restoreCoverPlaceholder(placeholder) {
      if (!(placeholder instanceof HTMLElement)) return;

      const coverGradient =
        typeof siteUtils.sanitizeCoverBackground === "function"
          ? siteUtils.sanitizeCoverBackground(placeholder.dataset.coverGradient, DEFAULT_COVER_GRADIENT)
          : DEFAULT_COVER_GRADIENT;
      const coverEmoji = placeholder.dataset.coverEmoji || "📝";

      placeholder.classList.remove("blog-card-cover-img");
      placeholder.style.background = coverGradient;
      placeholder.replaceChildren();

      const emoji = document.createElement("span");
      emoji.textContent = coverEmoji;
      placeholder.appendChild(emoji);
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

    async function loadCurrentPageData() {
      if (!isBookmarkView()) {
        return notionApi.queryPosts({
          category: currentCategory,
          search: currentSearch,
          page: currentPage,
        });
      }

      return buildBookmarkPageData({
        bookmarkManager,
        search: currentSearch,
        page: currentPage,
        pageSize,
        onBeforeRead: scheduleLegacyMetadataHydration,
      });
    }

    async function renderPosts() {
      const currentToken = ++renderToken;
      clearCardReveal();
      setGridBusy(true);
      announceStatus(currentSearch ? "正在更新搜索结果。" : "正在加载文章列表。");

      try {
        const data = await loadCurrentPageData();

        if (currentToken !== renderToken) return;
        if (currentPage !== data.currentPage) {
          currentPage = data.currentPage;
          syncListingUrl();
        }

        if (data.results.length === 0) {
          showEmptyState();
          return;
        }

        emptyEl.style.display = "none";
        gridEl.innerHTML = data.results.map(renderCard).join("");
        renderPagination(data);
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
          hint: describeLoadFailure(error),
          actionLabel: "重试",
          announcement: "文章加载失败，请重试。",
        });
      }
    }

    function handleFilterClick(event) {
      const button = event.target.closest(".filter-btn");
      if (!button || !filtersEl.contains(button)) return;

      currentCategory = button.dataset.category || ALL_CATEGORY;
      currentPage = 1;
      syncListingUrl(HISTORY_MODE_PUSH);
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
        syncListingUrl(HISTORY_MODE_REPLACE);
        updatePageUI();
        renderPosts();
      }, 300);
    }

    function handlePaginationClick(event) {
      const button = event.target.closest(".page-btn");
      if (!button || !paginationEl.contains(button)) return;

      currentPage = parseInt(button.dataset.page || "1", 10) || 1;
      syncListingUrl(HISTORY_MODE_PUSH);
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

      if (!nowBookmarked && isBookmarkView()) {
        setTimeout(() => renderPosts(), 300);
      }
    }

    function handleGridMediaError(event) {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;

      const placeholder = image.closest(".blog-card-cover-placeholder.blog-card-cover-img");
      if (!placeholder || !gridEl.contains(placeholder)) return;

      image.remove();
      restoreCoverPlaceholder(placeholder);
    }

    function handleEmptyStateClick(event) {
      const button = event.target.closest("[data-empty-action='retry']");
      if (!button || !emptyEl.contains(button)) return;
      renderPosts();
    }

    function bindBookmarkHashNavigation() {
      hashChangeHandler = () => {
        const nextBookmarkState = parseBookmarkListingHash(window.location.hash);

        if (nextBookmarkState.active) {
          const didChange =
            currentCategory !== BOOKMARK_CATEGORY ||
            currentSearch !== nextBookmarkState.search ||
            currentPage !== nextBookmarkState.page;

          currentCategory = BOOKMARK_CATEGORY;
          currentSearch = nextBookmarkState.search;
          currentPage = nextBookmarkState.page;

          if ((window.location.hash || "") !== nextBookmarkState.normalizedHash) {
            syncListingUrl(HISTORY_MODE_REPLACE);
          }

          if (!didChange) {
            return;
          }

          searchInput.value = currentSearch;
          updatePageUI();
          renderFilters();
          renderPosts();
          return;
        }

        if (!isBookmarkView()) {
          return;
        }

        if (!hasRemoteSource) {
          syncListingUrl(HISTORY_MODE_REPLACE);
          return;
        }

        currentCategory = ALL_CATEGORY;
        currentSearch = "";
        currentPage = 1;
        searchInput.value = currentSearch;
        updatePageUI();
        renderFilters();
        renderPosts();
      };

      window.addEventListener("hashchange", hashChangeHandler);
    }

    if (didNormalizeRoute) {
      syncListingUrl();
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
    bindBookmarkHashNavigation();

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
      if (hashChangeHandler) {
        window.removeEventListener("hashchange", hashChangeHandler);
        hashChangeHandler = null;
      }
      clearStatusAnnouncement();
      setGridBusy(false);
      if (statusEl) statusEl.textContent = "";
      clearCardReveal();
    };
  }

  window.PageRuntime?.register("blog", {
    init: initBlogPage,
  });
})();
