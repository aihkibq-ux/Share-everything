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

function loadCommonJsModule(relativePath, exportedNames = [], sandboxOverrides = {}) {
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
    ...sandboxOverrides,
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
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] || null;
    },
    get length() {
      return store.size;
    },
  };
}

function createQuotaLimitedStorageMock({ initialEntries = {}, maxChars = 1024 } = {}) {
  const storage = createStorageMock(initialEntries);

  return {
    getItem(key) {
      return storage.getItem(key);
    },
    setItem(key, value) {
      const serializedValue = String(value);
      const nextEntries = [];
      for (let index = 0; index < storage.length; index += 1) {
        const existingKey = storage.key(index);
        if (existingKey == null || existingKey === key) continue;
        nextEntries.push([existingKey, storage.getItem(existingKey) || ""]);
      }
      nextEntries.push([String(key), serializedValue]);

      const totalChars = nextEntries.reduce(
        (sum, [entryKey, entryValue]) => sum + String(entryKey).length + String(entryValue).length,
        0,
      );
      if (totalChars > maxChars) {
        const error = new Error("Quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }

      storage.setItem(key, serializedValue);
    },
    removeItem(key) {
      storage.removeItem(key);
    },
    clear() {
      storage.clear();
    },
    key(index) {
      return storage.key(index);
    },
    get length() {
      return storage.length;
    },
  };
}

function createHeadersMock(initialEntries = {}) {
  const headers = new Map(
    Object.entries(initialEntries).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );

  return {
    get(name) {
      return headers.get(String(name).toLowerCase()) || null;
    },
  };
}

function createJsonResponse(payload, { status = 200, headers = {} } = {}) {
  const serializedPayload = typeof payload === "string"
    ? payload
    : JSON.stringify(payload);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeadersMock(headers),
    async json() {
      return typeof payload === "string"
        ? JSON.parse(payload)
        : payload;
    },
    async text() {
      return serializedPayload;
    },
  };
}

function createApiResponseRecorder() {
  return {
    statusCode: 200,
    headers: new Map(),
    jsonBody: null,
    textBody: null,
    ended: false,
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    getHeader(name) {
      return this.headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      this.ended = true;
      return payload;
    },
    send(payload) {
      this.textBody = payload;
      this.ended = true;
      return payload;
    },
    end(payload = "") {
      this.textBody = payload;
      this.ended = true;
      return payload;
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
    fetch: overrides.fetch || globalThis.fetch,
    AbortController: overrides.AbortController || AbortController,
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
    AbortController: overrides.AbortController || AbortController,
    fetch: overrides.fetch || globalThis.fetch,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: windowObject.requestAnimationFrame,
    cancelAnimationFrame: windowObject.cancelAnimationFrame,
    ...overrides.globals,
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

function extractContentSecurityPolicyMetaContent(htmlSource) {
  const match = String(htmlSource || "").match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i,
  );
  assert.ok(match, "HTML should include a Content-Security-Policy meta tag");
  return match[1];
}

function normalizeHtml(source) {
  return String(source || "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function createHeadMock() {
  const nodes = [];

  function matchesSelector(node, selector) {
    const tagName = String(node?.tagName || "").toLowerCase();
    if (selector === 'meta[name="description"]') {
      return tagName === "meta" && node.getAttribute("name") === "description";
    }
    if (selector === 'meta[name="robots"]') {
      return tagName === "meta" && node.getAttribute("name") === "robots";
    }
    if (selector === 'meta[property="og:title"]') {
      return tagName === "meta" && node.getAttribute("property") === "og:title";
    }
    if (selector === 'meta[property="og:description"]') {
      return tagName === "meta" && node.getAttribute("property") === "og:description";
    }
    if (selector === 'meta[property="og:type"]') {
      return tagName === "meta" && node.getAttribute("property") === "og:type";
    }
    if (selector === 'meta[property="og:url"]') {
      return tagName === "meta" && node.getAttribute("property") === "og:url";
    }
    if (selector === 'meta[property="og:image"]') {
      return tagName === "meta" && node.getAttribute("property") === "og:image";
    }
    if (selector === 'meta[property="og:image:alt"]') {
      return tagName === "meta" && node.getAttribute("property") === "og:image:alt";
    }
    if (selector === 'link[rel="canonical"]') {
      return tagName === "link" && node.getAttribute("rel") === "canonical";
    }

    return false;
  }

  return {
    appendChild(node) {
      nodes.push(node);
      node.remove = () => {
        const index = nodes.indexOf(node);
        if (index >= 0) {
          nodes.splice(index, 1);
        }
      };
      return node;
    },
    querySelector(selector) {
      return nodes.find((node) => matchesSelector(node, selector)) || null;
    },
    nodes,
  };
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
  "js/runtime-core.js",
  "js/seo-meta.js",
  "js/site-utils.js",
  "js/spa-router.js",
  "js/ui-effects.js",
  "api/notion.js",
  "api/image.js",
  "api/posts-data.js",
  "api/post-data.js",
  "api/post.js",
  "api/sitemap.js",
  "server/public-content.js",
  "server/security-policy.js",
  "server/notion-server.js",
].forEach(checkSyntax);
const indexHtml = read("index.html");
const blogHtml = read("blog.html");
const postHtml = read("post.html");
const gitAttributes = read(".gitattributes");
const packageJson = read("package.json");
const vercelJson = read("vercel.json");
const localServerJs = read("scripts/local-server.mjs");
const styleCss = read("css/style.css");
const blogPageCss = read("css/blog-page.css");
const postPageCss = read("css/post-page.css");
const commonJs = read("js/common.js");
const blogPageJs = read("js/blog-page.js");
const runtimeCoreJs = read("js/runtime-core.js");
const spaRouterJs = read("js/spa-router.js");
const bookmarkJs = read("js/bookmark.js");
const indexPageJs = read("js/index-page.js");
const notionContentJs = read("js/notion-content.js");
const notionApiJs = read("js/notion-api.js");
const postPageJs = read("js/post-page.js");
const smokeCheckSource = read("scripts/smoke-check.mjs");
const apiNotionJs = read("api/notion.js");
const apiImageJs = read("api/image.js");
const apiPostsDataJs = read("api/posts-data.js");
const apiPostDataJs = read("api/post-data.js");
const apiPostJs = read("api/post.js");
const apiSitemapJs = read("api/sitemap.js");
const publicContentJs = read("server/public-content.js");
const serverNotionJs = read("server/notion-server.js");
const notionContentHelpers = loadCommonJsModule("js/notion-content.js");
const publicContentHelpers = loadCommonJsModule("server/public-content.js");
const securityPolicyHelpers = loadCommonJsModule("server/security-policy.js");
const apiNotionHandler = loadCommonJsModule("api/notion.js");
const apiImageHandler = loadCommonJsModule("api/image.js");
const apiPostHandler = loadCommonJsModule("api/post.js");
const apiPostsDataHandler = loadCommonJsModule("api/posts-data.js");
const apiPostDataHandler = loadCommonJsModule("api/post-data.js");
const {
  __test: apiPostHelpers,
} = loadCommonJsModule("api/post.js", [
  "buildInitialPostPayload",
  "upsertStructuredDataScript",
  "injectInitialPostData",
  "replaceContentSecurityPolicyMeta",
  "replacePostContent",
  "replaceHeadMeta",
  "replaceEmptyStateContent",
]);
const {
  __test: serverNotionHelpers,
} = loadCommonJsModule("server/notion-server.js", [
  "buildPostPayload",
  "buildArticleStructuredData",
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
expectIncludes(indexHtml, 'href="/blog.html#bookmarks"', "index.html should keep bookmark navigation on a hash-only route");
expectIncludes(indexHtml, 'id="ctaHome" href="/blog.html" aria-label="总览"', "index hero overview CTA should expose an accessible name");
expectIncludes(indexHtml, 'id="ctaStart" href="/blog.html?category=%E7%B2%BE%E9%80%89" aria-label="精选"', "index hero featured CTA should expose an accessible name");
expectIncludes(indexHtml, 'id="ctaWiki" href="/blog.html#bookmarks" rel="nofollow" aria-label="收藏"', "index hero bookmark CTA should expose an accessible name");
expectIncludes(blogHtml, 'href="/blog.html#bookmarks"', "blog.html should keep bookmark navigation on a hash-only route");
expectIncludes(postHtml, 'href="/blog.html#bookmarks"', "post.html should keep bookmark navigation on a hash-only route");
expectNotIncludes(blogHtml, 'href="/index.html"', "blog.html should avoid the duplicate /index.html home route");
expectNotIncludes(postHtml, 'href="/index.html"', "post.html should avoid the duplicate /index.html home route");
expectNotIncludes(indexHtml, '?category=%E6%94%B6%E8%97%8F', "index.html should avoid exposing bookmark query routes to crawlers");
expectNotIncludes(blogHtml, '?category=%E6%94%B6%E8%97%8F', "blog.html should avoid exposing bookmark query routes to crawlers");
expectNotIncludes(postHtml, '?category=%E6%94%B6%E8%97%8F', "post.html should avoid exposing bookmark query routes to crawlers");
const pageHtmlByLabel = [
  ["index.html", indexHtml],
  ["blog.html", blogHtml],
  ["post.html", postHtml],
];
const sharedRuntimeScriptSources = [
  "/js/font-loader.js",
  "/js/notion-content.js",
  "/js/runtime-core.js",
  "/js/site-utils.js",
  "/js/common.js",
  "/js/ui-effects.js",
  "/js/seo-meta.js",
  "/js/spa-router.js",
];
const expectedStaticContentSecurityPolicy = securityPolicyHelpers.buildStaticContentSecurityPolicy();
pageHtmlByLabel.forEach(([label, htmlSource]) => {
  assert.equal(
    extractContentSecurityPolicyMetaContent(htmlSource),
    expectedStaticContentSecurityPolicy,
    `${label} static CSP meta should match the shared security policy builder`,
  );

  sharedRuntimeScriptSources.forEach((src) => {
    expectIncludes(
      htmlSource,
      `src="${src}" data-spa-runtime`,
      `${label} should mark ${src} as a shared SPA runtime script`,
    );
  });
});
expectNoMalformedClosingTags(indexHtml, "index.html should not contain malformed closing tags");
expectNoMalformedClosingTags(blogHtml, "blog.html should not contain malformed closing tags");
expectNoMalformedClosingTags(postHtml, "post.html should not contain malformed closing tags");
expectIncludes(indexHtml, "data-page-focus", "index.html should mark a focus target");
expectIncludes(blogHtml, "data-page-focus", "blog.html should mark a focus target");
expectIncludes(blogHtml, 'id="blogStatus"', "blog.html should include the live status region");
expectIncludes(blogHtml, 'id="blogGrid" role="list"', "blog grid should expose list semantics");
expectIncludes(blogHtml, 'href="/css/blog-page.css"', "blog.html should load blog-page.css");
expectIncludes(postHtml, 'href="/css/post-page.css"', "post.html should load post-page.css");
expectIncludes(gitAttributes, "*.mjs text eol=lf", ".gitattributes should normalize .mjs files to LF");
assert.ok(!styleCss.includes("\r\n"), "style.css should use LF line endings");
assert.ok(!blogPageCss.includes("\r\n"), "blog-page.css should use LF line endings");
assert.ok(!postPageCss.includes("\r\n"), "post-page.css should use LF line endings");
assert.ok(!smokeCheckSource.includes("\r\n"), "smoke-check.mjs should use LF line endings");
expectNotIncludes(styleCss, ".blog-grid {", "style.css should not ship the blog grid layout anymore");
expectNotIncludes(styleCss, ".post-content {", "style.css should not ship post content styles anymore");
expectNotIncludes(styleCss, ".fab-bookmark {", "style.css should not ship the floating post bookmark styles anymore");
expectIncludes(blogPageCss, ".blog-grid {", "blog-page.css should own the blog grid layout");
expectIncludes(postPageCss, ".post-content {", "post-page.css should own the post content styles");
expectIncludes(postPageCss, ".fab-bookmark {", "post-page.css should own the floating bookmark styles");
expectIncludes(blogPageJs, "EAGER_COVER_IMAGE_COUNT = 3", "blog cards should prioritize the first visible cover images");
expectIncludes(blogPageJs, "resolveSafeCoverImage(post)", "blog cards should use display-safe cover URLs instead of share-image fallbacks");
expectIncludes(blogPageJs, 'loading="${coverLoading}"', "blog cards should keep lazy loading off the first visible covers");
expectIncludes(blogPageJs, 'fetchpriority="${coverFetchPriority}"', "blog cards should assign browser fetch priority to cover images");
expectIncludes(blogPageJs, "preloadCoverImages(data.results)", "blog cards should preload the first visible cover images after list data arrives");
expectIncludes(blogPageJs, "blog-card-cover-fallback", "blog cards should show a stable fallback while remote covers load");
expectIncludes(blogPageCss, ".blog-card-cover-fallback", "blog card cover CSS should keep fallback art visible until the image paints");
expectIncludes(blogPageCss, "z-index: 2;\n  border-radius: inherit;", "blog card link layer should stay above cover media");
expectIncludes(blogPageCss, "pointer-events: none;\n}", "blog card cover media should not swallow clicks meant for the card link");
expectIncludes(blogPageCss, "z-index: 3;\n  display: inline-flex;", "blog card bookmark button should stay above the card link layer");
expectIncludes(commonJs, "DESKTOP_PARTICLE_COUNT = 350", "particle runtime should preserve the desktop particle density");
expectIncludes(commonJs, "MOBILE_PARTICLE_COUNT = 48", "particle runtime should use a lighter mobile particle density");
expectIncludes(commonJs, "shouldReduceMobileParticles", "particle runtime should gate reduced-motion behavior to mobile particles");
expectIncludes(commonJs, "pauseMobileParticlesDuringScroll", "particle runtime should pause mobile particles while scrolling");
expectIncludes(blogPageCss, "opacity 0.3s ease", "blog cards should use shorter reveal transitions on mobile");
expectIncludes(blogPageJs, 'window.scrollTo({ top: 0, behavior: "auto" });', "blog pagination should avoid smooth-scroll jank on mobile");
expectIncludes(notionApiJs, "POSTS_RESPONSE_CACHE_TTL", "notion client should keep a short in-memory list cache for fast returns");
expectIncludes(notionContentJs, "IMAGE_PROXY_PATH", "shared notion content should proxy remote display images through the same-origin image endpoint");
expectIncludes(apiImageJs, "IMAGE_PROXY_CACHE_CONTROL", "image proxy endpoint should cache successful image responses at the edge");
expectIncludes(packageJson, '"dev": "node scripts/local-server.mjs"', "package scripts should expose the local API-aware dev server");
expectIncludes(localServerJs, '["/api/image", require("../api/image.js")]', "local dev server should route the image proxy endpoint");
expectIncludes(spaRouterJs, 'script[src]:not([data-spa-runtime])', "SPA router should skip shared runtime scripts via HTML metadata");
expectIncludes(spaRouterJs, "waitForPaintOpportunity", "SPA router should avoid fixed navigation delay floors");
expectNotIncludes(spaRouterJs, "setTimeout(resolve, 150)", "SPA router should not add an artificial 150ms delay to every page transition");
expectIncludes(spaRouterJs, "pendingPageFetches", "SPA router should coalesce in-flight page HTML prefetch and navigation requests");
expectIncludes(spaRouterJs, "buildPostTemplateFallbackUrl", "SPA router should recover post navigation when the local server lacks /posts rewrites");
expectIncludes(spaRouterJs, 'templateUrl.searchParams.set("id", postId);', "SPA router post fallback should load the static post template with the target id");
expectIncludes(spaRouterJs, "ROUTE_ENTER_TRANSITION", "SPA router should keep a visible route enter animation after cache hits");
expectIncludes(spaRouterJs, "translateY(22px) scale(0.985)", "SPA router should make page transitions visually noticeable without delaying navigation");
expectIncludes(spaRouterJs, "pointerEvents = \"none\"", "SPA router should avoid interactions during route transitions");
assert.ok(
  !spaRouterJs.includes("SHARED_RUNTIME_SCRIPT_NAMES"),
  "SPA router should not hardcode the shared runtime script list",
);

const siteUtilsHarness = loadBrowserScript("js/site-utils.js", {
  window: {
    location: new URL("https://example.com/blog.html?category=Tech"),
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
    NotionContent: {
      resolveDisplayImageUrl: (value, baseOrigin) => {
        if (!value || typeof value !== "string") return null;
        const parsed = new URL(value, baseOrigin);
        return parsed.protocol === "https:" || parsed.origin === new URL(baseOrigin).origin
          ? parsed.href
          : null;
      },
      resolveProxiedDisplayImageUrl: (value, baseOrigin) => {
        if (!value || typeof value !== "string") return null;
        const parsed = new URL(value, baseOrigin);
        if (parsed.origin === new URL(baseOrigin).origin) return parsed.href;
        const proxyUrl = new URL("/api/image", baseOrigin);
        proxyUrl.searchParams.set("src", parsed.href);
        return proxyUrl.href;
      },
    },
  },
  document: {
    referrer: "https://example.com/blog.html?page=2",
  },
});
assert.equal(
  siteUtilsHarness.window.SiteUtils.buildPostPath("post 1"),
  "/posts/post%201",
  "SiteUtils should centralize canonical post-path generation",
);
const parsedBookmarkHash = siteUtilsHarness.window.SiteUtils.parseBookmarkListingHash(
  "#bookmarks?search=Alpha&page=2",
);
assert.equal(parsedBookmarkHash.active, true, "SiteUtils should detect bookmark hash routes");
assert.equal(parsedBookmarkHash.search, "Alpha", "SiteUtils should recover bookmark hash search state");
assert.equal(parsedBookmarkHash.page, 2, "SiteUtils should recover bookmark hash page state");
assert.equal(
  parsedBookmarkHash.normalizedHash,
  "#bookmarks?search=Alpha&page=2",
  "SiteUtils should emit canonical bookmark hash routes",
);
assert.equal(
  siteUtilsHarness.window.SiteUtils.resolveShareImageUrl(
    "https://assets.example.com/image.png?X-Amz-Algorithm=test",
    "https://example.com/fallback.png",
  ),
  "https://example.com/fallback.png",
  "SiteUtils should drop expiring share-image URLs in favor of stable fallbacks",
);
assert.equal(
  siteUtilsHarness.window.SiteUtils.sanitizeImageUrl("http://cdn.example.com/cover.png"),
  null,
  "SiteUtils should reject external http images through the shared renderer path",
);
assert.equal(
  siteUtilsHarness.window.SiteUtils.sanitizeImageUrl("/cover.png"),
  "https://example.com/cover.png",
  "SiteUtils should keep same-origin image URLs through the shared renderer path",
);
assert.equal(
  siteUtilsHarness.window.SiteUtils.resolveProxiedDisplayImageUrl("https://assets.example.com/cover.png"),
  "https://example.com/api/image?src=https%3A%2F%2Fassets.example.com%2Fcover.png",
  "SiteUtils should expose the shared proxied display image resolver",
);
const siteUtilsFallbackHarness = loadBrowserScript("js/site-utils.js", {
  window: {
    location: new URL("https://example.com/blog.html"),
  },
  document: {
    referrer: "",
  },
});
assert.equal(
  siteUtilsFallbackHarness.window.SiteUtils.sanitizeImageUrl("http://cdn.example.com/cover.png"),
  null,
  "SiteUtils fallback should reject external http images that production CSP blocks",
);
assert.equal(
  siteUtilsFallbackHarness.window.SiteUtils.sanitizeImageUrl("https://cdn.example.com/cover.png"),
  "https://cdn.example.com/cover.png",
  "SiteUtils fallback should allow external https images",
);
assert.equal(
  siteUtilsFallbackHarness.window.SiteUtils.sanitizeImageUrl("/cover.png"),
  "https://example.com/cover.png",
  "SiteUtils fallback should allow same-origin images",
);
assert.equal(
  siteUtilsHarness.window.SiteUtils.getPreferredBlogReturnUrl(),
  "https://example.com/blog.html?category=Tech",
  "SiteUtils should remember the most recent blog listing URL",
);

const seoHead = createHeadMock();
const descriptionMeta = new FakeElement();
descriptionMeta.tagName = "meta";
descriptionMeta.setAttribute("name", "description");
descriptionMeta.content = "Initial description";
seoHead.appendChild(descriptionMeta);
const seoDocument = {
  title: "Original title",
  head: seoHead,
  querySelector(selector) {
    return seoHead.querySelector(selector);
  },
  createElement(tagName) {
    const element = new FakeElement();
    element.tagName = String(tagName).toLowerCase();
    return element;
  },
};
const seoHarness = loadBrowserScript("js/seo-meta.js", {
  window: {
    location: new URL("https://example.com/blog.html"),
    SiteUtils: {
      resolveShareImageUrl: (candidate, fallback) => candidate || fallback,
    },
  },
  document: seoDocument,
});
seoHarness.window.updateSeoMeta({
  title: "Updated article title",
  description: "Updated description",
  canonicalUrl: "https://example.com/posts/post-1#fragment",
  robots: "index, follow",
});
assert.equal(seoHarness.document.title, "Updated article title", "SEO runtime should update document.title");
assert.equal(
  seoHead.querySelector('meta[name="description"]').content,
  "Updated description",
  "SEO runtime should update the meta description",
);
assert.equal(
  seoHead.querySelector('link[rel="canonical"]').href,
  "https://example.com/posts/post-1",
  "SEO runtime should strip hashes from the canonical URL",
);
assert.equal(
  seoHead.querySelector('meta[name="robots"]').content,
  "index, follow",
  "SEO runtime should set robots metadata when requested",
);
seoHarness.window.updateSeoMeta({ robots: null });
assert.equal(
  seoHead.querySelector('meta[name="robots"]'),
  null,
  "SEO runtime should remove robots metadata when callers clear it",
);

const routerReplaceCalls = [];
const routerHarness = loadBrowserScript("js/spa-router.js", {
  window: {
    location: new URL("https://example.com/index.html"),
    history: {
      pushState: () => {},
      replaceState(state, title, nextUrl) {
        routerReplaceCalls.push(String(nextUrl));
      },
    },
    PageProgress: {
      start() {},
      finish() {},
    },
    PageRuntime: {
      getPageIdFromUrl: () => null,
      initializePage: () => null,
      cleanupCurrentPage: () => {},
      register: () => {},
    },
  },
  document: {
    head: {
      appendChild: () => null,
    },
    scripts: [],
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  globals: {
    navigator: {
      connection: null,
    },
    Element: class {},
    HTMLLinkElement: class {},
    DOMParser: class {},
  },
});
assert.equal(
  routerReplaceCalls.at(-1),
  "https://example.com/",
  "SPA router should canonicalize the duplicate /index.html route on boot",
);
assert.equal(
  typeof routerHarness.window.SPARouter?.navigate,
  "function",
  "SPA router should expose a navigate() API",
);

expectIncludes(runtimeCoreJs, 'application/ld+json', "runtime-core.js should own structured data script management");
expectIncludes(runtimeCoreJs, "readStructuredDataNonce", "runtime-core.js should only create JSON-LD nodes when a request nonce is available");
expectIncludes(runtimeCoreJs, "document.head?.querySelector", "runtime-core.js should only trust nonce-bearing scripts already present in the active document head");
expectIncludes(runtimeCoreJs, 'script.setAttribute("nonce", nonce)', "runtime-core.js should preserve CSP nonce protection for runtime JSON-LD updates");
expectIncludes(runtimeCoreJs, "page-progress", "runtime-core.js should wire the shared page progress bar");
expectIncludes(runtimeCoreJs, "focusSpaContent", "runtime-core.js should expose SPA focus management");
expectIncludes(runtimeCoreJs, "const PageRuntime = (() => {", "runtime-core.js should own page module registration and cleanup");
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
expectIncludes(notionContentJs, 'const SAFE_IMAGE_PROTOCOLS = new Set(["https:"])', "shared notion content module should align external image URL policy with production CSP");
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
  notionContentHelpers.getRemoteBlogCategories().some(
    (category) => category.name && category.name !== notionContentHelpers.ALL_CATEGORY,
  ),
  "shared notion content module should publish the remote category list for client pages",
);
assert.equal(
  notionContentHelpers.resolveDisplayImageUrl("http://cdn.example.com/cover.png", "https://example.com"),
  null,
  "shared notion content helpers should reject external http images that production CSP would block",
);
assert.equal(
  notionContentHelpers.resolveDisplayImageUrl("/cover.png", "http://localhost:3000"),
  "http://localhost:3000/cover.png",
  "shared notion content helpers should still allow same-origin local image URLs",
);
assert.equal(
  notionContentHelpers.resolveProxiedDisplayImageUrl("/cover.png", "https://example.com"),
  "https://example.com/cover.png",
  "shared notion content helpers should keep same-origin display images direct",
);
const proxiedDisplayImageUrl = new URL(
  notionContentHelpers.resolveProxiedDisplayImageUrl("https://assets.example.com/cover.png?token=1", "https://example.com"),
);
assert.equal(
  proxiedDisplayImageUrl.origin,
  "https://example.com",
  "shared notion content helpers should keep proxied image URLs same-origin",
);
assert.equal(
  proxiedDisplayImageUrl.pathname,
  "/api/image",
  "shared notion content helpers should send remote display images through the image proxy path",
);
assert.equal(
  proxiedDisplayImageUrl.searchParams.get("src"),
  "https://assets.example.com/cover.png?token=1",
  "shared notion content helpers should preserve the upstream remote image URL inside the proxy query",
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
const renderedImagePriorityHtml = normalizeHtml(notionContentHelpers.renderBlocks([
  {
    type: "image",
    url: "https://example.com/first.png",
    caption: "First image",
  },
  {
    type: "image",
    url: "https://example.com/second.png",
    caption: "Second image",
  },
], {
  baseOrigin: FIXTURE_BASE_ORIGIN,
}));
expectIncludes(
  renderedImagePriorityHtml,
  'src="https://example.com/first.png" alt="First image" loading="eager" decoding="async" fetchpriority="high"',
  "shared notion content module should prioritize the first article image for cover-like first paint",
);
expectIncludes(
  renderedImagePriorityHtml,
  'src="https://example.com/second.png" alt="Second image" loading="lazy" decoding="async"',
  "shared notion content module should keep later article images lazy",
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
    coverEmoji: "📘",
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
    Title: { id: "title", name: "Title", type: "title" },
    Summary: { id: "excerpt", name: "Summary", type: "rich_text" },
    "Read Time": { id: "readTime", name: "Read Time", type: "rich_text" },
    Tags: { id: "tags", name: "Tags", type: "multi_select" },
    Category: { id: "category", name: "Category", type: "select" },
    "Published At": { id: "date", name: "Published At", type: "date" },
  },
});
assert.equal(renamedSchema.title?.name, "Title", "schema resolution should find renamed title properties");
assert.equal(
  notionContentHelpers.buildPostSearchText({
    title: "  Shared Search  ",
    excerpt: "Helper Text",
    tags: ["TypeScript", "  Testing "],
  }),
  "shared search helper text typescript testing",
  "shared notion content helpers should normalize reusable post search text consistently",
);
assert.equal(
  notionContentHelpers.mapNotionPage({
    id: "post-1",
    icon: { emoji: "📘" },
    properties: {
      Title: { id: "title", name: "Title", type: "title", title: [{ plain_text: "Schema-aware title" }] },
      Summary: { id: "excerpt", name: "Summary", type: "rich_text", rich_text: [{ plain_text: "Schema-aware excerpt" }] },
      "Read Time": { id: "readTime", name: "Read Time", type: "rich_text", rich_text: [{ plain_text: "5 min" }] },
      Tags: { id: "tags", name: "Tags", type: "multi_select", multi_select: [{ name: "TypeScript" }] },
      Category: { id: "category", name: "Category", type: "select", select: { name: "Tech" } },
      "Published At": { id: "date", name: "Published At", type: "date", date: { start: "2026-04-08" } },
    },
  }, {
    schema: renamedSchema,
  }).title,
  "Schema-aware title",
  "page mapping should honor the resolved schema when Notion properties are renamed",
);
const sharedArticleStructuredData = notionContentHelpers.buildArticleStructuredData({
  id: "post-1",
  title: "Structured article",
  excerpt: "Structured excerpt",
  category: "Tech",
  date: "2026-04-17",
  coverImage: "https://example.com/cover.png",
  tags: ["Alpha", "Beta"],
}, {
  canonicalUrl: "https://example.com/posts/post-1",
  defaultShareImageUrl: "https://example.com/favicon.png?v=2",
  baseOrigin: "https://example.com",
});
assert.equal(
  sharedArticleStructuredData.mainEntityOfPage,
  "https://example.com/posts/post-1",
  "shared notion content helpers should build canonical article structured data",
);
assert.equal(
  sharedArticleStructuredData.image[0],
  "https://example.com/cover.png",
  "shared notion content helpers should preserve stable article images in structured data",
);
const serverArticleStructuredData = serverNotionHelpers.buildArticleStructuredData({
  id: "post-1",
  title: "Structured article",
  excerpt: "Structured excerpt",
  category: "Tech",
  date: "2026-04-17",
  coverImage: "https://example.com/cover.png",
  tags: ["Alpha", "Beta"],
});
assert.equal(
  serverArticleStructuredData.headline,
  "Structured article",
  "server notion structured data should preserve the article headline",
);
assert.equal(
  serverArticleStructuredData.keywords,
  "Alpha, Beta",
  "server notion structured data should preserve normalized article keywords",
);
assert.ok(
  serverArticleStructuredData.mainEntityOfPage.endsWith("/posts/post-1"),
  "server notion structured data should point at the canonical post route",
);
assert.equal(
  serverArticleStructuredData.image[0],
  "https://example.com/cover.png",
  "server notion structured data should preserve stable article images",
);
function buildBookmarkListingUrlMock({ search = "", page = 1, pathname = "/blog.html" } = {}) {
  const params = new URLSearchParams();
  const normalizedSearch = typeof search === "string" ? search.trim() : "";
  const normalizedPage = Math.max(1, Number.parseInt(String(page ?? ""), 10) || 1);
  if (normalizedSearch) params.set("search", normalizedSearch);
  if (normalizedPage > 1) params.set("page", String(normalizedPage));
  const query = params.toString();
  return `${pathname}#bookmarks${query ? `?${query}` : ""}`;
}

function parseBookmarkListingHashMock(hash = "") {
  const rawHash = typeof hash === "string" ? hash.trim() : "";
  if (!rawHash.startsWith("#bookmarks")) {
    return { active: false, search: "", page: 1, normalizedHash: "" };
  }
  const params = new URLSearchParams(rawHash.slice("#bookmarks".length).replace(/^\?/, ""));
  const search = (params.get("search") || "").trim();
  const page = Math.max(1, Number.parseInt(String(params.get("page") || ""), 10) || 1);
  const normalizedHash = `#bookmarks${params.toString() ? `?${params.toString()}` : ""}`;
  return { active: true, search, page, normalizedHash };

}
const registeredPages = new Map();
const blogFiltersEl = new FakeElement();
const blogSearchEl = new FakeElement();
const blogGridEl = new FakeElement();
const blogEmptyEl = new FakeElement();
const blogPaginationEl = new FakeElement();
const blogStatusEl = new FakeElement();
const blogTopActionsEl = new FakeElement();
const blogPageTitleEl = new FakeElement();
const topActionOverview = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "鎬昏" } : null),
};
const topActionBookmark = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "鏀惰棌" } : null),
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
        { name: "All", emoji: "📚" },
        { name: "Tech", emoji: "🧠" },
        { name: "Bookmarks", emoji: "🔖" },
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
      buildBookmarkListingUrl: buildBookmarkListingUrlMock,
      parseBookmarkListingHash: parseBookmarkListingHashMock,
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
        topActions: blogTopActionsEl,
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
    dataset: { category: "Tech" },
  closest(selector) {
    return selector === ".filter-btn" ? this : null;
  },
};
blogFiltersEl.dispatch("click", { target: filterButton });
assert.equal(
  blogHistory.pushCalls.at(-1),
  "/blog.html?category=Tech",
  "blog page should push filter state changes so browser back returns to the previous listing state",
);
blogSearchEl.value = "deep test";
blogSearchEl.dispatch("input");
await new Promise((resolve) => setTimeout(resolve, 350));
assert.equal(
  blogHistory.replaceCalls.at(-1),
  "/blog.html?category=Tech&search=deep+test",
  "blog page should replace the current history entry while live search text changes",
);
let didPreventOverviewNav = false;
blogTopActionsEl.dispatch("click", {
  target: {
    href: "https://example.com/blog.html",
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
  },
  preventDefault() {
    didPreventOverviewNav = true;
  },
});
assert.equal(
  didPreventOverviewNav,
  true,
  "blog page should intercept same-listing top action navigation for smoother in-page transitions",
);
assert.equal(
  blogHistory.pushCalls.at(-1),
  "/blog.html",
  "blog page should push overview navigation without falling back to native hash routing",
);
blogPageCleanup?.();
const legacyBookmarkRegisteredPages = new Map();
const legacyBookmarkFiltersEl = new FakeElement();
const legacyBookmarkSearchEl = new FakeElement();
const legacyBookmarkGridEl = new FakeElement();
const legacyBookmarkEmptyEl = new FakeElement();
const legacyBookmarkPaginationEl = new FakeElement();
const legacyBookmarkStatusEl = new FakeElement();
const legacyBookmarkTitleEl = new FakeElement();
const legacyBookmarkOverviewAction = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "鎬昏" } : null),
};
const legacyBookmarkAction = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "鏀惰棌" } : null),
};
const legacyBookmarkLocation = new URL("https://example.com/blog.html?category=%E6%94%B6%E8%97%8F&search=Alpha&page=2");
const legacyBookmarkHistory = {
  pushCalls: [],
  replaceCalls: [],
  pushState(state, title, nextUrl) {
    this.pushCalls.push(String(nextUrl));
    legacyBookmarkLocation.href = new URL(String(nextUrl), legacyBookmarkLocation.href).href;
  },
  replaceState(state, title, nextUrl) {
    this.replaceCalls.push(String(nextUrl));
    legacyBookmarkLocation.href = new URL(String(nextUrl), legacyBookmarkLocation.href).href;
  },
};
loadBrowserScript("js/blog-page.js", {
  window: {
    location: legacyBookmarkLocation,
    history: legacyBookmarkHistory,
    scrollTo: () => {},
    NotionAPI: {
      escapeHtml: (value) => String(value ?? ""),
      getCategoryColor: () => ({ bg: "#000", color: "#fff", border: "#222" }),
      getCategories: () => [
        { name: "All", emoji: "📚" },
        { name: "Tech", emoji: "🧠" },
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
        legacyBookmarkRegisteredPages.set(pageId, pageModule);
      },
    },
    SiteUtils: {
      rememberBlogReturnUrl: () => {},
      sanitizeCoverBackground: (value, fallback) => value || fallback,
      resolveShareImageUrl: (value) => value,
      resolveDisplayImageUrl: (value) => value,
      sanitizeImageUrl: (value) => value,
      buildPostPath: (postId) => `/posts/${postId}`,
      buildBookmarkListingUrl: buildBookmarkListingUrlMock,
      parseBookmarkListingHash: parseBookmarkListingHashMock,
    },
    updateSeoMeta: () => {},
    initBlogCardReveal: () => null,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  },
  document: {
    getElementById(id) {
      return {
        blogFilters: legacyBookmarkFiltersEl,
        blogSearch: legacyBookmarkSearchEl,
        blogGrid: legacyBookmarkGridEl,
        emptyState: legacyBookmarkEmptyEl,
        pagination: legacyBookmarkPaginationEl,
        blogStatus: legacyBookmarkStatusEl,
      }[id] || null;
    },
    querySelector(selector) {
      return selector === ".page-title" ? legacyBookmarkTitleEl : null;
    },
    querySelectorAll(selector) {
      return selector === ".top-actions .action-btn"
        ? [legacyBookmarkOverviewAction, legacyBookmarkAction]
        : [];
    },
    createElement() {
      return new FakeElement();
    },
  },
});
const legacyBookmarkCleanup = legacyBookmarkRegisteredPages.get("blog")?.init?.();
await Promise.resolve();
assert.equal(
  legacyBookmarkHistory.replaceCalls.at(0),
  "/blog.html#bookmarks?search=Alpha&page=2",
  "blog page should normalize legacy bookmark query routes onto the hash-only bookmark view URL",
);
legacyBookmarkCleanup?.();
const bookmarkHashRegisteredPages = new Map();
const bookmarkHashFiltersEl = new FakeElement();
const bookmarkHashSearchEl = new FakeElement();
const bookmarkHashGridEl = new FakeElement();
const bookmarkHashEmptyEl = new FakeElement();
const bookmarkHashPaginationEl = new FakeElement();
const bookmarkHashStatusEl = new FakeElement();
const bookmarkHashTitleEl = new FakeElement();
const bookmarkHashHandlers = new Set();
const bookmarkHashOverviewAction = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "鎬昏" } : null),
};
const bookmarkHashAction = {
  classList: createClassList(),
  querySelector: (selector) => (selector === "span" ? { textContent: "鏀惰棌" } : null),
};
const bookmarkHashLocation = new URL("https://example.com/blog.html#bookmarks?search=TypeScript%20%20Testing&page=3");
const bookmarkHashHistory = {
  pushCalls: [],
  replaceCalls: [],
  pushState(state, title, nextUrl) {
    this.pushCalls.push(String(nextUrl));
    bookmarkHashLocation.href = new URL(String(nextUrl), bookmarkHashLocation.href).href;
  },
  replaceState(state, title, nextUrl) {
    this.replaceCalls.push(String(nextUrl));
    bookmarkHashLocation.href = new URL(String(nextUrl), bookmarkHashLocation.href).href;
  },
};
loadBrowserScript("js/blog-page.js", {
  window: {
    location: bookmarkHashLocation,
    history: bookmarkHashHistory,
    scrollTo: () => {},
    BookmarkManager: {
      getAll: () => [{
        id: "bookmark-hit",
        title: "Bookmark hit",
        excerpt: "Local only",
        category: "",
        date: "",
        readTime: "",
        coverImage: null,
        coverEmoji: "馃摑",
        coverGradient: "linear-gradient(135deg, #111111, #222222)",
        tags: ["TypeScript", "Testing"],
      }],
      isBookmarked: () => true,
      toggleById: () => true,
      hasLegacyMetadata: () => false,
    },
    PageRuntime: {
      register(pageId, pageModule) {
        bookmarkHashRegisteredPages.set(pageId, pageModule);
      },
    },
    SiteUtils: {
      rememberBlogReturnUrl: () => {},
      sanitizeCoverBackground: (value, fallback) => value || fallback,
      resolveShareImageUrl: (value) => value,
      resolveDisplayImageUrl: (value) => value,
      sanitizeImageUrl: (value) => value,
      buildPostPath: (postId) => `/posts/${postId}`,
    },
    updateSeoMeta: () => {},
    initBlogCardReveal: () => null,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    addEventListener(type, handler) {
      if (type === "hashchange") {
        bookmarkHashHandlers.add(handler);
      }
    },
    removeEventListener(type, handler) {
      if (type === "hashchange") {
        bookmarkHashHandlers.delete(handler);
      }
    },
  },
  document: {
    getElementById(id) {
      return {
        blogFilters: bookmarkHashFiltersEl,
        blogSearch: bookmarkHashSearchEl,
        blogGrid: bookmarkHashGridEl,
        emptyState: bookmarkHashEmptyEl,
        pagination: bookmarkHashPaginationEl,
        blogStatus: bookmarkHashStatusEl,
      }[id] || null;
    },
    querySelector(selector) {
      return selector === ".page-title" ? bookmarkHashTitleEl : null;
    },
    querySelectorAll(selector) {
      return selector === ".top-actions .action-btn"
        ? [bookmarkHashOverviewAction, bookmarkHashAction]
        : [];
    },
    createElement() {
      return new FakeElement();
    },
  },
});
const bookmarkHashCleanup = bookmarkHashRegisteredPages.get("blog")?.init?.();
await Promise.resolve();
assert.equal(
  bookmarkHashHistory.replaceCalls.at(0),
  "/blog.html#bookmarks?search=TypeScript++Testing&page=3",
  "blog page should preserve bookmark search and page params when it falls back to its local bookmark hash URL builder",
);
assert.ok(
  bookmarkHashGridEl.innerHTML.includes("Bookmark hit"),
  "blog page should keep bookmark search matches when the query contains extra whitespace",
);
bookmarkHashLocation.hash = "";
bookmarkHashHandlers.forEach((handler) => handler());
assert.equal(
  bookmarkHashHistory.replaceCalls.at(-1),
  "/blog.html#bookmarks?search=TypeScript++Testing",
  "blog page should keep the local bookmark view pinned to the bookmark hash route when the remote source is unavailable",
);
bookmarkHashCleanup?.();
const staleSessionSummaryKey = "notion_post_summary_stale";
const quotaSessionStorage = createQuotaLimitedStorageMock({
  initialEntries: {
    [staleSessionSummaryKey]: JSON.stringify({
      timestamp: Date.now() - 1000 * 60 * 60,
      data: {
        id: "stale-post",
        title: "Stale post",
        excerpt: "x".repeat(240),
      },
    }),
  },
  maxChars: 760,
});
let notionApiFetchCount = 0;
const notionApiHarness = loadBrowserScript("js/notion-api.js", {
  window: {
    location: new URL("https://example.com/blog.html"),
    NotionContent: notionContentHelpers,
  },
  sessionStorage: quotaSessionStorage,
  fetch: async (url) => {
    notionApiFetchCount += 1;
    assert.equal(
      String(url),
      "/api/post-data?id=session-post-1",
      "notion client should request the semantic post data endpoint for detail fetches",
    );

    return createJsonResponse({
      id: "session-post-1",
      title: "Session cached title",
      excerpt: "Session cached excerpt",
      category: "Tech",
      date: "2026-04-17",
      readTime: "5 min",
      coverImage: `${ephemeralCoverImage}&padding=${"x".repeat(360)}`,
      coverEmoji: "馃И",
      coverGradient: "linear-gradient(135deg, #111111, #222222)",
      tags: ["Alpha", "Beta", "Gamma"],
      content: [],
    });
  },
});
const notionApiFetchedPost = await notionApiHarness.window.NotionAPI.getPost("session-post-1");
assert.equal(
  notionApiFetchCount,
  1,
  "notion client should issue exactly one network request for the uncached post detail",
);
assert.equal(
  notionApiFetchedPost.id,
  "session-post-1",
  "notion client should still return the fetched post payload after compacting the summary cache entry",
);
const storedSessionSummaryRaw = quotaSessionStorage.getItem("notion_post_summary_session-post-1");
assert.ok(
  storedSessionSummaryRaw,
  "notion client should persist a compacted post summary entry even when sessionStorage quota is tight",
);
const storedSessionSummary = JSON.parse(storedSessionSummaryRaw);
assert.equal(
  storedSessionSummary.data.coverImage,
  null,
  "notion client should drop session cover URLs when they are likely ephemeral or overly large",
);
assert.ok(
  !Object.prototype.hasOwnProperty.call(storedSessionSummary.data, "_searchText"),
  "notion client should avoid storing derived search text in the persisted session summary payload",
);
assert.equal(
  quotaSessionStorage.getItem(staleSessionSummaryKey),
  null,
  "notion client should clear expired session summary entries before evicting fresher data under quota pressure",
);
const notionApiSessionReloadHarness = loadBrowserScript("js/notion-api.js", {
  window: {
    location: new URL("https://example.com/blog.html"),
    NotionContent: notionContentHelpers,
  },
  sessionStorage: quotaSessionStorage,
  fetch: async () => {
    throw new Error("Unexpected network request while reading a persisted post summary");
  },
});
const restoredSessionSummary = notionApiSessionReloadHarness.window.NotionAPI.getPostSummary("session-post-1");
assert.equal(
  restoredSessionSummary?.title,
  "Session cached title",
  "notion client should restore compacted session summaries without re-fetching the post detail",
);
assert.ok(
  restoredSessionSummary?._searchText?.includes("alpha"),
  "notion client should rebuild derived search text when reading a compacted summary back from sessionStorage",
);
expectIncludes(notionApiJs, "createRequestError", "notion client should preserve HTTP status metadata on failures");
expectIncludes(notionApiJs, "error.status = Number(status);", "notion client should attach status codes to request errors");
expectIncludes(notionApiJs, 'postsEndpoint: "/api/posts-data"', "notion client should load post listings from the semantic endpoint");
expectIncludes(notionApiJs, 'postEndpoint: "/api/post-data"', "notion client should load post details from the restricted endpoint");
expectIncludes(notionApiJs, "sharedContent.renderPostArticle", "notion client should reuse the shared article renderer instead of duplicating article markup");
expectIncludes(notionApiJs, "POST_SUMMARY_CACHE_TTL", "notion client should keep a separate summary cache for bookmarks");
expectIncludes(notionApiJs, "window.NotionContent", "notion client should reuse shared notion content helpers");
assert.ok(
  !notionApiJs.includes("const RESPONSE_CACHE_TTL"),
  "notion client should remove zero-effect response cache branches instead of carrying disabled cache code",
);
assert.ok(
  !notionApiJs.includes("const RESPONSE_STALE_TTL"),
  "notion client should remove stale-response cache branches when public content must stay live",
);
assert.ok(
  !notionApiJs.includes("浠ヤ笅閫昏緫涓庢湇鍔＄"),
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
expectIncludes(indexPageJs, "siteUtils.buildBookmarkListingUrl", "index page should reuse the shared bookmark-listing URL helper");
expectIncludes(indexPageJs, 'navigateTo(`/blog.html?search=${encodeURIComponent(query)}`);', "index page search navigation should use root-relative paths");
expectIncludes(postPageJs, 'window.StructuredData?.set?.("post-article"', "post page should publish article structured data");
expectIncludes(postPageJs, "sharedContent.buildArticleStructuredData", "post page should reuse the shared article structured-data helper");
expectIncludes(postPageJs, "initialPostData", "post page should reuse server-rendered post payloads");
expectIncludes(postPageJs, "notionApi.renderPostArticle(post)", "post page should reuse the shared article-shell renderer for client-side redraws");
expectIncludes(postPageJs, "siteUtils.getPreferredBlogReturnUrl", "post page back navigation should restore the preferred blog listing route");
expectIncludes(postPageJs, "nowBookmarked === null", "post page should leave bookmark UI unchanged when persistence fails");
expectIncludes(postPageJs, "isMissingPostError", "post page should distinguish not-found posts from temporary failures");
expectIncludes(postPageJs, "showEmpty(isMissingPostError(error) ? \"not-found\" : \"unavailable\")", "post page should map 404-like errors to the not-found empty state");
expectIncludes(postPageJs, "收藏失败，请稍后重试", "post page should announce bookmark persistence failures");
expectIncludes(postPageJs, "hasServerRenderedContent", "post page should detect pre-rendered article content");
expectIncludes(postPageJs, "showServerRenderedFallback", "post page should preserve server-rendered content when NotionAPI is unavailable");
expectIncludes(postPageJs, "canBookmarkFromInitialData", "post page should recover bookmark controls from SSR initial data when the client API is unavailable");
expectIncludes(postPageJs, "initBookmark(initialPostData);", "post page should still wire bookmark controls from SSR summary data in fallback mode");
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
const registeredPostPages = new Map();
let fallbackBookmarkToggleCount = 0;
class FakeScriptElement extends FakeElement {}
const postSkeletonEl = new FakeElement();
const postContentEl = new FakeElement();
postContentEl.innerHTML = "<div>SSR article body</div>";
const postEmptyEl = new FakeElement();
const postBackEl = new FakeElement();
postBackEl.style = {
  removeProperty() {},
  setProperty() {},
};
const postArticleEl = new FakeElement();
postArticleEl.querySelector = (selector) => (selector === ".post-back" ? postBackEl : null);
const fabBookmarkEl = new FakeElement();
const fabBookmarkLabelEl = new FakeElement();
fabBookmarkEl.querySelector = (selector) => (selector === ".fab-bookmark-label" ? fabBookmarkLabelEl : null);
const navBookmarkEl = new FakeElement();
navBookmarkEl.querySelector = () => null;
const postStatusEl = new FakeElement();
const initialPostDataScriptEl = new FakeScriptElement();
initialPostDataScriptEl.textContent = JSON.stringify({
  id: "post-1",
  title: "SSR fallback title",
  excerpt: "SSR fallback excerpt",
  category: "Tech",
  date: "2026-04-17",
  readTime: "5 min",
  coverImage: null,
  coverEmoji: "馃摑",
  coverGradient: "linear-gradient(135deg, #111111, #222222)",
  tags: ["TypeScript"],
});
loadBrowserScript("js/post-page.js", {
  window: {
    location: new URL("https://example.com/posts/post-1"),
    BookmarkManager: {
      isBookmarked: () => false,
      toggle(post) {
        fallbackBookmarkToggleCount += 1;
        return post?.id === "post-1";
      },
    },
    PageRuntime: {
      register(pageId, pageModule) {
        registeredPostPages.set(pageId, pageModule);
      },
    },
    SiteUtils: {
      getPostIdFromUrl: () => "post-1",
      normalizePostId: (value) => String(value || "").trim() || null,
      createMediaQueryList: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      getPreferredBlogReturnUrl: () => "https://example.com/blog.html",
    },
  },
  document: {
    getElementById(id) {
      return {
        postSkeleton: postSkeletonEl,
        postContent: postContentEl,
        postEmpty: postEmptyEl,
        postArticle: postArticleEl,
        fabBookmark: fabBookmarkEl,
        navBookmark: navBookmarkEl,
        postBack: postBackEl,
        postStatus: postStatusEl,
        initialPostData: initialPostDataScriptEl,
      }[id] || null;
    },
  },
  globals: {
    HTMLScriptElement: FakeScriptElement,
  },
});
const postPageCleanup = registeredPostPages.get("post")?.init?.();
await Promise.resolve();
assert.equal(
  fabBookmarkEl.style.display,
  "flex",
  "post page should keep the floating bookmark control available when only the SSR fallback payload is available",
);
fabBookmarkEl.dispatch("click");
assert.equal(
  fallbackBookmarkToggleCount,
  1,
  "post page should still wire bookmark interactions from SSR initial data when the client API is unavailable",
);
postPageCleanup?.();
expectIncludes(apiPostJs, 'upsertStructuredDataScript(html, "post-article"', "article HTML route should emit structured data");
expectIncludes(apiPostJs, 'id="initialPostData"', "article HTML route should emit initial post data");
expectIncludes(apiPostJs, "buildUnavailableContent", "article HTML route should distinguish upstream failures from not-found routes");
expectIncludes(apiPostJs, "rejectUnsupportedReadMethod", "article HTML route should reuse the shared read-method guard");
expectIncludes(apiPostJs, "getPublicPostErrorStatus", "article HTML route should reuse shared public-post error mapping");
expectIncludes(apiPostJs, "fetchPublicPost", "article HTML route should only render posts from the public blog set");
expectIncludes(apiPostJs, "renderPostArticle(post, { renderedContent, baseOrigin })", "article HTML route should reuse the shared article-shell renderer for SSR");
expectIncludes(apiPostJs, "POST_CONTENT_PATTERN", "article HTML route should tolerate harmless postContent template attribute changes");
expectIncludes(apiPostJs, "postContent:fallback", "article HTML route should fall back to article insertion when the postContent anchor changes");
expectIncludes(apiPostJs, '"Cache-Control", "no-store"', "article HTML route should not cache public post responses");
expectIncludes(apiPostJs, "replaceMarkup(", "article HTML route should use literal-safe SSR replacements for dynamic content");
expectIncludes(apiPostJs, "upsertHeadMarkup", "article HTML route should centralize head-tag insertion and replacement");
expectIncludes(apiPostJs, "resolveShareImageUrl(post.coverImage, defaultShareImageUrl, siteOrigin)", "article HTML route should resolve og:image against the site origin consistently");
expectIncludes(apiPostJs, "../server/security-policy", "article HTML route should reuse the shared security policy builder");
expectIncludes(apiPostJs, "createCspNonce", "article HTML route should use per-request nonces for inline JSON data");
expectIncludes(apiPostJs, "applyHtmlSecurityHeaders", "article HTML route should emit nonce-aware CSP headers from the SSR function");
expectIncludes(apiPostJs, "replaceContentSecurityPolicyMeta", "article HTML route should keep template CSP meta in sync with the response nonce");
expectNotIncludes(apiPostJs, "script-src-elem 'self' 'unsafe-inline'", "article HTML route should not allow arbitrary inline script elements");

const replacementSentinel = "$& :: $` :: $'";
const escapedReplacementSentinel = "$&amp; :: $` :: $&#39;";
const nonceSentinel = "nonce-test-123";
const replacedPostContent = apiPostHelpers.replacePostContent(
  '<article><div class="placeholder" id="postContent" data-template="changed"></div></article>',
  {
    id: "post-1",
    title: "Rendered title",
    tags: [],
  },
  {
    renderedContent: "<p>Rendered body</p>",
    baseOrigin: "https://example.com",
  },
);
expectIncludes(replacedPostContent, 'id="postContent" style="display: block;"', "post content replacement should not depend on the original style attribute");
expectIncludes(replacedPostContent, "Rendered body", "post content replacement should preserve SSR article body markup");
const injectedInitialPostData = apiPostHelpers.injectInitialPostData("<main></main>", {
  title: replacementSentinel,
}, {
  scriptNonce: nonceSentinel,
});
expectIncludes(injectedInitialPostData, replacementSentinel, "initial post data injection should preserve replacement tokens literally");
expectIncludes(injectedInitialPostData, `nonce="${nonceSentinel}"`, "initial post data injection should carry the request CSP nonce");
const initialPostPayload = apiPostHelpers.buildInitialPostPayload({
  id: "post-1",
  title: "Payload title",
  excerpt: "Payload excerpt",
  category: "Tech",
  date: "2026-04-11",
  readTime: "5 min",
  coverImage: "https://example.com/cover.png",
  coverEmoji: "棣冩憫",
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
}, {
  scriptNonce: nonceSentinel,
});
expectIncludes(structuredDataHtml, replacementSentinel, "structured data injection should preserve replacement tokens literally");
expectIncludes(structuredDataHtml, `nonce="${nonceSentinel}"`, "structured data injection should carry the request CSP nonce");
const nonceContentSecurityPolicy = securityPolicyHelpers.buildContentSecurityPolicy({
  scriptNonce: nonceSentinel,
});
expectIncludes(
  nonceContentSecurityPolicy,
  `script-src 'self' 'nonce-${nonceSentinel}'`,
  "article HTML route should allow inline JSON scripts only through the request nonce",
);
expectIncludes(
  nonceContentSecurityPolicy,
  "frame-ancestors 'none'",
  "article HTML route CSP should preserve clickjacking protection when emitted as a header",
);
expectNotIncludes(
  nonceContentSecurityPolicy,
  "script-src 'self' 'unsafe-inline'",
  "article HTML route nonce CSP should not fall back to unsafe inline scripts",
);
expectNotIncludes(
  nonceContentSecurityPolicy,
  "script-src-elem 'self' 'unsafe-inline'",
  "article HTML route nonce CSP should not allow arbitrary inline script elements",
);
const replacedCspMeta = apiPostHelpers.replaceContentSecurityPolicyMeta(
  '<head><meta http-equiv="Content-Security-Policy" content="old" /></head>',
  { scriptNonce: nonceSentinel },
);
expectIncludes(replacedCspMeta, `nonce-${nonceSentinel}`, "article HTML route should mirror the request nonce into the CSP meta tag");
expectNotIncludes(replacedCspMeta, "frame-ancestors", "article HTML route should avoid frame-ancestors in meta CSP where browsers ignore it");
const reorderedCspMeta = apiPostHelpers.replaceContentSecurityPolicyMeta(
  "<head><meta content='old' data-test='1' http-equiv='content-security-policy'></head>",
  { scriptNonce: nonceSentinel },
);
expectIncludes(reorderedCspMeta, `nonce-${nonceSentinel}`, "article HTML route should replace CSP meta tags regardless of attribute order or quote style");
expectNotIncludes(reorderedCspMeta, "content='old'", "article HTML route should not leave an old CSP meta policy behind when attributes are reordered");
assert.equal(
  (reorderedCspMeta.match(/http-equiv="Content-Security-Policy"/g) || []).length,
  1,
  "article HTML route should emit one canonical CSP meta tag after replacing a reordered template tag",
);
const dedupedCspMeta = apiPostHelpers.replaceContentSecurityPolicyMeta(
  "<head><meta http-equiv=Content-Security-Policy content=old><meta content=\"legacy\" http-equiv=\"Content-Security-Policy\"></head>",
  { scriptNonce: nonceSentinel },
);
assert.equal(
  (dedupedCspMeta.match(/http-equiv="Content-Security-Policy"/g) || []).length,
  1,
  "article HTML route should collapse duplicate CSP meta tags to avoid intersecting policies",
);
expectNotIncludes(dedupedCspMeta, "content=old", "article HTML route should remove duplicate unquoted CSP meta policies");
expectNotIncludes(dedupedCspMeta, 'content="legacy"', "article HTML route should remove duplicate quoted CSP meta policies");

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
const originalConsoleWarn = console.warn;
const sameValueReplacementWarnings = [];
console.warn = (...args) => {
  sameValueReplacementWarnings.push(args.join(" "));
};
try {
  apiPostHelpers.replaceHeadMeta(`<!doctype html><html><head>
<title>Same title</title>
<meta name="description" content="Same description" />
<meta property="og:title" content="Same title" />
<meta property="og:description" content="Same description" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://example.com/post.html" />
<meta property="og:image" content="https://example.com/favicon.png?v=2" />
<meta property="og:image:alt" content="Share Everything" />
<link rel="canonical" href="https://example.com/post.html" />
</head></html>`, {
    title: "Same title",
    description: "Same description",
    url: "https://example.com/post.html",
    image: "https://example.com/favicon.png?v=2",
    imageAlt: "Share Everything",
    canonicalUrl: "https://example.com/post.html",
    robots: "",
    ogType: "website",
  });
} finally {
  console.warn = originalConsoleWarn;
}
assert.equal(
  sameValueReplacementWarnings.length,
  0,
  "head metadata replacement should not warn when a template pattern matched but the replacement value is unchanged",
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
const postRouteMethodNotAllowedRes = createApiResponseRecorder();
await apiPostHandler({ method: "POST", query: {} }, postRouteMethodNotAllowedRes);
assert.equal(postRouteMethodNotAllowedRes.statusCode, 405, "article HTML route should reject unsupported methods with HTTP 405");
assert.equal(postRouteMethodNotAllowedRes.getHeader("allow"), "GET", "article HTML route should advertise the supported methods on 405 responses");
assert.equal(postRouteMethodNotAllowedRes.getHeader("cache-control"), "no-store", "article HTML route should mark 405 responses as non-cacheable");
const postRouteHeadRes = createApiResponseRecorder();
await apiPostHandler({ method: "HEAD", query: { id: "post-1" } }, postRouteHeadRes);
assert.equal(postRouteHeadRes.statusCode, 405, "article HTML route should reject HEAD without loading Notion content");
assert.equal(postRouteHeadRes.getHeader("allow"), "GET", "article HTML route should avoid advertising HEAD when it is intentionally unsupported");
expectIncludes(apiPostsDataJs, "queryPublicPosts", "post list endpoint should serve the public blog set through a semantic API");
expectIncludes(apiPostsDataJs, '"Cache-Control", "no-store"', "post list endpoint should not cache public responses");
expectIncludes(apiPostDataJs, "fetchPublicPost", "post data endpoint should only serve posts from the public blog set");
expectIncludes(apiPostDataJs, "getPublicPostErrorStatus", "post data endpoint should reuse shared public-post error mapping");
expectIncludes(apiPostDataJs, '"Cache-Control", "no-store"', "post data endpoint should not cache public responses");
expectIncludes(publicContentJs, "rejectUnsupportedReadMethod", "public content helper should centralize read-only method guards");
const postsDataMethodNotAllowedRes = createApiResponseRecorder();
await apiPostsDataHandler({ method: "POST", query: {} }, postsDataMethodNotAllowedRes);
assert.equal(postsDataMethodNotAllowedRes.statusCode, 405, "post list endpoint should reject unsupported methods with HTTP 405");
assert.equal(postsDataMethodNotAllowedRes.getHeader("allow"), "GET", "post list endpoint should advertise the supported methods on 405 responses");
assert.equal(postsDataMethodNotAllowedRes.getHeader("cache-control"), "no-store", "post list endpoint should mark 405 responses as non-cacheable");
const postsDataHeadRes = createApiResponseRecorder();
await apiPostsDataHandler({ method: "HEAD", query: {} }, postsDataHeadRes);
assert.equal(postsDataHeadRes.statusCode, 405, "post list endpoint should reject HEAD without querying Notion");
const postDataMethodNotAllowedRes = createApiResponseRecorder();
await apiPostDataHandler({ method: "POST", query: {} }, postDataMethodNotAllowedRes);
assert.equal(postDataMethodNotAllowedRes.statusCode, 405, "post data endpoint should reject unsupported methods with HTTP 405");
assert.equal(postDataMethodNotAllowedRes.getHeader("allow"), "GET", "post data endpoint should advertise the supported methods on 405 responses");
assert.equal(postDataMethodNotAllowedRes.getHeader("cache-control"), "no-store", "post data endpoint should mark 405 responses as non-cacheable");
const postDataHeadRes = createApiResponseRecorder();
await apiPostDataHandler({ method: "HEAD", query: { id: "post-1" } }, postDataHeadRes);
assert.equal(postDataHeadRes.statusCode, 405, "post data endpoint should reject HEAD without loading the post detail tree");
expectIncludes(apiImageJs, "IMAGE_PROXY_MAX_BYTES", "image proxy endpoint should bound upstream image size");
expectIncludes(apiImageJs, "isBlockedImageHost", "image proxy endpoint should reject local and private upstream hosts");
expectIncludes(apiImageJs, "X-Content-Type-Options", "image proxy endpoint should prevent content-type sniffing");
let imageProxyFetchUrl = "";
const fakeImageBody = Buffer.from("png");
const successfulImageProxyHandler = loadCommonJsModule("api/image.js", [], {
  fetch: async (url) => {
    imageProxyFetchUrl = String(url);
    return {
      ok: true,
      status: 200,
      headers: createHeadersMock({
        "content-type": "image/png",
        "content-length": String(fakeImageBody.byteLength),
      }),
      async arrayBuffer() {
        return fakeImageBody.buffer.slice(
          fakeImageBody.byteOffset,
          fakeImageBody.byteOffset + fakeImageBody.byteLength,
        );
      },
    };
  },
});
const imageProxySuccessRes = createApiResponseRecorder();
await successfulImageProxyHandler({
  method: "GET",
  query: { src: "https://assets.example.com/cover.png" },
}, imageProxySuccessRes);
assert.equal(imageProxySuccessRes.statusCode, 200, "image proxy endpoint should return proxied images");
assert.equal(imageProxyFetchUrl, "https://assets.example.com/cover.png", "image proxy endpoint should fetch the normalized upstream image URL");
assert.equal(imageProxySuccessRes.getHeader("content-type"), "image/png", "image proxy endpoint should preserve upstream image content type");
assert.ok(
  imageProxySuccessRes.getHeader("cache-control")?.includes("s-maxage=604800"),
  "image proxy endpoint should make successful images edge-cacheable",
);
assert.ok(Buffer.isBuffer(imageProxySuccessRes.textBody), "image proxy endpoint should send a binary image buffer");
let blockedImageProxyFetchCount = 0;
const blockedImageProxyHandler = loadCommonJsModule("api/image.js", [], {
  fetch: async () => {
    blockedImageProxyFetchCount += 1;
    throw new Error("Blocked image URL should not be fetched");
  },
});
const imageProxyBlockedRes = createApiResponseRecorder();
await blockedImageProxyHandler({
  method: "GET",
  query: { src: "https://127.0.0.1/private.png" },
}, imageProxyBlockedRes);
assert.equal(imageProxyBlockedRes.statusCode, 400, "image proxy endpoint should reject private upstream hosts");
assert.equal(blockedImageProxyFetchCount, 0, "image proxy endpoint should reject private hosts before fetching");
const imageProxyMethodRes = createApiResponseRecorder();
await apiImageHandler({ method: "POST", query: { src: "https://assets.example.com/cover.png" } }, imageProxyMethodRes);
assert.equal(imageProxyMethodRes.statusCode, 405, "image proxy endpoint should reject unsupported methods");
expectIncludes(publicContentJs, "getPublicPostErrorStatus", "public content helper should centralize post error mapping");
expectIncludes(publicContentJs, "notion_public_config_error", "public content helper should surface public access misconfiguration as a server error");
expectIncludes(publicContentJs, "notion_timeout_error", "public content helper should preserve upstream timeout status");
expectIncludes(publicContentJs, "Retry-After", "public content helper should preserve retry guidance for upstream rate limits");
expectIncludes(publicContentJs, "restricted_resource", "public content helper should classify upstream Notion permission failures as server-side integration faults");
expectIncludes(publicContentJs, "object_not_found", "public content helper should classify missing upstream Notion objects as configuration faults");
expectIncludes(publicContentJs, "resourceType", "public content helper should distinguish database and page Notion errors");
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
assert.equal(
  publicContentHelpers.getPublicContentErrorStatus({
    status: 404,
    notionCode: "object_not_found",
  }),
  500,
  "public content helper should treat missing upstream Notion objects as a stable server-side configuration error",
);
assert.equal(
  publicContentHelpers.getPublicPostErrorStatus({
    status: 404,
    notionCode: "object_not_found",
    resourceType: "database",
    detail: "Could not find database with ID: test-database",
  }),
  500,
  "public post helper should treat missing database metadata as a server-side configuration error",
);
assert.equal(
  publicContentHelpers.getPublicPostErrorStatus({
    status: 400,
    notionCode: "validation_error",
    resourceType: "database",
    detail: "path failed validation: path.database_id should be a valid uuid",
  }),
  500,
  "public post helper should treat invalid database ids as server-side configuration errors",
);
assert.equal(
  publicContentHelpers.getPublicPostErrorStatus({
    status: 404,
    notionCode: "object_not_found",
    resourceType: "page",
    detail: "Could not find page with ID: missing-post",
  }),
  404,
  "public post helper should keep missing Notion pages as article-not-found responses",
);
assert.equal(
  publicContentHelpers.getPublicPostErrorStatus({
    status: 400,
    notionCode: "validation_error",
    resourceType: "page",
  }),
  404,
  "public post helper should keep invalid route page ids as article-not-found responses",
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
const sanitizedPublicError = publicContentHelpers.serializePublicError({
  code: "notion_config_error",
  notionCode: "object_not_found",
  detail: "Could not find database with ID: secret-database-id",
}, "Post list unavailable");
assert.equal(
  Object.prototype.hasOwnProperty.call(sanitizedPublicError, "detail"),
  false,
  "public content helper should not expose upstream error details by default",
);
expectIncludes(serverNotionJs, "queryPublicPages", "server notion layer should expose a filtered public page query helper");
expectIncludes(serverNotionJs, "queryPublicPosts", "server notion layer should provide a public post query helper");
expectIncludes(serverNotionJs, "getNotionResourceType", "server notion layer should annotate upstream errors with the Notion resource type");
expectIncludes(serverNotionJs, "PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS", "server notion layer should define a short-lived public summary cache");
expectIncludes(serverNotionJs, "buildContentSchema", "server notion layer should derive content property mappings from database metadata");
expectIncludes(serverNotionJs, "buildDatabaseSorts", "server notion layer should derive list sorting from the resolved schema");
expectIncludes(serverNotionJs, "normalizePostQueryFilters", "server notion layer should normalize category and search inputs before querying");
expectIncludes(serverNotionJs, "hasPostQueryFilters", "server notion layer should detect when filtered queries need extra work");
expectIncludes(serverNotionJs, "NOTION_REQUEST_TIMEOUT_MS", "server notion layer should define a request timeout for upstream calls");
expectIncludes(serverNotionJs, "AbortController", "server notion layer should abort slow Notion requests");
expectIncludes(serverNotionJs, "runWithBlockChildConcurrency", "server notion layer should limit recursive block child fetch concurrency");
expectIncludes(serverNotionJs, "Ambiguous Notion public visibility property configuration", "server notion layer should fail closed when multiple public visibility fields match");
expectIncludes(serverNotionJs, "findPropertyEntriesByCandidates", "server notion layer should inspect all matching public visibility properties");
expectIncludes(serverNotionJs, 'require("../js/notion-content")', "server notion layer should reuse the shared notion content helpers");
expectIncludes(serverNotionJs, "buildSharedArticleStructuredData", "server notion layer should delegate article structured data to the shared content helper");
expectIncludes(serverNotionJs, "resolveNotionContentSchema", "server notion layer should resolve renamed content properties from database metadata");
expectIncludes(serverNotionJs, "renderPostContent", "server notion layer should render SSR post HTML without duplicating it in API payloads");
expectNotIncludes(serverNotionJs, "buildSearchFilter", "server notion layer should not delegate search semantics to upstream filters that behave differently from local search");
expectNotIncludes(serverNotionJs, 'category === "閸忋劑鍎?', "server notion layer should not compare against a mojibake category label");
const resolvedContentSchema = serverNotionHelpers.buildContentSchema({
  properties: {
    Title: { id: "title", name: "Title", type: "title" },
    Summary: { id: "excerpt", name: "Summary", type: "rich_text" },
    Category: { id: "category", name: "Category", type: "select" },
    "Published At": { id: "date", name: "Published At", type: "date" },
  },
});
assert.equal(
  resolvedContentSchema.title?.name,
  "Title",
  "server notion layer should resolve renamed content properties from database metadata",
);
assert.equal(
  JSON.stringify(serverNotionHelpers.buildDatabaseSorts(resolvedContentSchema)),
  JSON.stringify([{
    property: "Published At",
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
const queryCacheFetchCounts = {
  database: 0,
  pageQueries: 0,
};
const queryCacheRequestBodies = [];
const queryCacheServerNotion = loadCommonJsModule("server/notion-server.js", [], {
  process: {
    env: {
      ...process.env,
      NOTION_TOKEN: "test-token",
      NOTION_DATABASE_ID: "query-cache-database",
      SITE_URL: "https://example.com",
      PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS: "120000",
    },
  },
  fetch: async (url, init = {}) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/databases/query-cache-database")) {
      queryCacheFetchCounts.database += 1;
      return createJsonResponse({
        properties: {
          Name: { id: "title", name: "Name", type: "title" },
          Excerpt: { id: "excerpt", name: "Excerpt", type: "rich_text" },
          Tags: { id: "tags", name: "Tags", type: "multi_select" },
          Category: { id: "category", name: "Category", type: "select" },
        },
      });
    }

    if (requestUrl.endsWith("/databases/query-cache-database/query")) {
      queryCacheFetchCounts.pageQueries += 1;
      const requestBody = JSON.parse(init?.body || "{}");
      queryCacheRequestBodies.push(requestBody);
      const requestedCategory = requestBody?.filter?.select?.equals;

      if (requestedCategory === "tech") {
        return createJsonResponse({
          results: [],
          has_more: false,
          next_cursor: null,
        });
      }

      return createJsonResponse({
        results: [
          {
            id: "search-post-alpha",
            properties: {
              Name: {
                id: "title",
                name: "Name",
                type: "title",
                title: [{ plain_text: "Alpha article" }],
              },
              Excerpt: {
                id: "excerpt",
                name: "Excerpt",
                type: "rich_text",
                rich_text: [{ plain_text: "Searchable excerpt" }],
              },
              Tags: {
                id: "tags",
                name: "Tags",
                type: "multi_select",
                multi_select: [{ name: "alpha" }],
              },
              Category: {
                id: "category",
                name: "Category",
                type: "select",
                select: { name: "Tech" },
              },
            },
          },
          {
            id: "search-post-beta",
            properties: {
              Name: {
                id: "title",
                name: "Name",
                type: "title",
                title: [{ plain_text: "Beta article" }],
              },
              Excerpt: {
                id: "excerpt",
                name: "Excerpt",
                type: "rich_text",
                rich_text: [{ plain_text: "Other excerpt" }],
              },
              Tags: {
                id: "tags",
                name: "Tags",
                type: "multi_select",
                multi_select: [{ name: "beta" }],
              },
              Category: {
                id: "category",
                name: "Category",
                type: "select",
                select: { name: "Tech" },
              },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected Notion request during filtered query cache test: ${requestUrl}`);
  },
});
const firstCachedQuery = await queryCacheServerNotion.queryPublicPosts({
  category: "Tech",
  search: "alpha",
  page: 1,
});
const secondCachedQuery = await queryCacheServerNotion.queryPublicPosts({
  category: "Tech",
  search: "alpha",
  page: 1,
});
const differentlyCasedQuery = await queryCacheServerNotion.queryPublicPosts({
  category: "tech",
  search: "alpha",
  page: 1,
});
assert.equal(
  queryCacheFetchCounts.database,
  1,
  "server notion layer should reuse one database metadata lookup while caching filtered list queries",
);
assert.equal(
  queryCacheFetchCounts.pageQueries,
  2,
  "server notion layer should reuse cached filtered query results for identical filters without collapsing differently cased category queries",
);
assert.equal(
  queryCacheRequestBodies[0]?.filter?.property,
  "Category",
  "server notion layer should still push category filters down to the Notion database query when possible",
);
assert.equal(
  firstCachedQuery.total,
  1,
  "server notion layer should still apply local search filtering after the category-prefiltered query returns",
);
assert.equal(
  secondCachedQuery.results[0]?.id,
  "search-post-alpha",
  "server notion layer should return the cached filtered result set without changing the query output",
);
assert.equal(
  differentlyCasedQuery.total,
  0,
  "server notion layer should not reuse a cached category query result when the requested category value changes semantically",
);
const dedupedFetchCounts = {
  database: 0,
  page: 0,
  blocks: 0,
};
const dedupedServerNotion = loadCommonJsModule("server/notion-server.js", [], {
  process: {
    env: {
      ...process.env,
      NOTION_TOKEN: "test-token",
      NOTION_DATABASE_ID: "test-database",
      SITE_URL: "https://example.com",
    },
  },
  fetch: async (url) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/databases/test-database")) {
      dedupedFetchCounts.database += 1;
      return createJsonResponse({
        properties: {
          Name: { id: "title", name: "Name", type: "title" },
        },
      });
    }

    if (requestUrl.endsWith("/pages/post-1")) {
      dedupedFetchCounts.page += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return createJsonResponse({
        id: "post-1",
        parent: { database_id: "test-database" },
        properties: {
          Name: {
            id: "title",
            name: "Name",
            type: "title",
            title: [{ plain_text: "Deduped title" }],
          },
        },
      });
    }

    if (requestUrl.includes("/blocks/post-1/children?")) {
      dedupedFetchCounts.blocks += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return createJsonResponse({
        results: [{
          id: "block-1",
          type: "paragraph",
          has_children: false,
          paragraph: {
            rich_text: [{ plain_text: "Deduped body" }],
          },
        }],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected Notion request during dedupe test: ${requestUrl}`);
  },
});
const [dedupedPostA, dedupedPostB] = await Promise.all([
  dedupedServerNotion.fetchPublicPost("post-1"),
  dedupedServerNotion.fetchPublicPost("post-1"),
]);
assert.strictEqual(
  dedupedPostA,
  dedupedPostB,
  "server notion layer should resolve concurrent post-detail requests through the same in-flight promise",
);
assert.equal(
  dedupedFetchCounts.database,
  1,
  "server notion layer should still reuse the shared database metadata lookup while coalescing concurrent post-detail requests",
);
assert.equal(
  dedupedFetchCounts.page,
  1,
  "server notion layer should fetch the Notion page only once for concurrent requests to the same post",
);
assert.equal(
  dedupedFetchCounts.blocks,
  1,
  "server notion layer should fetch the Notion block tree only once for concurrent requests to the same post",
);
assert.equal(
  dedupedPostA.content?.[0]?.text,
  "Deduped body",
  "server notion layer should still return the mapped block content after coalescing concurrent requests",
);
const encodedPathRequests = [];
const encodedPathServerNotion = loadCommonJsModule("server/notion-server.js", [], {
  process: {
    env: {
      ...process.env,
      NOTION_TOKEN: "test-token",
      NOTION_DATABASE_ID: "encoded/database",
      SITE_URL: "https://example.com",
    },
  },
  fetch: async (url) => {
    const requestUrl = String(url);
    encodedPathRequests.push(requestUrl);

    if (requestUrl.endsWith("/databases/encoded%2Fdatabase")) {
      return createJsonResponse({
        properties: {
          Name: { id: "title", name: "Name", type: "title" },
        },
      });
    }

    if (requestUrl.endsWith("/pages/unsafe%2Fpost%3Fdebug%3D1")) {
      return createJsonResponse({
        id: "safe-post-id",
        parent: { database_id: "encoded/database" },
        properties: {
          Name: {
            id: "title",
            name: "Name",
            type: "title",
            title: [{ plain_text: "Encoded path title" }],
          },
        },
      });
    }

    if (requestUrl.includes("/blocks/safe-post-id/children?")) {
      return createJsonResponse({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected Notion request during encoded path test: ${requestUrl}`);
  },
});
const encodedPathPost = await encodedPathServerNotion.fetchPublicPost("unsafe/post?debug=1");
assert.equal(
  encodedPathPost.id,
  "safe-post-id",
  "server notion layer should still map the public page returned for an encoded page id",
);
assert.ok(
  encodedPathRequests.some((requestUrl) => requestUrl.endsWith("/pages/unsafe%2Fpost%3Fdebug%3D1")),
  "server notion layer should encode route-supplied Notion page ids before building API paths",
);
assert.ok(
  encodedPathRequests.some((requestUrl) => requestUrl.includes("/blocks/safe-post-id/children?")),
  "server notion layer should fetch blocks using the canonical Notion page id returned by the API",
);
const retryFetchCounts = {
  database: 0,
  page: 0,
  blocks: 0,
};
let shouldFailNextRetryPageRequest = true;
const retryServerNotion = loadCommonJsModule("server/notion-server.js", [], {
  process: {
    env: {
      ...process.env,
      NOTION_TOKEN: "test-token",
      NOTION_DATABASE_ID: "retry-database",
      SITE_URL: "https://example.com",
    },
  },
  fetch: async (url) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/databases/retry-database")) {
      retryFetchCounts.database += 1;
      return createJsonResponse({
        properties: {
          Name: { id: "title", name: "Name", type: "title" },
        },
      });
    }

    if (requestUrl.endsWith("/pages/retry-post")) {
      retryFetchCounts.page += 1;
      if (shouldFailNextRetryPageRequest) {
        shouldFailNextRetryPageRequest = false;
        return createJsonResponse({
          message: "temporary upstream failure",
          code: "internal_server_error",
        }, {
          status: 500,
        });
      }

      return createJsonResponse({
        id: "retry-post",
        parent: { database_id: "retry-database" },
        properties: {
          Name: {
            id: "title",
            name: "Name",
            type: "title",
            title: [{ plain_text: "Recovered title" }],
          },
        },
      });
    }

    if (requestUrl.includes("/blocks/retry-post/children?")) {
      retryFetchCounts.blocks += 1;
      return createJsonResponse({
        results: [{
          id: "retry-block-1",
          type: "paragraph",
          has_children: false,
          paragraph: {
            rich_text: [{ plain_text: "Recovered body" }],
          },
        }],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected Notion request during retry test: ${requestUrl}`);
  },
});
await assert.rejects(
  () => retryServerNotion.fetchPublicPost("retry-post"),
  (error) => {
    assert.equal(error?.status, 500);
    return true;
  },
  "server notion layer should surface the original upstream failure for the first failed post-detail request",
);
const recoveredRetryPost = await retryServerNotion.fetchPublicPost("retry-post");
assert.equal(
  retryFetchCounts.page,
  2,
  "server notion layer should clear failed in-flight post-detail requests so the next retry can re-fetch the page",
);
assert.equal(
  retryFetchCounts.blocks,
  1,
  "server notion layer should only fetch block children once after the retry successfully loads the page metadata",
);
assert.equal(
  recoveredRetryPost.title,
  "Recovered title",
  "server notion layer should recover cleanly after a failed in-flight post-detail request",
);
let invalidPostCacheNow = 0;
class InvalidPostCacheDate extends Date {
  static now() {
    return invalidPostCacheNow;
  }
}
const invalidPostCacheFetchCounts = {
  database: 0,
  page: 0,
  blocks: 0,
};
const invalidPostCacheServerNotion = loadCommonJsModule("server/notion-server.js", [], {
  Date: InvalidPostCacheDate,
  process: {
    env: {
      ...process.env,
      NOTION_TOKEN: "test-token",
      NOTION_DATABASE_ID: "ttl-post-database",
      PUBLIC_POST_CACHE_TTL_MS: "not-a-number",
      SITE_URL: "https://example.com",
    },
  },
  fetch: async (url) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/databases/ttl-post-database")) {
      invalidPostCacheFetchCounts.database += 1;
      return createJsonResponse({
        properties: {
          Name: { id: "title", name: "Name", type: "title" },
        },
      });
    }

    if (requestUrl.endsWith("/pages/ttl-post")) {
      invalidPostCacheFetchCounts.page += 1;
      return createJsonResponse({
        id: "ttl-post",
        parent: { database_id: "ttl-post-database" },
        properties: {
          Name: {
            id: "title",
            name: "Name",
            type: "title",
            title: [{ plain_text: `TTL post ${invalidPostCacheFetchCounts.page}` }],
          },
        },
      });
    }

    if (requestUrl.includes("/blocks/ttl-post/children?")) {
      invalidPostCacheFetchCounts.blocks += 1;
      return createJsonResponse({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected Notion request during invalid post cache TTL test: ${requestUrl}`);
  },
});
await invalidPostCacheServerNotion.fetchPublicPost("ttl-post");
invalidPostCacheNow = 61_000;
await invalidPostCacheServerNotion.fetchPublicPost("ttl-post");
assert.equal(
  invalidPostCacheFetchCounts.page,
  2,
  "server notion layer should fall back to the default post cache TTL when the env value is invalid",
);
let invalidMetadataNow = 0;
class InvalidMetadataDate extends Date {
  static now() {
    return invalidMetadataNow;
  }
}
const invalidMetadataFetchCounts = {
  database: 0,
  query: 0,
};
const invalidMetadataServerNotion = loadCommonJsModule("server/notion-server.js", [], {
  Date: InvalidMetadataDate,
  process: {
    env: {
      ...process.env,
      NOTION_TOKEN: "test-token",
      NOTION_DATABASE_ID: "ttl-metadata-database",
      DATABASE_METADATA_TTL_MS: "not-a-number",
      SITE_URL: "https://example.com",
    },
  },
  fetch: async (url) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/databases/ttl-metadata-database")) {
      invalidMetadataFetchCounts.database += 1;
      return createJsonResponse({
        properties: {
          Name: { id: "title", name: "Name", type: "title" },
        },
      });
    }

    if (requestUrl.endsWith("/databases/ttl-metadata-database/query")) {
      invalidMetadataFetchCounts.query += 1;
      return createJsonResponse({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected Notion request during invalid metadata TTL test: ${requestUrl}`);
  },
});
await invalidMetadataServerNotion.queryPublicPosts();
invalidMetadataNow = 301_000;
await invalidMetadataServerNotion.queryPublicPosts();
assert.equal(
  invalidMetadataFetchCounts.database,
  2,
  "server notion layer should fall back to the default database metadata TTL when the env value is invalid",
);
assert.ok(
  !serverNotionJs.includes("鍔″繀鍚屾鏇存柊 js/notion-api.js"),
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
assert.ok(
  !apiNotionJs.includes("Access-Control-Allow-Origin"),
  "disabled Notion proxy should not keep dead per-origin CORS response handling",
);
const disabledProxyResponse = createApiResponseRecorder();
await apiNotionHandler({ method: "GET", headers: {} }, disabledProxyResponse);
assert.equal(disabledProxyResponse.statusCode, 410, "disabled Notion proxy should return HTTP 410");
assert.equal(disabledProxyResponse.getHeader("cache-control"), "no-store", "disabled Notion proxy should mark responses as non-cacheable");
expectIncludes(apiSitemapJs, "buildPostUrl", "dynamic sitemap should include article routes");
expectIncludes(apiSitemapJs, "queryPublicPages", "dynamic sitemap should only include public posts");
expectIncludes(apiSitemapJs, "getPublicContentErrorStatus", "dynamic sitemap should reuse public content error status mapping");
expectIncludes(apiSitemapJs, "applyPublicErrorHeaders", "dynamic sitemap should preserve upstream retry guidance");
expectIncludes(apiSitemapJs, "serializePublicError", "dynamic sitemap should serialize upstream errors consistently");
expectIncludes(apiSitemapJs, '"Cache-Control", "no-store"', "dynamic sitemap should not outlive public access changes");
expectIncludes(vercelJson, '"/posts/:id"', "Vercel should rewrite canonical article routes");
expectIncludes(vercelJson, '"/sitemap.xml"', "Vercel should serve a dynamic sitemap");
expectIncludes(vercelJson, '"/favicon.png"', "Vercel should set cache headers for the real favicon asset");
expectIncludes(vercelJson, "max-age=3600, stale-while-revalidate=86400", "Vercel should give versioned static scripts and styles a short browser cache");
expectIncludes(vercelJson, "frame-ancestors 'none'", "Vercel global CSP should preserve clickjacking protection");
expectIncludes(vercelJson, '"X-Frame-Options"', "Vercel should retain legacy frame-denial protection");
expectNotIncludes(vercelJson, "script-src-elem 'self' 'unsafe-inline'", "Vercel global CSP should not allow arbitrary inline script elements");
expectNotIncludes(vercelJson, "default-src 'self'; script-src", "Vercel global CSP should leave script policy to static meta tags and SSR nonce headers");
expectNotIncludes(vercelJson, '"/api/:path*"', "Vercel should not rewrite semantic API routes through the disabled legacy proxy");

console.log("Smoke check passed.");
