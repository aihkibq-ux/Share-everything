# Share Everything — 网站架构文档

> 更新时间：2026-04-15

## 1. 架构概述

**一句话定义**：Notion 内容源 + Vercel Serverless 渲染 + Cloudflare DNS 的轻量内容站。

不是 React / Next.js / Vue 项目，不是 Cloudflare Pages / Workers 项目。

### 1.1 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 内容源 | Notion API | 数据库存储文章，block 存储正文 |
| 服务端 | Vercel Serverless Functions | SSR 详情页、JSON API、动态 sitemap |
| 前端 | 原生 HTML / CSS / JS | 轻量 SPA 导航 + 真实 HTML 入口 |
| DNS | Cloudflare | 仅托管 DNS 记录，无 Workers / Pages |
| 收藏 | 浏览器 localStorage | 完全本地化，不涉及服务端 |

### 1.2 数据流总览

```text
┌─────────────┐                      ┌──────────────────────┐
│  Notion DB  │ ◄── Notion API ───── │  Vercel Serverless   │
│  (内容源)    │ ── JSON 响应 ──────► │  /api/* 函数          │
└─────────────┘                      └────────┬─────────────┘
                                              │
                                     HTML / JSON 响应
                                              │
                                     ┌────────▼─────────────┐
                                     │  浏览器               │
                                     │  - 页面渲染           │
                                     │  - SPA 导航           │
                                     │  - localStorage 收藏  │
                                     └──────────────────────┘
```

## 2. 部署拓扑

### 2.1 角色分工

| 角色 | 职责 | 不负责 |
|------|------|--------|
| Cloudflare | `0000068.xyz` DNS 记录 | 应用运行、CDN 缓存 |
| Vercel | 静态文件托管、Serverless API、页面重写 | — |
| Notion | CMS 数据库 + 文章块内容 | 渲染、缓存 |

### 2.2 域名

| 域名 | 用途 |
|------|------|
| `https://www.0000068.xyz` | 主生产域名 |
| `https://0000068.xyz` | 301 跳转到 `www` |
| `https://*.vercel.app` | Vercel 部署后自动分配的默认域名（示例：`share-everything-sigma.vercel.app`） |

### 2.3 Vercel 配置 (`vercel.json`)

**路由重写**：

| 入站路径 | 目标 | 意义 |
|---------|------|------|
| `/sitemap.xml` | `/api/sitemap` | 动态站点地图 |
| `/posts/:id` | `/api/post?id=:id` | 详情页走 SSR |
| `/post.html` | `/api/post` | 模板入口重写 |

**缓存策略**：

| 资源 | Cache-Control |
|------|---------------|
| JS / CSS / HTML | `public, max-age=0, must-revalidate` |
| `favicon.png` | `public, max-age=86400`（1 天） |
| API 接口 | `no-store` |

**CSP 策略**：

| 指令 | 值 | 说明 |
|------|----|------|
| `default-src` | `'self'` | 默认只允许同源 |
| `script-src` | `'self'` | 仅加载本站脚本 |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.cn` | Google Fonts |
| `img-src` | `'self' https: data: blob:` | 支持 Notion 外部图片 |
| `font-src` | `'self' https://fonts.gstatic.cn data:` | Google Fonts |
| `connect-src` | `'self' https:` | 浏览器 fetch API 数据 |
| `frame-src` | `'self' https:` | 文章内 embed（YouTube 等） |
| `object-src` | `'none'` | 禁止插件对象 |
| `base-uri` | `'self'` | 防 base 标签劫持 |
| `frame-ancestors` | `'none'` | 禁止被 iframe 嵌入 |

**部署区域**：`hkg1`

## 3. 仓库结构

