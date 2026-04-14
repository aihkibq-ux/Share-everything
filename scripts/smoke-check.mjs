import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { notionBlockFixtures } from "./fixtures/notion-block-fixtures.mjs";

const root = new URL("../", import.meta.url);
const FIXTURE_BASE_ORIGIN = "https://example.com";

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function checkSyntax(relativePath) {
  new vm.Script(read(relativePath), {
    filename: relativePath,
  });
}

function loadCommonJsModule(relativePath, exportedNames = []) {
  const filename = fileURLToPath(new URL(relativePath, root));
  const module = { exports: {} };
  const appendedExports = exportedNames.length > 0
    ? `\nmodule.exports.__test = { ${exportedNames.join(", ")} };`
    : "";

  vm.runInNewContext(`${read(relativePath)}${appendedExports}`, {
    module,
    exports: module.exports,
    require: createRequire(new URL(relativePath, root)),
    __dirname: fileURLToPath(new URL(".", new URL(relativePath, root))),
    __filename: filename,
    process,
    console,
    Buffer,
    AbortController,
    URL,
    URLSearchParams,
    fetch,
    setTimeout,
    clearTimeout,
  }, {
    filename,
  });

  return module.exports;
}

function withEnvOverrides(overrides, callback) {
  const entries = Object.entries(overrides);
  const previousValues = new Map(
    entries.map(([key]) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]),
  );

  try {
    entries.forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
        return;
      }

      process.env[key] = String(value);
    });

    return callback();
  } finally {
    previousValues.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  }
}

function createClassList(initialTokens = []) {
  const tokens = new Set(initialTokens);

  return {
    add: (...nextTokens) => nextTokens.forEach((token) => tokens.add(token)),
    remove: (...nextTokens) => nextTokens.forEach((token) => tokens.delete(token)),
    toggle(token, force) {
      if (force === true) {
        tokens.add(token);
        return true;
      }
      if (force === false) {
        tokens.delete(token);
        return false;
      }
      if (tokens.has(token)) {
        tokens.delete(token);
        return false;
      }
      tokens.add(token);
      return true;
    },
    contains: (token) => tokens.has(token),
  };
}

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.classList = createClassList();
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners.get(type) === handler) {
      this.listeners.delete(type);
    }
  }

  dispatch(type, event = {}) {
    const handler = this.listeners.get(type);
    if (typeof handler === "function") {
      return handler(event);
    }

    return undefined;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  contains() {
    return true;
  }
}

function createStorageMock(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function loadBrowserScript(relativePath, overrides = {}) {
  const filename = fileURLToPath(new URL(relativePath, root));
  const windowObject = {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    ...overrides.window,
  };
  const documentObject = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    ...overrides.document,
  };
  const localStorage = overrides.localStorage || createStorageMock();
  const sessionStorage = overrides.sessionStorage || createStorageMock();

  const sandbox = {
    window: windowObject,
    document: documentObject,
    localStorage,
    sessionStorage,
    history: windowObject.history,
    location: windowObject.location,
    console,
    JSON,
    Date,
    URL,
    URLSearchParams,
    Promise,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: windowObject.requestAnimationFrame,
    cancelAnimationFrame: windowObject.cancelAnimationFrame,
  };

  sandbox.globalThis = sandbox;
  windowObject.window = windowObject;
  windowObject.document = documentObject;

  vm.runInNewContext(read(relativePath), sandbox, {
    filename,
  });

  return {
    window: windowObject,
    document: documentObject,
    localStorage,
    sessionStorage,
  };
}

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

function expectNotIncludes(source, needle, message) {
  assert.ok(!source.includes(needle), message);
}

function normalizeHtml(source) {
  return String(source || "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function getValueAtPath(target, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, segment) => {
      if (value == null) {
        return value;
      }

      return value[segment];
    }, target);
}

