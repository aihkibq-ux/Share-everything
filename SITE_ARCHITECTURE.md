# Share Everything 网站架构文档

> 更新时间：2026-04-24

## 1. 架构概览

一句话定义：Notion 作为内容源，Vercel Serverless 负责公开内容访问与文章 SSR，前端采用原生 HTML / CSS / JS，并在真实页面入口之上叠加轻量 SPA 导航。

这不是 React / Next.js / Vue 项目，也不是 Cloudflare Workers / Pages 项目。Cloudflare 只承担 DNS。

### 1.1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 内容源 | Notion API | 存储文章摘要字段与 block 正文 |
| 服务端 | Vercel Serverless Functions | 公开文章查询、详情 SSR、sitemap |
| 前端 | 原生 HTML / CSS / JS | 真正可直接访问的页面 + 轻量 SPA 导航 |
| DNS | Cloudflare | 仅托管 DNS 记录 |
| 收藏 | `localStorage` | 完全本地化，不依赖服务端 |

### 1.2 数据流总览

```text
Notion Database
  -> Notion API
    -> Vercel Serverless
      -> /api/posts-data
      -> /api/post-data
      -> /api/post
      -> /api/sitemap
        -> Browser
          -> HTML 首屏
          -> 轻量 SPA 导航
          -> localStorage 收藏
```

## 2. 部署与路由

### 2.1 域名

| 域名 | 用途 |
|---|---|
| `https://www.0000068.xyz` | 主生产域名 |
| `https://0000068.xyz` | 301 跳转到 `www` |
| `https://*.vercel.app` | Vercel 默认部署域名 |

### 2.2 Vercel 路由

| 入口路径 | 目标 | 说明 |
|---|---|---|
| `/sitemap.xml` | `/api/sitemap` | 动态站点地图 |
| `/posts/:id` | `/api/post?id=:id` | 文章详情 SSR |
| `/post.html` | `/api/post` | 详情模板入口重写 |

### 2.3 缓存策略

| 资源 | Cache-Control |
|---|---|
| HTML / CSS / JS | `public, max-age=0, must-revalidate` |
| `favicon.png` | `public, max-age=86400` |
| API | `no-store` |

补充：
- `GET/HEAD` 之外的方法统一通过共享 helper 返回 `405`
- 所有公开 API 的 `405` 也显式带 `Cache-Control: no-store`

## 3. 仓库结构

```text
.
├─ index.html
├─ blog.html
├─ post.html
├─ vercel.json
├─ robots.txt
├─ favicon.png
├─ SITE_ARCHITECTURE.md
├─ .gitattributes
├─ api/
│  ├─ posts-data.js
│  ├─ post-data.js
│  ├─ post.js
│  ├─ sitemap.js
│  └─ notion.js
├─ server/
│  ├─ notion-server.js
│  └─ public-content.js
├─ js/
│  ├─ notion-content.js
│  ├─ runtime-core.js
│  ├─ site-utils.js
│  ├─ common.js
│  ├─ ui-effects.js
│  ├─ seo-meta.js
│  ├─ spa-router.js
│  ├─ notion-api.js
│  ├─ bookmark.js
│  ├─ index-page.js
│  ├─ blog-page.js
│  ├─ post-page.js
│  └─ font-loader.js
├─ css/
│  ├─ style.css
│  ├─ blog-page.css
│  └─ post-page.css
└─ scripts/
   ├─ smoke-check.mjs
   └─ fixtures/
      └─ notion-block-fixtures.mjs
```

## 4. 前端运行时分层

### 4.1 共享脚本加载策略

三个 HTML 页面都会先加载共享运行时脚本，并用 `data-spa-runtime` 标记：

- `font-loader.js`
- `notion-content.js`
- `runtime-core.js`
- `site-utils.js`
- `common.js`
- `ui-effects.js`
- `seo-meta.js`
- `spa-router.js`

这样 `spa-router.js` 在首次页面切换后，只需要补加载页面专属脚本，不需要再硬编码一份“共享脚本名单”。

