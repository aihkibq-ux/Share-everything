const {
  DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES,
  escapeHtml,
  getCategoryColor,
  mapNotionBlock,
  mapNotionPage,
  renderPostArticle,
  renderBlocks,
  resolveNotionContentSchema,
  resolveShareImageUrl,
} = require("../js/notion-content");

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_BLOCK_RECURSION_DEPTH = 10;
const DEFAULT_SITE_ORIGIN = process.env.SITE_URL || "https://www.0000068.xyz";
const DEFAULT_POST_PAGE_SIZE = 9;
const DATABASE_METADATA_TTL_MS = Number(process.env.DATABASE_METADATA_TTL_MS || 300_000);
const PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS = Number(process.env.PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS || 15_000);
const NOTION_REQUEST_TIMEOUT_MS = Number(process.env.NOTION_REQUEST_TIMEOUT_MS || 12_000);
const NOTION_BLOCK_CHILD_CONCURRENCY = Number(process.env.NOTION_BLOCK_CHILD_CONCURRENCY || 4);
const DEFAULT_PUBLIC_STATUS_VALUES = ["Published", "Public", "Live", "公开", "已发布"];
const DEFAULT_PUBLIC_STATUS_FALLBACK_VALUES = [
  ...DEFAULT_PUBLIC_STATUS_VALUES,
  "Done",
  "Complete",
  "Completed",
  "Finished",
  "Visible",
  "Online",
  "上线",
  "已上线",
  "完成",
  "已完成",
  "可见",
];
const DEFAULT_PUBLIC_STATUS_GROUP_NAMES = [
  "Complete",
  "Completed",
  "Done",
  "Published",
  "Public",
  "Live",
  "上线",
  "已上线",
  "完成",
  "已完成",
  "公开",
  "已发布",
];
const ALL_CATEGORY = "\u5168\u90e8";
const CONTENT_PROPERTY_ENV_NAMES = Object.freeze({
  title: ["NOTION_TITLE_PROPERTY_NAMES", "NOTION_TITLE_PROPERTY_NAME"],
  excerpt: ["NOTION_EXCERPT_PROPERTY_NAMES", "NOTION_EXCERPT_PROPERTY_NAME"],
  readTime: ["NOTION_READ_TIME_PROPERTY_NAMES", "NOTION_READ_TIME_PROPERTY_NAME"],
  tags: ["NOTION_TAGS_PROPERTY_NAMES", "NOTION_TAGS_PROPERTY_NAME"],
  category: ["NOTION_CATEGORY_PROPERTY_NAMES", "NOTION_CATEGORY_PROPERTY_NAME"],
  date: ["NOTION_DATE_PROPERTY_NAMES", "NOTION_DATE_PROPERTY_NAME"],
});
let databaseMetadataCache = null;
let databaseMetadataPromise = null;
let publicPageSummaryCache = null;
let publicPageSummaryPromise = null;

function readCsvEnv(names, defaults = []) {
  const keys = Array.isArray(names) ? names : [names];

  for (const key of keys) {
    const rawValue = process.env[key];
    if (typeof rawValue !== "string") {
      continue;
    }

    const values = rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (values.length > 0) {
      return values;
    }
  }

  return Array.isArray(defaults) ? defaults.slice() : [];
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeNotionId(value) {
  return typeof value === "string" ? value.replace(/-/g, "").toLowerCase() : "";
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createAsyncLimiter(limit) {
  const safeLimit = Math.max(1, Math.trunc(normalizePositiveNumber(limit, 1)));
  let activeCount = 0;
  const pendingResolvers = [];

  return async function runWithLimit(task) {
    if (activeCount >= safeLimit) {
      await new Promise((resolve) => {
        pendingResolvers.push(resolve);
      });
    }

    activeCount += 1;

    try {
      return await task();
    } finally {
      activeCount -= 1;
      const next = pendingResolvers.shift();
      if (next) {
        next();
      }
    }
  };
}

const runWithBlockChildConcurrency = createAsyncLimiter(NOTION_BLOCK_CHILD_CONCURRENCY);

function getNotionToken() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw createNotionRequestError("NOTION_TOKEN is not configured", {
      status: 500,
      code: "notion_config_error",
    });
  }
  return token;
}