function runNotionBlockFixture(fixture) {
  const mappedBlocks = fixture.rawBlocks.map((block) => notionContentHelpers.mapNotionBlock(block, {
    baseOrigin: FIXTURE_BASE_ORIGIN,
  }));

  assert.equal(
    JSON.stringify(mappedBlocks.map((block) => block?.type)),
    JSON.stringify(fixture.expectedTypes),
    `${fixture.name} should map each raw Notion block to the expected block type`,
  );

  (fixture.mappedChecks || []).forEach((check) => {
    const actual = getValueAtPath(mappedBlocks[check.blockIndex], check.path);

    if (Object.prototype.hasOwnProperty.call(check, "equals")) {
      assert.equal(
        actual,
        check.equals,
        `${fixture.name} should map ${check.path} to the expected value`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(check, "includes")) {
      expectIncludes(
        String(actual),
        check.includes,
        `${fixture.name} should preserve ${check.path} in the mapped block`,
      );
    }
  });

  const renderedHtml = normalizeHtml(notionContentHelpers.renderBlocks(mappedBlocks, {
    baseOrigin: FIXTURE_BASE_ORIGIN,
  }));

  (fixture.expectedHtmlIncludes || []).forEach((snippet) => {
    expectIncludes(
      renderedHtml,
      normalizeHtml(snippet),
      `${fixture.name} should render semantic HTML for the fixture`,
    );
  });

  (fixture.expectedHtmlExcludes || []).forEach((snippet) => {
    expectNotIncludes(
      renderedHtml,
      normalizeHtml(snippet),
      `${fixture.name} should avoid rendering stale fallback markup`,
    );
  });
}

function expectNoMalformedClosingTags(source, message) {
  assert.ok(
    !/(^|[^<])\/(?:p|span|a|div|button|svg|main|section|article|h1|h2|h3|title)>/m.test(source),
    message,
  );
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

[
  "js/common.js",
  "js/blog-page.js",
  "js/bookmark.js",
  "js/font-loader.js",
  "js/index-page.js",
  "js/notion-content.js",
  "js/notion-api.js",
  "js/post-page.js",
  "api/notion.js",
  "api/posts-data.js",
  "api/post-data.js",
  "api/post.js",
  "api/sitemap.js",
  "server/public-content.js",
  "server/notion-server.js",
].forEach(checkSyntax);
const indexHtml = read("index.html");
const blogHtml = read("blog.html");
const postHtml = read("post.html");
const vercelJson = read("vercel.json");
const commonJs = read("js/common.js");
const blogPageJs = read("js/blog-page.js");
const bookmarkJs = read("js/bookmark.js");
const indexPageJs = read("js/index-page.js");
const notionContentJs = read("js/notion-content.js");
const notionApiJs = read("js/notion-api.js");
const postPageJs = read("js/post-page.js");
const apiNotionJs = read("api/notion.js");
const apiPostsDataJs = read("api/posts-data.js");
const apiPostDataJs = read("api/post-data.js");
const apiPostJs = read("api/post.js");
const apiSitemapJs = read("api/sitemap.js");
const publicContentJs = read("server/public-content.js");
const serverNotionJs = read("server/notion-server.js");
const notionContentHelpers = loadCommonJsModule("js/notion-content.js");
const publicContentHelpers = loadCommonJsModule("server/public-content.js");
const {
  __test: apiPostHelpers,
} = loadCommonJsModule("api/post.js", [
  "buildInitialPostPayload",
  "upsertStructuredDataScript",
  "injectInitialPostData",
  "replaceHeadMeta",
  "replaceEmptyStateContent",
]);
const {
  __test: serverNotionHelpers,
} = loadCommonJsModule("server/notion-server.js", [
  "buildPostPayload",
  "buildContentSchema",
  "buildCategoryFilter",
  "buildDatabaseSorts",
  "buildPublicAccessPolicyFromDatabase",
  "filterPostsBySearch",
  "renderPostContent",
]);

expectIncludes(indexHtml, 'property="og:image"', "index.html should declare og:image");
expectIncludes(blogHtml, 'property="og:image"', "blog.html should declare og:image");
expectIncludes(postHtml, 'property="og:image"', "post.html should declare og:image");
expectIncludes(indexHtml, 'id="heroSearchForm"', "index.html should expose a real search form");
expectIncludes(indexHtml, 'action="/blog.html"', "index.html search should degrade to a real blog route");
expectIncludes(indexHtml, 'method="get"', "index.html search should work without JavaScript");
expectIncludes(postHtml, 'rel="canonical"', "post.html should declare a fallback canonical link");
expectIncludes(postHtml, 'href="/blog.html"', "post.html should use root-relative blog links for canonical post routes");
expectIncludes(postHtml, 'src="/js/post-page.js"', "post.html should use root-relative scripts for canonical post routes");
expectIncludes(postHtml, 'id="postStatus"', "post.html should expose a live status region for post interactions");
expectIncludes(blogHtml, 'href="/"', "blog.html should point the home action to the canonical root route");
expectIncludes(postHtml, 'href="/"', "post.html should point the home action to the canonical root route");
expectNotIncludes(blogHtml, 'href="/index.html"', "blog.html should avoid the duplicate /index.html home route");
expectNotIncludes(postHtml, 'href="/index.html"', "post.html should avoid the duplicate /index.html home route");
expectIncludes(indexHtml, 'src="/js/notion-content.js"', "index.html should load the shared notion content helpers");
expectIncludes(blogHtml, 'src="/js/notion-content.js"', "blog.html should load the shared notion content helpers");
expectIncludes(postHtml, 'src="/js/notion-content.js"', "post.html should load the shared notion content helpers");
expectNoMalformedClosingTags(indexHtml, "index.html should not contain malformed closing tags");
expectNoMalformedClosingTags(blogHtml, "blog.html should not contain malformed closing tags");
expectNoMalformedClosingTags(postHtml, "post.html should not contain malformed closing tags");
expectIncludes(indexHtml, "data-page-focus", "index.html should mark a focus target");
expectIncludes(blogHtml, "data-page-focus", "blog.html should mark a focus target");
expectIncludes(blogHtml, 'id="blogStatus"', "blog.html should include the live status region");
expectIncludes(blogHtml, 'id="blogGrid" role="list"', "blog grid should expose list semantics");

expectIncludes(commonJs, "page-progress", "common.js should wire the page progress bar");
expectIncludes(commonJs, 'property="og:image"', "common.js should update og:image metadata");
expectIncludes(commonJs, 'property="og:type"', "common.js should update og:type metadata");
expectIncludes(commonJs, 'meta[name="robots"]', "common.js should manage robots metadata");
expectIncludes(commonJs, '"touchcancel"', "common.js should reset particle acceleration on touchcancel");
expectIncludes(commonJs, "focusSpaContent", "common.js should expose SPA focus management");
expectIncludes(commonJs, "hasFreshPrefetch", "common.js should expire stale prefetched routes");
expectIncludes(commonJs, "const sharedContent = window.NotionContent || {};", "common.js should delegate shared content policies to notion-content");
expectIncludes(commonJs, "resolveDisplayImageUrl", "common.js should expose display-safe image URLs");
expectIncludes(commonJs, "resolveShareImageUrl", "common.js should normalize stable share images");
expectIncludes(commonJs, "getPostIdFromUrl", "common.js should expose canonical post URL helpers");
expectIncludes(commonJs, "getPreferredBlogReturnUrl", "common.js should expose a preferred blog return helper");
expectIncludes(commonJs, "rememberBlogReturnUrl", "common.js should persist the last blog listing route");
expectIncludes(commonJs, 'existingLink.hasAttribute("data-deferred-fonts")', "common.js should activate deferred font stylesheets that already exist in the DOM");
expectIncludes(commonJs, "function isRouteHtmlCacheable(url)", "common.js should distinguish cacheable route HTML from live post routes");
expectIncludes(commonJs, "const canCacheHtml = isRouteHtmlCacheable(routeKey);", "common.js should avoid caching post route HTML");
expectIncludes(commonJs, 'if (!isRouteHtmlCacheable(routeKey)) return;', "common.js should skip prefetching post route HTML");
expectIncludes(commonJs, 'resolved.pathname === "/index.html"', "common.js should normalize the duplicate /index.html home route");
expectIncludes(commonJs, 'history.replaceState(null, "", resolveUrl(window.location.href).href);', "common.js should replace duplicate home URLs with the canonical root route");
expectNotIncludes(commonJs, ':not([data-deferred-fonts])', "common.js should not skip deferred page font stylesheets during SPA navigation");
assert.ok(
  !commonJs.includes("function warmPostDetail("),
  "common.js should not prewarm full post payloads during SPA navigation",
);
assert.ok(
  !commonJs.includes("NotionAPI.getPost(id).catch(() => {})"),
  "common.js should not trigger hover-based full post fetches",
);
expectIncludes(blogPageJs, 'class="blog-card-link"', "blog cards should render a dedicated link layer");
expectIncludes(blogPageJs, 'siteUtils.buildPostPath', "blog cards should link to canonical /posts/:id routes");
expectIncludes(blogPageJs, "siteUtils.rememberBlogReturnUrl", "blog page should persist the current listing URL");
expectIncludes(blogPageJs, "window.NotionContent", "blog page should fall back to shared content helpers when NotionAPI is unavailable");
expectIncludes(blogPageJs, "SHARED_CONTENT", "blog page should derive shared category definitions from the shared notion content module");
expectIncludes(blogPageJs, "const defaultCategory = hasRemoteSource ? ALL_CATEGORY : BOOKMARK_CATEGORY;", "blog page should derive a single default category for both remote and bookmark-only modes");
expectIncludes(blogPageJs, 'if (!hasRemoteSource && currentCategory !== BOOKMARK_CATEGORY)', "blog page should keep the local bookmark listing available when NotionAPI is unavailable");
expectIncludes(blogPageJs, "BOOKMARK_ONLY_CATEGORIES", "blog page should expose a bookmark-only fallback filter set");
expectIncludes(blogPageJs, "buildBookmarkPageData", "blog page should centralize local bookmark pagination and filtering");
expectIncludes(blogPageJs, "buildBookmarkSearchText", "blog page should reuse one bookmark search-text builder");
expectIncludes(blogPageJs, "loadCurrentPageData", "blog page should centralize the active data source selection");
expectIncludes(blogPageJs, "didNormalizeRoute", "blog page should normalize invalid incoming route state before rendering");
expectIncludes(blogPageJs, 'const HISTORY_MODE_REPLACE = "replace";', "blog page should name the replaceState history mode");
expectIncludes(blogPageJs, 'const HISTORY_MODE_PUSH = "push";', "blog page should name the pushState history mode");
expectIncludes(blogPageJs, "function syncListingUrl(historyMode = HISTORY_MODE_REPLACE)", "blog page should centralize URL sync with explicit history modes");
expectIncludes(blogPageJs, 'history.pushState(null, "", nextUrl);', "blog page should push user-driven list state changes into browser history");
expectIncludes(blogPageJs, 'history.replaceState(null, "", nextUrl);', "blog page should still replace normalized list URLs without adding history noise");
expectIncludes(blogPageJs, 'data-post-tags="${serializedTags}"', "blog cards should serialize tags for bookmark fallback");
expectIncludes(blogPageJs, 'aria-pressed="${bookmarked ? "true" : "false"}"', "bookmark buttons should expose pressed state");
expectIncludes(blogPageJs, "announceStatus(", "blog page should announce result updates");
expectIncludes(blogPageJs, "siteUtils.resolveShareImageUrl", "blog page should drop expiring remote cover URLs before rendering cards");
expectIncludes(blogPageJs, "restoreCoverPlaceholder", "blog page should restore a gradient/emoji cover when an image fails to load");
expectIncludes(blogPageJs, 'data-cover-gradient="${esc(safeCoverGradient)}"', "blog cards should preserve a fallback cover gradient for failed images");
expectIncludes(blogPageJs, 'data-cover-emoji="${safeCoverEmoji}"', "blog cards should preserve a fallback cover emoji for failed images");
expectIncludes(blogPageJs, 'const seoUrl = isLocalBookmarkView ? "/blog.html" : window.location.href;', "blog page should collapse bookmark canonicals back to the public blog route");
expectIncludes(blogPageJs, 'const seoRobots = isLocalBookmarkView ? "noindex, nofollow" : null;', "blog page should keep local bookmark views out of the index");
expectIncludes(blogPageJs, "收藏失败，请稍后重试", "blog page should announce bookmark persistence failures");
expectIncludes(blogPageJs, "searchInput.value = currentSearch;", "blog page should preserve the current search text in failure states");
expectIncludes(blogPageJs, "updatePageUI();", "blog page should reflect route context before showing a failure state");
expectIncludes(blogPageJs, "syncListingUrl(HISTORY_MODE_REPLACE);\n        updatePageUI();\n        renderPosts();", "blog page should replace URL entries for live search updates");
expectIncludes(blogPageJs, "if (didNormalizeRoute) {\n      syncListingUrl();\n    }\n    updatePageUI();", "blog page should canonicalize invalid category/search/page params on first render");
assert.ok(
  !blogPageJs.includes("scheduleDetailWarmup("),
  "blog page should not prewarm full article payloads from listing results",
);
assert.ok(
  !blogPageJs.includes("notionApi.getPost(firstPostId)"),
  "blog page should not trigger full post fetches during idle warmup",
);
assert.ok(
  !blogPageJs.includes("await bookmarkManager.hydrateMissingMetadata"),
  "blog page should hydrate legacy bookmark metadata in the background",
);
assert.ok(
  !blogPageJs.includes("blog_history"),
  "blog page should not keep unused blog_history persistence code",
);
expectNotIncludes(blogPageJs, "?{", "blog page should not contain corrupted template interpolations");
expectIncludes(bookmarkJs, "parseSerializedTags", "bookmark fallback should recover serialized tags");
expectIncludes(bookmarkJs, "createBookmarkEntry", "bookmark manager should centralize bookmark record creation");
expectIncludes(bookmarkJs, "buildCardBookmarkSource", "bookmark manager should centralize DOM snapshot extraction");
expectIncludes(bookmarkJs, "hydrateMissingMetadata", "bookmark manager should hydrate legacy metadata");
expectIncludes(bookmarkJs, "BOOKMARK_METADATA_VERSION = 4", "bookmark metadata should upgrade when persistence rules change");
expectIncludes(bookmarkJs, "resolveDisplayImageUrl", "bookmark normalization should preserve displayable cover images");
expectIncludes(bookmarkJs, "coverPlaceholder?.dataset?.coverGradient", "bookmark DOM fallback should preserve card gradients");
expectIncludes(bookmarkJs, "coverPlaceholder?.dataset?.coverEmoji", "bookmark DOM fallback should preserve card emojis");
expectIncludes(bookmarkJs, "return false;", "bookmark save should fail explicitly when persistence is unavailable");
expectIncludes(bookmarkJs, "if (!save(bookmarks)) return null;", "bookmark toggles should abort when persistence fails");
expectIncludes(bookmarkJs, "if (!save(nextBookmarks))", "bookmark hydration should fail cleanly when persistence is unavailable");
expectIncludes(bookmarkJs, "return null;", "bookmark toggleById should signal persistence failures");
expectIncludes(notionContentJs, "root.NotionContent", "shared notion content module should publish a browser global");
expectIncludes(notionContentJs, "module.exports = exported;", "shared notion content module should support CommonJS consumers");
expectIncludes(notionContentJs, "function mapNotionPage", "shared notion content module should own notion page mapping");
expectIncludes(notionContentJs, "function renderBlocks", "shared notion content module should own block rendering");
expectIncludes(notionContentJs, "function renderPostArticle", "shared notion content module should own article-shell rendering for both SSR and CSR");
expectIncludes(notionContentJs, "resolveDisplayImageUrl", "shared notion content module should expose a display-safe image resolver");
expectIncludes(notionContentJs, "resolveNotionContentSchema", "shared notion content module should resolve Notion schemas for renamed database properties");
expectIncludes(notionContentJs, "REMOTE_BLOG_CATEGORIES", "shared notion content module should centralize remote blog category definitions");
expectIncludes(notionContentJs, "BOOKMARK_ONLY_CATEGORIES", "shared notion content module should centralize bookmark-only category definitions");
expectIncludes(notionContentJs, "table: () => ({", "shared notion content module should preserve Notion table blocks");
expectIncludes(notionContentJs, "buildResourceBlock(", "shared notion content module should preserve file-like Notion blocks");
expectIncludes(notionContentJs, "buildUnsupportedBlock(", "shared notion content module should surface unsupported blocks instead of dropping them");
expectIncludes(notionContentJs, "table_of_contents: () => ({ type })", "shared notion content module should preserve table of contents blocks for semantic rendering");
expectIncludes(notionContentJs, "function renderTableOfContentsBlock", "shared notion content module should build semantic table of contents navigation");
expectIncludes(notionContentJs, "function renderBookmarkBlock", "shared notion content module should render bookmark blocks as semantic cards");
expectIncludes(notionContentJs, "function renderEmbedBlock", "shared notion content module should render embed resources through a dedicated renderer");
assert.equal(
  notionContentHelpers.ALL_CATEGORY,
  "全部",
  "shared notion content module should expose the canonical all-posts category label",
);
assert.equal(
  notionContentHelpers.BOOKMARK_CATEGORY,
  "收藏",
  "shared notion content module should expose the canonical bookmark category label",
);
assert.ok(
  notionContentHelpers.getRemoteBlogCategories().some((category) => category.name === "精选"),
  "shared notion content module should publish the remote category list for client pages",
);
notionBlockFixtures.forEach(runNotionBlockFixture);
const renderedArticleHtml = normalizeHtml(notionContentHelpers.renderPostArticle({
  title: "Shared shell",
  category: "Tech",
  date: "2026-04-11",
  readTime: "5 min",
  tags: ["TypeScript"],
  content: [{ type: "paragraph", text: "Body copy" }],
}, {
  baseOrigin: FIXTURE_BASE_ORIGIN,
}));
expectIncludes(renderedArticleHtml, '<div class="post-header">', "shared notion content module should render the reusable article shell");
expectIncludes(renderedArticleHtml, '<div class="post-content"><p>Body copy</p></div>', "shared notion content module should render article content through the shared shell");
const minimalArticleHtml = normalizeHtml(notionContentHelpers.renderPostArticle({
  title: "Minimal shell",
  category: "",
  date: "",
  readTime: "",
  tags: [],
  content: [],
}, {
  baseOrigin: FIXTURE_BASE_ORIGIN,
}));
assert.ok(
  !minimalArticleHtml.includes('class="post-category"'),
  "shared notion content module should hide the category badge when a post has no category",
);
assert.ok(
  !minimalArticleHtml.includes('class="post-meta"'),
  "shared notion content module should omit empty metadata rows when a post has no date, read time, or tags",
);
const renderedEmbedHtml = normalizeHtml(notionContentHelpers.renderBlocks([{
  type: "resource",
  resourceType: "embed",
  url: "https://www.youtube.com/watch?v=video123",
  caption: "",
  captionHtml: "",
  name: "",
}], {
  baseOrigin: FIXTURE_BASE_ORIGIN,
}));
expectIncludes(renderedEmbedHtml, 'class="post-embed"', "shared notion content module should render embeds without the generic resource card shell");
expectIncludes(renderedEmbedHtml, 'class="post-embed-frame"', "shared notion content module should render embed resources as iframe shells");
expectIncludes(renderedEmbedHtml, 'src="https://www.youtube.com/embed/video123"', "shared notion content module should normalize common watch URLs into iframe-friendly embed URLs");
expectNotIncludes(renderedEmbedHtml, 'class="post-resource post-resource-embed"', "shared notion content module should not wrap embeds in the generic resource card shell");
const unsupportedEmbedHtml = normalizeHtml(notionContentHelpers.renderBlocks([{
  type: "resource",
  resourceType: "embed",
  url: "https://example.com/embed",
  caption: "",
  captionHtml: "",
  name: "",
}], {
  baseOrigin: FIXTURE_BASE_ORIGIN,
}));
expectIncludes(unsupportedEmbedHtml, 'class="post-embed post-embed-link-only"', "shared notion content module should degrade unsupported embed URLs to a lightweight link block");
expectNotIncludes(unsupportedEmbedHtml, 'class="post-embed-frame"', "shared notion content module should avoid rendering blank iframes for unsupported embed providers");
const missingEmbedHtml = normalizeHtml(notionContentHelpers.renderBlocks([{
  type: "resource",
  resourceType: "embed",
  url: "",
  caption: "",
  captionHtml: "",
  name: "",
}], {
  baseOrigin: FIXTURE_BASE_ORIGIN,
}));
assert.ok(
  !missingEmbedHtml.includes('class="post-resource post-resource-embed"'),
  "shared notion content module should drop embed cards entirely when no usable embed URL is available",
);
assert.ok(
  !missingEmbedHtml.includes('class="post-resource post-resource-resource"'),
  "shared notion content module should not fall back to the generic resource card for empty embed blocks",
);
const ephemeralCoverImage = "https://assets.example.com/image.png?X-Amz-Algorithm=test&X-Amz-Signature=signature";
const bookmarkManagerHarness = loadBrowserScript("js/bookmark.js", {
  window: {
    CSS: {
      escape: (value) => String(value),
    },
    SiteUtils: {
      resolveDisplayImageUrl: (value) => (typeof value === "string" && value.startsWith("https://") ? value : null),
      sanitizeImageUrl: () => null,
      sanitizeCoverBackground: (value) => value,
    },
  },
});
assert.equal(
  bookmarkManagerHarness.window.BookmarkManager.toggle({
    id: "bookmark-1",
    title: "Ephemeral cover",
    coverImage: ephemeralCoverImage,
    coverEmoji: "🖼️",
    coverGradient: "linear-gradient(135deg, #111111, #222222)",
    tags: [],
  }),
  true,
  "bookmark manager should add a new bookmark entry",
);
assert.equal(
  bookmarkManagerHarness.window.BookmarkManager.getAll()[0]?.coverImage,
  ephemeralCoverImage,
  "bookmark manager should preserve displayable cover URLs even when they are expiring remote assets",
);
assert.equal(
  bookmarkManagerHarness.window.BookmarkManager.getAll()[0]?.metadataVersion,
  4,
  "bookmark manager should persist the upgraded metadata version for new bookmarks",
);
const renamedSchema = notionContentHelpers.resolveNotionContentSchema({
  properties: {
    标题: { id: "title", name: "标题", type: "title" },
    摘要: { id: "excerpt", name: "摘要", type: "rich_text" },
    阅读时间: { id: "readTime", name: "阅读时间", type: "rich_text" },
    标签: { id: "tags", name: "标签", type: "multi_select" },
    分类: { id: "category", name: "分类", type: "select" },
    发布时间: { id: "date", name: "发布时间", type: "date" },
  },
});
assert.equal(renamedSchema.title?.name, "标题", "schema resolution should find renamed title properties");
assert.equal(
  notionContentHelpers.mapNotionPage({
    id: "post-1",
    icon: { emoji: "🧪" },
    properties: {
      标题: { id: "title", name: "标题", type: "title", title: [{ plain_text: "Schema-aware title" }] },
      摘要: { id: "excerpt", name: "摘要", type: "rich_text", rich_text: [{ plain_text: "Schema-aware excerpt" }] },
      阅读时间: { id: "readTime", name: "阅读时间", type: "rich_text", rich_text: [{ plain_text: "5 min" }] },
      标签: { id: "tags", name: "标签", type: "multi_select", multi_select: [{ name: "TypeScript" }] },
      分类: { id: "category", name: "分类", type: "select", select: { name: "技术" } },
      发布时间: { id: "date", name: "发布时间", type: "date", date: { start: "2026-04-08" } },
    },
  }, {
    schema: renamedSchema,
  }).title,
  "Schema-aware title",
  "page mapping should honor the resolved schema when Notion properties are renamed",
);
const registeredPages = new Map();
const blogFiltersEl = new FakeElement();
const blogSearchEl = new FakeElement();
const blogGridEl = new FakeElement();
const blogEmptyEl = new FakeElement();
const blogPaginationEl = new FakeElement();
const blogStatusEl = new FakeElement();
const blogPageTitleEl = new FakeElement();
const topActionOverview = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "总览" } : null),
};
const topActionBookmark = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "收藏" } : null),
};
const blogLocation = new URL("https://example.com/blog.html");
const blogHistory = {
  pushCalls: [],
  replaceCalls: [],
  pushState(state, title, nextUrl) {
    this.pushCalls.push(String(nextUrl));
    blogLocation.href = new URL(String(nextUrl), blogLocation.href).href;
  },
  replaceState(state, title, nextUrl) {
    this.replaceCalls.push(String(nextUrl));
    blogLocation.href = new URL(String(nextUrl), blogLocation.href).href;
  },
};
loadBrowserScript("js/blog-page.js", {
  window: {
    location: blogLocation,
    history: blogHistory,
    scrollTo: () => {},
    NotionAPI: {
      escapeHtml: (value) => String(value ?? ""),
      getCategoryColor: () => ({ bg: "#000", color: "#fff", border: "#222" }),
      getCategories: () => [
        { name: "全部", emoji: "📋" },
        { name: "技术", emoji: "💻" },
        { name: "收藏", emoji: "📚" },
      ],
      getPageSize: () => 9,
      queryPosts: async () => ({
        results: [],
        total: 0,
        totalPages: 1,
        currentPage: 1,
      }),
    },
    PageRuntime: {
      register(pageId, pageModule) {
        registeredPages.set(pageId, pageModule);
      },
    },
    SiteUtils: {
      rememberBlogReturnUrl: () => {},
      sanitizeCoverBackground: (value, fallback) => value || fallback,
      resolveDisplayImageUrl: (value) => value,
      sanitizeImageUrl: (value) => value,
      buildPostPath: (postId) => `/posts/${postId}`,
    },
    updateSeoMeta: () => {},
    initBlogCardReveal: () => null,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  },
  document: {
    getElementById(id) {
      return {
        blogFilters: blogFiltersEl,
        blogSearch: blogSearchEl,
        blogGrid: blogGridEl,
        emptyState: blogEmptyEl,
        pagination: blogPaginationEl,
        blogStatus: blogStatusEl,
      }[id] || null;
    },
    querySelector(selector) {
      return selector === ".page-title" ? blogPageTitleEl : null;
    },
    querySelectorAll(selector) {
      return selector === ".top-actions .action-btn"
        ? [topActionOverview, topActionBookmark]
        : [];
    },
    createElement() {
      return new FakeElement();
    },
  },
});
const blogPageCleanup = registeredPages.get("blog")?.init?.();
await Promise.resolve();
const filterButton = {
  dataset: { category: "技术" },
  closest(selector) {
    return selector === ".filter-btn" ? this : null;
  },
};
blogFiltersEl.dispatch("click", { target: filterButton });
assert.equal(
  blogHistory.pushCalls.at(-1),
  "/blog.html?category=%E6%8A%80%E6%9C%AF",
  "blog page should push filter state changes so browser back returns to the previous listing state",
);
blogSearchEl.value = "深度测试";
blogSearchEl.dispatch("input");
await new Promise((resolve) => setTimeout(resolve, 350));
assert.equal(
  blogHistory.replaceCalls.at(-1),
  "/blog.html?category=%E6%8A%80%E6%9C%AF&search=%E6%B7%B1%E5%BA%A6%E6%B5%8B%E8%AF%95",
  "blog page should replace the current history entry while live search text changes",
);
blogPageCleanup?.();
expectIncludes(notionApiJs, "collectPostSummaryCacheEntries", "notion cache should evict older post-summary entries on quota pressure");
expectIncludes(notionApiJs, "createRequestError", "notion client should preserve HTTP status metadata on failures");
expectIncludes(notionApiJs, "error.status = Number(status);", "notion client should attach status codes to request errors");
expectIncludes(notionApiJs, 'postsEndpoint: "/api/posts-data"', "notion client should load post listings from the semantic endpoint");
expectIncludes(notionApiJs, 'postEndpoint: "/api/post-data"', "notion client should load post details from the restricted endpoint");
expectIncludes(notionApiJs, "sharedContent.renderPostArticle", "notion client should reuse the shared article renderer instead of duplicating article markup");
expectIncludes(notionApiJs, "POST_SUMMARY_CACHE_TTL", "notion client should keep a separate summary cache for bookmarks");
expectIncludes(notionApiJs, "POSTS_REQUEST_KEY_PREFIX", "notion client should dedupe in-flight list requests without reviving stale response caches");
expectIncludes(notionApiJs, "window.NotionContent", "notion client should reuse shared notion content helpers");
expectIncludes(notionApiJs, "getRemoteBlogCategories", "notion client should source category metadata from the shared notion content module");
assert.ok(
  !notionApiJs.includes("RESPONSE_CACHE_TTL"),
  "notion client should remove zero-effect response cache branches instead of carrying disabled cache code",
);
assert.ok(
  !notionApiJs.includes("RESPONSE_STALE_TTL"),
  "notion client should remove stale-response cache branches when public content must stay live",
);
assert.ok(
  !notionApiJs.includes("以下逻辑与服务端"),
  "notion client should not ask maintainers to keep a duplicated server copy in sync",
);
assert.ok(
  !notionApiJs.includes("function mapNotionPage("),
  "notion client should not duplicate raw notion page mapping helpers locally",
);
assert.ok(
  !notionApiJs.includes("function mapNotionBlock("),
  "notion client should not duplicate raw notion block mapping helpers locally",
);
assert.ok(
  !notionApiJs.includes("function fetchPostSummaries("),
  "notion client should not keep the unused full-summary prefetch path",
);
assert.ok(
  !notionApiJs.includes('workerUrl: "/api"'),
  "notion client should not depend on the generic Notion proxy for post listings",
);
assert.ok(
  !notionApiJs.includes('databaseId: "32485b780a2580eaa67ecf051676d693"'),
  "notion client should not embed the Notion database id anymore",
);
expectIncludes(indexPageJs, "function navigateTo(url)", "index page should provide a navigation fallback helper");
expectIncludes(indexPageJs, "window.location.href = url", "index page should fall back to full navigation");
expectIncludes(indexPageJs, 'searchForm.addEventListener("submit", handleSearchSubmit);', "index page should intercept the real search form for SPA navigation");
expectIncludes(indexPageJs, 'ctaHome.href = "/blog.html";', "index page should preserve a native home/blog link fallback");
expectIncludes(indexPageJs, 'navigateTo(`/blog.html?search=${encodeURIComponent(query)}`);', "index page search navigation should use root-relative paths");
expectIncludes(postPageJs, 'window.StructuredData?.set?.("post-article"', "post page should publish article structured data");
expectIncludes(postPageJs, "initialPostData", "post page should reuse server-rendered post payloads");
expectIncludes(postPageJs, "notionApi.renderPostArticle(post)", "post page should reuse the shared article-shell renderer for client-side redraws");
expectIncludes(postPageJs, "siteUtils.getPreferredBlogReturnUrl", "post page back navigation should restore the preferred blog listing route");
expectIncludes(postPageJs, "nowBookmarked === null", "post page should leave bookmark UI unchanged when persistence fails");
expectIncludes(postPageJs, "isMissingPostError", "post page should distinguish not-found posts from temporary failures");
expectIncludes(postPageJs, "showEmpty(isMissingPostError(error) ? \"not-found\" : \"unavailable\")", "post page should map 404-like errors to the not-found empty state");
expectIncludes(postPageJs, "announceStatus(`收藏失败，请稍后重试", "post page should announce bookmark persistence failures");
expectIncludes(postPageJs, "hasServerRenderedContent", "post page should detect pre-rendered article content");
expectIncludes(postPageJs, "showServerRenderedFallback", "post page should preserve server-rendered content when NotionAPI is unavailable");
assert.ok(
  postPageJs.indexOf("const postId = getCurrentPostId();") < postPageJs.indexOf('if (!notionApi)'),
  "post page should initialize route state before the NotionAPI fallback branch runs",
);
expectNotIncludes(postPageJs, "?{", "post page should not contain corrupted template interpolations");
expectIncludes(postPageJs, 'robots: "index, follow"', "post page should restore article robots metadata after load");
assert.ok(
  !postPageJs.includes("reading_history"),
  "post page should not keep unused reading_history persistence code",
);
expectIncludes(apiPostJs, 'upsertStructuredDataScript(html, "post-article"', "article HTML route should emit structured data");
expectIncludes(apiPostJs, 'id="initialPostData"', "article HTML route should emit initial post data");
expectIncludes(apiPostJs, "buildUnavailableContent", "article HTML route should distinguish upstream failures from not-found routes");
expectIncludes(apiPostJs, 'req.method !== "GET" && req.method !== "HEAD"', "article HTML route should reject non-GET/HEAD requests explicitly");
expectIncludes(apiPostJs, 'res.setHeader("Allow", "GET, HEAD");', "article HTML route should advertise the supported methods on 405 responses");
expectIncludes(apiPostJs, "getPublicPostErrorStatus", "article HTML route should reuse shared public-post error mapping");
expectIncludes(apiPostJs, "fetchPublicPost", "article HTML route should only render posts from the public blog set");
expectIncludes(apiPostJs, "renderPostArticle(post, { renderedContent, baseOrigin: siteOrigin })", "article HTML route should reuse the shared article-shell renderer for SSR");
expectIncludes(apiPostJs, '"Cache-Control", "no-store"', "article HTML route should not cache public post responses");
expectIncludes(apiPostJs, "replaceMarkup(", "article HTML route should use literal-safe SSR replacements for dynamic content");
expectIncludes(apiPostJs, "upsertHeadMarkup", "article HTML route should centralize head-tag insertion and replacement");
expectIncludes(apiPostJs, "resolveShareImageUrl(post.coverImage, defaultShareImageUrl, siteOrigin)", "article HTML route should resolve og:image against the site origin consistently");

