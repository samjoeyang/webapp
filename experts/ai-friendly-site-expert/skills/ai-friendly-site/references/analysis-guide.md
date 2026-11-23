# 分析指南：项目 / 目录 / 网站 URL 如何审计

> 本文件配合 `scripts/analyze.py` 使用。先判断目标类型与框架，再决定"文件往哪放、怎么注入"。

## 一、目标类型判断

| 输入 | 模式 | 做法 |
|---|---|---|
| 本地目录路径 | `dir` | 直接扫描磁盘文件（最可靠，零网络依赖） |
| 本地单个/多个 HTML、MD、JSON 文件 | `files` | 直接读取这些文件 |
| `https://域名` 或页面 URL | `url` | 尝试抓取首页 + 探测 `/llms.txt`、`/robots.txt`；网络不可用时降级，提示改用 WebFetch 手工采集 |

> URL 模式下若沙箱无网络，`analyze.py` 会如实报错并列出"建议手工用 WebFetch 采集的页面清单"，
> 由智能体把采集到的内容存为临时文件后再跑 `dir`/`files` 模式。

## 二、框架识别与文件落点

| 框架 / 形态 | 识别特征 | llms.txt / robots.txt / 静态页落点 | schema 注入点 |
|---|---|---|---|
| 纯静态站点 | 根目录直接有 `index.html`、无构建配置 | 站点根目录 | 各 `*.html` 的 `<head>` |
| Vite / React / Vue / Angular SPA | `vite.config.*` / `package.json` 含 `vite`/`react`/`@angular`；`index.html` + `src/` | `public/`（构建后原样进 `dist/` 根） | 全局：`index.html` `<head>`；逐页：组件内动态注入或 `public/` 静态页自带 |
| Next.js | `next.config.*` / `app/` 或 `pages/` 目录 | `public/llms.txt`；页面用 `app/route` 或 `app/page.tsx` + Metadata | 组件内 `export const metadata` 或 `<Script type="application/ld+json">` |
| Astro | `astro.config.*` / `src/pages/*.astro` | `public/llms.txt`；页面 `.astro` 注入 | `.astro` 文件 `<head>` 或 `<script>` |
| Hugo / Jekyll / 其他 SSG | `config.toml`/`_config.yml` + `content/` | `static/` 或 `public/` | 模板 `head` 或页面 frontmatter |
| 单页 HTML 小工具 | 只有 1 个 `index.html` | 同目录 | 同 `index.html` `<head>` |

**通用规则**：`llms.txt`、`robots.txt` 必须位于"网站根"（最终部署后能被 `https://域名/llms.txt` 访问到）。
构建型项目一律放 `public/`（或框架等价的静态资源目录），不要放进会被打包处理的 `src/`。

## 三、逐项排查清单（对应 checklist.md 六个项目）

对目标运行 `analyze.py` 后，逐项核对 `checks` 字段：

1. **llms.txt** — 是否可公开访问？内容是否含重点页面链接 + 重要事实？
2. **robots.txt** — 是否存在且未 `Disallow` 关键页面？（建议显式 `Allow: /llms.txt`）
3. **sitemap** — 是否有 `sitemap.xml`？AI/搜索引擎发现页面的入口。
4. **JSON-LD** — 哪些 HTML 含 schema.org？类型是否覆盖 Organization/Brand？有无 FAQPage？
5. **FAQ 页** — 是否存在问答型页面（标题/正文含"常见问题/FAQ/Q&A"或 `<h3>` 问题+`<p>` 答案结构）？
6. **正品声明页** — 是否存在商标/授权/防伪相关页面？
7. **实体一致性** — 全站品牌名是否统一？扫描正文中品牌名出现次数与变体。
8. **内链** — 重点页面是否互相链接（首页↔关于↔正品↔FAQ）？

## 四、facts 采集（生成前必做）

`generate.py` 需要一份 `facts.json`。采集来源优先级：

1. **用户直接提供**（最准）：品牌名、商标号、授权方、域名、重点页面 URL、FAQ 原文。
2. **从目标站点推断**：`analyze.py` 输出的 `entity_consistency.primary_name`、已发现页面、现有 JSON-LD 字段可作为初值。
3. **缺项标注**：无法推断的必填项，在 facts 里留空或标 `【请补充】`，生成时脚本会保留提示，再由用户补。

### facts.json 最小结构示例

```json
{
  "brand": {
    "name": "真公司",
    "name_zh": "真公司",
    "name_en": "Your Brand Inc.",
    "description": "XX 领域的正品方与授权方，主营 XX 产品。",
    "domain": "https://真公司.com",
    "logo": "https://真公司.com/logo.png",
    "same_as": ["https://zh.wikipedia.org/wiki/条目", "https://权威媒体报道"]
  },
  "trademark": {
    "name": "XXXX",
    "reg_no": "XXXXXX",
    "owner": "真公司",
    "query_url": "https://商标局查询页"
  },
  "department": { "name": "XX 公司", "relation": "授权经销", "description": "中国地区唯一合法授权方" },
  "official_channels": "官网商城、授权经销商列表",
  "counterfeit_warning": "市场存在名称/产品近似的未授权主体，请以本页与工商登记为准。",
  "auth_methods": ["查验序列号", "扫描防伪码", "核对包装防伪特征"],
  "contact_url": "https://真公司.com/contact",
  "pages": {
    "about": "https://真公司.com/about",
    "authentic": "https://真公司.com/authentic",
    "china": "https://真公司.com/china",
    "products": "https://真公司.com/products",
    "faq": "https://真公司.com/faq"
  },
  "faq": [
    {"q": "如何鉴别 XX 产品是否为正品？", "a": "结论：通过官方防伪码+授权渠道核验。依据：注册号 XXXX，授权方为 XX 公司。"},
    {"q": "XX 品牌在中国地区的官方授权方是哪家公司？", "a": "结论：XX 公司。依据：与真公司为授权经销关系，详见正品声明页。"}
  ]
}
```

## 五、输出安全约定

- `analyze.py` 只读，不改任何文件。
- `generate.py` 默认写入**独立暂存目录**（如 `./ai-friendly-out/`），绝不覆盖项目现有文件。
- 把生成物搬进项目、向 `index.html` 注入 schema、删除旧矛盾内容等**写操作**，必须先把改动展示给用户确认后再执行。
