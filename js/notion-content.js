(function (root, factory) {
  const exported = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  } else if (root) {
    root.NotionContent = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
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
  const ALL_CATEGORY = "全部";
  const BOOKMARK_CATEGORY = "收藏";
  const DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES = Object.freeze({
    title: Object.freeze(["Name", "Title", "标题"]),
    excerpt: Object.freeze(["Excerpt", "Summary", "Description", "摘要"]),
    readTime: Object.freeze(["ReadTime", "Read Time", "Reading Time", "阅读时间", "阅读时长"]),
    tags: Object.freeze(["Tags", "Tag", "标签"]),
    category: Object.freeze(["Category", "分类"]),
    date: Object.freeze(["Date", "Published At", "Publish Date", "发布日期", "发布时间"]),
  });
  const NOTION_CONTENT_PROPERTY_TYPES = Object.freeze({
    title: Object.freeze(["title"]),
    excerpt: Object.freeze(["rich_text"]),
    readTime: Object.freeze(["rich_text"]),
    tags: Object.freeze(["multi_select"]),
    category: Object.freeze(["select"]),
    date: Object.freeze(["date"]),
  });
  const CATEGORY_DEFINITIONS = Object.freeze([
    Object.freeze({
      name: "精选",
      emoji: "🌟",
      color: "pink",
      cardColor: Object.freeze({
        bg: "rgba(255, 64, 129, 0.1)",
        color: "#ff4081",
        border: "rgba(255, 64, 129, 0.2)",
      }),
      gradient: "linear-gradient(135deg, #3b0a45, #6d1a7e)",
    }),
    Object.freeze({
      name: "技术",
      emoji: "💻",
      color: "blue",
      cardColor: Object.freeze({
        bg: "rgba(41, 121, 255, 0.1)",
        color: "#2979ff",
        border: "rgba(41, 121, 255, 0.2)",
      }),
      gradient: "linear-gradient(135deg, #0d1b4b, #1a3a6b)",
    }),
    Object.freeze({
      name: "随想",
      emoji: "💭",
      color: "purple",
      cardColor: Object.freeze({
        bg: "rgba(213, 0, 249, 0.1)",
        color: "#d500f9",
        border: "rgba(213, 0, 249, 0.2)",
      }),
      gradient: "linear-gradient(135deg, #1a0a3b, #3d1a7e)",
    }),
    Object.freeze({
      name: "教程",
      emoji: "📖",
      color: "green",
      cardColor: Object.freeze({
        bg: "rgba(0, 230, 118, 0.1)",
        color: "#00e676",
        border: "rgba(0, 230, 118, 0.2)",
      }),
      gradient: "linear-gradient(135deg, #0a2e1a, #1a5c35)",
    }),
    Object.freeze({
      name: "工具",
      emoji: "🔧",
      color: "orange",
      cardColor: Object.freeze({
        bg: "rgba(255, 171, 0, 0.1)",
        color: "#ffab00",
        border: "rgba(255, 171, 0, 0.2)",
      }),
      gradient: "linear-gradient(135deg, #2e1a00, #5c3800)",
    }),
  ]);
  const REMOTE_BLOG_CATEGORIES = Object.freeze([
    Object.freeze({ name: ALL_CATEGORY, emoji: "📋", color: "cyan" }),
    ...CATEGORY_DEFINITIONS.map(({ name, emoji, color }) => Object.freeze({ name, emoji, color })),
  ]);
  const BOOKMARK_ONLY_CATEGORIES = Object.freeze([
    Object.freeze({ name: BOOKMARK_CATEGORY, emoji: "📚" }),
  ]);
  const SUPPORTED_BLOG_CATEGORIES = Object.freeze([
    ...REMOTE_BLOG_CATEGORIES.map((category) => category.name),
    BOOKMARK_CATEGORY,
  ]);
  const CATEGORY_COLORS = Object.freeze(
    CATEGORY_DEFINITIONS.reduce((colors, definition) => {
      colors[definition.name] = definition.cardColor;
      return colors;
    }, {}),
  );
  const CATEGORY_GRADIENTS = Object.freeze(
    CATEGORY_DEFINITIONS.reduce((gradients, definition) => {
      gradients[definition.name] = definition.gradient;
      return gradients;
    }, {}),
  );
  const DEFAULT_CATEGORY_COLOR = { bg: "rgba(0, 229, 255, 0.1)", color: "#00e5ff", border: "rgba(0, 229, 255, 0.2)" };

  /**
   * Validates a CSS color value against a strict whitelist of safe formats.
   * Prevents style attribute escaping that could lead to HTML injection.
   */
  function sanitizeCssColorValue(value, fallback) {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    if (/^(rgba?|hsla?)\([0-9,.\s%]+\)$/i.test(trimmed)) return trimmed;
    return fallback;
  }

  function getBaseOrigin(baseOrigin) {
    if (typeof baseOrigin === "string" && baseOrigin.trim()) {
      return baseOrigin.trim().replace(/\/+$/, "");
    }

    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }

    return "http://localhost";
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

  function normalizeName(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function normalizeCandidates(value, fallback = []) {
    if (Array.isArray(value)) {
      return value.map((candidate) => String(candidate).trim()).filter(Boolean);
    }

    return normalizeCandidates(fallback, []);
  }

  function findPropertyEntry(properties, candidates, allowedTypes) {
    const entries = Object.values(properties || {});
    const normalizedCandidates = normalizeCandidates(candidates);
    const allowedTypeSet = new Set(normalizeCandidates(allowedTypes));

    for (const candidate of normalizedCandidates) {
      const normalizedCandidate = normalizeName(candidate);
      const match = entries.find((entry) => {
        if (allowedTypeSet.size > 0 && !allowedTypeSet.has(normalizeName(entry?.type))) {
          return false;
        }

        return normalizedCandidate === normalizeName(entry?.name) || normalizedCandidate === normalizeName(entry?.id);
      });

      if (match) {
        return {
          id: match.id || "",
          name: match.name || "",
          type: match.type || "",
        };
      }
    }

    return null;
  }

  function resolveNotionContentSchema(database, candidateOverrides = {}) {
    const properties = database?.properties || {};
    const schema = {};

    Object.entries(DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES).forEach(([field, defaults]) => {
      schema[field] = findPropertyEntry(
        properties,
        normalizeCandidates(candidateOverrides[field], defaults),
        NOTION_CONTENT_PROPERTY_TYPES[field] || [],
      );
    });

    return schema;
  }

  function getPageProperty(page, schemaEntry, fallbackCandidates = []) {
    const properties = page?.properties || {};
    if (schemaEntry?.name && properties[schemaEntry.name]) {
      return properties[schemaEntry.name];
    }

    if (schemaEntry?.id) {
      const byId = Object.values(properties).find((entry) => normalizeName(entry?.id) === normalizeName(schemaEntry.id));
      if (byId) {
        return byId;
      }
    }

    const fallbackEntry = findPropertyEntry(properties, fallbackCandidates, []);
    return fallbackEntry?.name ? properties[fallbackEntry.name] || null : null;
  }

  function getRemoteBlogCategories() {
    return REMOTE_BLOG_CATEGORIES.slice();
  }

  function getBookmarkOnlyCategories() {
    return BOOKMARK_ONLY_CATEGORIES.slice();
  }

  function getSupportedBlogCategories() {
    return SUPPORTED_BLOG_CATEGORIES.slice();
  }

  function sanitizeUrl(candidate, allowedProtocols, baseOrigin) {
    if (!candidate || typeof candidate !== "string") return null;

    try {
      const parsed = new URL(candidate, getBaseOrigin(baseOrigin));
      return allowedProtocols.has(parsed.protocol) ? parsed.href : null;
    } catch (error) {
      return null;
    }
  }

  function resolveDisplayImageUrl(candidate, baseOrigin) {
    return sanitizeUrl(candidate, SAFE_IMAGE_PROTOCOLS, baseOrigin);
  }

  function getBlockResourceUrl(blockData) {
    return blockData?.external?.url || blockData?.file?.url || blockData?.url || "";
  }

  function getBlockCaption(blockData) {
    return richTextToPlain(blockData?.caption);
  }

  function getBlockCaptionHtml(blockData, options = {}) {
    return richTextToHtml(blockData?.caption, options);
  }

  function formatBlockTypeLabel(type) {
    return String(type || "unsupported").replace(/_/g, " ");
  }

  function slugifyText(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, " ")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function buildHeadingAnchorId(blockId, fallbackText) {
    const source = typeof blockId === "string" && blockId.trim()
      ? blockId.trim()
      : slugifyText(fallbackText) || "section";

    return `heading-${source.replace(/[^a-z0-9\u4e00-\u9fff-]+/gi, "-").replace(/^-+|-+$/g, "")}`;
  }

  function buildHeadingBlock(type, blockId, richText, options = {}) {
    const plainText = richTextToPlain(richText);

    return {
      type,
      text: richTextToHtml(richText, options),
      plainText,
      anchorId: buildHeadingAnchorId(blockId, plainText),
    };
  }

  function buildResourceBlock(resourceType, blockData, options = {}) {
    return {
      type: "resource",
      resourceType,
      url: getBlockResourceUrl(blockData),
      caption: getBlockCaption(blockData),
      captionHtml: getBlockCaptionHtml(blockData, options),
      name: typeof blockData?.name === "string" ? blockData.name : "",
    };
  }

  function buildUnsupportedBlock(block, options = {}, children = []) {
    const type = typeof block?.type === "string" && block.type ? block.type : "unsupported";
    const blockData = block?.[type];
    const richText = blockData?.rich_text || blockData?.caption || [];

    return {
      type: "unsupported",
      blockType: type,
      text: richTextToHtml(richText, options),
      url: getBlockResourceUrl(blockData),
      children,
    };
  }

  function richTextToPlain(richText) {
    return (richText || []).map((item) => item.plain_text).join("");
  }

  function richTextToHtml(richText, { baseOrigin } = {}) {
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

      const safeHref = sanitizeUrl(item.href, SAFE_LINK_PROTOCOLS, baseOrigin);
      if (safeHref) {
        text = `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${text}</a>`;
      }

      return text;
    }).join("");
  }

  function gradientForCategory(category) {
    return CATEGORY_GRADIENTS[category] || "linear-gradient(135deg, #1a1a2e, #16213e)";
  }

  function mapNotionPage(page, { includeSearchText = false, schema = null } = {}) {
    const titleProperty = getPageProperty(page, schema?.title, DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES.title);
    const excerptProperty = getPageProperty(page, schema?.excerpt, DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES.excerpt);
    const readTimeProperty = getPageProperty(page, schema?.readTime, DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES.readTime);
    const tagsProperty = getPageProperty(page, schema?.tags, DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES.tags);
    const categoryProperty = getPageProperty(page, schema?.category, DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES.category);
    const dateProperty = getPageProperty(page, schema?.date, DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES.date);
    const cover = page?.cover;
    const coverImage = cover?.external?.url || cover?.file?.url || null;
    const category = categoryProperty?.select?.name || "";
    const title = richTextToPlain(titleProperty?.title) || "Untitled";
    const excerpt = richTextToPlain(excerptProperty?.rich_text);
    const readTime = richTextToPlain(readTimeProperty?.rich_text);
    const tags = tagsProperty?.multi_select?.map((tag) => tag.name) || [];
    const mappedPage = {
      id: page.id,
      title,
      excerpt,
      category,
      date: dateProperty?.date?.start || "",
      readTime,
      coverImage,
      coverEmoji: page?.icon?.emoji || "📝",
      coverGradient: gradientForCategory(category),
      tags,
    };

    if (includeSearchText) {
      mappedPage._searchText = [title, excerpt, ...tags].join(" ").toLowerCase();
    }

    return mappedPage;
  }

  function mapNotionBlock(block, options = {}) {
    const type = block.type;
    const children = Array.isArray(block.children)
      ? block.children.map((child) => mapNotionBlock(child, options)).filter(Boolean)
      : [];
    const withChildren = (payload) => (children.length > 0 ? { ...payload, children } : payload);

    const handlers = {
      paragraph: () => withChildren({ type, text: richTextToHtml(block.paragraph.rich_text, options) }),
      heading_1: () => withChildren(buildHeadingBlock(type, block.id, block.heading_1.rich_text, options)),
      heading_2: () => withChildren(buildHeadingBlock(type, block.id, block.heading_2.rich_text, options)),
      heading_3: () => withChildren(buildHeadingBlock(type, block.id, block.heading_3.rich_text, options)),
      bulleted_list_item: () => withChildren({ type, text: richTextToHtml(block.bulleted_list_item.rich_text, options) }),
      numbered_list_item: () => withChildren({ type, text: richTextToHtml(block.numbered_list_item.rich_text, options) }),
      code: () => ({ type, language: block.code.language || "", text: richTextToPlain(block.code.rich_text) }),
      quote: () => withChildren({ type, text: richTextToHtml(block.quote.rich_text, options) }),
      callout: () => withChildren({
        type,
        text: richTextToHtml(block.callout.rich_text, options),
        icon: block.callout.icon?.emoji || "",
      }),
      toggle: () => withChildren({ type, text: richTextToHtml(block.toggle.rich_text, options) }),
      to_do: () => withChildren({
        type,
        text: richTextToHtml(block.to_do.rich_text, options),
        checked: Boolean(block.to_do.checked),
      }),
      equation: () => ({
        type,
        expression: block.equation?.expression || "",
      }),
      bookmark: () => ({ type, url: block.bookmark.url || "" }),
      link_preview: () => buildResourceBlock(type, block.link_preview, options),
      child_page: () => ({ type, title: block.child_page?.title || "" }),
      child_database: () => ({ type, title: block.child_database?.title || "" }),
      synced_block: () => ({ type, children }),
      table_of_contents: () => ({ type }),
      column_list: () => ({ type: "container", children }),
      column: () => ({ type: "container", children }),
      divider: () => ({ type: "divider" }),
      image: () => ({
        type: "image",
        url: block.image.file?.url || block.image.external?.url || "",
        caption: richTextToPlain(block.image.caption),
        captionHtml: richTextToHtml(block.image.caption, options),
      }),
      embed: () => buildResourceBlock(type, block.embed, options),
      video: () => buildResourceBlock(type, block.video, options),
      file: () => buildResourceBlock(type, block.file, options),
      pdf: () => buildResourceBlock(type, block.pdf, options),
      audio: () => buildResourceBlock(type, block.audio, options),
      table: () => ({
        type,
        hasColumnHeader: Boolean(block.table?.has_column_header),
        hasRowHeader: Boolean(block.table?.has_row_header),
        children,
      }),
      table_row: () => ({
        type,
        cells: Array.isArray(block.table_row?.cells)
          ? block.table_row.cells.map((cell) => richTextToHtml(cell, options))
          : [],
      }),
    };

    if (handlers[type]) {
      return handlers[type]();
    }

    return buildUnsupportedBlock(block, options, children);
  }

  function renderBlocks(blocks, options = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) return "";

    const resolvedOptions = Array.isArray(options.tocHeadings)
      ? options
      : { ...options, tocHeadings: collectTableOfContentsHeadings(blocks) };
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
        html += `<${tag}>${items.map((item) => renderListItem(item, resolvedOptions)).join("")}</${tag}>`;
        continue;
      }

      html += renderBlock(block, resolvedOptions);
    }

    return html;
  }

  function renderListItem(block, options = {}) {
    return `<li>${block.text || ""}${renderBlocks(block.children || [], options)}</li>`;
  }

  function getResourceTypeLabel(resourceType) {
    const labels = {
      audio: "Audio",
      embed: "Embed",
      file: "File",
      link_preview: "Link",
      pdf: "PDF",
      video: "Video",
    };

    return labels[resourceType] || formatBlockTypeLabel(resourceType);
  }

  function getUrlHostname(candidate, baseOrigin) {
    if (!candidate || typeof candidate !== "string") return "";

    try {
      return new URL(candidate, getBaseOrigin(baseOrigin)).hostname.replace(/^www\./i, "");
    } catch (error) {
      return "";
    }
  }

  function resolveEmbeddableUrl(candidate, baseOrigin) {
    const safeUrl = sanitizeUrl(candidate, SAFE_IMAGE_PROTOCOLS, baseOrigin);
    if (!safeUrl) {
      return null;
    }

    try {
      const parsed = new URL(safeUrl, getBaseOrigin(baseOrigin));
      const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const pathname = parsed.pathname || "/";

      if (hostname === "youtu.be") {
        const videoId = pathname.split("/").filter(Boolean)[0];
        return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : safeUrl;
      }

      if (hostname === "youtube.com") {
        if (pathname === "/watch") {
          const videoId = parsed.searchParams.get("v");
          return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : safeUrl;
        }

        const shortMatch = pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
        if (shortMatch?.[1]) {
          return `https://www.youtube.com/embed/${encodeURIComponent(shortMatch[1])}`;
        }
      }

      if (hostname === "player.bilibili.com" && pathname.startsWith("/player.html")) {
        return parsed.href;
      }

      if (hostname === "bilibili.com") {
        const bilibiliMatch = pathname.match(/^\/video\/((?:BV[0-9A-Za-z]+)|(?:av\d+))/i);
        if (bilibiliMatch?.[1]) {
          const page = parsed.searchParams.get("p") || "1";
          const videoId = bilibiliMatch[1];
          const query = videoId.toLowerCase().startsWith("av")
            ? `aid=${encodeURIComponent(videoId.slice(2))}&page=${encodeURIComponent(page)}`
            : `bvid=${encodeURIComponent(videoId)}&page=${encodeURIComponent(page)}`;
          return `https://player.bilibili.com/player.html?${query}`;
        }
      }

      if (hostname === "vimeo.com") {
        const vimeoMatch = pathname.match(/^\/(\d+)(?:\/|$)/);
        if (vimeoMatch?.[1]) {
          return `https://player.vimeo.com/video/${encodeURIComponent(vimeoMatch[1])}`;
        }
      }

      if (hostname === "loom.com") {
        const loomMatch = pathname.match(/^\/(?:share|embed)\/([^/?#]+)/);
        if (loomMatch?.[1]) {
          return `https://www.loom.com/embed/${encodeURIComponent(loomMatch[1])}`;
        }
      }

      if (hostname === "codepen.io") {
        const codepenMatch = pathname.match(/^\/([^/]+)\/pen\/([^/?#]+)/);
        if (codepenMatch?.[1] && codepenMatch?.[2]) {
          return `https://codepen.io/${encodeURIComponent(codepenMatch[1])}/embed/${encodeURIComponent(codepenMatch[2])}?default-tab=result`;
        }
      }

      if (hostname === "figma.com") {
        return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(parsed.href)}`;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  function renderFigureCaption(captionHtml, fallbackText, className) {
    const content = captionHtml || escapeHtml(fallbackText || "");
    if (!content) {
      return "";
    }

    return `<figcaption class="${escapeHtml(className)}">${content}</figcaption>`;
  }

  function collectTableOfContentsHeadings(blocks, headings = []) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return headings;
    }

    blocks.forEach((block) => {
      if (!block) {
        return;
      }

      if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
        const level = Number(block.type.split("_")[1]) || 1;
        const text = block.plainText || "";
        if (text) {
          headings.push({
            level,
            text,
            anchorId: block.anchorId || buildHeadingAnchorId(block.id, text),
          });
        }
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        collectTableOfContentsHeadings(block.children, headings);
      }
    });

    return headings;
  }

  function renderHeadingBlock(tagName, block, childrenHtml) {
    const headingId = block.anchorId
      ? ` id="${escapeHtml(block.anchorId)}"`
      : "";

    return `<${tagName}${headingId}>${block.text || ""}</${tagName}>${childrenHtml}`;
  }

  function renderResourceBlock(block, childrenHtml, baseOrigin) {
    const safeUrl = sanitizeUrl(block.url, SAFE_LINK_PROTOCOLS, baseOrigin);
    const resourceLabel = getResourceTypeLabel(block.resourceType);
    const resourceName = block.name || (safeUrl ? safeUrl : "");
    const linkHtml = safeUrl
      ? `<a class="post-resource-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(resourceName || resourceLabel)}</a>`
      : `<span class="post-resource-link post-resource-link-disabled">${escapeHtml(resourceName || resourceLabel)}</span>`;
    const captionHtml = renderFigureCaption(block.captionHtml, block.caption, "post-resource-caption");
    const resourceTypeClass = String(block.resourceType || "resource").replace(/_/g, "-");

    return `<figure class="post-resource post-resource-${escapeHtml(resourceTypeClass)}"><div class="post-resource-body"><p class="post-block-label">${escapeHtml(resourceLabel)}</p>${linkHtml}</div>${captionHtml}</figure>${childrenHtml}`;
  }

  function renderEmbedLink(block, childrenHtml, safeUrl, hostname) {
    const captionHtml = renderFigureCaption(block.captionHtml, block.caption, "post-resource-caption");
    const linkLabel = block.name || hostname || safeUrl;

    return `<figure class="post-embed post-embed-link-only"><div class="post-embed-meta"><p class="post-block-label">Embed</p><a class="post-resource-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(linkLabel)}</a></div>${captionHtml}</figure>${childrenHtml}`;
  }

  function renderEmbedBlock(block, childrenHtml, baseOrigin) {
    const safeUrl = sanitizeUrl(block.url, SAFE_IMAGE_PROTOCOLS, baseOrigin);
    if (!safeUrl) {
      return childrenHtml;
    }

    const hostname = getUrlHostname(safeUrl, baseOrigin);
    const embedUrl = resolveEmbeddableUrl(safeUrl, baseOrigin);
    if (!embedUrl) {
      return renderEmbedLink(block, childrenHtml, safeUrl, hostname);
    }

    const captionHtml = renderFigureCaption(block.captionHtml, block.caption, "post-resource-caption");
    const linkLabel = block.name || hostname || safeUrl;

    return `<figure class="post-embed"><div class="post-embed-meta"><p class="post-block-label">Embed</p><a class="post-resource-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(linkLabel)}</a></div><div class="post-embed-shell"><iframe class="post-embed-frame" src="${escapeHtml(embedUrl)}" title="${escapeHtml(block.name || hostname || "Embedded content")}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"></iframe></div>${captionHtml}</figure>${childrenHtml}`;
  }

  function renderTableRow(block, { cellTag = "td", hasRowHeader = false } = {}) {
    const cells = Array.isArray(block.cells) ? block.cells : [];
    if (cells.length === 0) {
      return "";
    }

    return `<tr>${cells.map((cell, index) => {
      const resolvedTag = hasRowHeader && cellTag === "td" && index === 0 ? "th" : cellTag;
      const scope = resolvedTag === "th"
        ? ` scope="${cellTag === "th" ? "col" : "row"}"`
        : "";
      return `<${resolvedTag}${scope}>${cell || ""}</${resolvedTag}>`;
    }).join("")}</tr>`;
  }

  function renderTableBlock(block, childrenHtml) {
    const rows = Array.isArray(block.children) ? block.children.filter((child) => child?.type === "table_row") : [];
    if (rows.length === 0) {
      return childrenHtml;
    }

    const headerRows = block.hasColumnHeader ? rows.slice(0, 1) : [];
    const bodyRows = block.hasColumnHeader ? rows.slice(1) : rows;
    const headHtml = headerRows.length > 0
      ? `<thead>${headerRows.map((row) => renderTableRow(row, { cellTag: "th" })).join("")}</thead>`
      : "";
    const bodyHtml = bodyRows.length > 0
      ? `<tbody>${bodyRows.map((row) => renderTableRow(row, { hasRowHeader: block.hasRowHeader })).join("")}</tbody>`
      : "";

    return `<div class="post-table-wrapper" role="region" aria-label="Content table" tabindex="0"><table class="post-table"><caption class="visually-hidden">Content table</caption>${headHtml}${bodyHtml}</table></div>${childrenHtml}`;
  }

  function renderUnsupportedBlock(block, childrenHtml, baseOrigin) {
    const safeUrl = sanitizeUrl(block.url, SAFE_LINK_PROTOCOLS, baseOrigin);
    const blockTypeLabel = formatBlockTypeLabel(block.blockType);
    const detailHtml = block.text
      ? `<div class="post-unsupported-detail">${block.text}</div>`
      : "";
    const linkHtml = safeUrl
      ? `<a class="post-unsupported-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(safeUrl)}</a>`
      : "";

    return `<aside class="post-unsupported" aria-label="Unsupported Notion block"><p class="post-unsupported-title">Unsupported block: ${escapeHtml(blockTypeLabel)}</p>${detailHtml}${linkHtml}</aside>${childrenHtml}`;
  }

  function renderBookmarkBlock(block, childrenHtml, baseOrigin) {
    const safeUrl = sanitizeUrl(block.url, SAFE_LINK_PROTOCOLS, baseOrigin);
    if (!safeUrl) {
      return childrenHtml;
    }

    const hostname = getUrlHostname(safeUrl, baseOrigin);

    return `<article class="post-bookmark"><p class="post-block-label">Bookmark</p><a class="post-bookmark-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener"><span class="post-bookmark-title">${escapeHtml(hostname || safeUrl)}</span><span class="post-bookmark-url">${escapeHtml(safeUrl)}</span></a></article>${childrenHtml}`;
  }

  function renderChildReferenceBlock(block, childrenHtml) {
    const label = block.type === "child_database" ? "Child database" : "Child page";

    return `<section class="post-child-page" aria-label="${escapeHtml(label)}"><p class="post-block-label">${escapeHtml(label)}</p><p class="post-child-page-title">${escapeHtml(block.title || "")}</p></section>${childrenHtml}`;
  }

  function renderTableOfContentsBlock(block, childrenHtml, options = {}) {
    const headings = Array.isArray(options.tocHeadings) ? options.tocHeadings : [];
    if (headings.length === 0) {
      return childrenHtml;
    }

    const itemsHtml = headings.map((heading) => {
      const anchorId = escapeHtml(heading.anchorId || "");
      const text = escapeHtml(heading.text || "");
      const levelClass = `level-${Number(heading.level) || 1}`;

      return `<li class="post-table-of-contents-item ${levelClass}"><a href="#${anchorId}">${text}</a></li>`;
    }).join("");

    return `<nav class="post-table-of-contents" aria-label="Table of contents"><p class="post-block-label">Table of contents</p><ol class="post-table-of-contents-list">${itemsHtml}</ol></nav>${childrenHtml}`;
  }

  function renderBlock(block, options = {}) {
    const childrenHtml = renderBlocks(block.children || [], options);
    const baseOrigin = options.baseOrigin;

    switch (block.type) {
      case "container":
      case "synced_block":
        return childrenHtml;
      case "heading_1":
        return renderHeadingBlock("h1", block, childrenHtml);
      case "heading_2":
        return renderHeadingBlock("h2", block, childrenHtml);
      case "heading_3":
        return renderHeadingBlock("h3", block, childrenHtml);
      case "paragraph":
        return block.text ? `<p>${block.text}</p>${childrenHtml}` : childrenHtml;
      case "code":
        return `<pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.text)}</code></pre>${childrenHtml}`;
      case "quote":
        return `<blockquote>${block.text || ""}${childrenHtml}</blockquote>`;
      case "divider":
        return `<hr>${childrenHtml}`;
      case "image": {
        const safeImageUrl = sanitizeUrl(block.url, SAFE_IMAGE_PROTOCOLS, baseOrigin);
        if (!safeImageUrl) return childrenHtml;
        const captionHtml = renderFigureCaption(block.captionHtml, block.caption, "post-figure-caption");
        return `<figure class="post-figure post-figure-image"><img class="post-figure-media" src="${escapeHtml(safeImageUrl)}" alt="${escapeHtml(block.caption)}" loading="lazy" decoding="async">${captionHtml}</figure>${childrenHtml}`;
      }
      case "callout": {
        const iconHtml = block.icon
          ? `<div class="post-callout-icon" aria-hidden="true">${escapeHtml(block.icon)}</div>`
          : "";
        return `<aside class="post-callout" role="note">${iconHtml}<div class="post-callout-body">${block.text || ""}${childrenHtml}</div></aside>`;
      }
      case "toggle":
        return `<details class="post-toggle"><summary>${block.text || ""}</summary>${childrenHtml}</details>`;
      case "to_do":
        return `<div class="post-todo${block.checked ? " checked" : ""}"><span class="post-todo-box" aria-hidden="true">${block.checked ? "&#10003;" : ""}</span><div class="post-todo-content"><div class="post-todo-text">${block.text || ""}</div>${childrenHtml}</div></div>`;
      case "equation":
        return `<figure class="post-equation"><figcaption class="post-block-label">Equation</figcaption><div class="post-equation-expression" role="math" aria-label="Equation"><code>${escapeHtml(block.expression || "")}</code></div></figure>${childrenHtml}`;
      case "bookmark":
        return renderBookmarkBlock(block, childrenHtml, baseOrigin);
      case "resource":
        if (block.resourceType === "embed") {
          return renderEmbedBlock(block, childrenHtml, baseOrigin);
        }
        return renderResourceBlock(block, childrenHtml, baseOrigin);
      case "table":
        return renderTableBlock(block, childrenHtml);
      case "table_row":
        return `<div class="post-table-wrapper" role="region" aria-label="Content table row" tabindex="0"><table class="post-table"><caption class="visually-hidden">Content table row</caption><tbody>${renderTableRow(block)}</tbody></table></div>${childrenHtml}`;
      case "table_of_contents":
        return renderTableOfContentsBlock(block, childrenHtml, options);
      case "child_page":
      case "child_database":
        return renderChildReferenceBlock(block, childrenHtml);
      case "unsupported":
        return renderUnsupportedBlock(block, childrenHtml, baseOrigin);
      default:
        return childrenHtml;
    }
  }

  function renderPostTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
      return "";
    }

    return `<span>${tags.map((tag) => `#${escapeHtml(tag)}`).join(" ")}</span>`;
  }

  function renderPostArticle(post, { baseOrigin, renderedContent } = {}) {
    const category = post?.category || "";
    const date = post?.date || "";
    const readTime = post?.readTime || "";
    const categoryColor = getCategoryColor(category);
    const metaItems = [];
    const articleContent = typeof renderedContent === "string"
      ? renderedContent
      : renderBlocks(Array.isArray(post?.content) ? post.content : [], { baseOrigin });

    if (date) {
      metaItems.push(`
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                ${escapeHtml(date)}
              </span>
      `);
    }

    if (readTime) {
      metaItems.push(`
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${escapeHtml(readTime)}
              </span>
      `);
    }

    const tagHtml = renderPostTags(post?.tags);
    if (tagHtml) {
      metaItems.push(tagHtml);
    }

    const categoryHtml = category
      ? `
            <div class="post-category" style="background: ${sanitizeCssColorValue(categoryColor.bg, DEFAULT_CATEGORY_COLOR.bg)}; color: ${sanitizeCssColorValue(categoryColor.color, DEFAULT_CATEGORY_COLOR.color)}; border: 1px solid ${sanitizeCssColorValue(categoryColor.border, DEFAULT_CATEGORY_COLOR.border)};">
              ${escapeHtml(category)}
            </div>
      `
      : "";
    const metaHtml = metaItems.length > 0
      ? `
            <div class="post-meta">
              ${metaItems.join("")}
            </div>
      `
      : "";

    return `
          <div class="post-header">
            ${categoryHtml}
            <h1 class="post-title" data-page-focus>${escapeHtml(post?.title || "")}</h1>
            ${metaHtml}
          </div>
          <div class="post-content">
            ${articleContent}
          </div>
  `;
  }

  function isLikelyEphemeralAssetUrl(candidate, baseOrigin) {
    if (!candidate || typeof candidate !== "string") return false;

    try {
      const parsed = new URL(candidate, getBaseOrigin(baseOrigin));
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

  function resolveShareImageUrl(candidate, fallback, baseOrigin) {
    const safeImageUrl = resolveDisplayImageUrl(candidate, baseOrigin);
    if (!safeImageUrl || isLikelyEphemeralAssetUrl(safeImageUrl, baseOrigin)) {
      return fallback;
    }

    return safeImageUrl;
  }

  function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR;
  }

  return Object.freeze({
    ALL_CATEGORY,
    BOOKMARK_CATEGORY,
    BOOKMARK_ONLY_CATEGORIES,
    DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES,
    REMOTE_BLOG_CATEGORIES,
    SUPPORTED_BLOG_CATEGORIES,
    escapeHtml,
    getBookmarkOnlyCategories,
    getRemoteBlogCategories,
    getSupportedBlogCategories,
    getCategoryColor,
    gradientForCategory,
    isLikelyEphemeralAssetUrl,
    mapNotionBlock,
    mapNotionPage,
    renderPostArticle,
    renderBlocks,
    resolveDisplayImageUrl,
    resolveNotionContentSchema,
    resolveShareImageUrl,
    richTextToHtml,
    richTextToPlain,
    sanitizeCssColorValue,
    sanitizeUrl,
  });
});
