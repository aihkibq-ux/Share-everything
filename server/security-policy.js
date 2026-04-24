const crypto = require("node:crypto");

const DEFAULT_SCRIPT_SOURCE = "'self'";
const FRAME_ANCESTORS_DIRECTIVE = "frame-ancestors 'none'";

function normalizeNonce(scriptNonce) {
  return typeof scriptNonce === "string" ? scriptNonce.trim() : "";
}

function buildScriptSource(scriptNonce = "") {
  const nonce = normalizeNonce(scriptNonce);
  return nonce ? `${DEFAULT_SCRIPT_SOURCE} 'nonce-${nonce}'` : DEFAULT_SCRIPT_SOURCE;
}

function buildContentSecurityPolicy({ scriptNonce = "", includeFrameAncestors = true } = {}) {
  const scriptSource = buildScriptSource(scriptNonce);
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    `script-src-elem ${scriptSource}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.cn",
    "img-src 'self' https: data: blob:",
    "font-src 'self' https://fonts.gstatic.cn data:",
    "connect-src 'self'",
    "frame-src 'self' https:",
    "media-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
  ];

  if (includeFrameAncestors) {
    directives.push(FRAME_ANCESTORS_DIRECTIVE);
  }

  return directives.join("; ");
}

function buildStaticContentSecurityPolicy() {
  return buildContentSecurityPolicy({ includeFrameAncestors: false });
}

function createCspNonce() {
  return crypto.randomBytes(16).toString("base64");
}

function applyHtmlSecurityHeaders(res, options = {}) {
  res.setHeader("Content-Security-Policy", buildContentSecurityPolicy(options));
  res.setHeader("X-Frame-Options", "DENY");
}

module.exports = {
  FRAME_ANCESTORS_DIRECTIVE,
  applyHtmlSecurityHeaders,
  buildContentSecurityPolicy,
  buildScriptSource,
  buildStaticContentSecurityPolicy,
  createCspNonce,
};
