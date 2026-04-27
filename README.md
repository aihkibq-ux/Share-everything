<p align="center">
  <img src="favicon.png" width="80" alt="Share Everything" />
</p>

<h1 align="center">Share Everything</h1>

<p align="center">
  <b>探索 · 记录 · 分享</b>
  <br />
  一个以 Notion 为内容源、零框架依赖的高性能博客系统
</p>

<p align="center">
  <a href="https://www.0000068.xyz">🌐 在线演示</a> ·
  <a href="#快速开始">🚀 快速开始</a> ·
  <a href="#架构">📐 架构</a> ·
  <a href="#安全">🔒 安全</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.6.0-00e5ff?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/deploy-Vercel-000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel" />
  <img src="https://img.shields.io/badge/CMS-Notion-000?style=flat-square&logo=notion&logoColor=white" alt="Notion" />
  <img src="https://img.shields.io/badge/framework-none-d500f9?style=flat-square" alt="No Framework" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" />
</p>

---

## 为什么做这个？

大多数博客系统要么依赖厚重的框架，要么需要本地数据库，要么要求你在 Markdown 文件里写文章。

**Share Everything** 的思路不同：

- ✏️ **在 Notion 里写文章**，发布状态改为「已发布」就上线
- ⚡ **零构建步骤**，没有 React/Vue/Next.js，纯 HTML + CSS + JS
- 🖥️ **SSR + SPA 混合**，首屏服务端渲染，后续导航丝滑无刷新
- 🔒 **生产级安全**，CSP nonce、SSRF 防护、XSS 白名单过滤
- 📱 **极致移动端体验**，粒子降密度、滚动暂停、手势友好

---

## 特性

### 🎨 设计

- 深色玻璃拟态 (Glassmorphism) 设计语言
- WebGL 粒子背景 + 多层光晕轨道动画
- 鼠标跟随光效
- 渐变文字标题 + 微交互动效
- 3 级响应式断点（桌面 / 平板 / 手机）
- `prefers-reduced-motion` 全局适配

### 📝 内容

- Notion 数据库作为唯一内容源
- 支持所有常见 Notion 块（段落、标题、列表、代码、引用、Callout、Toggle、Todo、表格、图片、嵌入、书签、公式等）
- YouTube / Bilibili / Vimeo / CodePen / Figma 嵌入自动转换
- 文章分类、标签、阅读时间自动提取
- 全文搜索（标题 + 摘要 + 标签）

### ⚡ 性能

- 字体延迟加载 (`media="print"` → `"all"`)
- 封面图预加载（前 3 张 `eager` + `fetchpriority="high"`）
- 后续图片全部 `lazy` + `decoding="async"`
- SPA 路由 HTML 缓存（5 分钟 / 最多 6 页）
- 悬停 + 聚焦预取（尊重 `saveData` 和 2G 网络）
- 服务端六层缓存体系 + 三层请求去重
- 移动端粒子 48 个（桌面 350 个），滚动时自动暂停

### 🔒 安全

- 动态 CSP nonce 注入（SSR 页面）
- SSRF 多层防线（协议 / 本地域名 / 私网 IP / DNS 私网解析 / 已校验 IP 绑定 / 重定向逐跳校验 / 大小 / Content-Type）
- XSS 防护（HTML 转义 + URL 协议白名单 + CSS 值白名单）
- 旧 API 代理永久禁用 (410 Gone)
- 错误信息脱敏，仅调试模式暴露详情
- `frame-ancestors 'none'` + `X-Frame-Options: DENY`

### ♿ 无障碍

- SPA 导航后自动焦点管理
- `aria-live` 状态播报区域
- 书签按钮 `aria-pressed` 动态同步
- 博客网格 `role="list"` 语义标记
- 表格键盘滚动 (`tabindex="0"`)

---

## 架构

