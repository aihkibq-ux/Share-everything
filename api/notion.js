/**
 * Vercel Serverless Function — Notion API 代理
 *
 * 替代 Cloudflare Worker，解决大陆 Cloudflare IP 不可达的问题。
 * 通过 vercel.json rewrites，所有 /api/* 请求都被路由到此函数。
 * Vercel rewrites 会把捕获的 :path* 作为 req.query.path 传入。
 *
 * 环境变量（在 Vercel Dashboard → Settings → Environment Variables 中设置）：
 *   - NOTION_TOKEN: 你的 Notion Integration Token
 */

const NOTION_BASE = "https://api.notion.com/v1";

module.exports = async function handler(req, res) {
  // CORS 头 — 仅允许自己的域名
  const allowedOrigin = req.headers.origin === "https://www.0000068.xyz"
    ? "https://www.0000068.xyz"
    : "https://0000068.xyz";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Vercel rewrites 把 /api/:path* 的 :path* 部分放在 req.query.path 中
  // 例如 /api/databases/xxx/query → req.query.path = ["databases", "xxx", "query"]
  const pathParam = req.query.path;
  if (!pathParam) {
    return res.status(404).json({ error: "Not found. Usage: /api/{notion-api-path}" });
  }

  // path 可能是字符串或数组
  const notionPath = Array.isArray(pathParam) ? pathParam.join("/") : pathParam;

  // 构建查询参数（排除 path 本身）
  const otherParams = Object.entries(req.query)
    .filter(([key]) => key !== "path")
    .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
    .join("&");

  const notionUrl = `${NOTION_BASE}/${notionPath}${otherParams ? `?${otherParams}` : ""}`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
    };

    // 只有非 GET/HEAD 请求才发送 body
    if (!["GET", "HEAD"].includes(req.method)) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const notionRes = await fetch(notionUrl, fetchOptions);
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
