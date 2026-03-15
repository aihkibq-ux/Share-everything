/**
 * notion-api.js — Notion API 集成层
 * 提供 Mock 数据回退，无需 API Key 即可预览完整功能
 */

const NotionAPI = (() => {
  // ====== 配置 ======
const CONFIG = {
  // 改为你的 Cloudflare Worker URL 即可对接 Notion
  workerUrl: "https://restless-wood-e19f.aihkibq.workers.dev/v1",
  // 你的 Notion Database ID
  databaseId: "32485b780a2580eaa67ecf051676d693",
  pageSize: 9,
};

  // ====== Mock 数据 ======
  const MOCK_CATEGORIES = [
    { name: "全部", emoji: "📋", color: "cyan" },
    { name: "技术", emoji: "💻", color: "blue" },
    { name: "设计", emoji: "🎨", color: "pink" },
    { name: "随想", emoji: "💭", color: "purple" },
    { name: "教程", emoji: "📖", color: "green" },
    { name: "工具", emoji: "🔧", color: "orange" },
  ];

  // ====== 真实 API 实现（可选启用） ======
  async function liveQueryDatabase({ category, search, page }) {
    const body = {
      page_size: CONFIG.pageSize,
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
      },
    );

    if (!res.ok) throw new Error("Notion API error");
    const data = await res.json();

    return {
      results: data.results.map(mapNotionPage),
      total: data.results.length,
      totalPages: 1,
      currentPage: 1,
    };
  }

  async function liveGetPage(pageId) {
    const [pageRes, blocksRes] = await Promise.all([
      fetch(`${CONFIG.workerUrl}/pages/${pageId}`),
      fetch(`${CONFIG.workerUrl}/blocks/${pageId}/children?page_size=100`),
    ]);

    if (!pageRes.ok || !blocksRes.ok) throw new Error("Notion API error");

    const page = await pageRes.json();
    const blocks = await blocksRes.json();

    return {
      ...mapNotionPage(page),
      content: blocks.results.map(mapNotionBlock),
    };
  }

  function mapNotionPage(page) {
    const props = page.properties || {};
    return {
      id: page.id,
      title: props.Name?.title?.[0]?.plain_text || "Untitled",
      excerpt: props.Excerpt?.rich_text?.[0]?.plain_text || "",
      category: props.Category?.select?.name || "",
      date: props.Date?.date?.start || "",
      readTime: props.ReadTime?.rich_text?.[0]?.plain_text || "",
      coverEmoji: page.icon?.emoji || "📝",
      tags: props.Tags?.multi_select?.map((t) => t.name) || [],
    };
  }

  function mapNotionBlock(block) {
    const type = block.type;
    switch (type) {
      case "paragraph":
        return {
          type: "paragraph",
          text: richTextToPlain(block.paragraph.rich_text),
        };
      case "heading_1":
        return {
          type: "heading_1",
          text: richTextToPlain(block.heading_1.rich_text),
        };
      case "heading_2":
        return {
          type: "heading_2",
          text: richTextToPlain(block.heading_2.rich_text),
        };
      case "heading_3":
        return {
          type: "heading_3",
          text: richTextToPlain(block.heading_3.rich_text),
        };
      case "bulleted_list_item":
        return {
          type: "bulleted_list_item",
          text: richTextToPlain(block.bulleted_list_item.rich_text),
        };
      case "numbered_list_item":
        return {
          type: "numbered_list_item",
          text: richTextToPlain(block.numbered_list_item.rich_text),
        };
      case "code":
        return {
          type: "code",
          language: block.code.language || "",
          text: richTextToPlain(block.code.rich_text),
        };
      case "quote":
        return {
          type: "quote",
          text: richTextToPlain(block.quote.rich_text),
        };
      case "divider":
        return { type: "divider" };
      case "image":
        return {
          type: "image",
          url: block.image.file?.url || block.image.external?.url || "",
          caption: richTextToPlain(block.image.caption),
        };
      default:
        return { type: "unsupported", original: type };
    }
  }

  function richTextToPlain(richText) {
    return (richText || []).map((t) => t.plain_text).join("");
  }

  // ====== Block → HTML 渲染器 ======
  function renderBlocks(blocks) {
    let html = "";
    let listStack = []; // 追踪列表嵌套

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const nextBlock = blocks[i + 1];

      // 处理列表合并
      if (
        block.type === "bulleted_list_item" ||
        block.type === "bulleted_list"
      ) {
        const items = block.items || [block.text];
        if (listStack.length === 0 || listStack[listStack.length - 1] !== "ul") {
          html += "<ul>";
          listStack.push("ul");
        }
        items.forEach((item) => {
          html += `<li>${escapeHtml(item)}</li>`;
        });
        if (
          !nextBlock ||
          (nextBlock.type !== "bulleted_list_item" &&
            nextBlock.type !== "bulleted_list")
        ) {
          html += "</ul>";
          listStack.pop();
        }
        continue;
      }

      if (
        block.type === "numbered_list_item" ||
        block.type === "numbered_list"
      ) {
        const items = block.items || [block.text];
        if (listStack.length === 0 || listStack[listStack.length - 1] !== "ol") {
          html += "<ol>";
          listStack.push("ol");
        }
        items.forEach((item) => {
          html += `<li>${escapeHtml(item)}</li>`;
        });
        if (
          !nextBlock ||
          (nextBlock.type !== "numbered_list_item" &&
            nextBlock.type !== "numbered_list")
        ) {
          html += "</ol>";
          listStack.pop();
        }
        continue;
      }

      // 关闭所有未关闭的列表
      while (listStack.length > 0) {
        const tag = listStack.pop();
        html += `</${tag}>`;
      }

      switch (block.type) {
        case "heading_1":
          html += `<h1>${escapeHtml(block.text)}</h1>`;
          break;
        case "heading_2":
          html += `<h2>${escapeHtml(block.text)}</h2>`;
          break;
        case "heading_3":
          html += `<h3>${escapeHtml(block.text)}</h3>`;
          break;
        case "paragraph":
          html += `<p>${escapeHtml(block.text)}</p>`;
          break;
        case "code":
          html += `<pre><code class="language-${block.language || ""}">${escapeHtml(block.text)}</code></pre>`;
          break;
        case "quote":
          html += `<blockquote>${escapeHtml(block.text)}</blockquote>`;
          break;
        case "divider":
          html += "<hr>";
          break;
        case "image":
          html += `<img src="${block.url}" alt="${escapeHtml(block.caption || "")}" loading="lazy">`;
          break;
        default:
          break;
      }
    }

    // 清理残留列表标签
    while (listStack.length > 0) {
      const tag = listStack.pop();
      html += `</${tag}>`;
    }

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
    getCategories() {
      return MOCK_CATEGORIES;
    },
    async queryPosts(options = {}) {
      return await liveQueryDatabase(options);
    },
    async getPost(pageId) {
      return await liveGetPage(pageId);
    },
    renderBlocks,
  };
})();