const replacementSentinel = "$& :: $` :: $'";
const escapedReplacementSentinel = "$&amp; :: $` :: $&#39;";
const injectedInitialPostData = apiPostHelpers.injectInitialPostData("<main></main>", {
  title: replacementSentinel,
});
expectIncludes(injectedInitialPostData, replacementSentinel, "initial post data injection should preserve replacement tokens literally");
const initialPostPayload = apiPostHelpers.buildInitialPostPayload({
  id: "post-1",
  title: "Payload title",
  excerpt: "Payload excerpt",
  category: "Tech",
  date: "2026-04-11",
  readTime: "5 min",
  coverImage: "https://example.com/cover.png",
  coverEmoji: "馃摑",
  coverGradient: "linear-gradient(135deg, #111111, #222222)",
  tags: ["TypeScript"],
  content: [{ type: "paragraph", text: "Hello" }],
  renderedContent: "<p>Hello</p>",
});
assert.ok(
  !("content" in initialPostPayload) && !("renderedContent" in initialPostPayload),
  "article HTML route should keep the inline initial payload summary-only when SSR markup is already present",
);

const structuredDataHtml = apiPostHelpers.upsertStructuredDataScript("<head></head>", "post-article", {
  headline: replacementSentinel,
});
expectIncludes(structuredDataHtml, replacementSentinel, "structured data injection should preserve replacement tokens literally");

