/**
 * notion-api.js — Notion API 集成层
 */

const NotionAPI = (() => {
  // ====== 配置 ======
  const CONFIG = {
    workerUrl: "https://restless-wood-e19f.aihkibq.workers.dev/v1",
    databaseId: "32485b780a2580eaa67ecf051676d693",
    pageSize: 9,
  };

  // ====== 分类固定列表（Notion 不提供动态获取接口） ======
  const CATEGORIES = [
    { name: "全部", emoji: "📋", color: "cyan" },
    { name: "精选", emoji: "🌟", color: "pink" },
    { name: "技术", emoji: "💻", color: "blue" },
    { name: "随想", emoji: "💭", color: "purple" },
    { name: "教程", emoji: "📖", color: "green" },
    { name: "工具", emoji: "🔧", color: "orange" },
    { name: "收藏", emoji: "⭐", color: "orange" },
  ];

  // ====== Notion API 调用 ======
  async function fetchFromNotion(category, fetchAll = false) {
    const cacheKey = `notion_query_${category || "all"}_${fetchAll}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 1000 * 60 * 5) { // 5 分钟缓存
          return parsed.data;
        }
      }
    } catch (e) {}

    const body = {
      page_size: fetchAll ? 100 : CONFIG.pageSize,
      sorts: [{ property: "Date", direction: "descending" }],
    };

    if (category && category !== "全部") {
      body.filter = {
        property: "Category",
        select: { equals: category },
      };
    }

    const res = await fetch(
      `${CONFIG.workerUrl}/databases/${CONFIG.databaseId}/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      if (res.status === 400) return [];
      throw new Error(`Notion API error: ${res.status}`);
    }
    const data = await res.json();
    const mappedData = data.results.map(mapNotionPage);

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: mappedData
      }));
    } catch (e) {}

    return mappedData;
  }

  async function liveQueryDatabase({ category, search, page = 1 }) {
    // 有搜索词时拉取全量再内存过滤；否则只取一页
    const needAll = Boolean(search);
    let results = await fetchFromNotion(category, needAll);

    // 内存搜索过滤
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }

    // 分页切片
    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / CONFIG.pageSize));
    const currentPage = Math.min(page, totalPages);
    const start = (currentPage - 1) * CONFIG.pageSize;
    const paged = results.slice(start, start + CONFIG.pageSize);

    return { results: paged, total, totalPages, currentPage };
  }

  async function liveGetPage(pageId) {
    const cacheKey = `notion_page_${pageId}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 1000 * 60 * 10) { // 10 分钟缓存
          return parsed.data;
        }
      }
    } catch (e) {}

    const [pageRes, blocksRes] = await Promise.all([
      fetch(`${CONFIG.workerUrl}/pages/${pageId}`),
      fetch(`${CONFIG.workerUrl}/blocks/${pageId}/children?page_size=100`),
    ]);

    if (!pageRes.ok || !blocksRes.ok) throw new Error("Notion API error");

    const page = await pageRes.json();
    const blocks = await blocksRes.json();

    const mappedData = {
      ...mapNotionPage(page),
      content: blocks.results.map(mapNotionBlock),
    };

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: mappedData
      }));
    } catch (e) {}

    return mappedData;
  }

  // ====== 数据映射 ======
  function mapNotionPage(page) {
    const props = page.properties || {};
    const category = props.Category?.select?.name || "";
    const cover = page.cover;
    const coverImage =
      cover?.external?.url || cover?.file?.url || null;
    return {
      id: page.id,
      title: props.Name?.title?.[0]?.plain_text || "Untitled",
      excerpt: props.Excerpt?.rich_text?.[0]?.plain_text || "",
      category,
      date: props.Date?.date?.start || "",
      readTime: props.ReadTime?.rich_text?.[0]?.plain_text || "",
      coverImage,
      coverEmoji: page.icon?.emoji || "📝",
      coverGradient: gradientForCategory(category),
      tags: props.Tags?.multi_select?.map((t) => t.name) || [],
    };
  }

  function gradientForCategory(category) {
    const map = {
      技术: "linear-gradient(135deg, #0d1b4b, #1a3a6b)",
      精选: "linear-gradient(135deg, #3b0a45, #6d1a7e)",
      随想: "linear-gradient(135deg, #1a0a3b, #3d1a7e)",
      教程: "linear-gradient(135deg, #0a2e1a, #1a5c35)",
      工具: "linear-gradient(135deg, #2e1a00, #5c3800)",
      收藏: "linear-gradient(135deg, #2e2a00, #5c5200)",
    };
    return map[category] || "linear-gradient(135deg, #1a1a2e, #16213e)";
  }

  function mapNotionBlock(block) {
    const type = block.type;
    const handlers = {
      paragraph: () => ({ type, text: richTextToHtml(block.paragraph.rich_text) }),
      heading_1: () => ({ type, text: richTextToHtml(block.heading_1.rich_text) }),
      heading_2: () => ({ type, text: richTextToHtml(block.heading_2.rich_text) }),
      heading_3: () => ({ type, text: richTextToHtml(block.heading_3.rich_text) }),
      bulleted_list_item: () => ({ type, text: richTextToHtml(block.bulleted_list_item.rich_text) }),
      numbered_list_item: () => ({ type, text: richTextToHtml(block.numbered_list_item.rich_text) }),
      code: () => ({ type, language: block.code.language || "", text: richTextToPlain(block.code.rich_text) }),
      quote: () => ({ type, text: richTextToHtml(block.quote.rich_text) }),
      divider: () => ({ type: "divider" }),
      image: () => ({
        type: "image",
        url: block.image.file?.url || block.image.external?.url || "",
        caption: richTextToPlain(block.image.caption),
      }),
    };
    return handlers[type]?.() ?? { type: "unsupported" };
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
      if (t.href)            text = `<a href="${escapeHtml(t.href)}" target="_blank" rel="noopener">${text}</a>`;
      return text;
    }).join("");
  }

  // 纯文本（用在代码块、图片 alt 等不需要 HTML 的地方）
  function richTextToPlain(richText) {
    return (richText || []).map((t) => t.plain_text).join("");
  }

  // ====== Block → HTML 渲染器 ======
  function renderBlocks(blocks) {
    let html = "";
    let listStack = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const nextBlock = blocks[i + 1];
      const isBullet = block.type === "bulleted_list_item";
      const isNumber = block.type === "numbered_list_item";

      if (isBullet || isNumber) {
        const tag = isBullet ? "ul" : "ol";
        if (!listStack.length || listStack[listStack.length - 1] !== tag) {
          html += `<${tag}>`;
          listStack.push(tag);
        }
        html += `<li>${block.text}</li>`;
        const nextSameType = nextBlock?.type === block.type;
        if (!nextSameType) {
          html += `</${listStack.pop()}>`;
        }
        continue;
      }

      // 关闭残留列表
      while (listStack.length) html += `</${listStack.pop()}>`;

      switch (block.type) {
        case "heading_1":   html += `<h1>${block.text}</h1>`; break;
        case "heading_2":   html += `<h2>${block.text}</h2>`; break;
        case "heading_3":   html += `<h3>${block.text}</h3>`; break;
        case "paragraph":   html += block.text ? `<p>${block.text}</p>` : ""; break;
        case "code":        html += `<pre><code class="language-${block.language}">${escapeHtml(block.text)}</code></pre>`; break;
        case "quote":       html += `<blockquote>${block.text}</blockquote>`; break;
        case "divider":     html += "<hr>"; break;
        case "image":       html += `<img src="${block.url}" alt="${escapeHtml(block.caption)}" loading="lazy">`; break;
        default: break;
      }
    }

    while (listStack.length) html += `</${listStack.pop()}>`;
    return html;
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ====== 公开 API ======
  return {
    getCategories: () => CATEGORIES,
    queryPosts: (options = {}) => liveQueryDatabase(options),
    getPost: (pageId) => liveGetPage(pageId),
    renderBlocks,
  };
})();