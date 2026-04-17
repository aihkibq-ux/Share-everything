# Share Everything — 代码审查问题汇总

> 审查日期：2026-04-14 | 涵盖范围：全部前端、后端、API、配置、测试、文档 | 文档复核更新：2026-04-17

---

## 🔴 高优先级

### 1. ✅ 已修复｜列表页全量拉取 + 本地过滤，数据库增长后成本线性增长

| 属性 | 值 |
|-----|---|
| 类型 | 可扩展性 |
| 状态 | 已进一步缓解：列表摘要缓存提升到 120s，并新增按 `category + search` 复用的过滤结果缓存 |
| 影响文件 | [notion-server.js](file:///c:/Users/x/Documents/anti1/server/notion-server.js) |

`queryDatabasePages` 用 `do...while` 把整个数据库所有公开文章一次全拉下来（每页 100，翻页到底），然后在 `loadPublicPagesForQuery` 和 `queryPublicPosts` 才做本地分类过滤、搜索过滤和分页切片。现有 `publicPageSummaryCache`（TTL 120s）已能缓解短时重复调用；本轮又补上了过滤结果缓存，相同 `category + search` 组合在 TTL 内不会重复跑一次远端 category 查询或本地过滤链路。

**后续优化方向（更大规模时）：**
- 更多场景下把 `categoryFilter` 下推到 Notion API 的 `filter` 参数
- 超大数据库考虑 build-time 预构建文章索引

---

### 2. ✅ 已修复｜详情页每次请求递归拉整篇 block 树

| 属性 | 值 |
|-----|---|
| 类型 | 可扩展性 / Notion API 压力 |
| 状态 | 已进一步优化：`fetchPublicPost` 已增加 60s LRU 内存缓存（20 条上限）+ 同文并发请求去重 |
| 影响文件 | [notion-server.js](file:///c:/Users/x/Documents/anti1/server/notion-server.js) |

`fetchPublicPost` 每次调用：请求 `/pages/:id` → 验证公开策略 → `fetchAllBlockChildren` 递归拉 block 树（最深 10 层）。现已增加 60s 内存缓存，同一文章短时间内多次访问不再重复请求 Notion API；同时又补上了进行中 Promise 去重，避免缓存未命中时同一篇文章被并发请求重复拉取。

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
| 状态 | 已进一步缓解：`StructuredData` / `PageProgress` / `focusSpaContent` / `PageRuntime` 已拆到 `runtime-core.js`，但 `common.js` 仍承担 particles / seo / router / site-utils 主链路 |
| 影响文件 | [common.js](file:///c:/Users/x/Documents/anti1/js/common.js)、[runtime-core.js](file:///c:/Users/x/Documents/anti1/js/runtime-core.js)、[notion-content.js](file:///c:/Users/x/Documents/anti1/js/notion-content.js) |

`common.js` 之前同时管粒子系统、光标追踪、SEO、结构化数据、进度条、焦点管理、PageRuntime、SPARouter（8 个职责域）。现在共享运行时已拆成 `runtime-core.js` + `common.js` 两层：前者负责结构化数据、页面进度、焦点与页面注册，后者保留粒子、SEO、站点工具和 SPA 路由；维护压力已下降，但还没完全细拆到更小模块。

**修复方向：** 按文档已提出的方向拆分（router / seo / page-runtime / site-utils）。

---

### 7. ✅ 已修复｜`escapeHtml` 重复定义 3 份

| 属性 | 值 |
|-----|---|
| 类型 | 可维护性 |
| 状态 | 已修复：前端改为直接复用 `notion-content.js` 暴露的共享 `escapeHtml` |
| 影响文件 | `notion-content.js`、`notion-api.js`、`blog-page.js` |

`escapeHtml` 现在只保留 `notion-content.js` 一份实现；`notion-api.js` 与 `blog-page.js` 只消费共享 helper，不再各自保留近似重复的 fallback。

---

## 🟡 中低优先级

### 8. 回归测试过度依赖源码字符串断言

| 属性 | 值 |
|-----|---|
| 类型 | 测试可维护性 |
| 状态 | 已进一步缓解：新增行为断言覆盖过滤查询缓存、session 摘要压缩/恢复、共享搜索文本规范；仍有部分源码字符串断言待继续迁移 |
| 影响文件 | [smoke-check.mjs:445](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs#L445)、[L788](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs#L788)、[L855](file:///c:/Users/x/Documents/anti1/scripts/smoke-check.mjs#L855) |

大量 `expectIncludes(sourceCode, "某段字符串")` 断言测的是实现细节而非行为。重构变量名、提取函数、精简代码时会产生大量测试噪音。

**修复方向：** 逐步迁移为行为断言（调用函数验证输出），低价值断言逐步移除。

---

## 第三轮修复（2026-04-17）

- `fetchPublicPost` 增加同文并发请求去重，缓存未命中时只发起一次上游 Notion 页面与 block 树请求。
- 新增失败后重试行为保障：进行中的失败 Promise 会在 settle 后清理，后续请求可重新拉取。
- `smoke-check` 新增行为断言，直接验证“并发复用”和“失败后恢复”，不再只依赖源码字符串。

---

## 第四轮修复（2026-04-17）

- 列表查询链路增加过滤结果缓存，相同 `category + search` 组合在 TTL 内可直接复用，降低重复查询与重复过滤成本。
- 文章搜索文本构建逻辑统一收口到 `notion-content.js`，服务端列表过滤、客户端摘要缓存、收藏搜索共用同一规范。
- `notion-api.js` 写入 `sessionStorage` 前会主动清理过期摘要，并对持久化摘要做压缩：移除派生 `_searchText`、裁剪长字段、丢弃临时/超长 `coverImage`。
- `smoke-check` 新增行为断言，直接验证过滤查询缓存命中、session 摘要压缩与跨实例恢复，减少对源码字符串的依赖。

---

## 第五轮修复（2026-04-17）

- 修正列表过滤缓存 key 语义，不再把不同大小写但语义不同的分类值错误复用为同一缓存结果。
- 拆出 `runtime-core.js`，将 `StructuredData`、`PageProgress`、`focusSpaContent`、`PageRuntime` 从 `common.js` 中分离。
- `escapeHtml` 只保留 `notion-content.js` 一份共享实现，减少前端重复 fallback。
- `smoke-check` 新增回归覆盖，验证分类缓存语义、页面入口脚本链路与新运行时模块接入。

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
| 状态 | 已修复：写入前主动清理过期摘要，配额紧张时保存压缩版摘要并回退重试 |
| 影响文件 | `notion-api.js` |

文章摘要写入 `sessionStorage`，摘要多且 coverImage URL 长时可能接近 5MB 上限。现已在写入前主动清过期项，并将持久化摘要压缩为更小的数据形态；即使遇到配额压力，也会先尝试保留精简摘要而不是直接丢失缓存。

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
| 🟡 中 | 4 | 3 | 1 |
| 🟡 中低 | 1 | 0 | 1 |
| 🟢 低 | 7 | 5 | 2 |
| **合计** | **15** | **11** | **4** |
