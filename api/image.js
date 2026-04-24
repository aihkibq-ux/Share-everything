const {
  rejectUnsupportedReadMethod,
  readQueryString,
  serializePublicError,
} = require("../server/public-content");

const IMAGE_PROXY_TIMEOUT_MS = 10_000;
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_PROXY_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

function isBlockedImageHost(hostname) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  if (!normalizedHostname) return true;
  if (normalizedHostname.endsWith(".local")) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalizedHostname));
}

function normalizeSourceUrl(src) {
  if (typeof src !== "string" || !src.trim()) return null;

  try {
    const parsed = new URL(src.trim());
    if (parsed.protocol !== "https:") return null;
    if (isBlockedImageHost(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function isImageContentType(contentType) {
  return /^image\/[a-z0-9.+-]+/i.test(String(contentType || "").trim());
}

async function readBoundedImageBuffer(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > IMAGE_PROXY_MAX_BYTES) {
    const error = new Error("Image is too large");
    error.status = 413;
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > IMAGE_PROXY_MAX_BYTES) {
    const error = new Error("Image is too large");
    error.status = 413;
    throw error;
  }

  return Buffer.from(arrayBuffer);
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedReadMethod(req, res)) {
    return undefined;
  }

  const sourceUrl = normalizeSourceUrl(readQueryString(req.query.src));
  if (!sourceUrl) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "Invalid image source" });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`Image request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!isImageContentType(contentType)) {
      const error = new Error("Upstream response is not an image");
      error.status = 415;
      throw error;
    }

    const body = await readBoundedImageBuffer(response);
    res.setHeader("Cache-Control", IMAGE_PROXY_CACHE_CONTROL);
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(body);
  } catch (error) {
    const status = Number(error?.status) || (error?.name === "AbortError" ? 504 : 502);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json(
      serializePublicError(error, status === 413 ? "Image too large" : "Image unavailable"),
    );
  } finally {
    clearTimeout(timeoutId);
  }
};
