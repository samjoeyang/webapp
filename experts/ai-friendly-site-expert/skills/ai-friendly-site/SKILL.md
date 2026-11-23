---
name: ai-friendly-site
version: 1.0.0
display_name: 官网 AI 友好化改造（GEO）
display_name_en: AI-Friendly Website Optimizer (GEO)
description_zh: 基于本地项目/目录或网站 URL，审计并生成 llms.txt、schema.org JSON-LD、FAQ 标准答案页、正品/商标权属声明页等文件，把品牌官网改造成 AI 眼中的权威信源，让 ChatGPT/Gemini/DeepSeek/Perplexity/豆包等在回答"买哪个/哪家是正品/怎么选"时准确识别并推荐你、对冲仿冒者。
description_en: Audit a local project/directory or a live website URL, then generate llms.txt, schema.org JSON-LD, a FAQ standard-answers page, and an authentic/trademark declaration page — turning a brand site into an authoritative source that AI engines cite correctly.
description: 官网 AI 友好化改造（GEO，生成式引擎优化）工具。基于本地项目/目录或网站 URL 做只读审计，识别 llms.txt、schema.org 结构化数据、FAQ 页、正品声明页、实体一致性等方面的缺口，并生成可直接落地的优化文件（llms.txt、JSON-LD 片段、faq.html、authentic.html）。当用户说"官网AI友好化/让AI认识我们/AI能搜到我们吗/llms.txt/网站结构化数据/schema.org/FAQ标准答案页/正品声明页/GEO优化/AI搜索引擎优化/改造官网让AI推荐/官网被仿冒者抢推荐"时使用。
---

# 官网 AI 友好化改造（GEO）

把品牌官网改造成 AI 眼中的**权威信源**——让 ChatGPT / Gemini / DeepSeek / Perplexity / 豆包等
在回答"买哪个 / 哪家是正品 / 怎么选"时准确识别并推荐你，而非仿冒者。AI 的答案来自它
**抓取并信任的网页**，本 skill 让官网"读得懂、信得过、愿意引用"。

方法论与六项必做清单见 `references/checklist.md`（GEO 方法论，含优先级矩阵与诚实边界）。

## 先看这张表：用户意图走哪一步

| 用户意图 | 动作 | 关键资源 |
|---|---|---|
| 审计现有官网/项目哪里不够"AI 友好" | 跑 analyze.py | `scripts/analyze.py`、`references/analysis-guide.md` |
| 根据品牌事实生成优化文件 | 跑 generate.py | `scripts/generate.py`、`assets/templates/*` |
| 想知道六项必做具体怎么做 | 读方法论 | `references/checklist.md` |
| 想知道文件往哪放、怎么注入 | 读框架落点 | `references/analysis-guide.md` |
| 需要模板占位符说明 | 读模板字典 | `references/templates.md` |

## 主流程：采集事实 → 审计 → 生成 → 落地验证

### 第一步：明确目标并采集事实

先确认输入类型（决定 analyze 的模式）：
- **本地项目/目录**：传 `--path <目录>`（如 Vite/React 站点、静态站、Next.js 工程）。
- **本地若干文件**：传 `--files a.html,b.html`。
- **线上网站 URL**：传 `--url https://域名`（脚本尝试抓取首页 + 探测 `/llms.txt`、`/robots.txt`；无网络时降级并提示改用 WebFetch 手工采集）。

再收集一份 `facts.json`（品牌名、商标号、授权方、域名、重点页面 URL、FAQ 原文）。
采集来源优先级：**用户直接提供** > **从目标站点推断**（analyze 报告里的 `entity_consistency.primary_name`、已发现页面、现有 JSON-LD 可作初值）> **缺项标注**（`【请补充】`）。
`facts.json` 结构见 `references/analysis-guide.md` §四，最小示例可直接套用。

> 仿冒场景务必向用户索取：注册商标与注册号、中国区授权方及关系、正品鉴别方法、官方渠道。
> 这些是对冲仿冒的核心，缺了生成的页面也只是空壳。

### 第二步：审计（只读，不改任何文件）

```bash
# 本地目录
python3 <skill>/scripts/analyze.py --path /path/to/site --brand-name "真公司"

# 线上 URL
python3 <skill>/scripts/analyze.py --url https://example.com --out report.json

# 只看 JSON（便于程序消费）
python3 <skill>/scripts/analyze.py --path . --json
```

报告会逐项给出 `checks`：llms.txt / robots.txt / sitemap / JSON-LD 类型 / FAQ 页候选 /
正品声明页候选 / 实体一致性（主名与变体）/ 首页内链数，并汇总 `gaps` 缺口清单。
若 `--url` 抓不到（沙箱无网络），脚本输出 `manual_collection_hint`，改用 WebFetch 采集后存文件再跑 `--files`。

