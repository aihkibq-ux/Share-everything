# Share Everything — 代码审查问题汇总

> 审查日期：2026-04-14 | 涵盖范围：全部前端、后端、API、配置、测试、文档

---

## 🔴 高优先级

### 1. 列表页全量拉取 + 本地过滤，数据库增长后成本线性增长

| 属性 | 值 |
|-----|---|
| 类型 | 可扩展性 |
| 影响文件 | [notion-server.js:621](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L621)、[L724](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L724)、[L806](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L806) |

`queryDatabasePages` 用 `do...while` 把整个数据库所有公开文章一次全拉下来（每页 100，翻页到底），然后在 `loadPublicPagesForQuery` 和 `queryPublicPosts` 才做本地分类过滤、搜索过滤和分页切片。现有 `publicPageSummaryCache`（TTL 15s）能缓解短时重复调用，但冷启动或缓存过期时：100+ 篇 = 2+ 次 Notion API，500+ 篇 = 6+ 次串行调用。

**修复方向：**
- 将 `PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` 从 15s 提升到 60-120s
- 更多场景下把 `categoryFilter` 下推到 Notion API 的 `filter` 参数
- 超大数据库考虑 build-time 预构建文章索引

---

### 2. 详情页每次请求递归拉整篇 block 树，且不缓存

