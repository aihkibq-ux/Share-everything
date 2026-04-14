# Share Everything — 全局代码审查报告

## 1. 文档与代码一致性

### ✅ 文档准确的部分

`SITE_ARCHITECTURE.md` 整体质量很高，以下关键信息与代码完全吻合：

| 文档描述 | 代码验证结果 |
|---------|------------|
| 页面入口 (index/blog/post) | ✅ 三个 HTML 模板均存在 |
| Vercel 重写规则 | ✅ `vercel.json` 中 3 条 rewrite 正确 |
| API 端点 (posts-data / post-data / post / sitemap) | ✅ `api/` 目录一致 |
| notion.js 返回 410 | ✅ 已禁用 |
| SPA 路由 + SSR 混合模式 | ✅ `common.js` 的 `SPARouter` + `api/post.js` SSR |
| 收藏功能使用 localStorage | ✅ `bookmark.js` 实现完全本地 |
| CSP 策略 | ✅ `vercel.json` 中配置一致 |
| 区域 `hkg1` | ✅ |

### ⚠️ 文档存在的偏差

| 偏差点 | 详情 |
|-------|------|
| `worker/` 目录仍存在 | 文档第 544 行声称"旧 Cloudflare Worker 已从仓库中移除"，但 `worker/` 目录仍保留（虽为空目录）。建议删掉或在 `.gitignore` 中忽略。 |
| `favicon.ico` 缓存规则 | `vercel.json` 第 27-30 行为 `/favicon.ico` 配置了缓存头，但仓库中只有 `favicon.png`，没有 `favicon.ico`。这条规则不会命中任何文件。 |

---

## 2. 架构评估

### 总体评价

> [!TIP]
> 代码经过了明显的收敛治理。整体架构边界清晰，前后端分层合理，安全意识较强。

**优点：**

- `notion-content.js` 使用 UMD 封装，在浏览器和 Node 两侧共享渲染逻辑，避免重复实现
- `PageRuntime` 注册式页面生命周期管理，每个页面模块有独立的 `init` / `cleanup`，SPA 导航时主动清理资源
- API 层的错误处理统一抽象到 `public-content.js`，避免每个端点重复写错误判断
- 公开策略 (Public Access Policy) 设计灵活，支持 checkbox / status / select 三种字段类型
- 粒子系统有完整的生命周期管理（visibility change 暂停、resize 重建、重试机制）

---

## 3. 安全性审查

### ✅ 做得好的地方

| 安全措施 | 位置 | 评价 |
|---------|------|------|
| HTML 转义 (`escapeHtml`) | notion-content.js:156-164 | ✅ 覆盖 `& < > " '` 五种字符 |
| URL 协议白名单 (`sanitizeUrl`) | notion-content.js:249-258 | ✅ 仅允许 `http:`, `https:`, `mailto:` |
| CSS 颜色值消毒 (`sanitizeCssColorValue`) | notion-content.js:136-142 | ✅ 防止 style 注入 |
| 图片 URL 安全处理 | common.js 中 `sanitizeImageUrl` + `resolveDisplayImageUrl` | ✅ 防止 `javascript:` 等协议 |
| CSP 配置 | vercel.json:41-44 | ✅ `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` |
| iframe sandbox | notion-content.js:687 | ✅ 有对 embed iframe 加 `sandbox` 和 `referrerpolicy` |
| 临时资产 URL 检测 | `isLikelyEphemeralAssetUrl` | ✅ 防止把签名过期 URL 当作 og:image |

### ⚠️ 潜在安全关注

| 项目 | 风险等级 | 详情 |
|-----|---------|------|
| `innerHTML` 赋值 | 低 | `blog-page.js:584`, `post-page.js:355` 使用 `innerHTML` 注入渲染后的 HTML。内容来源已在 `notion-content.js` 经过 `escapeHtml` 处理，实际风险低。但如果后续有新数据源绕过共享渲染器，建议增加相关注释说明安全依赖链。 |

