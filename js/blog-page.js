(() => {
  function initBlogPage() {
    const notionApi = window.NotionAPI;
    const bookmarkManager = window.BookmarkManager || {
      getAll: () => [],
      isBookmarked: () => false,
      toggleById: () => false,
    };

    const filtersEl = document.getElementById("blogFilters");
    const searchInput = document.getElementById("blogSearch");
    const gridEl = document.getElementById("blogGrid");
    const emptyEl = document.getElementById("emptyState");
    const paginationEl = document.getElementById("pagination");

    if (!filtersEl || !searchInput || !gridEl || !emptyEl || !paginationEl) {
      return null;
    }

    if (!notionApi) {
      console.error("NotionAPI is unavailable on blog page.");
      filtersEl.replaceChildren();
      showEmptyState();
      return null;
    }

    let currentCategory = "全部";
    let currentSearch = "";
    let currentPage = 1;
    let renderToken = 0;
    let searchDebounce = null;
    let detailWarmupHandle = null;

    const params = new URLSearchParams(window.location.search);
    if (params.get("category")) currentCategory = params.get("category");
    if (params.get("search")) currentSearch = params.get("search");
    if (params.get("page")) currentPage = Math.max(1, parseInt(params.get("page"), 10) || 1);

    const categories = notionApi.getCategories();
    const pageSize = notionApi.getPageSize?.() || 9;
    const validCategories = new Set([...categories.map((cat) => cat.name), "收藏"]);
    if (!validCategories.has(currentCategory)) currentCategory = "全部";

    function clearDetailWarmup() {
      if (detailWarmupHandle == null) return;

      if ("cancelIdleCallback" in window) {
        window.cancelIdleCallback(detailWarmupHandle);
      } else {
        clearTimeout(detailWarmupHandle);
      }

      detailWarmupHandle = null;
    }

    function showEmptyState() {
      clearDetailWarmup();
      gridEl.innerHTML = "";
      emptyEl.style.display = "flex";
      paginationEl.innerHTML = "";
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

      document.title = `${currentCategory === "全部" ? "总览" : currentCategory} — Share Everything`;
      const description = currentSearch
        ? `搜索“${currentSearch}”的相关文章`
        : currentCategory === "全部"
          ? "探索所有文章，按分类浏览，搜索你感兴趣的内容。"
          : `浏览「${currentCategory}」分类下的文章`;
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.content = description;
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
    }

    function saveHistory() {
      try {
        const entries = JSON.parse(localStorage.getItem("blog_history") || "[]");
        entries.unshift({
          url: window.location.href,
          category: currentCategory,
          search: currentSearch,
          timestamp: Date.now(),
        });
        localStorage.setItem("blog_history", JSON.stringify(entries.slice(0, 50)));
      } catch (error) {
        // localStorage unavailable
      }
    }

    function renderCard(post) {
      const esc = notionApi.escapeHtml;
      const catColor = notionApi.getCategoryColor(post.category);
      const bookmarked = bookmarkManager.isBookmarked(post.id);
      const defaultCoverGradient = "linear-gradient(135deg, #1a1a2e, #16213e)";

      const safeTitle = esc(post.title);
      const safeExcerpt = esc(post.excerpt);
      const safeCategory = esc(post.category);
      const safeCoverEmoji = esc(post.coverEmoji || "📝");
      const safeCoverGradient = sanitizeCoverBackground(post.coverGradient, defaultCoverGradient);
      const safeCoverImage = sanitizeImageUrl(post.coverImage);
      const coverHtml = safeCoverImage
        ? `<div class="blog-card-cover-placeholder blog-card-cover-img">
             <img src="${esc(safeCoverImage)}" alt="${safeTitle}" loading="lazy">
           </div>`
        : `<div class="blog-card-cover-placeholder" style="background: ${safeCoverGradient}">
             <span>${safeCoverEmoji}</span>
           </div>`;

      return `
        <a href="post.html?id=${encodeURIComponent(post.id)}" class="blog-card" data-reveal data-post-id="${esc(post.id)}">
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
              <button class="card-bookmark-btn${bookmarked ? " bookmarked" : ""}" data-bookmark-id="${esc(post.id)}" title="${bookmarked ? "取消收藏" : "收藏"}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          </div>
        </a>
      `;
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

    function sanitizeCoverBackground(value, fallback) {
      if (typeof value !== "string") return fallback;

      const trimmed = value.trim();
      const isGradient = /^(linear-gradient|radial-gradient)\([#(),.%\sa-zA-Z0-9+-]+\)$/.test(trimmed);
      if (!trimmed || !isGradient) return fallback;
      if (trimmed.includes(";") || /url\s*\(/i.test(trimmed)) return fallback;
      return trimmed;
    }

    function renderPagination(data) {
      if (data.totalPages <= 1) {
        paginationEl.innerHTML = "";
        return;
      }

      let html = "";
      for (let i = 1; i <= data.totalPages; i++) {
        html += `<button class="page-btn${i === data.currentPage ? " active" : ""}" data-page="${i}">${i}</button>`;
      }
      paginationEl.innerHTML = html;
    }

    async function renderPosts() {
      const currentToken = ++renderToken;

      try {
        let data;

        if (currentCategory === "收藏") {
          let bookmarks = bookmarkManager.getAll();

          if (currentSearch) {
            const query = currentSearch.toLowerCase();
            bookmarks = bookmarks.filter(
              (post) =>
                post.title.toLowerCase().includes(query) ||
                (post.excerpt || "").toLowerCase().includes(query),
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

        requestAnimationFrame(() => {
          window.initBlogCardReveal?.();
        });

        saveHistory();
      } catch (error) {
        if (currentToken !== renderToken) return;

        console.error("Failed to load posts:", error);
        showEmptyState();
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

      button.classList.toggle("bookmarked", nowBookmarked);
      button.title = nowBookmarked ? "取消收藏" : "收藏";
      button.classList.remove("bounce");
      void button.offsetWidth;
      button.classList.add("bounce");

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

    updatePageUI();
    renderFilters();
    searchInput.value = currentSearch;

    filtersEl.addEventListener("click", handleFilterClick);
    searchInput.addEventListener("input", handleSearchInput);
    paginationEl.addEventListener("click", handlePaginationClick);
    gridEl.addEventListener("click", handleGridClick);
    gridEl.addEventListener("error", handleGridMediaError, true);

    renderPosts();

    return () => {
      renderToken += 1;
      clearTimeout(searchDebounce);
      searchDebounce = null;
      filtersEl.removeEventListener("click", handleFilterClick);
      searchInput.removeEventListener("input", handleSearchInput);
      paginationEl.removeEventListener("click", handlePaginationClick);
      gridEl.removeEventListener("click", handleGridClick);
      gridEl.removeEventListener("error", handleGridMediaError, true);
      clearDetailWarmup();
    };
  }

  window.PageRuntime?.register("blog", {
    init: initBlogPage,
  });
})();
