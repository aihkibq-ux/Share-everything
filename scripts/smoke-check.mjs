import assert from "node:assert/strict";
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

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

[
  "js/common.js",
  "js/blog-page.js",
  "js/bookmark.js",
  "js/post-page.js",
  "api/notion.js",
].forEach(checkSyntax);

const indexHtml = read("index.html");
const blogHtml = read("blog.html");
const postHtml = read("post.html");
const commonJs = read("js/common.js");
const blogPageJs = read("js/blog-page.js");
const bookmarkJs = read("js/bookmark.js");
const notionApiJs = read("js/notion-api.js");
const postPageJs = read("js/post-page.js");

expectIncludes(indexHtml, 'property="og:image"', "index.html should declare og:image");
expectIncludes(blogHtml, 'property="og:image"', "blog.html should declare og:image");
expectIncludes(postHtml, 'property="og:image"', "post.html should declare og:image");
expectIncludes(indexHtml, "data-page-focus", "index.html should mark a focus target");
expectIncludes(blogHtml, "data-page-focus", "blog.html should mark a focus target");
expectIncludes(blogHtml, 'id="blogStatus"', "blog.html should include the live status region");
expectIncludes(blogHtml, 'id="blogGrid" role="list"', "blog grid should expose list semantics");

expectIncludes(commonJs, "page-progress", "common.js should wire the page progress bar");
expectIncludes(commonJs, 'property="og:image"', "common.js should update og:image metadata");
expectIncludes(commonJs, "focusSpaContent", "common.js should expose SPA focus management");
expectIncludes(blogPageJs, 'class="blog-card-link"', "blog cards should render a dedicated link layer");
expectIncludes(blogPageJs, 'data-post-tags="${serializedTags}"', "blog cards should serialize tags for bookmark fallback");
expectIncludes(blogPageJs, 'aria-pressed="${bookmarked ? "true" : "false"}"', "bookmark buttons should expose pressed state");
expectIncludes(blogPageJs, "announceStatus(", "blog page should announce result updates");
expectIncludes(bookmarkJs, "parseSerializedTags", "bookmark fallback should recover serialized tags");
expectIncludes(notionApiJs, "collectManagedCacheEntries", "notion cache should evict older entries on quota pressure");
expectIncludes(postPageJs, 'window.StructuredData?.set?.("post-article"', "post page should publish article structured data");

console.log("Smoke check passed.");