### 4.2 `runtime-core.js`

负责共享运行时基础能力：

- `StructuredData`
- `PageProgress`
- `focusSpaContent`
- `PageRuntime`

### 4.3 `site-utils.js`

负责轻量但高复用的站点工具：

- 文章 canonical URL / path helper
- blog 返回地址记忆
- bookmark hash URL 构建与解析
- 图片 URL 与分享图 URL 安全处理
- `matchMedia` 兼容包装

### 4.4 `common.js`

现在只负责粒子背景运行时：

- 画布初始化与重建
- 粒子动画循环
- 桌面端保持 `350` 粒子密度
- 移动端使用更轻的 `80` 粒子密度
- 移动端在 `prefers-reduced-motion: reduce` 下只绘制静态粒子背景，不启动动画循环
- 指针位置同步
- 鼠标 / 触摸加速
- `visibilitychange` / `pageshow` / resize 生命周期处理

### 4.5 `ui-effects.js`

负责界面交互效果：

- cursor glow
- blog card reveal
- 文本选择清理等轻交互

### 4.6 `seo-meta.js`

负责运行时 SEO 标签同步：

- `title`
- `meta[name="description"]`
- `og:*`
- `canonical`
- `robots`

### 4.7 `spa-router.js`

负责轻量 SPA 导航：

- 站内点击拦截
- HTML 片段替换
- 页面级脚本 / 样式补加载
- 页面预取与短期 HTML 缓存
- `/index.html` 归一化为 `/`
- 文章页与 blog 页之间的返回地址记忆

### 4.8 `notion-content.js`

这是前后端共享的内容渲染与映射层，负责：

- Notion 数据库字段 schema 解析
- `mapNotionPage`
- block -> HTML 渲染
- 搜索文本规范化
- 安全转义与 URL 清洗
- 共享 `Article` structured data builder

补充：文章结构化数据现在只在这里定义一份，客户端与服务端共同复用，避免 schema 漂移。

### 4.9 页面脚本

| 文件 | 职责 |
|---|---|
| `index-page.js` | 首页搜索与导航 |
| `blog-page.js` | 列表查询、搜索、分页、分类、收藏列表、URL 同步 |
| `post-page.js` | 文章 hydration、SEO 同步、书签按钮、SSR 容错 |
| `bookmark.js` | 本地收藏存储与兼容旧数据补全 |
| `notion-api.js` | 浏览器侧数据访问、摘要缓存、详情请求 |

## 5. 页面运行链路

### 5.1 首页 `index.html`

- 是真实 HTML 入口，不依赖 JS 也能打开
- 搜索表单提交到 `/blog.html?search=...`
- 开启 SPA 后站内导航由 `SPARouter` 接管

### 5.2 列表页 `blog.html`

远程内容链路：

```text
blog-page.js
  -> NotionAPI.queryPosts()
    -> /api/posts-data
      -> notion-server.js queryPublicPosts()
        -> cache / filter / Notion API
```

本地收藏链路：

```text
blog-page.js
  -> bookmark.js
    -> localStorage
```

补充：
- 收藏视图使用 `#bookmarks` hash 路由
- 收藏视图 URL 形如 `/blog.html#bookmarks?search=...&page=...`
- 不再通过公开 query 参数暴露本地收藏入口

### 5.3 详情页 `/posts/:id`

首屏：

```text
/posts/:id
  -> /api/post?id=:id
    -> fetchPublicPost()
    -> renderPostContent()
    -> 注入 post.html
```

二次运行：

- `post-page.js` 先读取 SSR 注入的 `#initialPostData`
- 必要时再请求 `/api/post-data`
- `StructuredData`、SEO、书签状态在客户端继续接管
- 即使 `NotionAPI` 失败，SSR 首屏内容仍可继续展示
- `api/post.js` 的 SSR 正文注入使用更宽松的 `postContent` 模板锚点匹配；模板结构轻微变化时会告警并兜底插入到 `<article>` 内

## 6. CSS 分层

