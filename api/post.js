const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildArticleStructuredData,
  buildPostUrl,
  escapeHtml,
  fetchPublicPost,
  getSiteOrigin,
  renderPostArticle,
  renderPostContent,
  resolveShareImageUrl,
} = require("../server/notion-server");
const {
  applyPublicErrorHeaders,
  getPublicPostErrorStatus,
  readQueryString,
} = require("../server/public-content");

let templatePromise = null;
const HEAD_CLOSE_PATTERN = /<\/head>/;
const MAIN_CLOSE_PATTERN = /<\/main>/;
const HEAD_META_INSERTION_ANCHOR = /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/;

function getTemplate() {
  if (!templatePromise) {
    templatePromise = fs.readFile(path.join(process.cwd(), "post.html"), "utf8");
  }
  return templatePromise;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function serializeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function replaceMarkup(html, pattern, markup, label) {
  const result = html.replace(pattern, () => markup);
  if (label && result === html) {
    console.warn(`SSR: Pattern for "${label}" did not match template. The post.html structure may have changed.`);
  }
  return result;
}

function insertMarkupBefore(html, pattern, markup, indentation = "") {
  return html.replace(pattern, (matched) => `${markup}\n${indentation}${matched}`);
}

function insertMarkupAfter(html, pattern, markup, indentation = "    ") {
  return html.replace(pattern, (matched) => `${matched}\n${indentation}${markup}`);
}

function upsertHeadMarkup(html, pattern, markup) {
  const result = html.replace(pattern, () => markup);
  if (result !== html) {
    return result;
  }

  return insertMarkupAfter(html, HEAD_META_INSERTION_ANCHOR, markup);
}

function upsertStructuredDataScript(html, key, payload) {
  const marker = `data-structured-data="${escapeAttribute(key)}"`;
  const scriptTag = `    <script type="application/ld+json" ${marker}>${serializeJsonForScript(payload)}</script>`;
  const existingPattern = new RegExp(
    `<script type="application/ld\\+json"[^>]*${marker}[^>]*>[\\s\\S]*?<\\/script>`,
  );

  if (existingPattern.test(html)) {
    return replaceMarkup(html, existingPattern, scriptTag);
  }

  return insertMarkupBefore(html, HEAD_CLOSE_PATTERN, scriptTag, "  ");
}

function injectInitialPostData(html, payload) {
  const scriptTag = `    <script id="initialPostData" type="application/json">${serializeJsonForScript(payload)}</script>`;
  return insertMarkupBefore(html, MAIN_CLOSE_PATTERN, scriptTag, "    ");
}

function replaceHeadMeta(html, { title, description, url, image, imageAlt, canonicalUrl, robots, ogType }) {
  const replacements = [
    [/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`, "title"],
    [/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeAttribute(description)}" />`, "meta:description"],
    [/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${escapeAttribute(title)}" />`, "og:title"],
    [/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${escapeAttribute(description)}" />`, "og:description"],
    [/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/, `<meta property="og:type" content="${escapeAttribute(ogType || "website")}" />`, "og:type"],
    [/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${escapeAttribute(url)}" />`, "og:url"],
    [/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${escapeAttribute(image)}" />`, "og:image"],
    [/<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image:alt" content="${escapeAttribute(imageAlt)}" />`, "og:image:alt"],
  ];

  let nextHtml = html;
  replacements.forEach(([pattern, replacement, label]) => {
    nextHtml = replaceMarkup(nextHtml, pattern, replacement, label);
  });

  if (typeof robots === "string" && robots) {
    nextHtml = upsertHeadMarkup(
      nextHtml,
      /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/,
      `<meta name="robots" content="${escapeAttribute(robots)}" />`,
    );
  } else {
    nextHtml = nextHtml.replace(/\s*<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/, "");
  }

  nextHtml = upsertHeadMarkup(
    nextHtml,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
  );

  return nextHtml;
}

function replaceEmptyStateContent(html, { message, linkText = "返回博客列表" }) {
  let nextHtml = html.replace(
    /(<div class="empty-state" id="postEmpty"[^>]*>[\s\S]*?<\/svg>\s*<p>)[\s\S]*?(<\/p>)/,
    (matched, prefix, suffix) => `${prefix}${escapeHtml(message)}${suffix}`,
  );

  nextHtml = nextHtml.replace(
    /(<div class="empty-state" id="postEmpty"[^>]*>[\s\S]*?<p style="font-size: 0\.85rem;">\s*<a href=")[^"]*("[^>]*>)[\s\S]*?(<\/a>)/,
    (matched, prefix, middle, suffix) => `${prefix}/blog.html${middle}${escapeHtml(linkText)}${suffix}`,
  );

  return nextHtml;
}

function buildInitialPostPayload(post) {
  return {
    id: post.id,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    date: post.date,
    readTime: post.readTime,
    coverImage: post.coverImage,
    coverEmoji: post.coverEmoji,
    coverGradient: post.coverGradient,
    tags: Array.isArray(post.tags) ? post.tags : [],
  };
}

function buildNotFoundContent() {
  return {
    title: "文章不存在 - Share Everything",
    description: "未找到对应的文章内容。",
    message: "文章不存在",
    linkText: "返回博客列表",
    ogType: "website",
    robots: "noindex, nofollow",
  };
}

function buildUnavailableContent() {
  return {
    title: "文章暂时不可用 - Share Everything",
    description: "文章内容暂时无法加载，请稍后再试。",
    message: "文章暂时不可用",
    linkText: "返回博客列表",
    ogType: "website",
    robots: "noindex, nofollow",
  };
}

function renderFallbackPage(html, fallback, { url, canonicalUrl, image, imageAlt }) {
  let nextHtml = replaceHeadMeta(html, {
    title: fallback.title,
    description: fallback.description,
    url,
    image,
    imageAlt,
    canonicalUrl,
    robots: fallback.robots,
    ogType: fallback.ogType,
  });
  nextHtml = replaceEmptyStateContent(nextHtml, {
    message: fallback.message,
    linkText: fallback.linkText,
  });
  nextHtml = replaceMarkup(nextHtml, /<div\s+id="postSkeleton"(?=[\s>])/, '<div id="postSkeleton" style="display: none;"', "fallback:postSkeleton");
  nextHtml = replaceMarkup(nextHtml, /id="postEmpty"\s+style="display:\s*none;?"/, 'id="postEmpty" style="display: flex;"', "fallback:postEmpty");
  return nextHtml;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Cache-Control", "no-store");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const routeId = readQueryString(req.query.id);
  const siteOrigin = getSiteOrigin();
  const defaultShareImageUrl = `${siteOrigin}/favicon.png?v=2`;

  let html = await getTemplate();

  if (!routeId) {
    const fallback = buildNotFoundContent();
    html = renderFallbackPage(html, fallback, {
      url: `${siteOrigin}/post.html`,
      canonicalUrl: `${siteOrigin}/post.html`,
      image: defaultShareImageUrl,
      imageAlt: "Share Everything",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send(html);
  }

  try {
    const post = await fetchPublicPost(routeId);
    const postUrl = buildPostUrl(post.id);
    const pageTitle = `${post.title} — Share Everything`;
    const pageDescription = post.excerpt || post.title;
    const pageImage = resolveShareImageUrl(post.coverImage, defaultShareImageUrl, siteOrigin);
    const articleStructuredData = buildArticleStructuredData(post);
    const renderedContent = renderPostContent(post, { baseOrigin: siteOrigin });

    html = replaceHeadMeta(html, {
      title: pageTitle,
      description: pageDescription,
      url: postUrl,
      image: pageImage,
      imageAlt: post.title,
      canonicalUrl: postUrl,
      robots: "index, follow",
      ogType: "article",
    });

    html = replaceMarkup(html, /<div\s+id="postSkeleton"(?=[\s>])/, '<div id="postSkeleton" style="display: none;"', "postSkeleton");
    html = html.replace(
      /<div\s+id="postContent"\s+style="display:\s*none;?">\s*<\/div>/,
      () => `<div id="postContent" style="display: block;">${renderPostArticle(post, { renderedContent, baseOrigin: siteOrigin })}</div>`,
    );
    html = injectInitialPostData(html, buildInitialPostPayload(post));
    html = upsertStructuredDataScript(html, "post-article", articleStructuredData);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  } catch (error) {
    const status = getPublicPostErrorStatus(error);
    const fallback = status === 404 ? buildNotFoundContent() : buildUnavailableContent();
    if (status !== 404) {
      console.error("Failed to render post route:", error);
    }

    applyPublicErrorHeaders(res, error);
    html = renderFallbackPage(html, fallback, {
      url: buildPostUrl(routeId),
      canonicalUrl: buildPostUrl(routeId),
      image: defaultShareImageUrl,
      imageAlt: "Share Everything",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).send(html);
  }
};
