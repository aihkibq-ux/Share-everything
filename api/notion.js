/**
 * Vercel Serverless Function — Notion API 代理
 *
 * 替代 Cloudflare Worker，解决大陆 Cloudflare IP 不可达的问题。
 * 通过 vercel.json rewrites，/api/:path* 的 Notion 代理请求会被路由到此函数。
 * Vercel rewrites 会把捕获的 :path* 作为 req.query.path 传入。
 *
 * 环境变量（在 Vercel Dashboard → Settings → Environment Variables 中设置）：
 *   - NOTION_TOKEN: 你的 Notion Integration Token
 */

const NOTION_BASE = "https://api.notion.com/v1";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.0000068.xyz",
  "https://0000068.xyz",
];
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120);
const MAX_RATE_LIMIT_ENTRIES = Number(process.env.RATE_LIMIT_MAX_ENTRIES || 10_000);
const NOTION_ID_PATTERN = /^[0-9a-fA-F-]{32,36}$/;
const BLOCK_CHILDREN_QUERY_PARAMS = new Set(["page_size", "start_cursor"]);
const rateLimitStore = new Map();

function getNotionToken() {
  return typeof process.env.NOTION_TOKEN === "string"
    ? process.env.NOTION_TOKEN.trim()
    : "";
}

function getAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

function parseOriginHeader(value) {
  if (!value || typeof value !== "string") return "";

  try {
    return new URL(value).origin;
  } catch (error) {
    return "";
  }
}

function getResponseOrigin(requestOrigin, allowedOrigins) {
  if (allowedOrigins.includes("*")) return "*";

  const parsedOrigin = parseOriginHeader(requestOrigin);
  if (parsedOrigin && allowedOrigins.includes(parsedOrigin)) {
    return parsedOrigin;
  }

  return "";
}

function isAllowedRequestSource(req, allowedOrigins) {
  const allowAnyOrigin = allowedOrigins.includes("*");
  if (allowAnyOrigin) return true;

  const requestOrigin = parseOriginHeader(req.headers.origin);
  if (requestOrigin) {
    return allowedOrigins.includes(requestOrigin);
  }

  const refererOrigin = parseOriginHeader(req.headers.referer);
  if (refererOrigin) {
    return allowedOrigins.includes(refererOrigin);
  }

  const fetchSite = req.headers["sec-fetch-site"];
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

function normalizePathSegments(pathParam) {
  const rawSegments = Array.isArray(pathParam)
    ? pathParam
    : typeof pathParam === "string"
      ? pathParam.split("/")
      : [];

  if (rawSegments.length === 0) return null;

  const segments = [];
  for (const rawSegment of rawSegments) {
    if (typeof rawSegment !== "string") return null;

    const nestedSegments = rawSegment.split("/");
    for (const nestedSegment of nestedSegments) {
      if (!nestedSegment) continue;

      let decodedSegment;
      try {
        decodedSegment = decodeURIComponent(nestedSegment);
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
  }

  return segments.length > 0 ? segments : null;
}

function getAllowedPathInfo(pathParam) {
  const segments = normalizePathSegments(pathParam);
  if (!segments) return null;

  if (
    segments[0] === "databases" &&
    segments[2] === "query" &&
    segments.length === 3 &&
    NOTION_ID_PATTERN.test(segments[1])
  ) {
    return { kind: "databaseQuery", notionPath: segments.join("/") };
  }

  if (
    segments[0] === "pages" &&
    segments.length === 2 &&
    NOTION_ID_PATTERN.test(segments[1])
  ) {
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

function buildAllowedQueryString(query, pathKind) {
  const allowedParams = pathKind === "blockChildren" ? BLOCK_CHILDREN_QUERY_PARAMS : null;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (key === "path") continue;
    if (!allowedParams?.has(key)) return null;

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item == null) continue;
      params.append(key, String(item));
    }
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

function pruneRateLimitStore(now) {
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }

  if (rateLimitStore.size <= MAX_RATE_LIMIT_ENTRIES) {
    return;
  }

  const overflowCount = rateLimitStore.size - MAX_RATE_LIMIT_ENTRIES;
  let removed = 0;
  for (const ip of rateLimitStore.keys()) {
    rateLimitStore.delete(ip);
    removed += 1;
    if (removed >= overflowCount) {
      break;
    }
  }
}

function isRateLimited(req) {
  const now = Date.now();
  const clientIp = getClientIp(req);
  pruneRateLimitStore(now);
  const current = rateLimitStore.get(clientIp);

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientIp, { count: 1, windowStart: now });
  } else {
    current.count += 1;
    rateLimitStore.delete(clientIp);
    rateLimitStore.set(clientIp, current);
  }

  return rateLimitStore.get(clientIp)?.count > RATE_LIMIT_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = getResponseOrigin(req.headers.origin, allowedOrigins);

  res.setHeader("Vary", "Origin");
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    if (!isAllowedRequestSource(req, allowedOrigins)) {
      return res.status(403).json({ error: "Forbidden request source" });
    }
    return res.status(204).end();
  }

  if (!isAllowedRequestSource(req, allowedOrigins)) {
    return res.status(403).json({ error: "Forbidden request source" });
  }

  if (isRateLimited(req)) {
    res.setHeader("Retry-After", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    return res.status(429).json({ error: "Too many requests" });
  }

  // Vercel rewrites 把 /api/:path* 的 :path* 部分放在 req.query.path 中
  // 例如 /api/databases/xxx/query → req.query.path = ["databases", "xxx", "query"]
  const pathParam = req.query.path;
  if (!pathParam) {
    return res.status(404).json({ error: "Not found. Usage: /api/{notion-api-path}" });
  }

  const allowedPathInfo = getAllowedPathInfo(pathParam);
  if (!allowedPathInfo) {
    return res.status(400).json({ error: "Unsupported Notion API path" });
  }

  if (!isAllowedMethodForPath(req.method, allowedPathInfo.kind)) {
    return res.status(405).json({ error: "Method not allowed for this path" });
  }

  const queryString = buildAllowedQueryString(req.query, allowedPathInfo.kind);
  if (queryString == null) {
    return res.status(400).json({ error: "Unsupported query parameters" });
  }

  const notionUrl = `${NOTION_BASE}/${allowedPathInfo.notionPath}${queryString}`;
  const notionToken = getNotionToken();
  if (!notionToken) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "NOTION_TOKEN is not configured" });
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
    };

    // 只有非 GET/HEAD 请求才发送 body
    if (!["GET", "HEAD"].includes(req.method) && req.body != null) {
      fetchOptions.body =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
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