---

## 4. 性能与可扩展性

### 🔴 列表页全量拉取模式 — 数据库增长后成本线性增长

> [!WARNING]
> 这是当前架构中最值得关注的可扩展性瓶颈。文章少时没事，但文章数上来后，每次列表页请求的成本会线性增长。

**核心链路：**

```
客户端请求 /api/posts-data?category=技术&search=xxx&page=2
  → api/posts-data.js 调用 queryPublicPosts()
    → server/notion-server.js:806 queryPublicPosts()
      → server/notion-server.js:749 queryPublicPages()
        → server/notion-server.js:724 loadPublicPagesForQuery()
          → server/notion-server.js:621 queryDatabasePages()  ← 遍历整个数据库
```

**问题分析：**

[queryDatabasePages()](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L621-L652) 使用 `do...while` 循环一次拉取**整个数据库所有公开文章**（每页 100 条，反复翻页直到结束），然后在 [loadPublicPagesForQuery()](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L724-L747) 和 [queryPublicPosts()](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L806-L829) 才做本地的分类过滤、搜索过滤和分页切片。

目前有一层缓存（`publicPageSummaryCache`，TTL 15s），可以缓解短时间内重复的全量拉取。但一旦缓存过期或首次冷启动，100+ 篇文章就意味着 2+ 次 Notion API 调用，500+ 篇就是 6+ 次串行 API 调用。

**改进方向：**

| 方向 | 说明 |
|-----|------|
| 延长摘要缓存 TTL | 将 `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` 从 15s 提升到 60-120s 可显著减少 Notion API 调用频率 |
| Notion 原生分类过滤 | 目前只有在无全量缓存时才把 `categoryFilter` 下推到 Notion 查询条件中。可以在更多场景下利用 Notion API 的 `filter` 参数，避免全量拉取再本地过滤 |
| 增量构建 | 对于超大数据库，考虑在 build-time 或定时任务中预构建文章索引，运行时只查增量 |

---

### 🔴 详情页每次请求都递归拉取整篇 block 树 — 对 Notion API 压力大

> [!WARNING]
> 每一次详情页访问（SSR 或 JSON 接口）都会触发完整的 Notion block 树递归拉取，且明确 `no-store` 不缓存。流量一上来会把压力直接打到 Notion。

**核心链路：**

```
/posts/:id  →  api/post.js:218  fetchPublicPost(routeId)
/api/post-data?id=xxx  →  api/post-data.js:23  fetchPublicPost(routeId)
  → server/notion-server.js:888 fetchPublicPost()
    → server/notion-server.js:831 fetchAllBlockChildren()  ← 递归拉取所有子块
```

[fetchPublicPost()](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L888-L898) 每次调用会：
1. 请求 `/pages/:id` 拿页面元数据
2. 请求 `getDatabaseMetadata()` 验证公开策略
3. 调用 [fetchAllBlockChildren()](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L831-L864) 递归拉取 block 树（深度最大 10 层，每层可能分页）

