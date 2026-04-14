# Share Everything 网站代码结构与部署说明

更新时间：2026-04-14

本文档基于当前仓库主干代码整理，目标是把网站的页面结构、前后端运行链路、Notion 内容模型、部署拓扑和运维注意事项一次讲清楚，避免后续排障时反复猜测。

## 1. 网站概览

这是一个以 Notion 为内容源的内容站点，前端是原生 HTML/CSS/JavaScript，部署在 Vercel，域名 DNS 托管在 Cloudflare。

当前架构重点如下：

- Cloudflare 只负责域名和 DNS，不负责应用运行
- Vercel 负责静态资源、Serverless API、页面重写和生产部署
- Notion 负责文章数据库与文章块内容
- 浏览器本地 `localStorage` 负责“收藏”功能

这不是 React / Next.js / Vue 项目，也不是 Cloudflare Pages / Workers 项目。它是“静态页面 + 浏览器脚本 + Vercel API + Notion CMS”的轻量组合架构。

## 2. 当前部署拓扑

### 2.1 生产环境角色分工

- Cloudflare：托管 `0000068.xyz` 的 DNS 记录
- Vercel：托管站点代码、提供生产域名绑定、执行 `/api/*` Serverless 函数
- Notion：作为 CMS 数据库和文章内容源

### 2.2 当前域名结构

按当前线上配置，域名关系是：

- `https://www.0000068.xyz`：主生产域名
- `https://0000068.xyz`：跳转到 `https://www.0000068.xyz`
- `https://share-everything-sigma.vercel.app`：Vercel 默认域名

建议继续保持：

- `www` 作为主站
- 根域名只做跳转

### 2.3 Cloudflare 是否必须有 Workers / Pages

不需要。

当前站点没有使用 Cloudflare Workers，也没有使用 Cloudflare Pages，这是正常的。因为当前真实部署链路是：

- Cloudflare DNS
- Vercel 应用托管

Cloudflare 里只要 DNS 记录正确就够了。

## 3. 仓库目录结构

当前仓库主要结构如下：

```text
.
├─ index.html                首页
├─ blog.html                 列表页
├─ post.html                 文章详情页模板
├─ vercel.json               Vercel 重写、响应头、区域配置
├─ robots.txt                搜索引擎抓取规则
├─ favicon.png               默认站点图标/默认分享图
├─ api/
│  ├─ posts-data.js          文章列表 JSON 接口
│  ├─ post-data.js           单篇文章 JSON 接口
│  ├─ post.js                文章详情 SSR HTML 接口
│  ├─ sitemap.js             动态站点地图
│  └─ notion.js              已禁用的旧 Notion 代理接口
├─ server/
│  ├─ notion-server.js       Notion 服务层、公共内容过滤、SSR 支撑
│  └─ public-content.js      公共内容错误映射与响应辅助
├─ js/
│  ├─ common.js              SPA 路由、SEO、结构化数据、通用运行时
│  ├─ notion-content.js      Notion 页面/块映射与共享渲染器
│  ├─ notion-api.js          浏览器侧数据访问层
│  ├─ blog-page.js           列表页逻辑
│  ├─ post-page.js           详情页逻辑
│  ├─ index-page.js          首页逻辑
│  ├─ bookmark.js            收藏功能
│  └─ font-loader.js         延迟字体加载
├─ css/
│  ├─ style.css              全站基础样式
│  ├─ blog-page.css          列表页补充样式
│  └─ post-page.css          详情页补充样式
└─ scripts/
   ├─ smoke-check.mjs        当前主回归检查脚本
   └─ fixtures/
      └─ notion-block-fixtures.mjs
```

## 4. 页面与运行链路

## 4.1 首页：`index.html`

职责：

- 展示品牌入口
- 提供搜索入口
- 跳转到列表页和收藏页

对应脚本：

- `js/index-page.js`
- `js/common.js`

特点：

- 是真实 HTML 入口，不依赖 JS 才能打开
- 搜索表单提交会跳到 `/blog.html?search=...`
- 如果启用 SPA 路由，站内跳转会被 `SPARouter` 接管

## 4.2 列表页：`blog.html`