### 第三步：生成优化文件（写入独立暂存目录，绝不覆盖项目）

```bash
python3 <skill>/scripts/generate.py --facts facts.json --report report.json --out ./ai-friendly-out
```

产物（全部在暂存目录，未触碰项目源码）：

| 文件 | 用途 | 落地位置 |
|---|---|---|
| `llms.txt` | 根目录 AI 阅读清单 | 站点根 / `public/` |
| `schema-org.html` | Organization JSON-LD `<script>` 片段 | 注入各页 `<head>` |
| `faq.html` | 含 FAQPage JSON-LD 的标准答案页 | 站点根 / `public/`，URL 对应 facts 里的 `pages.faq` |
| `authentic.html` | 含 Brand JSON-LD 的正品/商标权属声明页 | 站点根 / `public/`，URL 对应 `pages.authentic` |
| `seo-report.md` | 生成说明 + 落地与验证待办 | —— |

缺失的必填字段会保留 `【请补充：…】` 提示而非半成品；可选字段（parentOrganization、第二项 sameAs、第三条鉴别方法）会自动省略对应区块。

### 第四步：落地与注入（写操作，先展示给用户确认）

把暂存产物搬进项目前，**先向用户展示改动清单并确认**，再执行：

1. 复制 `llms.txt` / `faq.html` / `authentic.html` 到**站点根或 `public/`**，确保
   `https://域名/llms.txt`、`/faq.html`、`/authentic.html` 可公开访问。
2. 把 `schema-org.html` 内的 `<script>` 注入 `index.html`（全局 Organization）；
   逐页 schema 在对应路由组件内动态注入（SPA）或各静态页 `<head>`。多个实体用 `@graph` 合并。
3. 全站内链：首页 ↔ 关于 ↔ 正品声明 ↔ FAQ 互相链接，强化"同一主体"图谱（对应清单⑥）。
4. 清理过期、矛盾、被仿冒者蹭过的内容（对应清单⑥）。

> 框架落点速查：纯静态 → 根目录；Vite/React/Vue/Angular/Next/Astro → `public/`；
> `llms.txt`/`robots.txt` 必须位于最终能被 `https://域名/llms.txt` 访问到的位置。详见 `references/analysis-guide.md` §二。

### 第五步：验证

- 重新跑 `analyze.py`，确认 `gaps` 收窄。
- 用 [Schema Markup Validator](https://validator.schema.org/) 粘贴页面 URL，确认 JSON-LD 无报错。
- 浏览器访问三个新页面确认可访问、无 `【请补充】` 残留。
- AI 探针：用 prompt 模拟用户提问（"XX 正品怎么鉴别""XX 国内授权方"），观察主流 AI 是否引到官网；每周复测（对应清单验收与监测）。

## 安全与诚实边界（务必遵守）

- `analyze.py` 只读；`generate.py` 只写暂存目录，**绝不写项目源码、绝不覆盖现有文件**。
- 一切搬入项目、注入 schema、删除旧内容的写操作，必须先把改动展示给用户确认后再执行。
- 同步告知客户诚实边界（`references/checklist.md` 文末）：llms.txt 非强制标准；schema.org 确定性更高优先做；
  **源头法律动作（商标函/澄清函/行政举报）永远排第一**，否则官网改造效果会被稀释；改造是"种树"非"灭火"，需持续维护。

## 脚本与文档索引

| 脚本 | 作用 |
|---|---|
| `scripts/analyze.py` | 只读审计本地目录/文件/URL，输出缺口报告 JSON |
| `scripts/generate.py` | 读取 facts.json（+报告）渲染模板，产出可落地的优化文件到暂存目录 |

| 参考文档 | 内容 |
|---|---|
| `references/checklist.md` | GEO 六项必做方法论、优先级矩阵、验收与诚实边界 |
| `references/analysis-guide.md` | 目标类型判断、框架识别与文件落点、facts 采集、输出安全约定 |
| `references/templates.md` | 模板文件清单与占位符字典（facts 键 → 占位符） |

| 模板资产 | 用途 |
|---|---|
| `assets/templates/llms.txt` | llms.txt 模板 |
| `assets/templates/faq.html` | FAQ 标准答案页模板（含 FAQPage JSON-LD） |
| `assets/templates/authentic.html` | 正品/商标权属声明页模板（含 Brand JSON-LD） |
| `assets/templates/schema-org.jsonld` | JSON-LD 参考示例（实际由 generate.py 程序化生成） |
