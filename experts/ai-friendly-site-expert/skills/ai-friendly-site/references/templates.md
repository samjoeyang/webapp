# 文件模板与占位符说明

> 本文件供**手动编辑**时查阅。自动化生成由 `scripts/generate.py` 完成，它会读取
> `assets/templates/` 下的模板并替换占位符，无需手填。

## 模板文件清单（`assets/templates/`）

| 文件 | 产物 | 用途 |
|---|---|---|
| `llms.txt` | `llms.txt` | 根目录 AI 阅读清单（纯 Markdown） |
| `faq.html` | `faq.html` | 含 FAQPage JSON-LD 的标准答案页 |
| `authentic.html` | `authentic.html` | 含 Brand JSON-LD 的正品/商标权属声明页 |
| `schema-org.jsonld` | 参考示例 | 仅作人工注入参考；实际 JSON-LD 由 `generate.py` **程序化生成**到 `schema-org.html`（自动处理 sameAs/parentOrganization/department 的有无，避免裸占位符） |

## 占位符字典（facts 字段 → 占位符）

`generate.py` 接收一份 `facts.json`，键名与下方占位符一一对应。

### 品牌信息 brand
| 占位符 | facts 键 | 说明 |
|---|---|---|
| `{{ brand_name }}` | `brand.name` | 品牌中文名 |
| `{{ brand_name_zh }}` | `brand.name_zh` | 中文名（与 name 通常相同） |
| `{{ brand_name_en }}` | `brand.name_en` | 外文原名 |
| `{{ brand_description }}` | `brand.description` | 一句话定位 |
| `{{ domain }}` | `brand.domain` | 官网根地址（含 https://） |
| `{{ logo }}` | `brand.logo` | logo 绝对 URL |
| `{{ same_as_1 }}` / `{{ same_as_2 }}` | `brand.same_as[0/1]` | 维基/权威媒体/官方社媒 |
| `{{ parent_organization }}` | `brand.parent` | 海外母公司（可选） |

### 商标与授权
| 占位符 | facts 键 | 说明 |
|---|---|---|
| `{{ trademark_name }}` | `trademark.name` | 注册商标 |
| `{{ trademark_reg_no }}` | `trademark.reg_no` | 注册号 |
| `{{ trademark_owner }}` | `trademark.owner` | 权属人 |
| `{{ trademark_query_url }}` | `trademark.query_url` | 商标局查询页 |
| `{{ department_name }}` | `department.name` | 中国区授权公司 |
| `{{ department_relation }}` | `department.relation` | 关系（授权经销等） |
| `{{ department_description }}` | `department.description` | 授权方说明（可选） |
| `{{ official_channels }}` | `official_channels` | 官方购买/售后渠道 |
| `{{ counterfeit_warning }}` | `counterfeit_warning` | 仿冒警示文案 |
| `{{ auth_method_1..3 }}` | `auth_methods[]` | 正品鉴别方法列表 |

### 页面 URL 与通用
| 占位符 | facts 键 | 说明 |
|---|---|---|
| `{{ url_about }}` `{{ url_authentic }}` `{{ url_china }}` `{{ url_products }}` `{{ url_faq }}` | `pages.*` | 重点页面绝对 URL |
| `{{ canonical }}` | 由 `pages.faq` / `pages.authentic` 推导 | 页面规范 URL |
| `{{ page_title }}` `{{ faq_description }}` `{{ auth_description }}` | `pages.titles.*` | 页面标题/描述 |
| `{{ site_name }}` | `brand.name` | 站点名（页脚用） |
| `{{ contact_url }}` | `contact_url` | 官方联系页 |
| `{{ faq_items }}` | 由 `faq[]` 渲染 | 重复 Q&A 区块 |
| `{{ faq_json }}` | 由 `faq[]` 渲染 | FAQPage JSON-LD 的 mainEntity 数组 |

## 缺字段时的处理

- 缺失的可选字段（parent、department、sameAs 第二项、auth_method 第三项）会被脚本**自动省略对应区块**，不会留下空占位符。
- 缺失的必填字段（品牌名、域名、商标号、FAQ 至少 1 条）由脚本保留 `【请补充：字段名】` 占位提示，避免生成半成品误导 AI。

## 注入 schema 的注意事项

- 每个页面 `<head>` 内 JSON-LD **只放一个 `<script type="application/ld+json">` 即可**，多个实体用 `@graph` 数组合并（参考 `schema-org.jsonld` 模板）。
- SPA（Vite/React 等）：全局 Organization 放 `index.html`；逐页 schema 用静态页面（`public/faq.html` 自带 JSON-LD）或在组件内 `dangerouslySetInnerHTML` / `useEffect` 动态注入。
- 注入后务必用 Schema Markup Validator 验证无报错。
