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
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.0000068.xyz",
  "https://0000068.xyz",
];
const NOTION_ID_PATTERN = /^[0-9a-fA-F-]{32,36}$/;
const BLOCK_CHILDREN_QUERY_PARAMS = new Set(["page_size", "start_cursor"]);

export default {
  async fetch(request, env, ctx) {
    const allowedOrigins = getAllowedOrigins(env);
    const responseOrigin = getResponseOrigin(request.headers.get("Origin"), allowedOrigins);

    // CORS Preflight
    if (request.method === "OPTIONS") {
      if (!isAllowedRequestSource(request, allowedOrigins)) {
        return jsonResponse({ error: "Forbidden request source" }, 403, responseOrigin);
      }
      return new Response(null, { headers: corsHeaders(responseOrigin) });
    }

    if (!isAllowedRequestSource(request, allowedOrigins)) {
      return jsonResponse({ error: "Forbidden request source" }, 403, responseOrigin);
    }

    const url = new URL(request.url);
    const pathInfo = getAllowedPathInfo(url.pathname);

    if (!pathInfo) {
      return jsonResponse({ error: "Unsupported Notion API path" }, 400, responseOrigin);
    }

    if (!isAllowedMethodForPath(request.method, pathInfo.kind)) {
      return jsonResponse({ error: "Method not allowed for this path" }, 405, responseOrigin);
    }

    const queryString = buildAllowedQueryString(url.searchParams, pathInfo.kind);
    if (queryString == null) {
      return jsonResponse({ error: "Unsupported query parameters" }, 400, responseOrigin);
    }

    // ====== 边缘缓存 ======
    const body = ["GET", "HEAD"].includes(request.method) ? null : await request.text();

    // 构造缓存 key：避免把原始 body 直接拼进 URL
    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = `/v1/${pathInfo.notionPath}`;
    cacheUrl.search = queryString;
    if (body) {
      cacheUrl.searchParams.set("_b", await sha256(body));
    }
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;

    // 尝试从缓存读取
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: {
          ...corsHeaders(responseOrigin),
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
          "X-Cache": "HIT",
        },
      });
    }

    // ====== 回源 Notion API ======
    const notionUrl = `https://api.notion.com/v1/${pathInfo.notionPath}${queryString}`;

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
          ...corsHeaders(responseOrigin),
          "Content-Type": "application/json",
          "Cache-Control": notionRes.ok ? `public, max-age=${CACHE_TTL}` : "no-store",
          "X-Cache": "MISS",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: {
          ...corsHeaders(responseOrigin),
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
  },
};

/**
 * CORS 响应头
 */
function corsHeaders(responseOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (responseOrigin) {
    headers["Access-Control-Allow-Origin"] = responseOrigin;
  }
  return headers;
}

function jsonResponse(data, status, responseOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(responseOrigin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getAllowedOrigins(env) {
  const configured = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function parseOriginHeader(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch (error) {
    return "";
  }
}

function getResponseOrigin(requestOrigin, allowedOrigins) {
  if (allowedOrigins.includes("*")) {
    return "*";
  }

  const parsedOrigin = parseOriginHeader(requestOrigin);
  if (parsedOrigin && allowedOrigins.includes(parsedOrigin)) {
    return parsedOrigin;
  }
  return "";
}

function isAllowedRequestSource(request, allowedOrigins) {
  if (allowedOrigins.includes("*")) {
    return true;
  }

  const requestOrigin = parseOriginHeader(request.headers.get("Origin"));
  if (requestOrigin) {
    return allowedOrigins.includes(requestOrigin);
  }

  const refererOrigin = parseOriginHeader(request.headers.get("Referer"));
  if (refererOrigin) {
    return allowedOrigins.includes(refererOrigin);
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

function normalizePathSegments(pathname) {
  const rawSegments = pathname.split("/").filter(Boolean);
  if (rawSegments[0] === "v1") rawSegments.shift();
  if (rawSegments.length === 0) return null;

  const segments = [];
  for (const rawSegment of rawSegments) {
    let decodedSegment;
    try {
      decodedSegment = decodeURIComponent(rawSegment);
    } catch (error) {
      return null;
    }

    if (
      !decodedSegment ||
      decodedSegment === "." ||
      decodedSegment === ".." ||
      decodedSegment.includes("/") ||
      decodedSegment.includes("\\")
    ) {
      return null;
    }

    segments.push(decodedSegment);
  }

  return segments.length > 0 ? segments : null;
}

function getAllowedPathInfo(pathname) {
  const segments = normalizePathSegments(pathname);
  if (!segments) return null;

  if (
    segments[0] === "databases" &&
    segments[2] === "query" &&
    segments.length === 3 &&
    NOTION_ID_PATTERN.test(segments[1])
  ) {
    return { kind: "databaseQuery", notionPath: segments.join("/") };
  }

  if (segments[0] === "pages" && segments.length === 2 && NOTION_ID_PATTERN.test(segments[1])) {
    return { kind: "page", notionPath: segments.join("/") };
  }

  if (
    segments[0] === "blocks" &&
    segments[2] === "children" &&
    segments.length === 3 &&
    NOTION_ID_PATTERN.test(segments[1])
  ) {
    return { kind: "blockChildren", notionPath: segments.join("/") };
  }

  return null;
}

function isAllowedMethodForPath(method, pathKind) {
  if (method === "POST" && pathKind === "databaseQuery") return true;
  if ((method === "GET" || method === "HEAD") && (pathKind === "page" || pathKind === "blockChildren")) {
    return true;
  }
  return false;
}

function buildAllowedQueryString(searchParams, pathKind) {
  const allowedParams = pathKind === "blockChildren" ? BLOCK_CHILDREN_QUERY_PARAMS : null;
  const params = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (!allowedParams?.has(key)) return null;
    params.append(key, value);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