```text
.
├─ index.html                 首页
├─ blog.html                  列表页
├─ post.html                  详情页模板（SSR 注入）
├─ vercel.json                路由重写 + 响应头 + 区域
├─ package.json               Node ≥ 18，定义 npm run check
├─ robots.txt                 爬虫规则
├─ favicon.png                站点图标 / 默认分享图
│
├─ api/                       Vercel Serverless 函数
│  ├─ posts-data.js           文章列表 JSON
│  ├─ post-data.js            单篇文章 JSON
│  ├─ post.js                 详情页 SSR HTML
│  ├─ sitemap.js              动态站点地图
│  └─ notion.js               已废弃（返回 410）
│
├─ server/                    服务端共享逻辑
│  ├─ notion-server.js        Notion 服务层（查询、缓存、渲染）
│  └─ public-content.js       错误处理与响应辅助
│
├─ js/                        浏览器脚本
│  ├─ common.js               粒子动画 + 光标效果 + SPA 路由 + SEO + 运行时
│  ├─ notion-content.js       Notion 内容映射与渲染（前后端共享）
│  ├─ notion-api.js           浏览器侧数据访问层
│  ├─ blog-page.js            列表页
│  ├─ post-page.js            详情页
│  ├─ index-page.js           首页
│  ├─ bookmark.js             收藏（localStorage）
│  └─ font-loader.js          延迟字体加载
│
├─ css/
│  ├─ style.css               全站基础样式
│  ├─ blog-page.css           列表页补充
│  └─ post-page.css           详情页补充
│
└─ scripts/
   ├─ smoke-check.mjs         回归检查（含 SSR / block fixture / 并发去重行为断言）
   └─ fixtures/
      └─ notion-block-fixtures.mjs
```

## 4. 页面运行链路

### 4.1 首页 — `index.html`

- 真实 HTML 入口，不依赖 JS 即可打开
- 搜索表单提交跳转 `/blog.html?search=...`
- SPA 路由启用时，站内跳转由 `SPARouter` 接管
- 脚本链路：`font-loader.js` + `notion-content.js` + `common.js` + `index-page.js`

### 4.2 列表页 — `blog.html`

**远端文章列表流程**：

```text
blog-page.js → NotionAPI.queryPosts()
  → fetch /api/posts-data
    → notion-server.js queryPublicPosts()
      → Notion API（带 2 分钟缓存）
→ 浏览器渲染卡片列表
```

**本地收藏流程**：分类切换到"收藏"时，直接读 `localStorage`，不请求服务端。

功能：分类过滤、搜索、分页、书签按钮、URL 状态同步。
脚本链路：`font-loader.js` + `notion-content.js` + `common.js` + `notion-api.js` + `bookmark.js` + `blog-page.js`

### 4.3 详情页 — `/posts/:id`

**首屏（SSR）**：

```text
浏览器 → /posts/:id
  → Vercel 重写 → /api/post?id=:id
    → api/post.js
      → fetchPublicPost()（带 60s LRU 缓存 + 同文并发请求去重）
        → 请求 Notion /pages/:id + 递归拉 block 树
      → 注入 post.html 模板
      → 输出完整 HTML（SEO + structured data + 正文）
```

**二次运行（Hydration）**：

- `post-page.js` 读取 SSR 注入的 `#initialPostData`
- 优先复用首屏内容，需要时走 `/api/post-data` 获取 JSON
- `notion-api.js` 负责 JSON 拉取与摘要缓存，`bookmark.js` 负责收藏状态
- JS 失败时 SSR 内容仍可展示
- 脚本链路：`font-loader.js` + `notion-content.js` + `common.js` + `notion-api.js` + `bookmark.js` + `post-page.js`

## 5. 前端代码

### 5.1 `common.js` — 运行时核心

| 模块 | 职责 |
|------|------|
| 粒子星空 | Canvas 星空背景动画、鼠标视差、点击加速效果 |
| 光标跟随 | 桌面端光标发光效果（fine pointer + 无减弱动画时启用） |
| `SiteUtils` | URL 解析构建、返回地址记忆、图片安全处理 |
| `updateSeoMeta` | SPA 导航后动态更新 title / description / OG / canonical / robots |
| `StructuredData` | 写入和清除 `application/ld+json` |
| `PageProgress` | 页面加载进度条（trickle + finish 模式） |
| `PageRuntime` | 根据 URL 注册和初始化对应页面模块（index / blog / post） |
| `SPARouter` | 站内链接拦截、HTML 预取与缓存、`#spa-content` 局部替换、切换动画与焦点管理 |

> 站点是“真实 HTML 入口 + 轻量 SPA 导航”的混合模式，不是纯 SPA。

### 5.2 `notion-content.js` — 内容渲染引擎（前后端共享）

核心职责：Notion 页面属性 → 文章摘要、Notion block → HTML。

**标题降级策略**：

| Notion block | 渲染为 | 原因 |
|-------------|--------|------|
| 页面标题 (`renderPostArticle`) | `<h1>` | 页面唯一 H1 |
| `heading_1` | `<h2>` | 避免多 H1 影响 SEO |
| `heading_2` | `<h3>` | — |
| `heading_3` | `<h4>` | — |

**Embed 支持**：YouTube / Bilibili / Vimeo / Loom / CodePen / Figma → iframe。不支持的平台降级为链接块。