而 [api/post.js:246](file:///c:/Users/x/Documents/anti1/api/post.js#L246) 和 [api/post-data.js:24](file:///c:/Users/x/Documents/anti1/api/post-data.js#L24) 都设置了 `Cache-Control: no-store`，完全不缓存。

**改进建议：**

在 `fetchPublicPost` 层增加**短 TTL 的内存缓存**（如 30-60 秒），相同文章的连续访问可以复用已拉取的 block 树。这不影响内容新鲜度（延迟仅几十秒），但能极大降低 Notion API 调用量。

```text
                       改进前                          改进后
同一文章 10 次访问/分钟    10 次 Notion 全量调用         1 次 Notion 调用 + 9 次缓存命中
```

---

## 5. 代码质量与潜在 Bug

### 🔴 需要关注的问题

#### 5.1 `user-select: none` 全局禁用

**位置：** [style.css:40-41](file:///c:/Users/x/Documents/anti1/css/style.css#L40-L41)

```css
user-select: none;
-webkit-user-select: none;
```

这是在 `body` 上设置的全局样式。对于一个**内容阅读站**来说，这意味着用户无法选取和复制文章正文。虽然在 `.hero-search input` 上单独启用了 `user-select: text`，但详情页的 `.post-content` 区域并没有覆盖。

> [!WARNING]
> 建议在 `.post-content` 上添加 `user-select: text` 以允许文章内容的选取与复制。

#### 5.2 `queryDatabasePages` 分页无安全上限

**位置：** [notion-server.js:621-648](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L621-L648)

```js
do {
  // ...
  pages.push(...data.results);
  startCursor = data.has_more ? data.next_cursor : null;
} while (startCursor);
```

如果 Notion API 异常导致 `has_more` 持续为 `true`，可能形成无限循环。建议加一个安全计数器上限（如 50 页 = 5000 篇文章）。

同样的问题存在于 [fetchAllBlockChildren()](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L831-L854) 的分页循环。

#### 5.3 SEO：文章详情页可能有多个 `<h1>`

**位置:** `notion-content.js` 中 `heading_1` 渲染为 `<h1>`，而 `renderPostArticle` 在第 900 行也生成了 `<h1 class="post-title">`。

如果 Notion 文章正文里包含 H1 块，那详情页最终 HTML 会有两个或多个 `<h1>`。SEO 最佳实践要求每页只有一个 `<h1>`。

> [!NOTE]
> 建议将正文中的 `heading_1` 降级渲染为 `<h2>`，`heading_2` → `<h3>`，`heading_3` → `<h4>`。

#### 5.4 文章 HTML 路由拒绝 HEAD 请求

**位置：** [api/post.js:192](file:///c:/Users/x/Documents/anti1/api/post.js#L192)

```js
if (req.method !== "GET") {
  res.setHeader("Allow", "GET");
  // ...
  return res.status(405).json({ error: "Method not allowed" });
}
```

HEAD 请求会被 405 拒绝。对于返回 HTML 的 SSR 端点来说，某些爬虫、预览器和健康检查工具会先发 HEAD 探测。这个是顺手可修的小点：改为 `if (req.method !== "GET" && req.method !== "HEAD")`，并在 HEAD 时只返回响应头不返回 body。

同样的问题也存在于 [api/posts-data.js:11](file:///c:/Users/x/Documents/anti1/api/posts-data.js#L11)、[api/post-data.js:10](file:///c:/Users/x/Documents/anti1/api/post-data.js#L10)、[api/sitemap.js:22](file:///c:/Users/x/Documents/anti1/api/sitemap.js#L22)，不过 JSON 接口影响较小。

---

### 🟡 值得改进的地方

#### 5.5 `common.js` 职责过重 + 与 `notion-content.js` 职责重叠

**位置：** [common.js](file:///c:/Users/x/Documents/anti1/js/common.js) 约 1400 行

当前 `common.js` 同时管理：

| 职责 | 行数范围 |
|-----|---------|
| 粒子系统 | 6-268 |
| 光标追踪 + 视觉效果 | 280-543 |
| SEO 元数据管理 | 589-704 |
| 结构化数据 | 706-738 |
| 进度条 | 740-831 |
| SPA 焦点管理 | 833-888 |
| 页面生命周期 (PageRuntime) | 902-968 |
| SPA 路由 (SPARouter) | 972-1396 |

同时，图片/分享图处理函数在 `common.js`（`sanitizeImageUrl`、`resolveDisplayImageUrl`、`resolveShareImageUrl`、`isLikelyEphemeralAssetUrl`）和 `notion-content.js`（[L260](file:///c:/Users/x/Documents/anti1/js/notion-content.js#L260)、[L909-L935](file:///c:/Users/x/Documents/anti1/js/notion-content.js#L909-L935)）之间存在明显的**职责重叠**——两边各自实现了一套几乎相同的逻辑，`common.js` 甚至会优先委托给 `window.NotionContent` 的版本。

> [!NOTE]
> 这不是功能 bug，但维护成本已经偏高。后续继续加功能会更难拆。文档已提到拆分方向（router / seo / page-runtime / site-utils），建议在下一个迭代中执行。

#### 5.6 `favicon.ico` 缓存规则无文件匹配

**位置：** [vercel.json:27-30](file:///c:/Users/x/Documents/anti1/vercel.json#L27-L30)

仓库内没有 `favicon.ico` 文件，只有 `favicon.png`。这条缓存规则不会命中任何文件，属于死配置。

#### 5.7 空的 `worker/` 目录

**位置：** 项目根目录 `worker/`

文档声称已移除此目录，但源码中仍保留了一个空目录。

#### 5.8 `escapeHtml` 重复定义

在 `notion-content.js`、`notion-api.js`、`blog-page.js` 中各有一份 fallback 实现。虽然有防御价值（确保在共享层不可用时仍能工作），但 3 份近乎相同的代码增加了维护负担。

---

### 🟢 回归测试过度依赖源码包含断言

**位置：** [smoke-check.mjs](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs)

当前的回归测试大量使用 `expectIncludes(sourceCode, "某段字符串")`模式。例如：

```js
// L445 — 验证卡片渲染包含特定 class
expectIncludes(blogPageJs, 'class="blog-card-link"', "blog cards should render a dedicated link layer");

// L788 — 验证 notion-api.js 包含特定函数名
expectIncludes(notionApiJs, "collectPostSummaryCacheEntries", "...");

// L855 — 验证 api/post.js 包含特定调用
expectIncludes(apiPostJs, 'upsertStructuredDataScript(html, "post-article"', "...");
```

这种断言策略：
- ✅ **优点**：能有效防止误删关键功能代码
- ⚠️ **缺点**：测的是实现细节而不是用户行为。后续重构变量名、提取函数、精简代码时会产生大量**测试噪音**——测试当然会挂，但挂的原因是实现方式变了而不是行为变了

> [!NOTE]
> 建议逐步将高价值的字符串断言迁移为行为断言（例如：调用 `renderBlocks` 验证输出 HTML 结构，而不是检查源码里是否出现 `renderBlocks` 这个字符串）。低价值的字符串断言（如检查变量名是否存在）可以逐步移除。

---

## 6. 性能评估

### ✅ 已优化的性能措施

| 措施 | 位置 | 评价 |
|-----|------|------|
| 延迟字体加载 | `font-loader.js` + HTML 中 `media="print"` | ✅ 字体不阻塞首屏 |
| 图片懒加载 | `loading="lazy" decoding="async"` | ✅ |
| 粒子系统可见性暂停 | common.js:270-277 | ✅ 页面不可见时暂停 rAF |
| SPA 页面预取 | common.js 中 `warmPage` + `pointerover`/`focusin` | ✅ 悬停时预取 |
| content-visibility | blog-page.css:1-6 | ✅ 卡片使用 `content-visibility: auto` |
| resize 节流 | common.js 中 300ms debounce | ✅ |
| 搜索输入防抖 | blog-page.js:618-628 中 300ms debounce | ✅ |
| 摘要缓存 (15s) | notion-server.js 中 `publicPageSummaryCache` | ✅ 但 TTL 偏短，详见上文 |

### 🟡 可考虑的性能优化

| 优化方向 | 说明 |
|---------|------|
| 延长列表缓存 TTL | `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` 15s → 60-120s 可显著减少 Notion API 调用 |
| 增加文章详情缓存 | 在 `fetchPublicPost` 层增加 30-60s 内存缓存 |
| CSS 文件体积 | `style.css` 约 40KB，可考虑按页面拆分关键 CSS |
| 粒子系统移动端 | 移动端仍渲染 120 个粒子，可用 `navigator.hardwareConcurrency` 动态裁剪 |
| API 缓存头 | 可考虑对列表接口使用短 TTL 的 `s-maxage`（如 30s），利用 Vercel Edge 缓存减少函数冷启动 |

---

## 7. 可靠性与容错

### ✅ 已有的容错设计

- SSR 失败时有完整的 fallback 渲染（`api/post.js` 中 `renderFallbackPage`）
- JS 失败时仍保留服务端渲染的文章正文（`showServerRenderedFallback`）
- SPA 导航失败时回退到传统页面跳转
- Notion API 请求有超时控制（客户端 12s，服务端 12s）
- 粒子系统有最多 6 次的重试引导机制
- 收藏系统监听 `storage` 事件处理多窗口同步

### 🟡 可考虑加强的容错

| 项目 | 说明 |
|-----|------|
| 分页死循环 | `queryDatabasePages` 和 `fetchAllBlockChildren` 都用 `do...while` 循环分页，需加安全上限 |
| `sessionStorage` 容量 | `notion-api.js` 把文章摘要写入 `sessionStorage`，摘要较多时可能接近 5MB 上限 |

---

## 8. 具体建议清单

### 按优先级排序

| 优先级 | 编号 | 建议 | 文件 |
|-------|------|------|------|
| 🔴 中高 | 1 | 列表查询改为更高效的分页策略（延长摘要缓存 TTL / 下推更多过滤条件到 Notion） | notion-server.js |
| 🔴 高 | 2 | 在 `.post-content` 上添加 `user-select: text` | style.css |
| 🟡 中 | 3 | 为 `fetchPublicPost` 增加短 TTL 内存缓存，降低 Notion block 递归拉取频率 | notion-server.js |
| 🟡 中 | 4 | 拆分 `common.js`，解决与 `notion-content.js` 的职责重叠 | common.js / notion-content.js |
| 🟡 中 | 5 | 为 `queryDatabasePages` 和 `fetchAllBlockChildren` 添加分页安全上限 | notion-server.js |
| 🟡 中 | 6 | 将正文 `heading_1` 降级为 `<h2>` 以确保单 `<h1>` | notion-content.js |
| 🟡 中低 | 7 | 回归测试逐步从源码字符串断言迁移到行为断言 | smoke-check.mjs |
| 🟢 低 | 8 | `api/post.js` 允许 HEAD 请求 | api/post.js |
| 🟢 低 | 9 | 移除 `vercel.json` 中无效的 `favicon.ico` 规则 | vercel.json |
| 🟢 低 | 10 | 删除空的 `worker/` 目录并更新文档 | 仓库根 / SITE_ARCHITECTURE.md |
| 🟢 低 | 11 | 为低端移动设备动态减少粒子数量 | common.js |

---

## 9. 总结

> [!TIP]
> **这是一套成熟度相当高的轻量内容站代码**。经过了明显的安全治理和架构收敛，代码质量在同类项目中属于上等。

**亮点：**
- 前后端共享渲染层设计精巧，SSR 和 CSR 路径的一致性很好
- 安全意识全面（XSS 防护、URL 协议白名单、CSS 注入防护、CSP）
- 错误处理和容错机制健全
- SPA 导航体验完整（预取、进度条、过渡动画、焦点管理）

**核心改进方向：**

1. **可扩展性**（最重要）：列表查询的全量拉取 + 本地过滤模式在文章增长后会成为瓶颈；详情页每次请求递归拉取整篇 block 树且不缓存，流量大时对 Notion API 压力很大
2. **可用性**：文章内容需要允许用户选取
3. **SEO**：正文 H1 降级以符合单 H1 最佳实践
4. **可维护性**：`common.js` 职责过重需拆分；回归测试需从实现细节断言迁移到行为断言
5. **清理**：少量死代码/死配置（空 `worker/` 目录、无效 `favicon.ico` 规则、HEAD 方法支持）