| 文件 | 职责 |
|---|---|
| `style.css` | 全站公共样式与首页基础样式 |
| `blog-page.css` | 列表页专属布局与卡片样式 |
| `post-page.css` | 详情页正文与书签样式 |

这次拆分后：

- 首页不再加载 blog / post 的专属样式块
- blog / post 的大块样式从共享 CSS 中移出
- `blog-page.css` 已移除 `content-visibility: auto` 方案，避免影响 reveal 动画时机

## 7. 服务端分层

### 7.1 `notion-server.js`

核心职责：

- 数据库 metadata / schema 解析
- 公开内容访问策略推导
- 列表查询、搜索、分页
- 详情获取
- block 递归拉取与并发限制
- SSR 详情页依赖的 HTML / structured data 构建
- Notion API 路径参数统一按 path segment 编码，避免路由参数影响上游请求路径

公开访问策略说明：

- 当前 `NOTION_PUBLIC_PROPERTY_NAME(S)` 为空时，使用 database-wide public mode
- 这个模式依赖一个前提：`NOTION_DATABASE_ID` 指向的是专门用于网站发布的 public-only 内容库
- 如果未来同一个 Notion 库要混放草稿或私密内容，需要配置 `NOTION_PUBLIC_PROPERTY_NAME(S)` 与 `NOTION_PUBLIC_STATUS_VALUES`，改为字段过滤公开内容

主要缓存：

| 对象 | 位置 | TTL / 容量 |
|---|---|---|
| 数据库 metadata | 内存 | 5 分钟 |
| 公开摘要列表 | 内存 | 2 分钟 |
| 过滤结果 | 内存 Map | 跟随摘要缓存 |
| 单篇文章详情 | 内存 LRU | 60 秒 / 20 条 |
| 进行中的详情请求 | Promise Map | 请求生命周期 |

### 7.2 `public-content.js`

负责共享公开内容响应逻辑：

- query 参数读取
- 错误状态映射
- `Retry-After` 透传
- 公开错误 payload 序列化
- `rejectUnsupportedReadMethod()` 统一处理只读接口的 `405`

补充：
- Notion 上游 `401` / `403` / `restricted_resource` 归为服务端配置或权限错误
- Notion 上游 `404` + `object_not_found` 也归为配置或权限错误，避免列表页误显示泛化网络错误
- `/api/sitemap` 复用同一套错误状态映射、`Retry-After` 透传与错误 payload 序列化

### 7.3 API 一览

| 路由 | 方法 | 功能 |
|---|---|---|
| `/api/posts-data` | `GET, HEAD` | 文章列表 JSON |
| `/api/post-data` | `GET, HEAD` | 单篇文章 JSON |
| `/api/post` | `GET, HEAD` | 文章详情 SSR HTML |
| `/api/sitemap` | `GET, HEAD` | 动态 sitemap |
| `/api/notion` | 任意 | 已禁用，固定返回 `410` |

补充：
- `/api/notion` 不再保留旧 CORS 透传逻辑
- 响应固定 `no-store`

## 8. SEO

SEO 由三层共同完成：

| 层 | 实现 |
|---|---|
| 静态模板 | HTML 中的初始 `title` / `meta` / `canonical` |
| 运行时 | `seo-meta.js` 的 `updateSeoMeta()` |
| 详情页 SSR | `api/post.js` 服务端注入 meta 与 `Article` JSON-LD |

额外策略：

- 本地收藏视图写入 `noindex, nofollow`
- 收藏视图 canonical 收敛到 `/blog.html`
- 详情页 structured data 统一使用共享 builder

## 9. 测试与约束

### 9.1 `scripts/smoke-check.mjs`

当前覆盖的重点包括：

- HTML 入口结构
- 共享脚本声明
- CSS 归属
- bookmark hash 路由
- SEO runtime
- SPA router 启动行为
- API 405 / `no-store`
- public content 错误状态映射与 `Retry-After` 透传
- sitemap 错误处理复用公共映射
- 结构化数据共享逻辑
- 详情页 SSR 正文注入的模板锚点容错
- 移动端粒子性能约束
- 失效代理 `/api/notion`
- Notion 上游请求路径参数编码
- TTL 环境变量非法值回退