### 5.3 `notion-api.js` — 浏览器数据访问层

- 请求 `/api/posts-data` 和 `/api/post-data`
- 两级文章摘要缓存：内存 Map（快查）+ sessionStorage（30 分钟 TTL，跨页面持久化，用于收藏补全）
- 不保留响应缓存分支，公共内容走实时接口

### 5.4 其他页面脚本

| 文件 | 职责 |
|------|------|
| `blog-page.js` | 分类切换、搜索、分页、卡片渲染、书签交互、URL 同步 |
| `post-page.js` | 首屏 hydration、书签按钮、返回列表、SEO 同步、SSR 容错 |
| `bookmark.js` | 完全本地收藏系统（localStorage），含旧数据补全 |
| `font-loader.js` | 延迟激活带 `data-deferred-fonts` 的字体样式，降低首屏阻塞 |

## 6. 服务端代码

### 6.1 `notion-server.js` — 核心服务层

**缓存体系**：

| 缓存对象 | 存储 | TTL | 容量 |
|---------|------|-----|------|
| 数据库 metadata + schema | 内存 | 5 分钟 | 1 条 |
| 公开文章列表摘要 | 内存 | 2 分钟 | 1 条 |
| 单篇文章（摘要 + blocks） | 内存 LRU | 60 秒 | 20 条 |
| 单篇文章进行中请求 | 内存 Promise Map | 请求生命周期 | 同 cache key 1 条 |

**安全机制**：

- Notion API 请求超时：12 秒（可配置）
- 分页安全上限：`MAX_PAGINATION_ROUNDS = 50`（= 5000 条）
- block 递归深度上限：10 层
- block 并发拉取限制：4（可配置）

**公开策略**：

| 模式 | 条件 | 行为 |
|------|------|------|
| A. 整库公开（默认） | 未设置 `NOTION_PUBLIC_PROPERTY_NAME` / `NOTION_PUBLIC_PROPERTY_NAMES` | 整个数据库 = 公开内容库 |
| B. 按字段控制 | 设置了 `NOTION_PUBLIC_PROPERTY_NAME` 或 `NOTION_PUBLIC_PROPERTY_NAMES` | 按 checkbox / status / select 字段匹配 |

补充：当公开字段类型为 `status` / `select` 时，可通过 `NOTION_PUBLIC_STATUS_VALUES` 显式指定公开状态；未指定时服务端会优先尝试常见“已发布/公开/Done/Complete”类状态值与分组名。

### 6.2 `public-content.js` — 错误处理层

统一处理 404 / 429 / 500 / 502 / 504 判断、错误序列化、`Retry-After` 透传。

### 6.3 API 接口一览

| 接口 | 方法 | 功能 | 缓存 | 备注 |
|------|------|------|------|------|
| `/api/posts-data` | GET, HEAD | 文章列表 JSON | no-store | 接收 category / search / page |
| `/api/post-data` | GET, HEAD | 单篇文章 JSON | no-store | 仅返回公开文章 |
| `/api/post` | GET, HEAD | 详情页 SSR HTML | no-store | 注入 SEO + structured data |
| `/api/sitemap` | GET, HEAD | 动态 sitemap XML | no-store | — |
| `/api/notion` | — | **已废弃**（返回 410） | — | 防止误开通用代理 |

## 7. SEO 策略

| 层 | 实现 | 覆盖范围 |
|----|------|---------|
| 静态基础头 | HTML 模板内的 `title` / `meta` / `og:*` / `canonical` | 所有页面 |
| 运行时更新 | `common.js` → `updateSeoMeta()` | SPA 导航后 |
| 文章 SSR | `api/post.js` 服务端注入 | 文章详情页首屏 |
| 结构化数据 | `Article` schema via `application/ld+json` | 文章详情页 |
| robots.txt | 允许页面抓取，禁止 `/api/` | 全站 |
| sitemap | `/sitemap.xml` → 动态生成 | 首页 + 列表页 + 所有公开文章 |

## 8. 环境变量

### 必需

| 变量 | 说明 |
|------|------|
| `NOTION_TOKEN` | Notion Integration Token |
| `NOTION_DATABASE_ID` | 内容数据库 ID |

### 推荐

| 变量 | 说明 | 示例 |
|------|------|------|
| `SITE_URL` | 生产主域名 | `https://www.0000068.xyz` |

