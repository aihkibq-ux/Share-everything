/**
 * notion-api.js — Notion API 集成层
 */

const NotionAPI = (() => {
  // ====== 配置 ======
  const CONFIG = {
    workerUrl: "/api",
    databaseId: "32485b780a2580eaa67ecf051676d693",
    pageSize: 9,
  };
  const REQUEST_TIMEOUT = 12000;
  const POST_SUMMARY_CACHE_PREFIX = "notion_post_summary_";
  const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
  const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
  const NOTION_ANNOTATION_STYLES = {
    gray: "color: #9b9a97;",
    brown: "color: #937264;",
    orange: "color: #ffa344;",
    yellow: "color: #ffd43b;",
    green: "color: #4caf50;",
    blue: "color: #4dabf7;",
    purple: "color: #c77dff;",
    pink: "color: #ff7aa2;",
    red: "color: #ff6b6b;",
    gray_background: "background: rgba(155, 154, 151, 0.16); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    brown_background: "background: rgba(147, 114, 100, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    orange_background: "background: rgba(255, 163, 68, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    yellow_background: "background: rgba(255, 212, 59, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    green_background: "background: rgba(76, 175, 80, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    blue_background: "background: rgba(77, 171, 247, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    purple_background: "background: rgba(199, 125, 255, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    pink_background: "background: rgba(255, 122, 162, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
    red_background: "background: rgba(255, 107, 107, 0.18); color: var(--text-primary); border-radius: 0.2em; padding: 0 0.2em;",
  };

  // ====== 分类固定列表（Notion 不提供动态获取接口） ======
  const CATEGORIES = [
    { name: "全部", emoji: "📋", color: "cyan" },
    { name: "精选", emoji: "🌟", color: "pink" },
    { name: "技术", emoji: "💻", color: "blue" },
    { name: "随想", emoji: "💭", color: "purple" },
    { name: "教程", emoji: "📖", color: "green" },
    { name: "工具", emoji: "🔧", color: "orange" },
  ];

  // ====== 缓存工具 ======
  const CACHE_TTL = 1000 * 60 * 30; // 30 分钟硬过期
  const STALE_TTL = 1000 * 60 * 5;  // 5 分钟后视为 stale，后台刷新
  const pendingRequests = new Map();
  const postSummaryMemoryCache = new Map();
  const postSummaryTimestampCache = new Map();

  function getCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function setCache(key, data, timestamp = Date.now()) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ timestamp, data }));
    } catch (e) {}
  }

  function getPostSummaryCacheKey(pageId) {
    return `${POST_SUMMARY_CACHE_PREFIX}${pageId}`;
  }

  function normalizePostSummary(post) {
    if (!post?.id) return null;

    return {
      id: post.id,
      title: post.title || "Untitled",
      excerpt: post.excerpt || "",
      category: post.category || "",
      date: post.date || "",
      readTime: post.readTime || "",
      coverImage: post.coverImage || null,
      coverEmoji: post.coverEmoji || "📝",
      coverGradient: post.coverGradient || gradientForCategory(post.category || ""),
      tags: Array.isArray(post.tags) ? [...post.tags] : [],
      _searchText: post._searchText || "",
    };
  }

  function storePostSummary(post, timestamp = Date.now()) {
    const summary = normalizePostSummary(post);
    if (!summary) return null;

    postSummaryMemoryCache.set(summary.id, summary);
    postSummaryTimestampCache.set(summary.id, timestamp);
    setCache(getPostSummaryCacheKey(summary.id), summary, timestamp);
    return summary;
  }

  function primePostSummaries(posts, timestamp) {
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

    const cached = getCache(getPostSummaryCacheKey(pageId));
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

  function getPostSummary(pageId, maxAge = CACHE_TTL) {
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

  // ====== Notion API 调用 ======
  async function fetchFromNotion(category) {
    const cacheKey = `notion_query_${category || "all"}`;
    const cached = getCache(cacheKey);

    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL) {
        primePostSummaries(cached.data, cached.timestamp);
        // 缓存未硬过期
        if (age > STALE_TTL) {
          // stale: 先返回旧数据，后台静默刷新
          fetchFromNotionRemote(category, cacheKey).catch(() => {});
        }
        return cached.data;
      }
    }

    // 无缓存或已硬过期，必须等待网络
    return fetchFromNotionRemote(category, cacheKey);
  }

  async function requestJson(path, init = {}, { allow400AsEmpty = false } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(`${CONFIG.workerUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) {
        if (allow400AsEmpty && res.status === 400) {
          return { results: [], has_more: false, next_cursor: null };
        }
        throw new Error(`Notion API error: ${res.status}`);
      }
      return res.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Notion API request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchFromNotionRemote(category, cacheKey) {
    return withPendingRequest(cacheKey, async () => {
      const allPages = [];
      let startCursor = null;

      do {
        const body = {
          page_size: 100,
          sorts: [{ property: "Date", direction: "descending" }],
        };

        if (startCursor) body.start_cursor = startCursor;

        if (category && category !== "全部") {
          body.filter = {
            property: "Category",
            select: { equals: category },
          };
        }

        const data = await requestJson(
          `/databases/${CONFIG.databaseId}/query`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          { allow400AsEmpty: true },
        );

        allPages.push(...data.results);
        startCursor = data.has_more ? data.next_cursor : null;
      } while (startCursor);

      const mappedData = allPages.map(mapNotionPage);
      primePostSummaries(mappedData);
      setCache(cacheKey, mappedData);
      return mappedData;
    });
  }

  async function liveQueryDatabase({ category, search, page = 1 }) {
    let results = await fetchFromNotion(category);

    // 内存搜索过滤
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((p) => p._searchText.includes(q));
    }

    // 分页切片
    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / CONFIG.pageSize));
    const requestedPage = Number.isFinite(Number(page)) ? Number(page) : 1;
    const currentPage = Math.max(1, Math.min(requestedPage, totalPages));
    const start = (currentPage - 1) * CONFIG.pageSize;
    const paged = results.slice(start, start + CONFIG.pageSize);

    return { results: paged, total, totalPages, currentPage };
  }

  async function liveGetPage(pageId) {
    const cacheKey = `notion_page_${pageId}`;
    const cached = getCache(cacheKey);

    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL) {
        storePostSummary(cached.data, cached.timestamp);
        if (age > STALE_TTL) {
          // stale: 后台静默刷新
          fetchPageRemote(pageId, cacheKey).catch(() => {});
        }
        return cached.data;
      }
    }

    return fetchPageRemote(pageId, cacheKey);
  }

  async function fetchPageRemote(pageId, cacheKey) {
    return withPendingRequest(cacheKey, async () => {
      async function fetchAllBlockChildren(blockId) {
        const blocks = [];
        let startCursor = null;

        do {
          const qs = new URLSearchParams({ page_size: "100" });
          if (startCursor) qs.set("start_cursor", startCursor);
          const data = await requestJson(`/blocks/${blockId}/children?${qs.toString()}`);
          blocks.push(...data.results);
          startCursor = data.has_more ? data.next_cursor : null;
        } while (startCursor);

        await Promise.all(
          blocks.map(async (block) => {
            if (!block?.has_children) return;
            block.children = await fetchAllBlockChildren(block.id);
          }),
        );

        return blocks;
      }

      const summarySnapshot = getPostSummarySnapshot(pageId);
      const blocksPromise = fetchAllBlockChildren(pageId);

      let summary = summarySnapshot?.age < STALE_TTL ? summarySnapshot.summary : null;
      let blocksRes;

      if (summary) {
        blocksRes = await blocksPromise;
      } else {
        const [pageRes, fetchedBlocks] = await Promise.all([
          requestJson(`/pages/${pageId}`),
          blocksPromise,
        ]);
        summary = mapNotionPage(pageRes);
        blocksRes = fetchedBlocks;
      }

      const mappedData = {
        ...summary,
        content: blocksRes.map(mapNotionBlock),
      };

      storePostSummary(mappedData);
      setCache(cacheKey, mappedData);
      return mappedData;
    });
  }

  // ====== 数据映射 ======
  function mapNotionPage(page) {
    const props = page.properties || {};
    const category = props.Category?.select?.name || "";
    const cover = page.cover;
    const coverImage =
      cover?.external?.url || cover?.file?.url || null;
    const title = richTextToPlain(props.Name?.title) || "Untitled";
    const excerpt = richTextToPlain(props.Excerpt?.rich_text);
    const readTime = richTextToPlain(props.ReadTime?.rich_text);
    const tags = props.Tags?.multi_select?.map((t) => t.name) || [];
    return {
      id: page.id,
      title,
      excerpt,
      category,
      date: props.Date?.date?.start || "",
      readTime,
      coverImage,
      coverEmoji: page.icon?.emoji || "📝",
      coverGradient: gradientForCategory(category),
      tags,
      _searchText: [
        title,
        excerpt,
        ...tags,
      ].join(" ").toLowerCase(),
    };
  }

  function gradientForCategory(category) {
    const map = {
      技术: "linear-gradient(135deg, #0d1b4b, #1a3a6b)",
      精选: "linear-gradient(135deg, #3b0a45, #6d1a7e)",
      随想: "linear-gradient(135deg, #1a0a3b, #3d1a7e)",
      教程: "linear-gradient(135deg, #0a2e1a, #1a5c35)",
      工具: "linear-gradient(135deg, #2e1a00, #5c3800)",
    };
    return map[category] || "linear-gradient(135deg, #1a1a2e, #16213e)";
  }

  function mapNotionBlock(block) {
    const type = block.type;
    const children = Array.isArray(block.children)
      ? block.children.map(mapNotionBlock).filter(Boolean)
      : [];
    const withChildren = (payload) =>
      children.length > 0 ? { ...payload, children } : payload;
    const handlers = {
      paragraph: () => withChildren({ type, text: richTextToHtml(block.paragraph.rich_text) }),
      heading_1: () => withChildren({ type, text: richTextToHtml(block.heading_1.rich_text) }),
      heading_2: () => withChildren({ type, text: richTextToHtml(block.heading_2.rich_text) }),
      heading_3: () => withChildren({ type, text: richTextToHtml(block.heading_3.rich_text) }),
      bulleted_list_item: () => withChildren({ type, text: richTextToHtml(block.bulleted_list_item.rich_text) }),
      numbered_list_item: () => withChildren({ type, text: richTextToHtml(block.numbered_list_item.rich_text) }),
      code: () => ({ type, language: block.code.language || "", text: richTextToPlain(block.code.rich_text) }),
      quote: () => withChildren({ type, text: richTextToHtml(block.quote.rich_text) }),
      callout: () => withChildren({
        type,
        text: richTextToHtml(block.callout.rich_text),
        icon: block.callout.icon?.emoji || "",
      }),
      toggle: () => withChildren({ type, text: richTextToHtml(block.toggle.rich_text) }),
      to_do: () => withChildren({
        type,
        text: richTextToHtml(block.to_do.rich_text),
        checked: Boolean(block.to_do.checked),
      }),
      bookmark: () => ({ type, url: block.bookmark.url || "" }),
      child_page: () => ({ type, title: block.child_page?.title || "" }),
      synced_block: () => ({ type, children }),
      divider: () => ({ type: "divider" }),
      image: () => ({
        type: "image",
        url: block.image.file?.url || block.image.external?.url || "",
        caption: richTextToPlain(block.image.caption),
      }),
    };
    return handlers[type]?.() ?? (children.length > 0 ? { type: "container", children } : null);
  }

  // ====== 富文本处理 ======

  // 保留链接、加粗、斜体（用在正文段落）
  function richTextToHtml(richText) {
    if (!richText?.length) return "";
    return richText.map((t) => {
      let text = escapeHtml(t.plain_text);
      const ann = t.annotations || {};
      if (ann.code)          text = `<code>${text}</code>`;
      if (ann.bold)          text = `<strong>${text}</strong>`;
      if (ann.italic)        text = `<em>${text}</em>`;
      if (ann.strikethrough) text = `<del>${text}</del>`;
      if (ann.underline)     text = `<u>${text}</u>`;
      if (ann.color && NOTION_ANNOTATION_STYLES[ann.color]) {
        text = `<span style="${NOTION_ANNOTATION_STYLES[ann.color]}">${text}</span>`;
      }
      const safeHref = sanitizeUrl(t.href, SAFE_LINK_PROTOCOLS);
      if (safeHref)          text = `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${text}</a>`;
      return text;
    }).join("");
  }

  // 纯文本（用在代码块、图片 alt 等不需要 HTML 的地方）
  function richTextToPlain(richText) {
    return (richText || []).map((t) => t.plain_text).join("");
  }

  // ====== Block → HTML 渲染器 ======
  function renderBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return "";

    let html = "";
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) continue;

      if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
        const tag = block.type === "bulleted_list_item" ? "ul" : "ol";
        const items = [];

        while (i < blocks.length && blocks[i]?.type === block.type) {
          items.push(blocks[i]);
          i += 1;
        }

        i -= 1;
        html += `<${tag}>${items.map(renderListItem).join("")}</${tag}>`;
        continue;
      }

      html += renderBlock(block);
    }

    return html;
  }

  function renderListItem(block) {
    return `<li>${block.text || ""}${renderBlocks(block.children || [])}</li>`;
  }

  function renderBlock(block) {
    const childrenHtml = renderBlocks(block.children || []);

    switch (block.type) {
      case "container":
      case "synced_block":
        return childrenHtml;
      case "heading_1":
        return `<h1>${block.text || ""}</h1>${childrenHtml}`;
      case "heading_2":
        return `<h2>${block.text || ""}</h2>${childrenHtml}`;
      case "heading_3":
        return `<h3>${block.text || ""}</h3>${childrenHtml}`;
      case "paragraph":
        return block.text ? `<p>${block.text}</p>${childrenHtml}` : childrenHtml;
      case "code":
        return `<pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.text)}</code></pre>${childrenHtml}`;
      case "quote":
        return `<blockquote>${block.text || ""}${childrenHtml}</blockquote>`;
      case "divider":
        return `<hr>${childrenHtml}`;
      case "image": {
        const safeImageUrl = sanitizeUrl(block.url, SAFE_IMAGE_PROTOCOLS);
        if (!safeImageUrl) return childrenHtml;
        return `<img src="${escapeHtml(safeImageUrl)}" alt="${escapeHtml(block.caption)}" loading="lazy" decoding="async">${childrenHtml}`;
      }
      case "callout": {
        const iconHtml = block.icon
          ? `<div class="post-callout-icon" aria-hidden="true">${escapeHtml(block.icon)}</div>`
          : "";
        return `<div class="post-callout">${iconHtml}<div class="post-callout-body">${block.text || ""}${childrenHtml}</div></div>`;
      }
      case "toggle":
        return `<details class="post-toggle"><summary>${block.text || ""}</summary>${childrenHtml}</details>`;
      case "to_do":
        return `<div class="post-todo${block.checked ? " checked" : ""}"><span class="post-todo-box" aria-hidden="true">${block.checked ? "&#10003;" : ""}</span><div class="post-todo-content"><div class="post-todo-text">${block.text || ""}</div>${childrenHtml}</div></div>`;
      case "bookmark": {
        const safeUrl = sanitizeUrl(block.url, SAFE_LINK_PROTOCOLS);
        if (!safeUrl) return childrenHtml;
        return `<p><a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(safeUrl)}</a></p>${childrenHtml}`;
      }
      case "child_page":
        return `<p class="post-child-page">${escapeHtml(block.title || "")}</p>${childrenHtml}`;
      default:
        return childrenHtml;
    }
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeUrl(candidate, allowedProtocols) {
    if (!candidate || typeof candidate !== "string") return null;

    try {
      const parsed = new URL(candidate, window.location.origin);
      return allowedProtocols.has(parsed.protocol) ? parsed.href : null;
    } catch (error) {
      return null;
    }
  }

  // ====== 分类颜色映射 ======
  const CATEGORY_COLORS = {
    "技术": { bg: "rgba(41, 121, 255, 0.1)", color: "#2979ff", border: "rgba(41, 121, 255, 0.2)" },
    "精选": { bg: "rgba(255, 64, 129, 0.1)", color: "#ff4081", border: "rgba(255, 64, 129, 0.2)" },
    "随想": { bg: "rgba(213, 0, 249, 0.1)", color: "#d500f9", border: "rgba(213, 0, 249, 0.2)" },
    "教程": { bg: "rgba(0, 230, 118, 0.1)", color: "#00e676", border: "rgba(0, 230, 118, 0.2)" },
    "工具": { bg: "rgba(255, 171, 0, 0.1)", color: "#ffab00", border: "rgba(255, 171, 0, 0.2)" },
  };
  const DEFAULT_CATEGORY_COLOR = { bg: "rgba(0, 229, 255, 0.1)", color: "#00e5ff", border: "rgba(0, 229, 255, 0.2)" };

  function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR;
  }

  // ====== 公开 API ======
  return {
    getCategories: () => CATEGORIES,
    queryPosts: (options = {}) => liveQueryDatabase(options),
    getPost: (pageId) => liveGetPage(pageId),
    getPostSummary,
    renderBlocks,
    escapeHtml,
    getCategoryColor,
    getPageSize: () => CONFIG.pageSize,
  };
})();

window.NotionAPI = NotionAPI;
