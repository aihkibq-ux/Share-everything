/**
 * Vercel Serverless Function — Notion API 代理
 *
 * 替代 Cloudflare Worker，解决大陆 Cloudflare IP 不可达的问题。
 * 通过 vercel.json rewrites，所有 /api/* 请求都被路由到此函数。
 *
 * 环境变量（在 Vercel Dashboard → Settings → Environment Variables 中设置）：
 *   - NOTION_TOKEN: 你的 Notion Integration Token
 */

const NOTION_BASE = "https://api.notion.com/v1";

module.exports = async function handler(req, res) {
  // CORS 头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 从 URL 中提取 /api/ 之后的路径
  // /api/databases/xxx/query → databases/xxx/query
  const fullPath = req.url || "";
  const match = fullPath.match(/^\/api\/(.+?)(\?.*)?$/);

  if (!match || !match[1]) {
    return res.status(404).json({ error: "Not found. Usage: /api/{notion-api-path}" });
  }

  const notionPath = match[1];
  const queryString = match[2] || "";
  const notionUrl = `${NOTION_BASE}/${notionPath}${queryString}`;

  try {
    const notionRes = await fetch(notionUrl, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const data = await notionRes.text();

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Cache-Control",
      notionRes.ok ? "public, s-maxage=300, stale-while-revalidate=60" : "no-store"
    );

    return res.status(notionRes.status).send(data);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