| 属性 | 值 |
|-----|---|
| 类型 | 可扩展性 / Notion API 压力 |
| 影响文件 | [notion-server.js:831](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L831)、[L888](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L888)、[api/post.js:218](file:///c:/Users/x/Documents/anti1/api/post.js#L218)、[api/post-data.js:23](file:///c:/Users/x/Documents/anti1/api/post-data.js#L23) |

`fetchPublicPost` 每次调用：请求 `/pages/:id` → 验证公开策略 → `fetchAllBlockChildren` 递归拉 block 树（最深 10 层），且 `api/post.js` 和 `api/post-data.js` 都设 `Cache-Control: no-store`。同一文章 10 次/分钟 = 10 次完整 Notion 调用。

**修复方向：** 在 `fetchPublicPost` 层增加 30-60s 内存缓存。

---

### 3. `user-select: none` 全局禁用，文章正文不可选

| 属性 | 值 |
|-----|---|
| 类型 | 可用性 |
| 影响文件 | [style.css:40-41](file:///c:/Users/x/Documents/anti1/css/style.css#L40-L41) |

`body` 上设了 `user-select: none`，导致文章正文区（`.post-content`）无法选取和复制。对内容阅读站来说这是体验问题。

**修复：** 在 `.post-content` 上添加 `user-select: text`。

---

## 🟡 中优先级

### 4. 分页循环无安全上限，极端情况可能死循环

| 属性 | 值 |
|-----|---|
| 类型 | 可靠性 |
| 影响文件 | [notion-server.js:621-648](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L621-L648)、[L831-854](file:///c:/Users/x/Documents/anti1/server/notion-server.js#L831-L854) |

`queryDatabasePages` 和 `fetchAllBlockChildren` 都用 `do...while(startCursor)` 分页，如果 Notion API 异常导致 `has_more` 持续 `true`，会无限循环。

**修复：** 加安全计数器上限（如 50 页 = 5000 条）。

---

### 5. 文章正文 H1 与标题 H1 冲突，SEO 多 `<h1>` 问题

| 属性 | 值 |
|-----|---|
| 类型 | SEO |
| 影响文件 | [notion-content.js](file:///c:/Users/x/Documents/anti1/js/notion-content.js) 中 `heading_1` 渲染 + `renderPostArticle` L900 |

`renderPostArticle` 生成 `<h1 class="post-title">`，而正文中的 Notion `heading_1` 也渲染为 `<h1>`，导致页面出现多个 `<h1>`。

**修复：** 正文中 `heading_1` → `<h2>`，`heading_2` → `<h3>`，`heading_3` → `<h4>`。

---

### 6. `common.js` 职责过重 + 与 `notion-content.js` 职责重叠

| 属性 | 值 |
|-----|---|
| 类型 | 可维护性 |
| 影响文件 | [common.js](file:///c:/Users/x/Documents/anti1/js/common.js)（~1400 行）、[notion-content.js:260](file:///c:/Users/x/Documents/anti1/js/notion-content.js#L260)、[L909-935](file:///c:/Users/x/Documents/anti1/js/notion-content.js#L909-L935) |

`common.js` 同时管粒子系统、光标追踪、SEO、结构化数据、进度条、焦点管理、PageRuntime、SPARouter（8 个职责域）。图片/分享图处理函数在 `common.js` 和 `notion-content.js` 两边各实现了一套，`common.js` 甚至会优先委托给 `NotionContent` 版本。

**修复方向：** 按文档已提出的方向拆分（router / seo / page-runtime / site-utils）。

---

### 7. `escapeHtml` 重复定义 3 份

| 属性 | 值 |
|-----|---|
| 类型 | 可维护性 |
| 影响文件 | `notion-content.js`、`notion-api.js`、`blog-page.js` |

三个文件各有一份近乎相同的 `escapeHtml` fallback 实现。有防御价值但增加维护负担。

---

## 🟡 中低优先级

### 8. 回归测试过度依赖源码字符串断言

| 属性 | 值 |
|-----|---|
| 类型 | 测试可维护性 |
| 影响文件 | [smoke-check.mjs:445](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs#L445)、[L788](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs#L788)、[L855](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs#L855) |

大量 `expectIncludes(sourceCode, "某段字符串")` 断言测的是实现细节而非行为。重构变量名、提取函数、精简代码时会产生大量测试噪音。

**修复方向：** 逐步迁移为行为断言（调用函数验证输出），低价值断言逐步移除。

---

## 🟢 低优先级

### 9. API 路由拒绝 HEAD 请求

| 属性 | 值 |
|-----|---|
| 类型 | 兼容性 |
| 影响文件 | [api/post.js:192](file:///c:/Users/x/Documents/anti1/api/post.js#L192)、[api/posts-data.js:11](file:///c:/Users/x/Documents/anti1/api/posts-data.js#L11)、[api/post-data.js:10](file:///c:/Users/x/Documents/anti1/api/post-data.js#L10)、[api/sitemap.js:22](file:///c:/Users/x/Documents/anti1/api/sitemap.js#L22) |

`req.method !== "GET"` 导致 HEAD 被 405。爬虫、预览器、探活工具会发 HEAD 探测。

**修复：** 改为 `req.method !== "GET" && req.method !== "HEAD"`。

---

### 10. `vercel.json` 中 `favicon.ico` 缓存规则无文件匹配

| 属性 | 值 |
|-----|---|
| 类型 | 死配置 |
| 影响文件 | [vercel.json:27-30](file:///c:/Users/x/Documents/anti1/vercel.json#L27-L30) |

仓库只有 `favicon.png`，没有 `favicon.ico`，这条规则永远不会命中。

---

### 11. 空的 `worker/` 目录残留

| 属性 | 值 |
|-----|---|
| 类型 | 文档一致性 |
| 影响 | 项目根 `worker/` + `SITE_ARCHITECTURE.md` 第 544 行 |

文档声称已移除，但空目录仍存在。

---

### 12. `innerHTML` 使用缺少安全依赖注释

| 属性 | 值 |
|-----|---|
| 类型 | 安全（低风险） |
| 影响文件 | `blog-page.js:584`、`post-page.js:355` |

`innerHTML` 赋值的内容源已经过 `escapeHtml` 处理，实际风险低。但缺少注释说明安全依赖链，后续新数据源可能绕过。

---

### 13. 移动端粒子系统开销

| 属性 | 值 |
|-----|---|
| 类型 | 性能 |
| 影响文件 | [common.js](file:///c:/Users/x/Documents/anti1/js/common.js) 粒子系统 |

移动端仍渲染 120 个粒子，低端设备可能有负担。可用 `navigator.hardwareConcurrency` 动态裁剪。

---

### 14. `sessionStorage` 摘要缓存容量风险

| 属性 | 值 |
|-----|---|
| 类型 | 可靠性（低风险） |
| 影响文件 | `notion-api.js` |

文章摘要写入 `sessionStorage`，摘要多且 coverImage URL 长时可能接近 5MB 上限。已有 `collectPostSummaryCacheEntries` 清理逻辑，但未捕获 `QuotaExceededError` 后重试。

---

### 15. CSS 文件体积偏大

| 属性 | 值 |
|-----|---|
| 类型 | 性能 |
| 影响文件 | `style.css`（~40KB） |

3 个页面共用一个 40KB 的 CSS 文件，可考虑按页面拆分关键 CSS。

---

## 统计

| 优先级 | 数量 |
|-------|------|
| 🔴 高 | 3 |
| 🟡 中 | 4 |
| 🟡 中低 | 1 |
| 🟢 低 | 7 |
| **合计** | **15** |
