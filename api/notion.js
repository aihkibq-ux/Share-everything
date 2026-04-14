/**
 * Legacy Notion proxy endpoint.
 *
 * The app now serves blog content through semantic, first-party endpoints:
 *   - /api/posts-data
 *   - /api/post-data
 *
 * Keeping a public pass-through proxy makes it too easy to widen the public
 * surface area accidentally, so this endpoint is intentionally disabled.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.0000068.xyz",
  "https://0000068.xyz",
];

function getAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function parseOriginHeader(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  try {
    return new URL(value).origin;
  } catch {
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
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return res.status(410).json({
    error: "The generic Notion proxy is disabled. Use /api/posts-data or /api/post-data instead.",
  });
};
