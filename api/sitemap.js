const {
  buildPostUrl,
  getSiteOrigin,
  queryPublicPages,
} = require("../server/notion-server");
const {
  applyPublicErrorHeaders,
  getPublicContentErrorStatus,
  rejectUnsupportedReadMethod,
  serializePublicError,
} = require("../server/public-content");

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatUrlEntry(loc, { lastmod, changefreq, priority } = {}) {
  const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  const changefreqTag = changefreq ? `\n    <changefreq>${escapeXml(changefreq)}</changefreq>` : "";
  const priorityTag = priority != null ? `\n    <priority>${escapeXml(String(priority))}</priority>` : "";
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodTag}${changefreqTag}${priorityTag}\n  </url>`;
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedReadMethod(req, res)) {
    return undefined;
  }

  try {
    const siteOrigin = getSiteOrigin();
    const posts = await queryPublicPages();
    const entries = [
      formatUrlEntry(`${siteOrigin}/`, { changefreq: "daily", priority: 1.0 }),
      formatUrlEntry(`${siteOrigin}/blog.html`, { changefreq: "daily", priority: 0.9 }),
      ...posts.map((post) => formatUrlEntry(buildPostUrl(post.id), {
        lastmod: post.date || undefined,
        changefreq: "weekly",
        priority: 0.7,
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(xml);
  } catch (error) {
    const status = getPublicContentErrorStatus(error);
    console.error("Failed to generate sitemap:", error);

    applyPublicErrorHeaders(res, error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json(
      serializePublicError(
        error,
        status === 500 ? "Sitemap unavailable" : "Sitemap request failed",
      ),
    );
  }
};