职责：

- 展示文章列表
- 分类过滤
- 搜索
- 分页
- 本地收藏视图

对应脚本：

- `js/blog-page.js`
- `js/notion-api.js`
- `js/bookmark.js`
- `js/common.js`

列表页数据流：

1. 浏览器打开 `blog.html`
2. `js/blog-page.js` 初始化当前分类、搜索词、分页状态
3. 如果不是“收藏”视图，就调用 `window.NotionAPI.queryPosts(...)`
4. `js/notion-api.js` 请求 `/api/posts-data`
5. `api/posts-data.js` 调用 `server/notion-server.js` 的 `queryPublicPosts`
6. 服务端查询 Notion 数据库，筛出公开文章，返回 JSON
7. 浏览器渲染卡片列表

收藏页数据流：

1. 当分类为“收藏”时，不请求远端列表
2. 直接使用 `bookmark.js` 读取浏览器 `localStorage`
3. 在前端完成搜索、分页和展示

## 4.3 详情页：`/posts/:id`

详情页不是直接渲染 `post.html`，而是通过 Vercel 重写进入 SSR 路径。

实际链路：

1. 浏览器访问 `/posts/:id`
2. Vercel 根据 `vercel.json` 重写到 `/api/post?id=:id`
3. `api/post.js` 拉取 Notion 文章与块内容
4. 服务端把内容插入 `post.html` 模板
5. 返回带完整 SEO 信息和正文 HTML 的页面

详情页二次运行：

- `js/post-page.js` 读取 SSR 注入的 `#initialPostData`
- 优先复用首屏服务端内容
- 需要时再走 `/api/post-data?id=...` 获取文章 JSON
- 收藏按钮由 `bookmark.js` 接管

这样做的好处：

- 首次访问文章页时有真实 HTML
- SEO、分享卡片、结构化数据更完整
- JS 失败时仍能显示主体内容

## 5. 前端代码分层

## 5.1 `js/common.js`

这是当前前端运行时核心文件，主要负责：

- `SiteUtils`
  - 文章 URL 解析与构建
  - blog 返回地址记忆
  - 图片与封面安全处理
- `updateSeoMeta`
  - 动态更新标题、描述、OG、canonical、robots
- `StructuredData`
  - 动态写入和清除 `application/ld+json`
- `PageRuntime`
  - 根据 URL 初始化不同页面模块
- `SPARouter`
  - 站内链接拦截
  - 页面 HTML 预取
  - `#spa-content` 局部替换
  - 页面切换动画与焦点管理

当前站点是“有真实 HTML 页面入口，但带一层轻量 SPA 导航体验”的混合模式，不是纯 SPA。

## 5.2 `js/notion-content.js`

这是 Notion 内容共享层，也是当前内容渲染的核心。

主要职责：

- 解析 Notion 数据库字段映射
- 把 Notion 页面属性映射成统一文章摘要结构
- 把 Notion block 映射成站点内部 block 结构
- 渲染文章块 HTML
- 渲染详情页文章壳
- 处理图片、分享图、embed、表格、目录等特殊内容

当前 embed 策略：

- 支持的平台会渲染为 iframe
  - YouTube
  - Bilibili
  - Vimeo
  - Loom
  - CodePen
  - Figma
- 不支持的链接不再强行渲染空 iframe
- 会降级成轻量链接块
- 空 embed 不再渲染白色占位卡片

## 5.3 `js/notion-api.js`

这是浏览器侧的数据访问层。

当前职责：

- 请求 `/api/posts-data`
- 请求 `/api/post-data`
- 合并错误状态与错误信息
- 维护书签需要的文章摘要缓存
- 复用 `notion-content.js` 的共享渲染器

当前策略已经做过精简：

- 不再保留无实际效果的响应缓存分支
- 只保留“文章摘要缓存”用于收藏补全和书签体验
- 公共内容本身走实时接口，避免文章取消公开后前端仍拿旧数据

## 5.4 `js/blog-page.js`

主要负责：

- 分类切换
- 搜索联想式过滤
- 分页
- 卡片渲染
- 空态和错误态文案
- 书签按钮交互
- URL 状态同步

