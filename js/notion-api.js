/**
 * notion-api.js — Notion API 集成层（客户端）
 */

const NotionAPI = (() => {
  const CONFIG = {
    postsEndpoint: "/api/posts-data",
    postEndpoint: "/api/post-data",
    pageSize: 9,
  };
  const REQUEST_TIMEOUT = 12000;
  const POST_SUMMARY_CACHE_PREFIX = "notion_post_summary_";
  const POSTS_REQUEST_KEY_PREFIX = "notion_query_posts";
  const POST_REQUEST_KEY_PREFIX = "notion_page_";
  const POST_SUMMARY_CACHE_TTL = 1000 * 60 * 30;
  const FALLBACK_REMOTE_BLOG_CATEGORIES = [
    { name: "全部", emoji: "📋", color: "cyan" },
    { name: "精选", emoji: "🌟", color: "pink" },
    { name: "技术", emoji: "💻", color: "blue" },
    { name: "随想", emoji: "💭", color: "purple" },
    { name: "教程", emoji: "📖", color: "green" },
    { name: "工具", emoji: "🔧", color: "orange" },
  ];
  const sharedContent = window.NotionContent || {};
  const ALL_CATEGORY = sharedContent.ALL_CATEGORY || "全部";
  const REMOTE_BLOG_CATEGORIES =
    typeof sharedContent.getRemoteBlogCategories === "function"
      ? sharedContent.getRemoteBlogCategories()
      : FALLBACK_REMOTE_BLOG_CATEGORIES;
  const pendingRequests = new Map();
  const postSummaryMemoryCache = new Map();
  const postSummaryTimestampCache = new Map();
  const fallbackCategoryColor = {
    bg: "rgba(0, 229, 255, 0.1)",
    color: "#00e5ff",
    border: "rgba(0, 229, 255, 0.2)",
  };

  function escapeHtml(value) {
    if (typeof sharedContent.escapeHtml === "function") {
      return sharedContent.escapeHtml(value);
    }

    if (!value) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function gradientForCategory(category) {
    if (typeof sharedContent.gradientForCategory === "function") {
      return sharedContent.gradientForCategory(category);
    }

    return "linear-gradient(135deg, #1a1a2e, #16213e)";
  }

  function getCategoryColor(category) {
    if (typeof sharedContent.getCategoryColor === "function") {
      return sharedContent.getCategoryColor(category);
    }

    return fallbackCategoryColor;
  }

  function renderBlocks(blocks) {
    if (typeof sharedContent.renderBlocks === "function") {
      return sharedContent.renderBlocks(blocks, { baseOrigin: window.location.origin });
    }

    return "";
  }

  function renderPostArticle(post) {
    if (typeof sharedContent.renderPostArticle === "function") {
      return sharedContent.renderPostArticle(post, { baseOrigin: window.location.origin });
    }

    return "";
  }

  function createRequestError(message, { status, notionCode, code, detail } = {}) {
    const error = new Error(message);
    if (Number.isFinite(Number(status))) {
      error.status = Number(status);
    }
    if (typeof notionCode === "string" && notionCode) {
      error.notionCode = notionCode;
    }
    if (typeof code === "string" && code) {
      error.code = code;
    }
    if (typeof detail === "string" && detail) {
      error.detail = detail;
    }
    return error;
  }

  function isPostSummaryCacheKey(key) {
    return typeof key === "string" && key.startsWith(POST_SUMMARY_CACHE_PREFIX);
  }

  function removeCacheEntry(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {}
  }

  function collectPostSummaryCacheEntries(excludeKey) {
    const entries = [];
    const corruptedKeys = [];

    // Pre-collect all keys to avoid index shifting if entries are removed
    // during iteration (e.g. by another tab or a future code change).
    const allKeys = [];
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        allKeys.push(sessionStorage.key(index));
      }
    } catch (error) {
      return [];
    }

    for (const key of allKeys) {
      if (!key || key === excludeKey || !isPostSummaryCacheKey(key)) continue;

      const raw = sessionStorage.getItem(key);
      if (!raw) {
        entries.push({ key, timestamp: 0 });
        continue;
      }

      try {
        const parsed = JSON.parse(raw);
        entries.push({
          key,
          timestamp: Number.isFinite(Number(parsed?.timestamp)) ? Number(parsed.timestamp) : 0,
        });
      } catch (error) {
        corruptedKeys.push(key);
      }
    }

    corruptedKeys.forEach(removeCacheEntry);
    return entries.sort((left, right) => left.timestamp - right.timestamp);
  }

  function trySetSessionCacheItem(key, payload) {
    try {
      sessionStorage.setItem(key, payload);
      return true;
    } catch (error) {
      return false;
    }
  }

  function readSessionCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      if (isPostSummaryCacheKey(key)) {
        removeCacheEntry(key);
      }
      return null;
    }
  }

  function writeSessionCache(key, data, timestamp = Date.now()) {
    const payload = JSON.stringify({ timestamp, data });
    if (trySetSessionCacheItem(key, payload)) return;

    const existingEntries = collectPostSummaryCacheEntries(key);
    for (const entry of existingEntries) {
      removeCacheEntry(entry.key);
      if (trySetSessionCacheItem(key, payload)) {
        return;
      }
    }
  }

  function getPostSummaryCacheKey(pageId) {
    return `${POST_SUMMARY_CACHE_PREFIX}${pageId}`;
  }

  function normalizePostSummary(post) {
    if (!post?.id) return null;

    const title = post.title || "Untitled";
    const excerpt = post.excerpt || "";
    const category = post.category || "";
    const readTime = post.readTime || "";
    const coverImage = post.coverImage || null;
    const coverEmoji = post.coverEmoji || "📝";
    const coverGradient = post.coverGradient || gradientForCategory(category);
    const tags = Array.isArray(post.tags) ? [...post.tags] : [];

    return {
      id: post.id,
      title,
      excerpt,
      category,
      date: post.date || "",
      readTime,
      coverImage,
      coverEmoji,
      coverGradient,
      tags,
      _searchText: post._searchText || [title, excerpt, ...tags].join(" ").toLowerCase(),
    };
  }

  function storePostSummary(post, timestamp = Date.now()) {
    const summary = normalizePostSummary(post);
    if (!summary) return null;

    postSummaryMemoryCache.set(summary.id, summary);
    postSummaryTimestampCache.set(summary.id, timestamp);
    writeSessionCache(getPostSummaryCacheKey(summary.id), summary, timestamp);
    return summary;
  }

  function primePostSummaries(posts, timestamp = Date.now()) {
    (posts || []).forEach((post) => {
      storePostSummary(post, timestamp);
    });
  }

  function getPostSummarySnapshot(pageId) {
    if (!pageId) return null;

    if (postSummaryMemoryCache.has(pageId) && postSummaryTimestampCache.has(pageId)) {
      const summary = postSummaryMemoryCache.get(pageId);
      const timestamp = postSummaryTimestampCache.get(pageId);
      return {
        summary,
        timestamp,
        age: Date.now() - timestamp,
      };
    }

    const cached = readSessionCache(getPostSummaryCacheKey(pageId));
    if (!cached) return null;

    const summary = normalizePostSummary(cached.data);
    if (!summary) return null;

    postSummaryMemoryCache.set(pageId, summary);
    postSummaryTimestampCache.set(pageId, cached.timestamp);
    return {
      summary,
      timestamp: cached.timestamp,
      age: Date.now() - cached.timestamp,
    };
  }

  function getPostSummary(pageId, maxAge = POST_SUMMARY_CACHE_TTL) {
    const snapshot = getPostSummarySnapshot(pageId);
    if (!snapshot || snapshot.age >= maxAge) return null;
    return snapshot.summary;
  }

  function withPendingRequest(key, loader) {
    if (pendingRequests.has(key)) {
      return pendingRequests.get(key);
    }

    const pending = Promise.resolve()
      .then(loader)
      .finally(() => {
        if (pendingRequests.get(key) === pending) {
          pendingRequests.delete(key);
        }
      });

    pendingRequests.set(key, pending);
    return pending;
  }

  async function requestJsonWithTimeout(url, init = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawDetail = await response.text().catch(() => "");
        let detail = rawDetail;
        let notionCode = "";
        let code = "";

        if (rawDetail) {
          try {
            const parsedDetail = JSON.parse(rawDetail);
            if (typeof parsedDetail?.detail === "string" && parsedDetail.detail) {
              detail = parsedDetail.detail;
            } else if (typeof parsedDetail?.message === "string" && parsedDetail.message) {
              detail = parsedDetail.message;
            } else if (typeof parsedDetail?.error === "string" && parsedDetail.error) {
              detail = parsedDetail.error;
            }
            if (typeof parsedDetail?.code === "string" && parsedDetail.code) {
              code = parsedDetail.code;
            }
            if (typeof parsedDetail?.notionCode === "string" && parsedDetail.notionCode) {
              notionCode = parsedDetail.notionCode;
            }
          } catch (error) {}
        }

        throw createRequestError(`Notion API error: ${response.status}${detail ? ` ${detail}` : ""}`, {
          status: response.status,
          notionCode,
          code,
          detail,
        });
      }

      return response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw createRequestError("Notion API request timed out", {
          status: 504,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function buildPostQueryString({ category, search, page } = {}) {
    const params = new URLSearchParams();

    if (category && category !== ALL_CATEGORY) {
      params.set("category", category);
    }

    if (search) {
      params.set("search", search);
    }

    const requestedPage = Number.isFinite(Number(page))
      ? Math.max(1, Math.trunc(Number(page)))
      : 1;
    if (requestedPage > 1) {
      params.set("page", String(requestedPage));
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
  }

  function buildPostsRequestKey(options = {}) {
    return `${POSTS_REQUEST_KEY_PREFIX}${buildPostQueryString(options)}`;
  }

  function normalizePostQueryResult(data) {
    const results = Array.isArray(data?.results)
      ? data.results.map(normalizePostSummary).filter(Boolean)
      : [];
    const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : results.length;
    const totalPages = Math.max(
      1,
      Number.isFinite(Number(data?.totalPages))
        ? Number(data.totalPages)
        : Math.ceil(total / CONFIG.pageSize) || 1,
    );
    const currentPage = Math.max(
      1,
      Number.isFinite(Number(data?.currentPage)) ? Number(data.currentPage) : 1,
    );

    return {
      results,
      total,
      totalPages,
      currentPage,
    };
  }

  async function fetchPostsRemote(options) {
    return withPendingRequest(buildPostsRequestKey(options), async () => {
      const mappedData = normalizePostQueryResult(
        await requestJsonWithTimeout(`${CONFIG.postsEndpoint}${buildPostQueryString(options)}`),
      );

      primePostSummaries(mappedData.results);
      return mappedData;
    });
  }

  async function liveQueryDatabase({ category, search, page = 1 }) {
    return fetchPostsRemote({ category, search, page });
  }

  async function fetchPageRemote(pageId) {
    return withPendingRequest(`${POST_REQUEST_KEY_PREFIX}${pageId}`, async () => {
      const mappedData = await requestJsonWithTimeout(
        `${CONFIG.postEndpoint}?id=${encodeURIComponent(pageId)}`,
      );

      storePostSummary(mappedData);
      return mappedData;
    });
  }

  async function liveGetPage(pageId) {
    return fetchPageRemote(pageId);
  }

  return {
    getCategories: () => REMOTE_BLOG_CATEGORIES.map((category) => ({ ...category })),
    queryPosts: (options = {}) => liveQueryDatabase(options),
    getPost: (pageId) => liveGetPage(pageId),
    getPostSummary,
    renderPostArticle,
    renderBlocks,
    escapeHtml,
    getCategoryColor,
    getPageSize: () => CONFIG.pageSize,
  };
})();

window.NotionAPI = NotionAPI;