### 可选（含默认值）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_METADATA_TTL_MS` | 300,000（5 分钟） | 数据库 schema 缓存时长 |
| `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` | 120,000（2 分钟） | 文章列表缓存时长 |
| `PUBLIC_POST_CACHE_TTL_MS` | 60,000（1 分钟） | 单篇文章缓存时长 |
| `NOTION_REQUEST_TIMEOUT_MS` | 12,000 | Notion API 超时 |
| `NOTION_BLOCK_CHILD_CONCURRENCY` | 4 | block 并发拉取数 |
| `NOTION_PUBLIC_PROPERTY_NAME` | —（整库公开） | 公开策略属性名 |
| `NOTION_PUBLIC_PROPERTY_NAMES` | — | 多候选属性名 |
| `NOTION_PUBLIC_STATUS_VALUES` | — | 自定义公开状态值 |

### 内容字段候选名（可选）

| 变量 | 说明 |
|------|------|
| `NOTION_TITLE_PROPERTY_NAME` / `NOTION_TITLE_PROPERTY_NAMES` | 覆盖标题字段候选名 |
| `NOTION_EXCERPT_PROPERTY_NAME` / `NOTION_EXCERPT_PROPERTY_NAMES` | 覆盖摘要字段候选名 |
| `NOTION_READ_TIME_PROPERTY_NAME` / `NOTION_READ_TIME_PROPERTY_NAMES` | 覆盖阅读时长字段候选名 |
| `NOTION_TAGS_PROPERTY_NAME` / `NOTION_TAGS_PROPERTY_NAMES` | 覆盖标签字段候选名 |
| `NOTION_CATEGORY_PROPERTY_NAME` / `NOTION_CATEGORY_PROPERTY_NAMES` | 覆盖分类字段候选名 |
| `NOTION_DATE_PROPERTY_NAME` / `NOTION_DATE_PROPERTY_NAMES` | 覆盖发布日期字段候选名 |

### 已废弃

| 变量 | 说明 |
|------|------|
| `ALLOWED_ORIGINS` | 仅用于已禁用的 `api/notion.js`，主链路不依赖 |

## 9. 变更记录

### 第一轮复查

- 主页面入口存在且结构完整
- Vercel 重写规则正常
- 文章详情 SSR 输出结构化数据与初始数据
- embed 不再回退成白色通用卡片
- 客户端数据层已移除无效响应缓存分支
- 旧 Cloudflare Worker 已从仓库中移除

### 第二轮修复（2026-04-14）

| # | 修复内容 | 影响文件 |
|---|---------|---------|
| 1 | 文章列表缓存 TTL 15s → 120s | `notion-server.js` |
| 2 | 详情页增加 60s LRU 缓存（20 条） | `notion-server.js` |
| 3 | 分页安全上限 50 轮 | `notion-server.js` |
| 4 | 正文 heading 降级（H1→h2, H2→h3, H3→h4） | `notion-content.js` |
| 5 | 全部 API 支持 HEAD 请求 | 4 个 `api/*.js` |
| 6 | 移除无用 `favicon.ico` 缓存规则 | `vercel.json` |
| 7 | 删除空 `worker/` 残留目录 | 项目根目录 |

### 第三轮修复（2026-04-17）

| # | 修复内容 | 影响文件 |
|---|---------|---------|
| 1 | `fetchPublicPost` 增加同文并发请求去重，避免缓存未命中时重复请求同一篇 Notion 页面与 block 树 | `server/notion-server.js` |
| 2 | 失败的进行中请求会在 settle 后清理，后续重试不会被已失败 Promise 污染 | `server/notion-server.js` |
| 3 | `smoke-check` 新增行为断言，覆盖单篇文章并发复用与失败后重试恢复 | `scripts/smoke-check.mjs` |
| 4 | 架构文档与代码审查文档同步更新到当前实现 | `SITE_ARCHITECTURE.md`、`CODE_REVIEW.md` |

### 待后续迭代

- `common.js` 按职责拆分（router / seo / page-runtime / site-utils）
- `escapeHtml` 三处重复定义合并
- 继续将低价值源码字符串断言迁移为行为断言
- 移动端粒子系统按设备能力裁剪
- CSS 按页面拆分关键样式

## 10. 验证

当前 `smoke-check` 已覆盖：

- 模板与路由基础结构
- Notion block fixture 渲染
- SSR 注入安全性
- 单篇文章并发请求去重与失败后重试恢复

```bash
npm run check
# → Smoke check passed.
```

也可直接执行：

```bash
node scripts/smoke-check.mjs
```

在当前 Windows PowerShell 环境里如果遇到执行策略拦截 `npm`，可改用：

```bash
npm.cmd run check
```
