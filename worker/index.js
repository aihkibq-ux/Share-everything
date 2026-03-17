/**
 * Cloudflare Worker — Notion API 代理
 * 
 * 部署方式：
 * 1. 在 Cloudflare Dashboard 创建一个 Worker
 * 2. 设置环境变量 NOTION_TOKEN = 你的 Notion Integration Token
 * 3. 粘贴此代码并部署
 * 4. 在 notion-api.js 的 CONFIG.workerUrl 中填入 Worker URL
 */

export default {
  async fetch(request, env) {
    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 仅代理 Notion API 路径
    if (!path.startsWith("/v1/")) {
      return new Response("Not found", { status: 404 });
    }

    const notionUrl = "https://api.notion.com" + path + url.search;

    try {
      const notionResponse = await fetch(notionUrl, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
      });

      const data = await notionResponse.text();

      return new Response(data, {
        status: notionResponse.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
        },
      });
    }
  },
};

// TODO: 生产环境应将 Allow-Origin 改为实际前端域名，而非 "*"
// TODO: 考虑添加简单的速率控制/缓存，Notion API 限速 3 req/s
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