它既支持远端文章列表，也支持本地收藏视图。

## 5.5 `js/post-page.js`

主要负责：

- 详情页首屏 hydration
- 文章页书签按钮
- 返回列表逻辑
- 详情页 SEO 和结构化数据同步
- SSR 内容失败时的容错回退

## 5.6 `js/bookmark.js`

收藏系统完全在浏览器本地实现：

- 存储介质：`localStorage`
- 内容：文章摘要、封面、标签、时间戳
- 支持旧收藏数据补全
- 当收藏元数据不完整时，会尝试借助 `NotionAPI` 进行修复

这部分是“本地视图”，不会被搜索引擎索引。

## 6. 服务端代码分层

## 6.1 `server/notion-server.js`

这是当前服务端主逻辑文件，职责很多，但边界已经比较明确：

- 读取环境变量
- 请求 Notion API
- 超时控制与错误封装
- 读取数据库 metadata
- 推导内容字段 schema
- 推导公开策略
- 查询公开文章列表
- 拉取单篇文章正文块
- 渲染详情页文章 HTML
- 生成结构化数据

### 当前公开策略

当前实现支持两种模式：

### 模式 A：整个数据库默认公开

如果没有设置：

- `NOTION_PUBLIC_PROPERTY_NAME`
- `NOTION_PUBLIC_PROPERTY_NAMES`

那么默认把配置的整个数据库视为公开内容库。

适合你的当前使用方式：整个内容库就是公开站点文章库。

### 模式 B：按字段控制公开

如果设置了：

- `NOTION_PUBLIC_PROPERTY_NAME`

那么系统会：

- 读取对应字段
- 判断它是 `checkbox` / `status` / `select`
- 使用 `NOTION_PUBLIC_STATUS_VALUES` 或默认公开值集合匹配

适合以后做“草稿 / 已发布 / 私有”区分。

## 6.2 `server/public-content.js`

这是公共内容接口的错误处理层，主要职责：

- 解析 query string
- 统一 404 / 429 / 500 / 502 / 504 判断
- 统一序列化错误结构
- 透传 `Retry-After`

作用是避免每个 API 文件自己写一遍错误判断。

## 6.3 `api/posts-data.js`

职责：

- 暴露文章列表 JSON 接口
- 接收 `category`、`search`、`page`
- 调用 `queryPublicPosts`

特点：

- 仅支持 `GET`
- `Cache-Control: no-store`

## 6.4 `api/post-data.js`

职责：

- 暴露单篇文章 JSON 接口
- 返回文章摘要 + 结构化 block 内容

特点：

- 仅支持 `GET`
- `Cache-Control: no-store`
- 只允许返回公开文章

## 6.5 `api/post.js`

职责：

- 详情页 HTML SSR
- 把文章内容注入 `post.html`
- 写入 SEO 元信息
- 写入 structured data
- 写入 `initialPostData`

这是当前文章详情页最关键的入口。

## 6.6 `api/sitemap.js`

职责：

- 生成动态 sitemap
- 把首页、列表页和所有公开文章页写进站点地图

## 6.7 `api/notion.js`

这是旧的通用 Notion 代理接口，现在故意返回 `410`。

保留它的意义：

- 明确告诉维护者旧代理已废弃
- 防止以后误把数据库代理重新暴露到公网

也就是说，现在真正对外可用的内容接口只有：

- `/api/posts-data`
- `/api/post-data`
- `/api/post`
- `/api/sitemap`

## 7. Vercel 路由与响应头

当前 `vercel.json` 里有三条关键重写：

- `/sitemap.xml` -> `/api/sitemap`
- `/posts/:id` -> `/api/post?id=:id`
- `/post.html` -> `/api/post`

实际意义：

- SEO 使用标准文章路径 `/posts/:id`
- 详情页首屏走 SSR HTML
- `sitemap.xml` 是动态生成的

当前响应头策略：

- JS / CSS / HTML：`public, max-age=0, must-revalidate`
- `favicon.png`：缓存 1 天
- 全站统一 CSP

当前 CSP 重点：

