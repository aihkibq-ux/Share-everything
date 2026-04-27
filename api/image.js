const dns = require("node:dns").promises;
const https = require("node:https");
const net = require("node:net");

const {
  rejectUnsupportedReadMethod,
  readQueryString,
  serializePublicError,
} = require("../server/public-content");

const IMAGE_PROXY_TIMEOUT_MS = 10_000;
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_PROXY_MAX_REDIRECTS = 4;
const IMAGE_PROXY_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
const IMAGE_PROXY_REQUEST_HEADERS = Object.freeze({
  Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
});
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",   // GCP metadata endpoint
  "metadata.google",            // GCP metadata alias
  "instance-data",              // AWS metadata alias
]);

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function parseIpv4Address(address) {
  if (net.isIP(address) !== 4) return null;
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function expandIpv4TailInIpv6Address(address) {
  if (!String(address).includes(".")) return address;

  const tailSeparatorIndex = address.lastIndexOf(":");
  if (tailSeparatorIndex < 0) return address;

  const ipv4Tail = address.slice(tailSeparatorIndex + 1);
  const octets = parseIpv4Address(ipv4Tail);
  if (!octets) return address;

  const highSegment = ((octets[0] << 8) | octets[1]).toString(16);
  const lowSegment = ((octets[2] << 8) | octets[3]).toString(16);
  return `${address.slice(0, tailSeparatorIndex)}:${highSegment}:${lowSegment}`;
}

function parseIpv6Segments(address) {
  const normalizedAddress = expandIpv4TailInIpv6Address(
    normalizeHostname(address).replace(/%.+$/, ""),
  );
  if (net.isIP(normalizedAddress) !== 6) return null;

  const parts = normalizedAddress.split("::");
  if (parts.length > 2) return null;

  const parsePart = (part) => (
    part
      ? part.split(":").map((segment) => Number.parseInt(segment || "0", 16))
      : []
  );
  const head = parsePart(parts[0]);
  const tail = parts.length === 2 ? parsePart(parts[1]) : [];
  if ([...head, ...tail].some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 0xffff)) {
    return null;
  }

  const missingSegments = 8 - head.length - tail.length;
  if (missingSegments < 0 || (parts.length === 1 && missingSegments !== 0)) {
    return null;
  }

  return [...head, ...Array(missingSegments).fill(0), ...tail];
}

function getIpv4AddressFromIpv6Tail(segments) {
  return [
    (segments[6] >> 8) & 0xff,
    segments[6] & 0xff,
    (segments[7] >> 8) & 0xff,
    segments[7] & 0xff,
  ].join(".");
}

function isBlockedIpv4Address(address) {
  const octets = parseIpv4Address(address);
  if (!octets) return false;

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isBlockedIpv6Address(address) {
  const segments = parseIpv6Segments(address);
  if (!segments) return false;

  const isUnspecified = segments.every((segment) => segment === 0);
  const isLoopback = segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;
  const isUniqueLocal = (segments[0] & 0xfe00) === 0xfc00;
  const isLinkLocal = (segments[0] & 0xffc0) === 0xfe80;
  const isMulticast = (segments[0] & 0xff00) === 0xff00;
  const isIpv4Mapped =
    segments.slice(0, 5).every((segment) => segment === 0) &&
    segments[5] === 0xffff;
  const isIpv4Compatible = segments.slice(0, 6).every((segment) => segment === 0);
  const isWellKnownNat64 =
    segments[0] === 0x0064 &&
    segments[1] === 0xff9b &&
    segments.slice(2, 6).every((segment) => segment === 0);
  const isLocalNat64 =
    segments[0] === 0x0064 &&
    segments[1] === 0xff9b &&
    segments[2] === 0x0001 &&
    segments.slice(3, 6).every((segment) => segment === 0);
  const is6to4 = segments[0] === 0x2002;

  if (isIpv4Mapped || isIpv4Compatible || isWellKnownNat64 || isLocalNat64) {
    return isBlockedIpv4Address(getIpv4AddressFromIpv6Tail(segments));
  }

  if (is6to4) {
    const embeddedIpv4 = [
      (segments[1] >> 8) & 0xff,
      segments[1] & 0xff,
      (segments[2] >> 8) & 0xff,
      segments[2] & 0xff,
    ].join(".");
    return isBlockedIpv4Address(embeddedIpv4);
  }

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast;
}

function isBlockedIpAddress(address) {
  const normalizedAddress = normalizeHostname(address);
  return isBlockedIpv4Address(normalizedAddress) || isBlockedIpv6Address(normalizedAddress);
}

function isBlockedImageHost(hostname) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) return true;
  if (PRIVATE_HOSTNAMES.has(normalizedHostname)) return true;
  if (normalizedHostname.endsWith(".local")) return true;
  return isBlockedIpAddress(normalizedHostname);
}

