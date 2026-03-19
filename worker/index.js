/**
 * Cloudflare Worker — Notion API 代理（带边缘缓存）
 *
 * 部署方式：
 * 1. 在 Cloudflare Dashboard 创建一个 Worker
 * 2. 设置环境变量：
 *    - NOTION_TOKEN = 你的 Notion Integration Token
 *    - ALLOWED_ORIGIN = 前端域名（如 https://example.com），不设则允许所有
 * 3. 粘贴此代码并部署
 * 4. 在 notion-api.js 的 CONFIG.workerUrl 中填入 Worker URL
 */

const CACHE_TTL = 300; // 边缘缓存 5 分钟

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";

    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(allowed, origin) });
    }

    // 来源校验：限制非法跨域调用
    if (allowed !== "*" && origin && origin !== allowed) {
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 仅代理 Notion API 路径
    if (!path.startsWith("/v1/")) {
      return new Response("Not found", { status: 404 });
    }

    // ====== 边缘缓存 ======
    const body = ["GET", "HEAD"].includes(request.method) ? null : await request.text();

    // 构造缓存 key：用 body 内容直接做 URL 参数（短 body 无需 SHA-256）
    const cacheUrl = new URL(request.url);
    if (body) cacheUrl.searchParams.set("_b", body);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;

    // 尝试从缓存读取
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: {
          ...corsHeaders(allowed, origin),
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
          "X-Cache": "HIT",
        },
      });
    }

    // ====== 回源 Notion API ======
    const notionUrl = "https://api.notion.com" + path + url.search;

    try {
      const notionRes = await fetch(notionUrl, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body,
      });

      const data = await notionRes.text();

      // 异步写入缓存（仅成功响应），不阻塞返回
      if (notionRes.ok) {
        const toCache = new Response(data, {
          status: notionRes.status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CACHE_TTL}`,
          },
        });
        ctx.waitUntil(cache.put(cacheKey, toCache));
      }

      return new Response(data, {
        status: notionRes.status,
        headers: {
          ...corsHeaders(allowed, origin),
          "Content-Type": "application/json",
          "Cache-Control": notionRes.ok ? `public, max-age=${CACHE_TTL}` : "no-store",
          "X-Cache": "MISS",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: {
          ...corsHeaders(allowed, origin),
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
  },
};

/**
 * CORS 响应头
 * @param {string} allowed - 环境变量配置的允许域名，"*" 或具体域名
 * @param {string} origin  - 请求的 Origin 头
 */
function corsHeaders(allowed, origin) {
  return {
    "Access-Control-Allow-Origin": allowed === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
