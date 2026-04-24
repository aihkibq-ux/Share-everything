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

function formatUrlEntry(loc, lastmod) {
  const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodTag}\n  </url>`;
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedReadMethod(req, res)) {
    return undefined;
  }

  try {
    const siteOrigin = getSiteOrigin();
    const posts = await queryPublicPages();
    const entries = [
      formatUrlEntry(`${siteOrigin}/`),
      formatUrlEntry(`${siteOrigin}/blog.html`),
      ...posts.map((post) => formatUrlEntry(buildPostUrl(post.id), post.date || undefined)),
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