```
Notion Database
  → Notion API (v2022-06-28)
    → Vercel Serverless Functions (Hong Kong)
      → /api/posts-data     列表 JSON
      → /api/post-data      文章 JSON
      → /api/post           SSR 文章 HTML
      → /api/image          安全图片代理
      → /api/sitemap        动态站点地图
        → Browser
          → 静态 HTML 外壳
          → SPA 路由导航
          → localStorage 本地书签
```

| 层级 | 技术 | 职责 |
|------|------|------|
| 内容源 | Notion API | 文章元数据与块内容 |
| 服务端 | Vercel Serverless | 公开 API、SSR、图片代理、站点地图 |
| 前端 | 原生 HTML/CSS/JS | 静态页面 + 轻量 SPA |
| DNS | Cloudflare | 仅 DNS 解析 |
| 收藏 | localStorage | 纯本地存储 |

### 目录结构

```
.
├── index.html              首页 / 搜索入口
├── blog.html               博客列表 / 书签列表
├── post.html               文章模板（SSR 注入）
├── api/
│   ├── posts-data.js       列表数据接口
│   ├── post-data.js        文章数据接口
│   ├── post.js             SSR 渲染器
│   ├── image.js            安全图片代理
│   ├── sitemap.js          站点地图生成
│   └── notion.js           已禁用的旧代理 (410)
├── server/
│   ├── notion-server.js    Notion 通信、缓存、访问控制
│   ├── security-policy.js  CSP 策略构建器
│   └── public-content.js   错误处理、输入验证
├── js/
│   ├── runtime-core.js     页面生命周期、进度条、焦点管理
│   ├── spa-router.js       SPA 路由、预取、过渡动画
│   ├── notion-content.js   同构块渲染器 (SSR + 浏览器)
│   ├── notion-api.js       客户端 API 层、缓存
│   ├── blog-page.js        列表页逻辑
│   ├── post-page.js        文章页逻辑
│   ├── bookmark.js         收藏管理器
│   ├── site-utils.js       URL、图片、Hash 工具
│   ├── seo-meta.js         SPA SEO 元信息管理
│   ├── common.js           粒子系统
│   ├── ui-effects.js       光标光效
│   └── font-loader.js      字体延迟加载
├── css/
│   ├── style.css           全局设计令牌与共享样式
│   ├── blog-page.css       列表页样式
│   └── post-page.css       文章页样式
├── scripts/
│   ├── local-server.mjs    本地开发服务器
│   └── smoke-check.mjs     冒烟测试 (3000+ 断言)
└── vercel.json             路由、缓存、安全头
```