function getDatabaseId() {
  const id = process.env.NOTION_DATABASE_ID;
  if (!id) {
    throw createNotionRequestError("NOTION_DATABASE_ID is not configured", {
      status: 500,
      code: "notion_config_error",
    });
  }
  return id;
}

function getSiteOrigin() {
  return DEFAULT_SITE_ORIGIN.replace(/\/+$/, "");
}

function createNotionRequestError(message, {
  status = 500,
  code = "notion_request_error",
  notionCode = "",
  detail = "",
  retryAfter = "",
  cause,
} = {}) {
  const error = new Error(message);
  error.name = "NotionRequestError";
  error.status = status;
  error.code = code;
  error.notionCode = notionCode;
  error.detail = detail;
  error.retryAfter = retryAfter;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function createPublicAccessConfigError(message, detail = "") {
  return createNotionRequestError(message, {
    status: 500,
    code: "notion_public_config_error",
    detail,
  });
}

function getExplicitPublicStatusValues() {
  return readCsvEnv("NOTION_PUBLIC_STATUS_VALUES", []);
}

async function requestNotionJson(path, init = {}) {
  const notionToken = getNotionToken();

  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), normalizePositiveNumber(NOTION_REQUEST_TIMEOUT_MS, 12_000));

  try {
    response = await fetch(`${NOTION_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createNotionRequestError("Notion API request timed out", {
        status: 504,
        code: "notion_timeout_error",
        cause: error,
      });
    }

    throw createNotionRequestError("Failed to reach Notion API", {
      status: 502,
      code: "notion_network_error",
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const rawDetail = await response.text().catch(() => "");
    let detail = rawDetail;
    let notionCode = "";
    const retryAfter = response.headers.get("retry-after") || "";

    if (rawDetail) {
      try {
        const parsedDetail = JSON.parse(rawDetail);
        if (typeof parsedDetail?.message === "string" && parsedDetail.message) {
          detail = parsedDetail.message;
        }
        if (typeof parsedDetail?.code === "string" && parsedDetail.code) {
          notionCode = parsedDetail.code;
        }
      } catch {
        // Keep the raw response body when it is not JSON.
      }
    }

    throw createNotionRequestError(`Notion API error: ${response.status}${detail ? ` ${detail}` : ""}`, {
      status: response.status,
      code: "notion_api_error",
      notionCode,
      detail: detail || rawDetail,
      retryAfter,
    });
  }

  return response.json();
}

function getCachedDatabaseMetadata() {
  if (!databaseMetadataCache) {
    return null;
  }

  if (Date.now() >= databaseMetadataCache.expiresAt) {
    databaseMetadataCache = null;
    return null;
  }

  return databaseMetadataCache;
}

function getCachedPublicPageSummaries() {
  if (!publicPageSummaryCache) {
    return null;
  }

  if (Date.now() >= publicPageSummaryCache.expiresAt) {
    publicPageSummaryCache = null;
    return null;
  }

  return publicPageSummaryCache;
}

function findPropertyEntriesByCandidates(properties, candidates) {
  const entries = Object.values(properties || {});
  const normalizedCandidates = candidates.map(normalizeName).filter(Boolean);
  const seenEntries = new Set();
  const matches = [];

  normalizedCandidates.forEach((candidate) => {
    entries.forEach((entry) => {
      const entryName = normalizeName(entry?.name);
      const entryId = normalizeName(entry?.id);
      if (candidate !== entryName && candidate !== entryId) {
        return;
      }

      const entryKey = normalizeName(entry?.id || entry?.name);
      if (!entryKey || seenEntries.has(entryKey)) {
        return;
      }

      seenEntries.add(entryKey);
      matches.push({ entry, candidate });
    });
  });

  return matches;
}

function getPropertySchemaOptions(entry) {
  if (entry?.type === "status") {
    return Array.isArray(entry?.status?.options) ? entry.status.options : [];
  }

  if (entry?.type === "select") {
    return Array.isArray(entry?.select?.options) ? entry.select.options : [];
  }

  return [];
}

function getPropertySchemaOptionNames(entry) {
  const seen = new Set();

  return getPropertySchemaOptions(entry)
    .map((option) => (typeof option?.name === "string" ? option.name.trim() : ""))
    .filter((name) => {
      const normalized = normalizeName(name);
      if (!normalized || seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
}

function matchPropertySchemaOptionNames(entry, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizeName).filter(Boolean));
  if (normalizedCandidates.size === 0) {
    return [];
  }

  return getPropertySchemaOptionNames(entry)
    .filter((name) => normalizedCandidates.has(normalizeName(name)));
}

function getStatusGroupBackedOptionNames(entry, groupCandidates = DEFAULT_PUBLIC_STATUS_GROUP_NAMES) {
  if (entry?.type !== "status") {
    return [];
  }

  const optionNameById = new Map(
    getPropertySchemaOptions(entry)
      .map((option) => [
        normalizeName(option?.id),
        typeof option?.name === "string" ? option.name.trim() : "",
      ])
      .filter(([id, name]) => Boolean(id && name)),
  );
  const normalizedGroupCandidates = new Set(groupCandidates.map(normalizeName).filter(Boolean));
  const groups = Array.isArray(entry?.status?.groups) ? entry.status.groups : [];
  const matchedGroups = groups.filter((group) => normalizedGroupCandidates.has(normalizeName(group?.name)));

  if (matchedGroups.length !== 1) {
    return [];
  }

  const seen = new Set();
  return (Array.isArray(matchedGroups[0]?.option_ids) ? matchedGroups[0].option_ids : [])
    .map((optionId) => optionNameById.get(normalizeName(optionId)) || "")
    .filter((name) => {
      const normalized = normalizeName(name);
      if (!normalized || seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
}

function resolvePublicStatusValuesForProperty(entry) {
  if (entry?.type === "checkbox") {
    return [];
  }

  if (!["status", "select"].includes(entry?.type)) {
    throw createPublicAccessConfigError(
      `Unsupported public visibility property type "${entry?.type}"`,
      "Supported types: checkbox, status, select",
    );
  }

  const explicitStatusValues = getExplicitPublicStatusValues();
  const configuredStatusValues = explicitStatusValues.length > 0
    ? explicitStatusValues
    : DEFAULT_PUBLIC_STATUS_VALUES;
  const directMatches = matchPropertySchemaOptionNames(entry, configuredStatusValues);
  if (directMatches.length > 0) {
    return directMatches;
  }

  const schemaOptionNames = getPropertySchemaOptionNames(entry);
  if (explicitStatusValues.length > 0) {
    throw createPublicAccessConfigError(
      `Configured public visibility values do not match "${entry.name}"`,
      schemaOptionNames.length > 0
        ? `Set NOTION_PUBLIC_STATUS_VALUES to one of: ${schemaOptionNames.join(", ")}`
        : `Property "${entry.name}" does not expose selectable status values.`,
    );
  }

  const fallbackMatches = matchPropertySchemaOptionNames(entry, DEFAULT_PUBLIC_STATUS_FALLBACK_VALUES);
  if (fallbackMatches.length > 0) {
    return fallbackMatches;
  }

  const groupBackedMatches = getStatusGroupBackedOptionNames(entry);
  if (groupBackedMatches.length > 0) {
    return groupBackedMatches;
  }

  throw createPublicAccessConfigError(
    `Notion public visibility values are not configured for "${entry.name}"`,
    schemaOptionNames.length > 0
      ? `Set NOTION_PUBLIC_STATUS_VALUES to one of: ${schemaOptionNames.join(", ")}`
      : `Property "${entry.name}" does not expose selectable status values.`,
  );
}

function buildMatchAnyPropertyFilter(propertyName, propertyType, allowedValues) {
  if (propertyType === "checkbox") {
    return {
      property: propertyName,
      checkbox: { equals: true },
    };
  }

  const values = allowedValues.map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    throw createPublicAccessConfigError(
      `Public visibility property "${propertyName}" requires at least one allowed status value`,
    );
  }

  if (!["status", "select"].includes(propertyType)) {
    throw createPublicAccessConfigError(
      `Unsupported public visibility property type "${propertyType}"`,
      "Supported types: checkbox, status, select",
    );
  }

  const operator = propertyType === "status" ? "status" : "select";
  if (values.length === 1) {
    return {
      property: propertyName,
      [operator]: { equals: values[0] },
    };
  }

  return {
    or: values.map((value) => ({
      property: propertyName,
      [operator]: { equals: value },
    })),
  };
}

function combineDatabaseFilters(filters) {
  const activeFilters = filters.filter(Boolean);
  if (activeFilters.length === 0) {
    return null;
  }
  if (activeFilters.length === 1) {
    return activeFilters[0];
  }
  return {
    and: activeFilters,
  };
}

function getContentPropertyCandidates(field) {
  return readCsvEnv(
    CONTENT_PROPERTY_ENV_NAMES[field] || [],
    DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES[field] || [],
  );
}

function buildContentSchema(database) {
  const candidateOverrides = {};
  Object.keys(DEFAULT_NOTION_CONTENT_PROPERTY_CANDIDATES).forEach((field) => {
    candidateOverrides[field] = getContentPropertyCandidates(field);
  });

  return resolveNotionContentSchema(database, candidateOverrides);
}

function buildDatabaseSorts(schema) {
  if (schema?.date?.name && schema.date.type === "date") {
    return [{
      property: schema.date.name,
      direction: "descending",
    }];
  }

  return null;
}

function sortPostsByDateDesc(posts) {
  return posts.slice().sort((left, right) => {
    const leftTimestamp = Date.parse(left?.date || "");
    const rightTimestamp = Date.parse(right?.date || "");
    const safeLeftTimestamp = Number.isFinite(leftTimestamp) ? leftTimestamp : 0;
    const safeRightTimestamp = Number.isFinite(rightTimestamp) ? rightTimestamp : 0;
    return safeRightTimestamp - safeLeftTimestamp;
  });
}

function buildCategoryFilter(category, schema) {
  const normalizedCategory = typeof category === "string" ? category.trim() : "";
  if (!normalizedCategory || normalizedCategory === ALL_CATEGORY) {
    return null;
  }

  if (!schema?.category?.name || schema.category.type !== "select") {
    return null;
  }

  return {
    property: schema.category.name,
    select: { equals: normalizedCategory },
  };
}

function buildDatabaseWidePublicAccessPolicy() {
  return {
    propertyName: "",
    propertyType: "database",
    allowedStatusValues: [],
    filter: null,
  };
}

function buildPublicAccessPolicyFromDatabase(database) {
  const explicitPropertyCandidates = readCsvEnv(
    ["NOTION_PUBLIC_PROPERTY_NAMES", "NOTION_PUBLIC_PROPERTY_NAME"],
    [],
  );

  if (explicitPropertyCandidates.length === 0) {
    return buildDatabaseWidePublicAccessPolicy();
  }

  const propertyCandidates = explicitPropertyCandidates;
  const propertyMatches = findPropertyEntriesByCandidates(
    database?.properties,
    propertyCandidates,
  );

  if (propertyMatches.length > 1) {
    const matchSummary = propertyMatches
      .map(({ entry, candidate }) => `${entry.name} (matched by ${candidate})`)
      .join(", ");

    throw createPublicAccessConfigError(
      "Ambiguous Notion public visibility property configuration",
      `Matched multiple properties: ${matchSummary}. Set NOTION_PUBLIC_PROPERTY_NAME to exactly one property.`,
    );
  }

  let propertyEntry = propertyMatches[0]?.entry || null;

  if (!propertyEntry?.name || !propertyEntry?.type) {
    throw createPublicAccessConfigError(
      "Notion public visibility property is not configured",
      `Set NOTION_PUBLIC_PROPERTY_NAME(S) to one of: ${propertyCandidates.join(", ")}`,
    );
  }

  const allowedStatusValues = resolvePublicStatusValuesForProperty(propertyEntry);

  return {
    propertyName: propertyEntry.name,
    propertyType: propertyEntry.type,
    allowedStatusValues,
    filter: buildMatchAnyPropertyFilter(propertyEntry.name, propertyEntry.type, allowedStatusValues),
  };
}

async function getDatabaseMetadata() {
  const cached = getCachedDatabaseMetadata();
  if (cached?.publicAccessPolicy) {
    return cached;
  }

  if (!databaseMetadataPromise) {
    databaseMetadataPromise = (async () => {
      const database = await requestNotionJson(`/databases/${getDatabaseId()}`);
      const publicAccessPolicy = buildPublicAccessPolicyFromDatabase(database);
      const contentSchema = buildContentSchema(database);
      const nextMetadata = {
        database,
        contentSchema,
        publicAccessPolicy,
        expiresAt: Date.now() + DATABASE_METADATA_TTL_MS,
      };
      databaseMetadataCache = nextMetadata;
      return nextMetadata;
    })().finally(() => {
      databaseMetadataPromise = null;
    });
  }

  return databaseMetadataPromise;
}

async function queryDatabasePages({ filter, schema = null } = {}) {
  const databaseId = getDatabaseId();
  const pages = [];
  let startCursor = null;
  const sorts = buildDatabaseSorts(schema);

  do {
    const body = {
      page_size: 100,
    };
    if (sorts) {
      body.sorts = sorts;
    }
    if (filter) {
      body.filter = filter;
    }
    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const data = await requestNotionJson(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    pages.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);

  const mappedPages = pages.map((page) => mapNotionPage(page, { schema }));
  return sorts ? mappedPages : sortPostsByDateDesc(mappedPages);
}

function filterPostsByCategory(posts, category) {
  if (!category || category === ALL_CATEGORY) {
    return posts.slice();
  }

  return posts.filter((post) => post.category === category);
}

function filterPostsBySearch(posts, search) {
  const normalizedSearch = typeof search === "string" ? search.trim().toLowerCase() : "";
  if (!normalizedSearch) {
    return posts.slice();
  }

  return posts.filter((post) => buildPostSearchText(post).includes(normalizedSearch));
}

function applyPostFilters(posts, { category = "", search = "" } = {}) {
  return filterPostsBySearch(
    filterPostsByCategory(posts, category),
    search,
  );
}

function normalizePostQueryFilters({ category = "", search = "" } = {}) {
  return {
    category: typeof category === "string" ? category.trim() : "",
    search: typeof search === "string" ? search.trim() : "",
  };
}

function hasPostQueryFilters(filters) {
  return Boolean(filters?.category || filters?.search);
}

async function getPublicPageSummaries() {
  const cacheTtlMs = normalizeNonNegativeNumber(PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS, 15_000);
  if (cacheTtlMs > 0) {
    const cached = getCachedPublicPageSummaries();
    if (cached?.pages) {
      return cached.pages;
    }
  }

  if (!publicPageSummaryPromise) {
    publicPageSummaryPromise = (async () => {
      const metadata = await getDatabaseMetadata();
      const pages = await queryDatabasePages({
        filter: metadata.publicAccessPolicy.filter,
        schema: metadata.contentSchema,
      });

      if (cacheTtlMs > 0) {
        publicPageSummaryCache = {
          pages,
          expiresAt: Date.now() + cacheTtlMs,
        };
      } else {
        publicPageSummaryCache = null;
      }

      return pages;
    })().finally(() => {
      publicPageSummaryPromise = null;
    });
  }

  return publicPageSummaryPromise;
}

async function loadPublicPagesForQuery(filters) {
  const cachedSummaries = getCachedPublicPageSummaries()?.pages;
  if (cachedSummaries) {
    return cachedSummaries;
  }

  if (!hasPostQueryFilters(filters)) {
    return getPublicPageSummaries();
  }

  const metadata = await getDatabaseMetadata();
  const categoryFilter = buildCategoryFilter(filters.category, metadata.contentSchema);
  if (!categoryFilter) {
    return getPublicPageSummaries();
  }

  return queryDatabasePages({
    filter: combineDatabaseFilters([
      metadata.publicAccessPolicy.filter,
      categoryFilter,
    ]),
    schema: metadata.contentSchema,
  });
}

async function queryPublicPages(query = {}) {
  const filters = normalizePostQueryFilters(query);
  const pages = await loadPublicPagesForQuery(filters);
  return applyPostFilters(pages, filters);
}

function isPageInPublicDatabase(page) {
  return normalizeNotionId(page?.parent?.database_id) === normalizeNotionId(getDatabaseId());
}

function isPagePublicByPolicy(page, publicAccessPolicy) {
  if (publicAccessPolicy?.propertyType === "database") {
    return true;
  }

  const property = page?.properties?.[publicAccessPolicy.propertyName];
  const normalizedAllowedValues = publicAccessPolicy.allowedStatusValues.map(normalizeName);

  if (publicAccessPolicy.propertyType === "checkbox") {
    return property?.checkbox === true;
  }

  if (publicAccessPolicy.propertyType === "status") {
    return normalizedAllowedValues.includes(normalizeName(property?.status?.name));
  }

  if (publicAccessPolicy.propertyType === "select") {
    return normalizedAllowedValues.includes(normalizeName(property?.select?.name));
  }

  return false;
}

function assertPublicPage(page, publicAccessPolicy) {
  if (isPageInPublicDatabase(page) && isPagePublicByPolicy(page, publicAccessPolicy)) {
    return page;
  }

  throw createNotionRequestError("Notion page is not public", {
    status: 404,
    code: "notion_page_not_public",
  });
}

function buildPostSearchText(post) {
  return [
    post?.title || "",
    post?.excerpt || "",
    ...(Array.isArray(post?.tags) ? post.tags : []),
  ].join(" ").toLowerCase();
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function queryPublicPosts({
  category = "",
  search = "",
  page = 1,
  pageSize = DEFAULT_POST_PAGE_SIZE,
} = {}) {
  const results = await queryPublicPages({ category, search });

  const safePageSize = Math.max(
    1,
    Math.min(normalizePositiveInteger(pageSize, DEFAULT_POST_PAGE_SIZE), 100),
  );
  const total = results.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.max(1, Math.min(normalizePositiveInteger(page, 1), totalPages));
  const sliceStart = (currentPage - 1) * safePageSize;

  return {
    results: results.slice(sliceStart, sliceStart + safePageSize),
    total,
    totalPages,
    currentPage,
  };
}

async function fetchAllBlockChildren(blockId, depth = 0) {
  if (depth >= MAX_BLOCK_RECURSION_DEPTH) {
    console.warn(
      `Block children recursion reached max depth (${MAX_BLOCK_RECURSION_DEPTH}), ` +
      `stopping for block: ${blockId}`,
    );
    return [];
  }

  const blocks = [];
  let startCursor = null;

  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (startCursor) {
      query.set("start_cursor", startCursor);
    }

    const data = await runWithBlockChildConcurrency(() => (
      requestNotionJson(`/blocks/${blockId}/children?${query.toString()}`)
    ));
    blocks.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);

  await Promise.all(
    blocks.map(async (block) => {
      if (!block?.has_children) return;
      block.children = await fetchAllBlockChildren(block.id, depth + 1);
    }),
  );

  return blocks;
}

function buildPostPayload(summary, blocks) {
  const baseOrigin = getSiteOrigin();
  const mapped = blocks
    .map((block) => mapNotionBlock(block, { baseOrigin }))
    .filter(Boolean);

  return {
    ...summary,
    content: mapped,
  };
}

function renderPostContent(postOrBlocks, { baseOrigin = getSiteOrigin() } = {}) {
  const content = Array.isArray(postOrBlocks)
    ? postOrBlocks
    : Array.isArray(postOrBlocks?.content)
      ? postOrBlocks.content
      : [];

  return renderBlocks(content, { baseOrigin });
}

async function fetchPublicPost(pageId) {
  const [page, metadata] = await Promise.all([
    requestNotionJson(`/pages/${pageId}`),
    getDatabaseMetadata(),
  ]);
  const summary = mapNotionPage(assertPublicPage(page, metadata.publicAccessPolicy), {
    schema: metadata.contentSchema,
  });
  const blocks = await fetchAllBlockChildren(pageId);
  return buildPostPayload(summary, blocks);
}

function buildPostUrl(pageId) {
  return `${getSiteOrigin()}/posts/${encodeURIComponent(pageId)}`;
}

function buildArticleStructuredData(post) {
  const canonicalUrl = buildPostUrl(post.id);
  const defaultShareImageUrl = `${getSiteOrigin()}/favicon.png?v=2`;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || post.title,
    articleSection: post.category || undefined,
    keywords: Array.isArray(post.tags) && post.tags.length > 0 ? post.tags.join(", ") : undefined,
    datePublished: post.date || undefined,
    dateModified: post.date || undefined,
    image: [resolveShareImageUrl(post.coverImage, defaultShareImageUrl, getSiteOrigin())],
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    author: {
      "@type": "Organization",
      name: "Share Everything",
    },
    publisher: {
      "@type": "Organization",
      name: "Share Everything",
      logo: {
        "@type": "ImageObject",
        url: defaultShareImageUrl,
      },
    },
  };
}

module.exports = {
  buildArticleStructuredData,
  buildPostUrl,
  escapeHtml,
  fetchPublicPost,
  getDatabaseId,
  getCategoryColor,
  getSiteOrigin,
  queryPublicPages,
  queryPublicPosts,
  renderPostArticle,
  renderPostContent,
  resolveShareImageUrl,
};
