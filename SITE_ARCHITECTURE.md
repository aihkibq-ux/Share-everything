# Share Everything Site Architecture

> Version: v2.0
> Updated: 2026-04-24

## 1. Overview

Share Everything is a small static-first site with Notion as the content source, Vercel Serverless Functions as the public content layer, and vanilla HTML/CSS/JS on the frontend.

It is not a React, Next.js, Vue, Cloudflare Workers, or Cloudflare Pages app. Cloudflare only handles DNS.

| Layer | Technology | Responsibility |
|---|---|---|
| Content source | Notion API | Article metadata and block content |
| Server | Vercel Serverless Functions | Public list API, post data API, SSR post HTML, sitemap, image proxy |
| Frontend | Vanilla HTML/CSS/JS | Static entry pages plus lightweight SPA navigation |
| DNS | Cloudflare | DNS only |
| Bookmarks | `localStorage` | Fully local bookmark storage |

```text
Notion Database
  -> Notion API
    -> Vercel Serverless Functions
      -> /api/posts-data
      -> /api/post-data
      -> /api/post
      -> /api/image
      -> /api/sitemap
        -> Browser
          -> Static HTML shell
          -> Lightweight SPA navigation
          -> localStorage bookmarks
```

## 2. Version v2.0 Highlights

v2.0 focuses on navigation smoothness, cover image loading, mobile performance, and local development parity.

- Blog top actions now switch listing state in-page, avoiding a full reload when moving between bookmarks and overview.
- Blog cards preload the first visible cover images and mark first-screen covers as `loading="eager"` with `fetchpriority="high"`.
- Blog cover cards include a stable fallback layer so slow images do not leave a blank cover area.
- Blog cover media is non-interactive so clicks always reach the card link, while bookmark buttons remain above the link layer.
- Article content prioritizes the first image with eager loading and high fetch priority.
- Remote display images can be routed through the same-origin `/api/image` proxy for better cache behavior.
- Mobile particle density was reduced from 80 to 48, and particles pause briefly while scrolling on mobile.
- SPA page HTML requests are coalesced and no longer pay a fixed 150ms transition delay.
- SPA article navigation falls back to `/post.html?id=...` when a local server does not support `/posts/:id` rewrites.
- SPA route transitions use a visible opacity/transform animation without adding a fixed navigation delay.
- `npm.cmd run dev` now starts a local API-aware server through `scripts/local-server.mjs`.
- Package version is now `2.0.0`.

## 3. Public Routes

| Route | Handler | Notes |
|---|---|---|
| `/` | `index.html` | Home/search entry |
| `/blog.html` | `blog.html` | Blog list and local bookmark list |
| `/blog.html#bookmarks` | `blog-page.js` | Local bookmark view, marked noindex at runtime |
| `/posts/:id` | `/api/post?id=:id` | Canonical SSR article route |
| `/post.html?id=:id` | `/api/post` | Template-compatible article entry |
| `/sitemap.xml` | `/api/sitemap` | Dynamic sitemap |

## 4. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/posts-data` | `GET` | Public post list JSON |
| `/api/post-data` | `GET` | Single post JSON |
| `/api/post` | `GET` | SSR article HTML |
| `/api/image` | `GET` | Same-origin remote image proxy |
| `/api/sitemap` | `GET` | Dynamic sitemap XML |
| `/api/notion` | Any | Disabled legacy proxy, fixed `410` |

Read-only public APIs reject non-`GET` methods with `405` and `Cache-Control: no-store`.

## 5. Caching

| Resource | Cache-Control |
|---|---|
| HTML | Browser revalidates through normal static serving / route handlers |
| CSS and JS | `public, max-age=3600, stale-while-revalidate=86400` |
| `favicon.png` | `public, max-age=86400` |
| Successful `/api/image` responses | `public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400` |
| Public JSON/SSR error responses | `no-store` |
| Disabled `/api/notion` | `no-store` |

Client-side `notion-api.js` also keeps a short in-memory post-list response cache for fast repeated listing transitions.

## 6. Security

- Global Vercel headers keep frame protection through `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- Static pages use CSP meta tags generated from `server/security-policy.js`.
- SSR article pages generate request-scoped nonces for CSP, JSON-LD, and initial post data.
- `connect-src` remains same-origin so browser data requests continue through semantic API routes.
- `/api/image` only accepts `https:` upstream URLs, rejects localhost/private host patterns, enforces image content types, limits image size, applies a timeout, and sends `X-Content-Type-Options: nosniff`.
- Public error details are hidden unless `EXPOSE_PUBLIC_ERROR_DETAILS=true` is set for local debugging.

## 7. Repository Structure

```text
.
|-- index.html
|-- blog.html
|-- post.html
|-- package.json
|-- vercel.json
|-- robots.txt
|-- favicon.png
|-- SITE_ARCHITECTURE.md
|-- api/
|   |-- image.js
|   |-- posts-data.js
|   |-- post-data.js
|   |-- post.js
|   |-- sitemap.js
|   `-- notion.js
|-- server/
|   |-- notion-server.js
|   |-- public-content.js
|   `-- security-policy.js
|-- js/
|   |-- notion-content.js
|   |-- runtime-core.js
|   |-- site-utils.js
|   |-- common.js
|   |-- ui-effects.js
|   |-- seo-meta.js
|   |-- spa-router.js
|   |-- notion-api.js
|   |-- bookmark.js
|   |-- index-page.js
|   |-- blog-page.js
|   |-- post-page.js
|   `-- font-loader.js
|-- css/
|   |-- style.css
|   |-- blog-page.css
|   `-- post-page.css
`-- scripts/
    |-- local-server.mjs
    |-- smoke-check.mjs
    `-- fixtures/
        `-- notion-block-fixtures.mjs
```

