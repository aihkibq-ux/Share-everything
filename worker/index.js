/**
 * Cloudflare Worker — Notion API 代理（带边缘缓存）
 * 
 * 部署方式：
 * 1. 在 Cloudflare Dashboard 创建一个 Worker
 * 2. 设置环境变量 NOTION_TOKEN = 你的 Notion Integration Token
 * 3. 粘贴此代码并部署
 * 4. 在 notion-api.js 的 CONFIG.workerUrl 中填入 Worker URL
 */

const CACHE_TTL = 300; // 边缘缓存 5 分钟

export default {
  async fetch(request, env) {
    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 仅代理 Notion API 路径
    if (!path.startsWith("/v1/")) {
      return new Response("Not found", { status: 404 });
    }

    // ====== 边缘缓存 ======
    // POST 请求不走 Cloudflare 默认缓存，需要手动用 Cache API
    const body = ["GET", "HEAD"].includes(request.method) ? null : await request.text();
    const cacheKey = new URL(request.url);
    if (body) {
      // 用 body 的 hash 作为缓存 key 的一部分
      const hash = await sha256(body);
      cacheKey.searchParams.set("_h", hash);
    }
    const cacheRequest = new Request(cacheKey.toString(), { method: "GET" });
    const cache = caches.default;

    // 尝试从缓存读取
    let response = await cache.match(cacheRequest);
    if (response) {
      // 命中缓存，直接返回（加上 CORS 头）
      const cachedBody = await response.text();
      return new Response(cachedBody, {
        status: response.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
          "X-Cache": "HIT",
        },
      });
    }

    // ====== 回源 Notion API ======
    const notionUrl = "https://api.notion.com" + path + url.search;

    try {
      const notionResponse = await fetch(notionUrl, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: body,
      });

      const data = await notionResponse.text();

      // 只缓存成功的响应
      if (notionResponse.ok) {
        const cacheResponse = new Response(data, {
          status: notionResponse.status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CACHE_TTL}`,
          },
        });
        // 异步写入缓存，不阻塞响应
        await cache.put(cacheRequest, cacheResponse);
      }

      return new Response(data, {
        status: notionResponse.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
          "X-Cache": "MISS",
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

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// TODO: 生产环境应将 Allow-Origin 改为实际前端域名
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

