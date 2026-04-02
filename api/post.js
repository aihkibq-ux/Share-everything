const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildArticleStructuredData,
  buildPostUrl,
  escapeHtml,
  fetchPost,
  getCategoryColor,
  getSiteOrigin,
  resolveShareImageUrl,
} = require("../server/notion-server");

let templatePromise = null;

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

function upsertStructuredDataScript(html, key, payload) {
  const marker = `data-structured-data="${escapeAttribute(key)}"`;
  const scriptTag = `    <script type="application/ld+json" ${marker}>${serializeJsonForScript(payload)}</script>`;
  const existingPattern = new RegExp(
    `<script type="application/ld\\+json"[^>]*${marker}[^>]*>[\\s\\S]*?<\\/script>`,
  );

  if (existingPattern.test(html)) {
    return html.replace(existingPattern, scriptTag);
  }

  return html.replace("</head>", `${scriptTag}\n  </head>`);
}

function injectInitialPostData(html, payload) {
  const scriptTag = `    <script id="initialPostData" type="application/json">${serializeJsonForScript(payload)}</script>`;
  return html.replace("</main>", `${scriptTag}\n    </main>`);
}

function replaceHeadMeta(html, { title, description, url, image, imageAlt, canonicalUrl, robots, ogType }) {
  const replacements = [
    [/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`],
    [/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeAttribute(description)}" />`],
    [/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${escapeAttribute(title)}" />`],
    [/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${escapeAttribute(description)}" />`],
    [/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/, `<meta property="og:type" content="${escapeAttribute(ogType || "website")}" />`],
    [/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${escapeAttribute(url)}" />`],
    [/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${escapeAttribute(image)}" />`],
    [/<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image:alt" content="${escapeAttribute(imageAlt)}" />`],
  ];

  let nextHtml = html;
  replacements.forEach(([pattern, replacement]) => {
    nextHtml = nextHtml.replace(pattern, replacement);
  });

  if (typeof robots === "string" && robots) {
    if (/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/.test(nextHtml)) {
      nextHtml = nextHtml.replace(
        /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/,
        `<meta name="robots" content="${escapeAttribute(robots)}" />`,
      );
    } else {
      nextHtml = nextHtml.replace(
        /(<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>)/,
        `$1\n    <meta name="robots" content="${escapeAttribute(robots)}" />`,
      );
    }
  } else {
    nextHtml = nextHtml.replace(/\s*<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/, "");
  }

  if (/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/.test(nextHtml)) {
    nextHtml = nextHtml.replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    );
  } else {
    nextHtml = nextHtml.replace(
      /(<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>)/,
      `$1\n    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    );
  }

  return nextHtml;
}

function replaceEmptyStateContent(html, { message, linkText = "返回博客列表" }) {
  let nextHtml = html.replace(
    /(<div class="empty-state" id="postEmpty"[^>]*>[\s\S]*?<\/svg>\s*<p>)[\s\S]*?(<\/p>)/,
    `$1${escapeHtml(message)}$2`,
  );

  nextHtml = nextHtml.replace(
    /(<div class="empty-state" id="postEmpty"[^>]*>[\s\S]*?<p style="font-size: 0\.85rem;">\s*<a href=")[^"]*("[^>]*>)[\s\S]*?(<\/a>)/,
    `$1/blog.html$2${escapeHtml(linkText)}$3`,
  );

  return nextHtml;
}

function buildServerRenderedArticle(post) {
  const categoryColor = getCategoryColor(post.category);
  const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
    ? `<span>${post.tags.map((tag) => `#${escapeHtml(tag)}`).join(" ")}</span>`
    : "";

  return `
          <div class="post-header">
            <div class="post-category" style="background: ${categoryColor.bg}; color: ${categoryColor.color}; border: 1px solid ${categoryColor.border};">
              ${escapeHtml(post.category)}
            </div>
            <h1 class="post-title" data-page-focus>${escapeHtml(post.title)}</h1>
            <div class="post-meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                ${escapeHtml(post.date)}
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${escapeHtml(post.readTime)}
              </span>
              ${tagsHtml}
            </div>
          </div>
          <div class="post-content">
            ${post.renderedContent || ""}
          </div>
  `;
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

function isMissingPostError(error) {
  const status = Number(error?.status);
  return status === 404 || (status === 400 && error?.notionCode === "validation_error");
}

function getPostErrorStatus(error) {
  if (isMissingPostError(error)) {
    return 404;
  }

  if (Number(error?.status) === 500 && error?.code === "notion_config_error") {
    return 500;
  }

  return 502;
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
  nextHtml = nextHtml.replace(/<div\s+id="postSkeleton"(?=[\s>])/, '<div id="postSkeleton" style="display: none;"');
  nextHtml = nextHtml.replace(/id="postEmpty"\s+style="display:\s*none;?"/, 'id="postEmpty" style="display: flex;"');
  return nextHtml;
}

module.exports = async function handler(req, res) {
  const rawRouteId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const routeId = typeof rawRouteId === "string" ? rawRouteId.trim() : "";
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
    const post = await fetchPost(routeId);
    const postUrl = buildPostUrl(post.id);
    const pageTitle = `${post.title} — Share Everything`;
    const pageDescription = post.excerpt || post.title;
    const pageImage = resolveShareImageUrl(post.coverImage, defaultShareImageUrl);
    const articleStructuredData = buildArticleStructuredData(post);

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

    html = html.replace(/<div\s+id="postSkeleton"(?=[\s>])/, '<div id="postSkeleton" style="display: none;"');
    html = html.replace(
      /<div\s+id="postContent"\s+style="display:\s*none;?">\s*<\/div>/,
      `<div id="postContent" style="display: block;">${buildServerRenderedArticle(post)}</div>`,
    );
    html = injectInitialPostData(html, post);
    html = upsertStructuredDataScript(html, "post-article", articleStructuredData);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
    return res.status(200).send(html);
  } catch (error) {
    const status = getPostErrorStatus(error);
    const fallback = status === 404 ? buildNotFoundContent() : buildUnavailableContent();
    if (status !== 404) {
      console.error("Failed to render post route:", error);
    }

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
