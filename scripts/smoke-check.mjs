import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function checkSyntax(relativePath) {
  new vm.Script(read(relativePath), {
    filename: relativePath,
  });
}

async function checkModuleSyntax(relativePath) {
  const encodedSource = Buffer.from(read(relativePath), "utf8").toString("base64");
  await import(`data:text/javascript;base64,${encodedSource}`);
}

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

[
  "js/common.js",
  "js/blog-page.js",
  "js/bookmark.js",
  "js/font-loader.js",
  "js/index-page.js",
  "js/notion-api.js",
  "js/post-page.js",
  "api/notion.js",
  "api/post.js",
  "api/sitemap.js",
  "server/notion-server.js",
].forEach(checkSyntax);
await checkModuleSyntax("worker/index.js");

const indexHtml = read("index.html");
const blogHtml = read("blog.html");
const postHtml = read("post.html");
const vercelJson = read("vercel.json");
const commonJs = read("js/common.js");
const blogPageJs = read("js/blog-page.js");
const bookmarkJs = read("js/bookmark.js");
const indexPageJs = read("js/index-page.js");
const notionApiJs = read("js/notion-api.js");
const postPageJs = read("js/post-page.js");
const apiNotionJs = read("api/notion.js");
const apiPostJs = read("api/post.js");
const apiSitemapJs = read("api/sitemap.js");

expectIncludes(indexHtml, 'property="og:image"', "index.html should declare og:image");
expectIncludes(blogHtml, 'property="og:image"', "blog.html should declare og:image");
expectIncludes(postHtml, 'property="og:image"', "post.html should declare og:image");
expectIncludes(postHtml, 'rel="canonical"', "post.html should declare a fallback canonical link");
expectIncludes(postHtml, 'href="/blog.html"', "post.html should use root-relative blog links for canonical post routes");
expectIncludes(postHtml, 'src="/js/post-page.js"', "post.html should use root-relative scripts for canonical post routes");
expectIncludes(postHtml, 'id="postStatus"', "post.html should expose a live status region for post interactions");
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
expectIncludes(commonJs, "resolveShareImageUrl", "common.js should normalize stable share images");
expectIncludes(commonJs, "getPostIdFromUrl", "common.js should expose canonical post URL helpers");
expectIncludes(commonJs, "getPreferredBlogReturnUrl", "common.js should expose a preferred blog return helper");
expectIncludes(commonJs, "rememberBlogReturnUrl", "common.js should persist the last blog listing route");
expectIncludes(blogPageJs, 'class="blog-card-link"', "blog cards should render a dedicated link layer");
expectIncludes(blogPageJs, 'siteUtils.buildPostPath', "blog cards should link to canonical /posts/:id routes");
expectIncludes(blogPageJs, "siteUtils.rememberBlogReturnUrl", "blog page should persist the current listing URL");
expectIncludes(blogPageJs, 'data-post-tags="${serializedTags}"', "blog cards should serialize tags for bookmark fallback");
expectIncludes(blogPageJs, 'aria-pressed="${bookmarked ? "true" : "false"}"', "bookmark buttons should expose pressed state");
expectIncludes(blogPageJs, "announceStatus(", "blog page should announce result updates");
expectIncludes(blogPageJs, "收藏失败，请稍后重试", "blog page should announce bookmark persistence failures");
assert.ok(
  blogPageJs.indexOf('let currentCategory = "全部";') < blogPageJs.indexOf('if (!notionApi)'),
  "blog page should initialize local state before the NotionAPI fallback branch runs",
);
assert.ok(
  blogPageJs.indexOf('const params = new URLSearchParams(window.location.search);') < blogPageJs.indexOf('if (!notionApi)'),
  "blog page should parse URL state before the NotionAPI fallback branch runs",
);
expectIncludes(blogPageJs, "searchInput.value = currentSearch;", "blog page should preserve the current search text in failure states");
expectIncludes(blogPageJs, "updatePageUI();", "blog page should reflect route context before showing a failure state");
assert.ok(
  !blogPageJs.includes("await bookmarkManager.hydrateMissingMetadata"),
  "blog page should hydrate legacy bookmark metadata in the background",
);
assert.ok(
  !blogPageJs.includes("blog_history"),
  "blog page should not keep unused blog_history persistence code",
);
expectIncludes(bookmarkJs, "parseSerializedTags", "bookmark fallback should recover serialized tags");
expectIncludes(bookmarkJs, "hydrateMissingMetadata", "bookmark manager should hydrate legacy metadata");
expectIncludes(bookmarkJs, "return false;", "bookmark save should fail explicitly when persistence is unavailable");
expectIncludes(bookmarkJs, "if (!save(bookmarks)) return null;", "bookmark toggles should abort when persistence fails");
expectIncludes(bookmarkJs, "if (!save(nextBookmarks))", "bookmark hydration should fail cleanly when persistence is unavailable");
expectIncludes(bookmarkJs, "return null;", "bookmark toggleById should signal persistence failures");
expectIncludes(notionApiJs, "collectManagedCacheEntries", "notion cache should evict older entries on quota pressure");
expectIncludes(notionApiJs, "createRequestError", "notion client should preserve HTTP status metadata on failures");
expectIncludes(notionApiJs, "error.status = Number(status);", "notion client should attach status codes to request errors");
expectIncludes(indexPageJs, "function navigateTo(url)", "index page should provide a navigation fallback helper");
expectIncludes(indexPageJs, "window.location.href = url", "index page should fall back to full navigation");
expectIncludes(indexPageJs, 'navigateTo("/blog.html"', "index page navigation should use root-relative paths");
expectIncludes(postPageJs, 'window.StructuredData?.set?.("post-article"', "post page should publish article structured data");
expectIncludes(postPageJs, "initialPostData", "post page should reuse server-rendered post payloads");
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
expectIncludes(postPageJs, 'robots: "index, follow"', "post page should restore article robots metadata after load");
assert.ok(
  !postPageJs.includes("reading_history"),
  "post page should not keep unused reading_history persistence code",
);
expectIncludes(apiPostJs, 'upsertStructuredDataScript(html, "post-article"', "article HTML route should emit structured data");
expectIncludes(apiPostJs, 'id="initialPostData"', "article HTML route should emit initial post data");
expectIncludes(apiPostJs, "buildUnavailableContent", "article HTML route should distinguish upstream failures from not-found routes");
expectIncludes(apiPostJs, "getPostErrorStatus", "article HTML route should map upstream failures to non-404 responses");
expectIncludes(apiNotionJs, "getNotionToken", "API proxy should centralize Notion token lookup");
expectIncludes(apiNotionJs, "NOTION_TOKEN is not configured", "API proxy should fail clearly when the Notion token is missing");
expectIncludes(apiSitemapJs, "buildPostUrl", "dynamic sitemap should include article routes");
expectIncludes(vercelJson, '"/posts/:id"', "Vercel should rewrite canonical article routes");
expectIncludes(vercelJson, '"/sitemap.xml"', "Vercel should serve a dynamic sitemap");
expectIncludes(vercelJson, '"/favicon.png"', "Vercel should set cache headers for the real favicon asset");

console.log("Smoke check passed.");