function getDnsLookup() {
  return typeof globalThis.__IMAGE_PROXY_DNS_LOOKUP__ === "function"
    ? globalThis.__IMAGE_PROXY_DNS_LOOKUP__
    : dns.lookup.bind(dns);
}

function getHttpsRequest() {
  return typeof globalThis.__IMAGE_PROXY_HTTPS_REQUEST__ === "function"
    ? globalThis.__IMAGE_PROXY_HTTPS_REQUEST__
    : https.request.bind(https);
}

function createImageProxyError(message, status, cause) {
  const error = new Error(message);
  error.status = status;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function normalizeResolvedAddressRecord(record) {
  const address = typeof record === "string" ? record : record?.address;
  const detectedFamily = typeof address === "string" ? net.isIP(address) : 0;
  const family = Number(typeof record === "string" ? detectedFamily : record?.family || detectedFamily);

  return typeof address === "string" && family > 0
    ? { address: normalizeHostname(address), family }
    : null;
}

async function resolvePublicImageHost(hostname) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw createImageProxyError("Image host is not allowed", 400);
  }

  const literalIpFamily = net.isIP(normalizedHostname);
  if (literalIpFamily) {
    if (isBlockedIpAddress(normalizedHostname)) {
      throw createImageProxyError("Image host resolves to a blocked address", 400);
    }

    return {
      hostname: normalizedHostname,
      address: normalizedHostname,
      family: literalIpFamily,
    };
  }

  let records;
  try {
    records = await getDnsLookup()(normalizedHostname, {
      all: true,
      verbatim: true,
    });
  } catch (error) {
    throw createImageProxyError("Image host could not be resolved", 400, error);
  }

  const addresses = (Array.isArray(records) ? records : [records])
    .map(normalizeResolvedAddressRecord)
    .filter(Boolean);

  if (addresses.length === 0 || addresses.some((record) => isBlockedIpAddress(record.address))) {
    throw createImageProxyError("Image host resolves to a blocked address", 400);
  }

  return {
    hostname: normalizedHostname,
    address: addresses[0].address,
    family: addresses[0].family,
  };
}

async function normalizeSourceUrl(src, baseUrl) {
  if (typeof src !== "string" || !src.trim()) return null;

  try {
    const parsed = baseUrl ? new URL(src.trim(), baseUrl) : new URL(src.trim());
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (isBlockedImageHost(parsed.hostname)) return null;
    const resolvedHost = await resolvePublicImageHost(parsed.hostname);
    parsed.hash = "";
    return {
      href: parsed.href,
      resolvedHost,
    };
  } catch (error) {
    return null;
  }
}

function isRedirectResponse(response) {
  return REDIRECT_STATUSES.has(Number(response?.status));
}

function createResponseHeaders(headers = {}) {
  const normalizedHeaders = new Map();
  Object.entries(headers).forEach(([key, value]) => {
    if (value == null) return;

    normalizedHeaders.set(
      String(key).toLowerCase(),
      Array.isArray(value) ? value.join(", ") : String(value),
    );
  });

  return {
    get(name) {
      return normalizedHeaders.get(String(name).toLowerCase()) || null;
    },
  };
}

