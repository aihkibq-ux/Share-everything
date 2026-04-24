function readQueryString(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

function readPositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(readQueryString(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRetryAfter(error) {
  const rawValue = Array.isArray(error?.retryAfter) ? error.retryAfter[0] : error?.retryAfter;
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

function applyPublicErrorHeaders(res, error) {
  const retryAfter = readRetryAfter(error);
  if (retryAfter) {
    res.setHeader("Retry-After", retryAfter);
  }
}

function rejectUnsupportedReadMethod(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    return false;
  }

  res.setHeader("Allow", "GET, HEAD");
  res.setHeader("Cache-Control", "no-store");
  res.status(405).json({ error: "Method not allowed" });
  return true;
}

function readErrorDetail(error) {
  const rawValue = Array.isArray(error?.detail) ? error.detail[0] : error?.detail;
  if (typeof rawValue === "string" && rawValue.trim()) {
    return rawValue.trim();
  }

  return typeof error?.message === "string" ? error.message.trim() : "";
}

function readNotionResourceType(error) {
  const rawValue = Array.isArray(error?.resourceType) ? error.resourceType[0] : error?.resourceType;
  return typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
}

function getNormalizedErrorDetail(error) {
  return readErrorDetail(error).toLowerCase();
}

function serializePublicError(error, fallbackError) {
  const payload = {
    error: fallbackError,
  };
  const detail = readErrorDetail(error);

  if (typeof error?.code === "string" && error.code) {
    payload.code = error.code;
  }

  if (typeof error?.notionCode === "string" && error.notionCode) {
    payload.notionCode = error.notionCode;
  }

  if (detail) {
    payload.detail = detail;
  }

  return payload;
}

function isPublicContentConfigError(error) {
  return (
    error?.code === "notion_config_error" ||
    error?.code === "notion_public_config_error"
  );
}

function isUpstreamAuthOrPermissionError(error) {
  const status = Number(error?.status);
  return (
    status === 401 ||
    status === 403 ||
    error?.notionCode === "unauthorized" ||
    error?.notionCode === "restricted_resource"
  );
}

function isUpstreamObjectNotFoundError(error) {
  return (
    Number(error?.status) === 404 &&
    error?.notionCode === "object_not_found"
  );
}

function hasDatabaseErrorContext(error) {
  const resourceType = readNotionResourceType(error);
  if (resourceType) {
    return resourceType === "database";
  }

  return getNormalizedErrorDetail(error).includes("database");
}

function isUpstreamDatabaseReferenceError(error) {
  const status = Number(error?.status);
  return (
    hasDatabaseErrorContext(error) &&
    (
      status === 404 ||
      (status === 400 && error?.notionCode === "validation_error")
    )
  );
}

function getPublicContentErrorStatus(error) {
  const status = Number(error?.status);

  if (
    (status === 500 && isPublicContentConfigError(error)) ||
    isUpstreamAuthOrPermissionError(error) ||
    isUpstreamObjectNotFoundError(error) ||
    isUpstreamDatabaseReferenceError(error)
  ) {
    return 500;
  }

  if (status === 429 || error?.notionCode === "rate_limited") {
    return 429;
  }

  if (status === 504 || error?.code === "notion_timeout_error") {
    return 504;
  }

  return 502;
}

function isMissingPublicPostError(error) {
  const status = Number(error?.status);
  if (error?.code === "notion_page_not_public") {
    return true;
  }

  if (isUpstreamDatabaseReferenceError(error)) {
    return false;
  }

  return (
    isUpstreamObjectNotFoundError(error) ||
    status === 404 ||
    (status === 400 && error?.notionCode === "validation_error")
  );
}

function getPublicPostErrorStatus(error) {
  if (isMissingPublicPostError(error)) {
    return 404;
  }

  return getPublicContentErrorStatus(error);
}

module.exports = {
  applyPublicErrorHeaders,
  getPublicContentErrorStatus,
  getPublicPostErrorStatus,
  rejectUnsupportedReadMethod,
  readPositiveInteger,
  readQueryString,
  serializePublicError,
};