## 8. Frontend Runtime

All three HTML entry pages load shared runtime scripts marked with `data-spa-runtime`:

- `font-loader.js`
- `notion-content.js`
- `runtime-core.js`
- `site-utils.js`
- `common.js`
- `ui-effects.js`
- `seo-meta.js`
- `spa-router.js`

Page-specific scripts are then loaded as needed:

| File | Responsibility |
|---|---|
| `index-page.js` | Home search and navigation |
| `blog-page.js` | Listing state, search, filters, pagination, bookmarks, cover preloading |
| `post-page.js` | Article hydration, SEO sync, bookmark state, SSR fallback behavior |
| `bookmark.js` | Local bookmark persistence and legacy metadata hydration |
| `notion-api.js` | Browser-side API requests, summary cache, short list response cache |

`spa-router.js` keeps canonical URLs in the address bar, but can load `/post.html?id=...` as a compatibility fallback when the current local server returns `404` for `/posts/:id`. Route changes animate through opacity and transform only, so the transition remains visible while staying inexpensive for the browser.

## 9. Image Loading Strategy

`notion-content.js` owns display-safe image URL handling:

- Same-origin images remain direct.
- External display images must be `https:`.
- Remote display images can be rewritten to `/api/image?src=...`.
- Share images still avoid likely ephemeral signed URLs and fall back to stable defaults.

`blog-page.js` uses `SiteUtils.resolveProxiedDisplayImageUrl()` for cover cards, preloads the first three cover images, and uses cover fallback markup so cards remain visually stable while images load.

Cover images and fallback layers set `pointer-events: none`; the full-card link sits above the media layer, and the bookmark button sits above the link. This preserves the expected behavior that clicking the cover opens the article and clicking the bookmark toggles the bookmark.

## 10. Server Content Layer

`server/notion-server.js` handles:

- Database metadata and schema resolution.
- Public content access policy.
- Post list querying, filtering, search, and pagination.
- Single post fetching.
- Recursive block fetching with concurrency limits.
- SSR article content and structured data preparation.
- Notion error classification by resource type.

Main server-side caches:

| Object | Location | TTL / Size |
|---|---|---|
| Database metadata | Memory | 5 minutes |
| Public post summaries | Memory | 2 minutes |
| Filtered results | Memory Map | Follows summary cache |
| Single post details | Memory LRU | 60 seconds / 20 entries |
| In-flight post requests | Promise Map | Request lifetime |

## 11. Local Development

Use:

```powershell
npm.cmd run dev
```

This starts `scripts/local-server.mjs` on `127.0.0.1:4173` by default and supports static assets plus semantic API routes including `/api/image`, `/api/post`, `/api/post-data`, `/api/posts-data`, and `/api/sitemap`.

Use:

```powershell
npm.cmd run check
```

PowerShell may block `npm run check` because `npm.ps1` execution is disabled on the system, so `npm.cmd` is the reliable form on this machine.

## 12. Environment Variables

Required:

| Variable | Description |
|---|---|
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DATABASE_ID` | Public content database ID |

Recommended:

| Variable | Description |
|---|---|
| `SITE_URL` | Production site origin |

Optional:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_METADATA_TTL_MS` | `300000` | Database metadata cache TTL |
| `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` | `120000` | Public list summary cache TTL |
| `PUBLIC_POST_CACHE_TTL_MS` | `60000` | Single post cache TTL |
| `NOTION_REQUEST_TIMEOUT_MS` | `12000` | Server-side Notion request timeout |
| `NOTION_BLOCK_CHILD_CONCURRENCY` | `4` | Concurrent child block fetches |
| `NOTION_PUBLIC_PROPERTY_NAME(S)` | empty | Public visibility property names |
| `NOTION_PUBLIC_STATUS_VALUES` | empty | Allowed public status values |
| `EXPOSE_PUBLIC_ERROR_DETAILS` | empty | Expose upstream error detail for local debugging only |

When public property variables are empty, the configured Notion database is treated as a public-only content database. If draft/private content is later mixed into the same database, configure explicit public filters before publishing.

## 13. Checks

`scripts/smoke-check.mjs` currently covers:

- HTML entry structure and CSP consistency.
- Shared runtime script declarations.
- CSS ownership and line-ending rules.
- Bookmark hash routing.
- SEO runtime behavior.
- SPA navigation and page HTML request coalescing.
- SPA post-template fallback for local `/posts/:id` 404s.
- Visible SPA route transition parameters.
- Blog cover preloading and mobile reveal behavior.
- Blog cover click layering.
- Remote display image proxying.
- `/api/image` validation, cache headers, binary response behavior, method guard.
- API `405` and `no-store` behavior.
- Public content error mapping and `Retry-After` propagation.
- Sitemap behavior.
- Structured data shared helpers.
- SSR article injection fallback behavior.
- Mobile particle performance constraints.
- Disabled `/api/notion` behavior.
- Notion path parameter encoding.
- Invalid TTL environment variable fallback behavior.

Latest verification:

```powershell
npm.cmd run check
```

Result: passed.