function createAbortError() {
  const error = new Error("Image request aborted");
  error.name = "AbortError";
  return error;
}

function collectResponseBuffer(response, maxBytes, cleanup) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    }

    response.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;

      if (Number.isFinite(maxBytes) && totalBytes > maxBytes) {
        const error = createImageProxyError("Image is too large", 413);
        if (typeof response.destroy === "function") {
          response.destroy(error);
        }
        settle(reject, error);
        return;
      }

      chunks.push(buffer);
    });
    response.on("end", () => settle(resolve, Buffer.concat(chunks, totalBytes)));
    response.on("error", (error) => settle(reject, error));
  });
}

function createImageResponse(response, cleanup) {
  let bodyBufferPromise = null;

  function readBuffer(maxBytes = Number.POSITIVE_INFINITY) {
    if (!bodyBufferPromise) {
      bodyBufferPromise = collectResponseBuffer(response, maxBytes, cleanup);
    }

    return bodyBufferPromise;
  }

  return {
    ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
    status: Number(response.statusCode) || 0,
    headers: createResponseHeaders(response.headers),
    readBuffer,
    async arrayBuffer() {
      const buffer = await readBuffer();
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    discardBody() {
      if (typeof response.resume === "function") {
        response.on("end", cleanup);
        response.on("error", cleanup);
        response.resume();
        return;
      }

      cleanup();
    },
  };
}

function requestImage(source, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    let request = null;
    let response = null;
    let settled = false;
    const requestUrl = new URL(source.href);
    const cleanup = () => {
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onAbort = () => {
      const error = createAbortError();
      if (typeof response?.destroy === "function") {
        response.destroy(error);
      }
      if (typeof request?.destroy === "function") {
        request.destroy(error);
      }
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };

    signal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      request = getHttpsRequest()(requestUrl, {
        method: "GET",
        headers: IMAGE_PROXY_REQUEST_HEADERS,
        lookup(hostname, options, callback) {
          if (options?.all) {
            callback(null, [{
              address: source.resolvedHost.address,
              family: source.resolvedHost.family,
            }]);
            return;
          }

          callback(null, source.resolvedHost.address, source.resolvedHost.family);
        },
      }, (incomingResponse) => {
        response = incomingResponse;
        settled = true;
        resolve(createImageResponse(incomingResponse, cleanup));
      });
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }

    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    request.end();
  });
}

async function fetchImageResponse(source, { signal } = {}) {
  let currentSource = source;

  for (let redirectCount = 0; redirectCount <= IMAGE_PROXY_MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestImage(currentSource, { signal });

    if (!isRedirectResponse(response)) {
      return response;
    }

    const location = response.headers.get("location");
    response.discardBody?.();

    const nextSource = await normalizeSourceUrl(location, currentSource.href);
    if (!nextSource) {
      throw createImageProxyError("Image redirect target is not allowed", 400);
    }

    currentSource = nextSource;
  }

  throw createImageProxyError("Image redirected too many times", 508);
}

function isImageContentType(contentType) {
  return /^image\/[a-z0-9.+-]+/i.test(String(contentType || "").trim());
}

async function readBoundedImageBuffer(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > IMAGE_PROXY_MAX_BYTES) {
    response.discardBody?.();
    const error = new Error("Image is too large");
    error.status = 413;
    throw error;
  }

  if (typeof response.readBuffer === "function") {
    return response.readBuffer(IMAGE_PROXY_MAX_BYTES);
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

  const source = await normalizeSourceUrl(readQueryString(req.query.src));
  if (!source) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "Invalid image source" });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);

  try {
    const response = await fetchImageResponse(source, {
      signal: controller.signal,
    });

    if (!response.ok) {
      response.discardBody?.();
      const error = new Error(`Image request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!isImageContentType(contentType)) {
      response.discardBody?.();
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