### 9.2 换行规范

`.gitattributes` 统一约束：

- `*.html`
- `*.css`
- `*.js`
- `*.mjs`
- `*.json`
- `*.xml`
- `*.md`
- `.gitattributes`

都使用 LF。

## 10. 环境变量

### 必需

| 变量 | 说明 |
|---|---|
| `NOTION_TOKEN` | Notion Integration Token |
| `NOTION_DATABASE_ID` | 内容数据库 ID |

### 推荐

| 变量 | 说明 |
|---|---|
| `SITE_URL` | 生产主域名 |

### 可选

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_METADATA_TTL_MS` | `300000` | metadata 缓存时长 |
| `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` | `120000` | 列表摘要缓存 |
| `PUBLIC_POST_CACHE_TTL_MS` | `60000` | 单篇文章缓存 |
| `NOTION_REQUEST_TIMEOUT_MS` | `12000` | 服务端 Notion 请求超时 |
| `NOTION_BLOCK_CHILD_CONCURRENCY` | `4` | block 子节点抓取并发 |
| `NOTION_PUBLIC_PROPERTY_NAME(S)` | 空 | 公共可见性字段名；为空时默认整个配置的 Notion 库都是公开内容 |
| `NOTION_PUBLIC_STATUS_VALUES` | 空 | 公共状态候选值 |

补充：
- 浏览器侧 `notion-api.js` 当前请求超时为 `8000ms`
- 服务端 `NOTION_REQUEST_TIMEOUT_MS` 仍是 `12000ms`
- TTL / timeout / 并发类数字环境变量遇到无效值时回退到默认值
- 当前生产内容库按 public-only 设计维护，因此 database-wide public mode 是预期行为
- 如果内容库未来要混放草稿，必须配置公开字段过滤，避免未发布内容进入列表、详情页或 sitemap

## 11. 本次同步点

本轮文档已同步以下代码变化：

- `common.js` 从“大一统运行时”收敛为粒子系统
- 新增 `site-utils.js`、`ui-effects.js`、`seo-meta.js`、`spa-router.js`
- CSS 拆分为 `style.css` / `blog-page.css` / `post-page.css`
- `Article` structured data 改为共享 helper
- API 只读方法守卫抽到 `public-content.js`
- `api/notion.js` 精简为固定 `410` 禁用入口
- 共享运行时脚本改为 `data-spa-runtime` 声明式标记
- `.gitattributes` 补充 `*.mjs` 与文档自身 LF 规则
- Notion page / block / database id 在服务端请求上游前统一做路径编码
- 服务端缓存 TTL 环境变量无效时回退默认值，避免缓存永久不过期
- `public-content.js` 将 Notion `object_not_found` 归为配置或权限类错误
- `/api/sitemap` 复用公开内容错误状态映射、`Retry-After` 透传与错误 payload 序列化
- `api/post.js` 增强 SSR `postContent` 模板锚点匹配，并添加 `<article>` 兜底插入
- `common.js` 只优化移动端粒子性能：移动端粒子数降为 `80`，桌面端继续保持 `350`
- 移动端开启 reduced motion 时粒子背景静态绘制，不启动动画循环
- `scripts/smoke-check.mjs` 补充以上行为的静态约束与 helper 覆盖

## 12. 复查确认

2026-04-24 已完成一轮全仓库复查，当前确认项：

- `npm.cmd run check` 通过
- 全部 `*.js` / `*.mjs` 均通过 `node --check`
- `git diff --check` 通过
- HTML / CSS / JSON / Markdown / 文本格式静态审计通过，未发现缺失本地资源、重复 HTML id、CSS 括号失衡、JSON 解析错误、Markdown fence 未闭合、末尾空白或缺失文件末尾换行

结论：本轮复查未发现剩余问题。