- `script-src 'self'`
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.cn`
- `font-src 'self' https://fonts.gstatic.cn data:`
- `connect-src 'self' https:`
- `frame-src 'self' https:`

`frame-src 'self' https:` 是为了支持文章里的可信外部 embed。

当前区域：

- `hkg1`

## 8. 搜索引擎与 SEO

当前 SEO 机制分成三层：

### 8.1 静态基础头

每个 HTML 模板都自带：

- `title`
- `description`
- `og:*`
- `canonical`

### 8.2 运行时动态更新

`js/common.js` 的 `updateSeoMeta()` 会在 SPA 导航后更新：

- 标题
- 描述
- OG
- canonical
- robots

### 8.3 文章页 SSR

`api/post.js` 在服务端直接输出：

- 文章标题
- 文章摘要
- 文章 canonical
- `og:image`
- `Article` 结构化数据

### 8.4 robots 与 sitemap

`robots.txt` 当前规则：

- 允许抓取页面
- 禁止抓取 `/api/`
- 指向 `https://www.0000068.xyz/sitemap.xml`

## 9. 当前环境变量

### 9.1 必需变量

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`

### 9.2 推荐变量

- `SITE_URL`
  - 建议设置为生产主域名
  - 例如：`https://www.0000068.xyz`

### 9.3 可选变量

- `NOTION_PUBLIC_PROPERTY_NAME`
- `NOTION_PUBLIC_PROPERTY_NAMES`
- `NOTION_PUBLIC_STATUS_VALUES`
- `DATABASE_METADATA_TTL_MS`
- `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS`
- `NOTION_REQUEST_TIMEOUT_MS`
- `NOTION_BLOCK_CHILD_CONCURRENCY`

### 9.4 旧兼容变量

- `ALLOWED_ORIGINS`

说明：

这个变量只对已禁用的 `api/notion.js` 有意义，主链路不依赖它。

## 10. 当前部署情况与维护结论

当前部署链路可以概括为：

```text
Notion 数据库
   ↓
Vercel Serverless API
   ↓
HTML / JSON 输出
   ↓
浏览器页面与轻量 SPA 路由
   ↓
Cloudflare 仅负责 DNS
```

### 当前部署结论

- 架构成立
- 页面入口清晰
- 详情页首屏为 SSR
- 列表页为 JSON 拉取 + 前端渲染
- 收藏功能完全本地化
- Cloudflare 没有 Workers / Pages 属于正常状态
- 当前不应重新启用通用 Notion 代理

## 11. 本次复查结果

本次复查已执行：

```bash
node scripts/smoke-check.mjs
```

结果：

- `Smoke check passed.`

本次复查重点确认了：

- 主页面入口存在且结构完整
- Vercel 重写规则正常
- 列表接口与文章接口仍指向当前语义化 API
- 文章详情 SSR 仍输出结构化数据与初始数据
- embed 渲染不再回退成白色通用卡片
- 客户端数据层已移除无实际效果的响应缓存分支
- 旧 Cloudflare Worker 已从仓库中移除

## 12. 后续维护建议

### 优先级高

- 保持 `NOTION_DATABASE_ID`、`NOTION_TOKEN` 在 Vercel 中正确配置
- 如果以后需要草稿/公开区分，再启用 `NOTION_PUBLIC_PROPERTY_NAME`
- 不要重新开放通用 Notion 代理

### 优先级中

- 如果后续页面继续增多，建议把 `js/common.js` 再拆分
  - `router`
  - `seo`
  - `page-runtime`
  - `site-utils`
- 如果后续要支持更多内容块，可以继续扩展 `js/notion-content.js`

### 优先级低

- 若要进一步增强首屏性能，可考虑后续补：
  - 更细的资源 preload
  - 图片尺寸信息
  - 更细粒度的字体策略

## 13. 一句话总结

当前网站是一套“Notion 内容源 + Vercel 渲染与 API + Cloudflare DNS”的轻量内容站架构。

它不是 Cloudflare Pages 项目，也不是 Worker 项目；当前主链路清晰、部署方式正确、代码已经围绕现有架构收敛过一轮，后续维护重点应放在内容模型稳定性和前端运行时拆分，而不是再引入新的托管层。