const replacedHeadMeta = apiPostHelpers.replaceHeadMeta(`<!doctype html><html><head>
<title>Old</title>
<meta name="description" content="old" />
<meta property="og:title" content="old" />
<meta property="og:description" content="old" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://example.com/old" />
<meta property="og:image" content="https://example.com/old.png" />
<meta property="og:image:alt" content="old" />
</head></html>`, {
  title: replacementSentinel,
  description: replacementSentinel,
  url: "https://example.com/posts/sentinel",
  image: "https://example.com/sentinel.png",
  imageAlt: replacementSentinel,
  canonicalUrl: "https://example.com/posts/sentinel",
  robots: "index, follow",
  ogType: "article",
});
expectIncludes(replacedHeadMeta, `<title>${escapedReplacementSentinel}</title>`, "head metadata replacement should preserve replacement tokens in the page title");
assert.ok(
  !replacedHeadMeta.includes("<title><title>Old</title></title>"),
  "head metadata replacement should not reinsert the original title through replacement tokens",
);

const replacedEmptyState = apiPostHelpers.replaceEmptyStateContent(
  '<div class="empty-state" id="postEmpty"><svg></svg><p>old</p><p style="font-size: 0.85rem;"><a href="/old">old</a></p></div>',
  {
    message: replacementSentinel,
    linkText: replacementSentinel,
  },
);
assert.equal(
  replacedEmptyState.match(new RegExp(escapeRegex(escapedReplacementSentinel), "g"))?.length,
  2,
  "empty-state replacement should preserve replacement tokens in both the message and link text",
);
expectIncludes(apiPostsDataJs, "queryPublicPosts", "post list endpoint should serve the public blog set through a semantic API");
expectIncludes(apiPostsDataJs, '"Cache-Control", "no-store"', "post list endpoint should not cache public responses");
expectIncludes(apiPostDataJs, "fetchPublicPost", "post data endpoint should only serve posts from the public blog set");
expectIncludes(apiPostDataJs, "getPublicPostErrorStatus", "post data endpoint should reuse shared public-post error mapping");
expectIncludes(apiPostDataJs, '"Cache-Control", "no-store"', "post data endpoint should not cache public responses");
expectIncludes(publicContentJs, "getPublicPostErrorStatus", "public content helper should centralize post error mapping");
expectIncludes(publicContentJs, "notion_public_config_error", "public content helper should surface public access misconfiguration as a server error");
expectIncludes(publicContentJs, "notion_timeout_error", "public content helper should preserve upstream timeout status");
expectIncludes(publicContentJs, "Retry-After", "public content helper should preserve retry guidance for upstream rate limits");
expectIncludes(publicContentJs, "restricted_resource", "public content helper should classify upstream Notion permission failures as server-side integration faults");
assert.equal(
  publicContentHelpers.getPublicContentErrorStatus({
    status: 429,
    notionCode: "rate_limited",
  }),
  429,
  "public content helper should preserve Notion rate-limit responses as HTTP 429",
);
assert.equal(
  publicContentHelpers.getPublicContentErrorStatus({
    status: 401,
    notionCode: "unauthorized",
  }),
  500,
  "public content helper should treat upstream auth failures as a stable server-side configuration error",
);
assert.equal(
  publicContentHelpers.getPublicContentErrorStatus({
    status: 403,
    notionCode: "restricted_resource",
  }),
  500,
  "public content helper should treat upstream permission failures as a stable server-side configuration error",
);
const publicErrorHeaders = [];
publicContentHelpers.applyPublicErrorHeaders({
  setHeader(name, value) {
    publicErrorHeaders.push([name, value]);
  },
}, {
  retryAfter: "30",
});
assert.equal(
  JSON.stringify(publicErrorHeaders),
  JSON.stringify([["Retry-After", "30"]]),
  "public content helper should forward Retry-After headers for rate-limited upstream responses",
);
expectIncludes(serverNotionJs, "queryPublicPages", "server notion layer should expose a filtered public page query helper");
expectIncludes(serverNotionJs, "queryPublicPosts", "server notion layer should provide a public post query helper");
expectIncludes(serverNotionJs, "PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS", "server notion layer should define a short-lived public summary cache");
expectIncludes(serverNotionJs, "getPublicPageSummaries", "server notion layer should cache public list summaries separately from post details");
expectIncludes(serverNotionJs, "buildContentSchema", "server notion layer should derive content property mappings from database metadata");
expectIncludes(serverNotionJs, "buildDatabaseSorts", "server notion layer should derive list sorting from the resolved schema");
expectIncludes(serverNotionJs, "buildCategoryFilter", "server notion layer should prefilter category queries before paginating");
expectIncludes(serverNotionJs, "applyPostFilters", "server notion layer should centralize local category/search semantics");
expectIncludes(serverNotionJs, "normalizePostQueryFilters", "server notion layer should normalize category and search inputs before querying");
expectIncludes(serverNotionJs, "loadPublicPagesForQuery", "server notion layer should separate source selection from local filtering");
expectIncludes(serverNotionJs, "hasPostQueryFilters", "server notion layer should detect when filtered queries need extra work");
expectIncludes(serverNotionJs, "queryPublicPages({ category, search })", "server notion layer should thread search/category filters into public list queries");
expectIncludes(serverNotionJs, "NOTION_REQUEST_TIMEOUT_MS", "server notion layer should define a request timeout for upstream calls");
expectIncludes(serverNotionJs, "AbortController", "server notion layer should abort slow Notion requests");
expectIncludes(serverNotionJs, "runWithBlockChildConcurrency", "server notion layer should limit recursive block child fetch concurrency");
expectIncludes(serverNotionJs, "Ambiguous Notion public visibility property configuration", "server notion layer should fail closed when multiple public visibility fields match");
expectIncludes(serverNotionJs, "findPropertyEntriesByCandidates", "server notion layer should inspect all matching public visibility properties");
expectIncludes(serverNotionJs, 'require("../js/notion-content")', "server notion layer should reuse the shared notion content helpers");
expectIncludes(serverNotionJs, "resolveNotionContentSchema", "server notion layer should resolve renamed content properties from database metadata");
expectIncludes(serverNotionJs, "renderPostContent", "server notion layer should render SSR post HTML without duplicating it in API payloads");
expectNotIncludes(serverNotionJs, "buildSearchFilter", "server notion layer should not delegate search semantics to upstream filters that behave differently from local search");
expectNotIncludes(serverNotionJs, 'category === "鍏ㄩ儴"', "server notion layer should not compare against a mojibake category label");
const resolvedContentSchema = serverNotionHelpers.buildContentSchema({
  properties: {
    标题: { id: "title", name: "标题", type: "title" },
    摘要: { id: "excerpt", name: "摘要", type: "rich_text" },
    分类: { id: "category", name: "分类", type: "select" },
    发布时间: { id: "date", name: "发布时间", type: "date" },
  },
});
assert.equal(
  resolvedContentSchema.title?.name,
  "标题",
  "server notion layer should resolve renamed content properties from database metadata",
);
assert.equal(
  JSON.stringify(serverNotionHelpers.buildDatabaseSorts(resolvedContentSchema)),
  JSON.stringify([{
    property: "发布时间",
    direction: "descending",
  }]),
  "server notion layer should sort by the resolved date property instead of a hardcoded field name",
);
assert.equal(
  JSON.stringify(serverNotionHelpers.buildCategoryFilter("Tech", {
    category: { name: "Category", type: "select" },
  })),
  JSON.stringify({
    property: "Category",
    select: { equals: "Tech" },
  }),
  "category prefilter should only be emitted when the Notion schema still matches the expected select field",
);
assert.equal(
  serverNotionHelpers.buildCategoryFilter("Tech", {
    category: { name: "Category", type: "multi_select" },
  }),
  null,
  "category prefilter should disable itself instead of breaking requests when the Notion schema drifts",
);
const databaseWidePublicAccessPolicy = withEnvOverrides({
  NOTION_PUBLIC_PROPERTY_NAME: null,
  NOTION_PUBLIC_PROPERTY_NAMES: null,
  NOTION_PUBLIC_STATUS_VALUES: null,
}, () => serverNotionHelpers.buildPublicAccessPolicyFromDatabase({
  properties: {
    Workflow: {
      id: "workflow",
      name: "Workflow",
      type: "status",
      status: {
        options: [
          { id: "draft", name: "Draft" },
          { id: "published", name: "Published" },
        ],
      },
    },
  },
}));
assert.equal(
  databaseWidePublicAccessPolicy.propertyType,
  "database",
  "server notion layer should default to exposing the whole configured database when no explicit public visibility field is configured",
);
assert.equal(
  databaseWidePublicAccessPolicy.filter,
  null,
  "database-wide public mode should not emit an additional Notion filter",
);
const explicitPublicAccessPolicy = withEnvOverrides({
  NOTION_PUBLIC_PROPERTY_NAME: "Workflow",
  NOTION_PUBLIC_PROPERTY_NAMES: null,
  NOTION_PUBLIC_STATUS_VALUES: null,
}, () => serverNotionHelpers.buildPublicAccessPolicyFromDatabase({
  properties: {
    Workflow: {
      id: "workflow",
      name: "Workflow",
      type: "status",
      status: {
        options: [
          { id: "draft", name: "Draft" },
          { id: "published", name: "Published" },
        ],
      },
    },
  },
}));
assert.equal(
  explicitPublicAccessPolicy.propertyName,
  "Workflow",
  "server notion layer should still honor an explicitly configured public visibility field",
);
assert.equal(
  explicitPublicAccessPolicy.propertyType,
  "status",
  "server notion layer should preserve the explicit public property type for downstream filtering",
);
const groupedStatusPublicAccessPolicy = withEnvOverrides({
  NOTION_PUBLIC_PROPERTY_NAME: "Status",
  NOTION_PUBLIC_PROPERTY_NAMES: null,
  NOTION_PUBLIC_STATUS_VALUES: null,
}, () => serverNotionHelpers.buildPublicAccessPolicyFromDatabase({
  properties: {
    Status: {
      id: "status",
      name: "Status",
      type: "status",
      status: {
        options: [
          { id: "draft", name: "Draft" },
          { id: "done", name: "Done" },
        ],
        groups: [
          { id: "todo", name: "To-do", option_ids: ["draft"] },
          { id: "complete", name: "Complete", option_ids: ["done"] },
        ],
      },
    },
  },
}));
assert.equal(
  JSON.stringify(groupedStatusPublicAccessPolicy.allowedStatusValues),
  JSON.stringify(["Done"]),
  "server notion layer should infer public status values from the matched property schema when the workflow uses Done-style completion states",
);
assert.equal(
  serverNotionHelpers.filterPostsBySearch([
    { title: "", excerpt: "", tags: ["TypeScript"] },
    { title: "Other", excerpt: "", tags: ["Docs"] },
  ], "script").length,
  1,
  "local post search should preserve substring matches for tag text",
);
const builtPostPayload = serverNotionHelpers.buildPostPayload(
  {
    id: "post-1",
    title: "Payload title",
    excerpt: "Payload excerpt",
    category: "Tech",
    date: "2026-04-11",
    readTime: "5 min",
    tags: [],
  },
  [{
    type: "paragraph",
    paragraph: {
      rich_text: [{ plain_text: "Server rendered body" }],
    },
  }],
);
assert.ok(
  Array.isArray(builtPostPayload.content) && !("renderedContent" in builtPostPayload),
  "server notion layer should return structured post content without duplicating rendered HTML in the payload",
);
assert.equal(
  serverNotionHelpers.renderPostContent(builtPostPayload, { baseOrigin: "https://example.com" }),
  "<p>Server rendered body</p>",
  "server notion layer should render post HTML on demand from structured content",
);
assert.ok(
  !serverNotionJs.includes("务必同步更新 js/notion-api.js"),
  "server notion layer should not depend on manually syncing duplicated client helpers",
);
assert.ok(
  !serverNotionJs.includes("queryAllPages"),
  "server notion layer should not expose the whole database as the public content set",
);
expectIncludes(apiNotionJs, "generic Notion proxy is disabled", "API proxy should be explicitly disabled");
assert.ok(
  !apiNotionJs.includes("Authorization: `Bearer"),
  "API proxy should not forward arbitrary authenticated Notion requests anymore",
);
expectIncludes(apiSitemapJs, "buildPostUrl", "dynamic sitemap should include article routes");
expectIncludes(apiSitemapJs, "queryPublicPages", "dynamic sitemap should only include public posts");
expectIncludes(apiSitemapJs, '"Cache-Control", "no-store"', "dynamic sitemap should not outlive public access changes");
expectIncludes(vercelJson, '"/posts/:id"', "Vercel should rewrite canonical article routes");
expectIncludes(vercelJson, '"/sitemap.xml"', "Vercel should serve a dynamic sitemap");
expectIncludes(vercelJson, '"/favicon.png"', "Vercel should set cache headers for the real favicon asset");
expectIncludes(vercelJson, "frame-src 'self' https:", "Vercel CSP should allow external iframe embeds for article content");
expectNotIncludes(vercelJson, '"/api/:path*"', "Vercel should not rewrite semantic API routes through the disabled legacy proxy");

console.log("Smoke check passed.");
