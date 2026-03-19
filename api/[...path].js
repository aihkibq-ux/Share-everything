/**
 * Vercel Serverless Function — Notion API 代理
 *
 * 替代 Cloudflare Worker，解决大陆 Cloudflare IP 不可达的问题。
 * 所有 /api/* 请求都会被转发到 https://api.notion.com/v1/*
 *
 * 环境变量（在 Vercel Dashboard → Settings → Environment Variables 中设置）：
 *   - NOTION_TOKEN: 你的 Notion Integration Token
 */

const NOTION_BASE = "https://api.notion.com/v1";

export default async function handler(req, res) {
  // CORS 头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 从 catch-all 路径中提取 Notion API 路径
  // /api/databases/xxx/query → ["databases", "xxx", "query"]
  const pathSegments = req.query.path;
  if (!pathSegments || !pathSegments.length) {
    return res.status(404).json({ error: "Not found" });
  }
  const notionPath = pathSegments.join("/");

  // 构建 Notion API URL（保留查询参数）
  const queryString = Object.entries(req.query)
    .filter(([key]) => key !== "path")
    .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
    .join("&");

  const notionUrl = `${NOTION_BASE}/${notionPath}${queryString ? `?${queryString}` : ""}`;

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
}