---

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) ≥ 18
- 一个 [Notion](https://www.notion.so/) 数据库
- 一个 [Notion Integration Token](https://developers.notion.com/docs/getting-started)

### 1. 克隆仓库

```bash
git clone https://github.com/你的用户名/share-everything.git
cd share-everything
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 必填
NOTION_TOKEN=ntn_xxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID=你的数据库ID

# 可选
SITE_URL=https://你的域名
DATABASE_METADATA_TTL_MS=300000
PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS=120000
PUBLIC_POST_CACHE_TTL_MS=60000
NOTION_REQUEST_TIMEOUT_MS=12000
NOTION_BLOCK_CHILD_CONCURRENCY=4
NOTION_PUBLIC_PROPERTY_NAMES=Status,Public,发布状态
NOTION_PUBLIC_STATUS_VALUES=Published,Public,Live,公开,已发布
# 仅当整个数据库都可公开时才设为 true
NOTION_ALLOW_DATABASE_WIDE_PUBLIC_ACCESS=false
```

### 3. 本地开发

```bash
npm run dev
```

浏览器打开 `http://127.0.0.1:4173`

### 4. 运行测试

```bash
npm run check
```

---

## 部署

### Vercel（推荐）

1. Fork 本仓库
2. 在 [Vercel](https://vercel.com) 导入项目
3. 添加环境变量 `NOTION_TOKEN` 和 `NOTION_DATABASE_ID`
4. 部署完成 ✅

项目自带 `vercel.json` 配置，无需额外设置。

### Notion 数据库设置

在你的 Notion 数据库中，确保包含以下属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| Title | Title | 文章标题（必须） |
| Status | Status / Select / Checkbox | 公开可见性字段；Status / Select 值为 `Published` / `Public` / `Live` / `公开` / `已发布` 中任意一个即视为公开，Checkbox 为勾选即公开 |
| Category | Select | 文章分类（可选） |
| Tags | Multi-select | 标签（可选） |
| Excerpt | Rich text | 摘要（可选，自动从属性名推断） |
| Cover | Files & Media | 封面图（可选，也支持 Notion 页面封面） |

> **提示**：系统会自动检测 `Status` / `Public` / `发布状态` 等 checkbox / status / select 公开字段，支持中英文属性名；同名 `Published` 日期字段会被忽略，不会造成歧义。若数据库包含草稿，请确保公开字段存在且已配置；只有整个数据库都可公开时，才设置 `NOTION_ALLOW_DATABASE_WIDE_PUBLIC_ACCESS=true`。

---

## 环境变量参考

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `NOTION_TOKEN` | ✅ | — | Notion Integration Token |
| `NOTION_DATABASE_ID` | ✅ | — | Notion 数据库 ID |
| `SITE_URL` | ❌ | `https://www.0000068.xyz` | 站点根 URL |
| `DATABASE_METADATA_TTL_MS` | ❌ | `300000` | 数据库元数据缓存时间 (ms) |
| `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` | ❌ | `120000` | 页面摘要缓存时间 (ms) |
| `PUBLIC_POST_CACHE_TTL_MS` | ❌ | `60000` | 单篇文章缓存时间 (ms) |
| `NOTION_REQUEST_TIMEOUT_MS` | ❌ | `12000` | Notion API 超时 (ms) |
| `NOTION_BLOCK_CHILD_CONCURRENCY` | ❌ | `4` | 块子元素并发获取数 |
| `NOTION_PUBLIC_PROPERTY_NAME(S)` | ❌ | 自动识别 `Status` / `Public` 等 checkbox / status / select 字段 | 公开可见性字段名；显式配置时会严格校验类型 |
| `NOTION_PUBLIC_STATUS_VALUES` | ❌ | 先匹配 `Published`, `Public`, `Live`, `公开`, `已发布`；未命中时再尝试 `Done`, `Complete`, `Visible`, `Online`, `完成` 等兜底值 | 允许公开的状态值；显式设置后只按配置值匹配 |
| `NOTION_ALLOW_DATABASE_WIDE_PUBLIC_ACCESS` | ❌ | `false` | 仅当整个数据库都可公开时显式设为 `true` |
| `EXPOSE_PUBLIC_ERROR_DETAILS` | ❌ | `false` | 是否在 API 响应中暴露详细错误 |

---

## 技术栈

<table>
  <tr>
    <td align="center"><b>前端</b></td>
    <td>HTML5 + CSS3 + Vanilla JavaScript（零框架）</td>
  </tr>
  <tr>
    <td align="center"><b>后端</b></td>
    <td>Node.js Serverless Functions (Vercel)</td>
  </tr>
  <tr>
    <td align="center"><b>CMS</b></td>
    <td>Notion API v2022-06-28</td>
  </tr>
  <tr>
    <td align="center"><b>部署</b></td>
    <td>Vercel (Hong Kong Region)</td>
  </tr>
  <tr>
    <td align="center"><b>设计</b></td>
    <td>Glassmorphism + WebGL 粒子 + 微交互</td>
  </tr>
  <tr>
    <td align="center"><b>字体</b></td>
    <td>Google Sans + Inter</td>
  </tr>
  <tr>
    <td align="center"><b>测试</b></td>
    <td>自定义冒烟测试 (3000+ 断言，零依赖)</td>
  </tr>
</table>

---

## 开源协议

[MIT](LICENSE) © Share Everything

---

<p align="center">
  <sub>用 ❤️ 和 Notion 构建</sub>
</p>
