# Share Everything — 代码审查问题汇总

> 审查日期：2026-04-14 | 涵盖范围：全部前端、后端、API、配置、测试、文档 | 文档复核更新：2026-04-15

---

## 🔴 高优先级

### 1. ✅ 已修复｜列表页全量拉取 + 本地过滤，数据库增长后成本线性增长

| 属性 | 值 |
|-----|---|
| 类型 | 可扩展性 |
| 状态 | 已缓解：`PUBLIC_PAGE_SUMMARY_CACHE_TTL_MS` 已从 15s 提升到 120s |
| 影响文件 | [notion-server.js](file:///c:/Users/x/Documents/anti1/server/notion-server.js) |

`queryDatabasePages` 用 `do...while` 把整个数据库所有公开文章一次全拉下来（每页 100，翻页到底），然后在 `loadPublicPagesForQuery` 和 `queryPublicPosts` 才做本地分类过滤、搜索过滤和分页切片。现有 `publicPageSummaryCache`（TTL 120s）能缓解短时重复调用。

**后续优化方向（更大规模时）：**
- 更多场景下把 `categoryFilter` 下推到 Notion API 的 `filter` 参数
- 超大数据库考虑 build-time 预构建文章索引

---

### 2. ✅ 已修复｜详情页每次请求递归拉整篇 block 树

| 属性 | 值 |
|-----|---|
| 类型 | 可扩展性 / Notion API 压力 |
| 状态 | 已修复：`fetchPublicPost` 已增加 60s LRU 内存缓存（20 条上限） |
| 影响文件 | [notion-server.js](file:///c:/Users/x/Documents/anti1/server/notion-server.js) |

`fetchPublicPost` 每次调用：请求 `/pages/:id` → 验证公开策略 → `fetchAllBlockChildren` 递归拉 block 树（最深 10 层）。现已增加 60s 内存缓存，同一文章短时间内多次访问不再重复请求 Notion API。

---

### 3. ✅ 已确认｜`user-select: none` 全局禁用

| 属性 | 值 |
|-----|---|
| 类型 | 可用性 |
| 状态 | 无需修改：`.post-content` 已有 `user-select: text` 覆盖 |
| 影响文件 | [style.css](file:///c:/Users/x/Documents/anti1/css/style.css) |

---

## 🟡 中优先级

### 4. ✅ 已修复｜分页循环无安全上限

| 属性 | 值 |
|-----|---|
| 类型 | 可靠性 |
| 状态 | 已修复：`MAX_PAGINATION_ROUNDS = 50` |
| 影响文件 | [notion-server.js](file:///c:/Users/x/Documents/anti1/server/notion-server.js) |

`queryDatabasePages` 和 `fetchAllBlockChildren` 现已增加 `MAX_PAGINATION_ROUNDS = 50` 安全计数器上限（= 5000 条），避免异常时无限循环。

---

### 5. ✅ 已修复｜文章正文 H1 与标题 H1 冲突

| 属性 | 值 |
|-----|---|
| 类型 | SEO |
| 状态 | 已修复：heading_1→h2, heading_2→h3, heading_3→h4 |
| 影响文件 | [notion-content.js](file:///c:/Users/x/Documents/anti1/js/notion-content.js) |

`renderPostArticle` 生成唯一的 `<h1 class="post-title">`，正文中的 Notion `heading_1` 现已渲染为 `<h2>`，避免多 `<h1>` SEO 问题。

---

### 6. `common.js` 职责过重 + 与 `notion-content.js` 职责重叠

| 属性 | 值 |
|-----|---|
| 类型 | 可维护性 |
| 影响文件 | [common.js](file:///c:/Users/x/Documents/anti1/js/common.js)（当前约 1180 行）、[notion-content.js](file:///c:/Users/x/Documents/anti1/js/notion-content.js)（图片 URL 清洗与分享图回退相关段落） |

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

### 9. ✅ 已修复｜API 路由拒绝 HEAD 请求

| 属性 | 值 |
|-----|---|
| 类型 | 兼容性 |
| 状态 | 已修复：所有 API 现已支持 `GET` 和 `HEAD` |
| 影响文件 | [api/post.js](file:///c:/Users/x/Documents/anti1/api/post.js)、[api/posts-data.js](file:///c:/Users/x/Documents/anti1/api/posts-data.js)、[api/post-data.js](file:///c:/Users/x/Documents/anti1/api/post-data.js)、[api/sitemap.js](file:///c:/Users/x/Documents/anti1/api/sitemap.js) |

---

### 10. ✅ 已修复｜`vercel.json` 中 `favicon.ico` 缓存规则无文件匹配

| 属性 | 值 |
|-----|---|
| 类型 | 死配置 |
| 状态 | 已修复：已从 `vercel.json` 中移除 |
| 影响文件 | [vercel.json](file:///c:/Users/x/Documents/anti1/vercel.json) |

---

### 11. ✅ 已修复｜空的 `worker/` 目录残留

| 属性 | 值 |
|-----|---|
| 类型 | 文档一致性 |
| 状态 | 已修复：空目录已删除 |

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

| 优先级 | 总数 | 已修复 | 待处理 |
|-------|------|--------|--------|
| 🔴 高 | 3 | 3 | 0 |
| 🟡 中 | 4 | 2 | 2 |
| 🟡 中低 | 1 | 0 | 1 |
| 🟢 低 | 7 | 4 | 3 |
| **合计** | **15** | **9** | **6** |
