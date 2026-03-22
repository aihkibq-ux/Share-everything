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

function replaceHeadMeta(html, { title, description, url, image, imageAlt, canonicalUrl, robots }) {
  const replacements = [
    [/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`],
    [/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeAttribute(description)}" />`],
    [/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeAttribute(title)}" />`],
    [/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeAttribute(description)}" />`],
    [/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeAttribute(url)}" />`],
    [/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${escapeAttribute(image)}" />`],
    [/<meta property="og:image:alt" content="[^"]*" \/>/, `<meta property="og:image:alt" content="${escapeAttribute(imageAlt)}" />`],
  ];

  let nextHtml = html;
  replacements.forEach(([pattern, replacement]) => {
    nextHtml = nextHtml.replace(pattern, replacement);
  });

  if (robots) {
    if (/<meta name="robots" content="[^"]*" \/>/.test(nextHtml)) {
      nextHtml = nextHtml.replace(
        /<meta name="robots" content="[^"]*" \/>/,
        `<meta name="robots" content="${escapeAttribute(robots)}" />`,
      );
    } else {
      nextHtml = nextHtml.replace(
        /(<meta property="og:image:alt" content="[^"]*" \/>)/,
        `$1\n    <meta name="robots" content="${escapeAttribute(robots)}" />`,
      );
    }
  }

  if (/<link rel="canonical" href="[^"]*" \/>/.test(nextHtml)) {
    nextHtml = nextHtml.replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    );
  } else {
    nextHtml = nextHtml.replace(
      /(<meta property="og:image:alt" content="[^"]*" \/>)/,
      `$1\n    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    );
  }

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
    title: "文章不存在 — Share Everything",
    description: "未找到对应的文章内容。",
    robots: "noindex, nofollow",
  };
}

module.exports = async function handler(req, res) {
  const rawRouteId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const routeId = typeof rawRouteId === "string" ? rawRouteId.trim() : "";
  const siteOrigin = getSiteOrigin();
  const defaultShareImageUrl = `${siteOrigin}/favicon.png?v=2`;

  let html = await getTemplate();

  if (!routeId) {
    const fallback = buildNotFoundContent();
    html = replaceHeadMeta(html, {
      title: fallback.title,
      description: fallback.description,
      url: `${siteOrigin}/post.html`,
      image: defaultShareImageUrl,
      imageAlt: "Share Everything",
      canonicalUrl: `${siteOrigin}/post.html`,
      robots: fallback.robots,
    });
    html = html.replace('<div id="postSkeleton">', '<div id="postSkeleton" style="display: none;">');
    html = html.replace('id="postEmpty" style="display: none;"', 'id="postEmpty" style="display: flex;"');
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
    });

    html = html.replace('<div id="postSkeleton">', '<div id="postSkeleton" style="display: none;">');
    html = html.replace(
      '<div id="postContent" style="display: none;"></div>',
      `<div id="postContent" style="display: block;">${buildServerRenderedArticle(post)}</div>`,
    );
    html = injectInitialPostData(html, post);
    html = upsertStructuredDataScript(html, "post-article", articleStructuredData);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
    return res.status(200).send(html);
  } catch (error) {
    const fallback = buildNotFoundContent();
    html = replaceHeadMeta(html, {
      title: fallback.title,
      description: fallback.description,
      url: buildPostUrl(routeId),
      image: defaultShareImageUrl,
      imageAlt: "Share Everything",
      canonicalUrl: buildPostUrl(routeId),
      robots: fallback.robots,
    });
    html = html.replace('<div id="postSkeleton">', '<div id="postSkeleton" style="display: none;">');
    html = html.replace('id="postEmpty" style="display: none;"', 'id="postEmpty" style="display: flex;"');
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send(html);
  }
};
