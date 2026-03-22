const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DEFAULT_DATABASE_ID = "32485b780a2580eaa67ecf051676d693";
const DEFAULT_SITE_ORIGIN = process.env.SITE_URL || "https://www.0000068.xyz";
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
  gray_background: "background: rgba(155, 154, 151, 0.16); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  brown_background: "background: rgba(147, 114, 100, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  orange_background: "background: rgba(255, 163, 68, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  yellow_background: "background: rgba(255, 212, 59, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  green_background: "background: rgba(76, 175, 80, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  blue_background: "background: rgba(77, 171, 247, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  purple_background: "background: rgba(199, 125, 255, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  pink_background: "background: rgba(255, 122, 162, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
  red_background: "background: rgba(255, 107, 107, 0.18); color: #f5f7fb; border-radius: 0.2em; padding: 0 0.2em;",
};
const CATEGORY_COLORS = {
  技术: { bg: "rgba(41, 121, 255, 0.1)", color: "#2979ff", border: "rgba(41, 121, 255, 0.2)" },
  精选: { bg: "rgba(255, 64, 129, 0.1)", color: "#ff4081", border: "rgba(255, 64, 129, 0.2)" },
  随想: { bg: "rgba(213, 0, 249, 0.1)", color: "#d500f9", border: "rgba(213, 0, 249, 0.2)" },
  教程: { bg: "rgba(0, 230, 118, 0.1)", color: "#00e676", border: "rgba(0, 230, 118, 0.2)" },
  工具: { bg: "rgba(255, 171, 0, 0.1)", color: "#ffab00", border: "rgba(255, 171, 0, 0.2)" },
};
const DEFAULT_CATEGORY_COLOR = { bg: "rgba(0, 229, 255, 0.1)", color: "#00e5ff", border: "rgba(0, 229, 255, 0.2)" };

function getNotionToken() {
  return process.env.NOTION_TOKEN;
}

function getDatabaseId() {
  return process.env.NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;
}

function getSiteOrigin() {
  return DEFAULT_SITE_ORIGIN.replace(/\/+$/, "");
}

function createNotionRequestError(message, { status = 500, code = "notion_request_error", notionCode = "", detail = "", cause } = {}) {
  const error = new Error(message);
  error.name = "NotionRequestError";
  error.status = status;
  error.code = code;
  error.notionCode = notionCode;
  error.detail = detail;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function requestNotionJson(path, init = {}) {
  const notionToken = getNotionToken();
  if (!notionToken) {
    throw createNotionRequestError("NOTION_TOKEN is not configured", {
      status: 500,
      code: "notion_config_error",
    });
  }

  let response;
  try {
    response = await fetch(`${NOTION_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw createNotionRequestError("Failed to reach Notion API", {
      status: 502,
      code: "notion_network_error",
      cause: error,
    });
  }

  if (!response.ok) {
    const rawDetail = await response.text().catch(() => "");
    let detail = rawDetail;
    let notionCode = "";

    if (rawDetail) {
      try {
        const parsedDetail = JSON.parse(rawDetail);
        if (typeof parsedDetail?.message === "string" && parsedDetail.message) {
          detail = parsedDetail.message;
        }
        if (typeof parsedDetail?.code === "string" && parsedDetail.code) {
          notionCode = parsedDetail.code;
        }
      } catch {
        // Keep the raw response body when it is not JSON.
      }
    }

    throw createNotionRequestError(`Notion API error: ${response.status}${detail ? ` ${detail}` : ""}`, {
      status: response.status,
      code: "notion_api_error",
      notionCode,
      detail: detail || rawDetail,
    });
  }

  return response.json();
}

async function queryAllPages() {
  const databaseId = getDatabaseId();
  const pages = [];
  let startCursor = null;

  do {
    const body = {
      page_size: 100,
      sorts: [{ property: "Date", direction: "descending" }],
    };
    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const data = await requestNotionJson(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    pages.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);

  return pages.map(mapNotionPage);
}

async function fetchAllBlockChildren(blockId) {
  const blocks = [];
  let startCursor = null;

  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (startCursor) {
      query.set("start_cursor", startCursor);
    }

    const data = await requestNotionJson(`/blocks/${blockId}/children?${query.toString()}`);
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

async function fetchPost(pageId) {
  const [page, blocks] = await Promise.all([
    requestNotionJson(`/pages/${pageId}`),
    fetchAllBlockChildren(pageId),
  ]);

  const summary = mapNotionPage(page);
  return {
    ...summary,
    content: blocks.map(mapNotionBlock),
    renderedContent: renderBlocks(blocks.map(mapNotionBlock)),
  };
}

function mapNotionPage(page) {
  const props = page.properties || {};
  const category = props.Category?.select?.name || "";
  const cover = page.cover;
  const coverImage = cover?.external?.url || cover?.file?.url || null;
  const title = richTextToPlain(props.Name?.title) || "Untitled";
  const excerpt = richTextToPlain(props.Excerpt?.rich_text);
  const readTime = richTextToPlain(props.ReadTime?.rich_text);
  const tags = props.Tags?.multi_select?.map((tag) => tag.name) || [];

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
  };
}

function gradientForCategory(category) {
  const gradients = {
    技术: "linear-gradient(135deg, #0d1b4b, #1a3a6b)",
    精选: "linear-gradient(135deg, #3b0a45, #6d1a7e)",
    随想: "linear-gradient(135deg, #1a0a3b, #3d1a7e)",
    教程: "linear-gradient(135deg, #0a2e1a, #1a5c35)",
    工具: "linear-gradient(135deg, #2e1a00, #5c3800)",
  };
  return gradients[category] || "linear-gradient(135deg, #1a1a2e, #16213e)";
}

function mapNotionBlock(block) {
  const type = block.type;
  const children = Array.isArray(block.children)
    ? block.children.map(mapNotionBlock).filter(Boolean)
    : [];
  const withChildren = (payload) => (children.length > 0 ? { ...payload, children } : payload);

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

function richTextToPlain(richText) {
  return (richText || []).map((item) => item.plain_text).join("");
}

function richTextToHtml(richText) {
  if (!richText?.length) return "";

  return richText.map((item) => {
    let text = escapeHtml(item.plain_text);
    const annotations = item.annotations || {};

    if (annotations.code) text = `<code>${text}</code>`;
    if (annotations.bold) text = `<strong>${text}</strong>`;
    if (annotations.italic) text = `<em>${text}</em>`;
    if (annotations.strikethrough) text = `<del>${text}</del>`;
    if (annotations.underline) text = `<u>${text}</u>`;
    if (annotations.color && NOTION_ANNOTATION_STYLES[annotations.color]) {
      text = `<span style="${NOTION_ANNOTATION_STYLES[annotations.color]}">${text}</span>`;
    }

    const safeHref = sanitizeUrl(item.href, SAFE_LINK_PROTOCOLS);
    if (safeHref) {
      text = `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${text}</a>`;
    }

    return text;
  }).join("");
}

function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  let html = "";
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;

    if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const tag = block.type === "bulleted_list_item" ? "ul" : "ol";
      const items = [];

      while (index < blocks.length && blocks[index]?.type === block.type) {
        items.push(blocks[index]);
        index += 1;
      }

      index -= 1;
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

function escapeHtml(value) {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(candidate, allowedProtocols) {
  if (!candidate || typeof candidate !== "string") return null;

  try {
    const parsed = new URL(candidate, getSiteOrigin());
    return allowedProtocols.has(parsed.protocol) ? parsed.href : null;
  } catch (error) {
    return null;
  }
}

function isLikelyEphemeralAssetUrl(candidate) {
  if (!candidate || typeof candidate !== "string") return false;

  try {
    const parsed = new URL(candidate, getSiteOrigin());
    return [
      "X-Amz-Algorithm",
      "X-Amz-Credential",
      "X-Amz-Date",
      "X-Amz-Expires",
      "X-Amz-Signature",
      "Expires",
      "Signature",
    ].some((key) => parsed.searchParams.has(key));
  } catch (error) {
    return false;
  }
}

function resolveShareImageUrl(candidate, fallback) {
  const safeImageUrl = sanitizeUrl(candidate, SAFE_IMAGE_PROTOCOLS);
  if (!safeImageUrl || isLikelyEphemeralAssetUrl(safeImageUrl)) {
    return fallback;
  }
  return safeImageUrl;
}

function buildPostUrl(pageId) {
  return `${getSiteOrigin()}/posts/${encodeURIComponent(pageId)}`;
}

function buildArticleStructuredData(post) {
  const canonicalUrl = buildPostUrl(post.id);
  const defaultShareImageUrl = `${getSiteOrigin()}/favicon.png?v=2`;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || post.title,
    articleSection: post.category || undefined,
    keywords: Array.isArray(post.tags) && post.tags.length > 0 ? post.tags.join(", ") : undefined,
    datePublished: post.date || undefined,
    dateModified: post.date || undefined,
    image: [resolveShareImageUrl(post.coverImage, defaultShareImageUrl)],
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
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
  };
}

module.exports = {
  buildArticleStructuredData,
  buildPostUrl,
  escapeHtml,
  fetchPost,
  getCategoryColor: (category) => CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR,
  getSiteOrigin,
  mapNotionPage,
  queryAllPages,
  renderBlocks,
  resolveShareImageUrl,
};
