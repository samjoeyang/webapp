# 项目级长期记忆

## 网站部署与 SEO 约定（2026-11-02 确立）
- **门户生产根地址**：`https://webapp.zhenzhidaole.com/`（单数 webapp，用户确认；仓库内无显式部署配置）。所有绝对 URL（llms.txt、schema.org JSON-LD、og/twitter）以此为准。
- **SEO/AI 可见性产物**：`public/robots.txt`、`public/llms.txt`（遵循 llmstxt.org 规范）放 `public/`（构建原样进 `dist/`）。`index.html` 含 `WebSite`+`Organization` 的 `@graph` JSON-LD（已加 `sameAs:["https://zhenzhidaole.com"]` 与 `department:朕知道了`）；三个子页面含 `WebApplication` JSON-LD。`public/sitemap.xml` 已生成（6 个入口页：首页 + 3 子应用 + `faq.html` + `authentic.html`），`robots.txt` 已启用 `Sitemap:` 指令。Skill 的 `.md` 是 Agent 安装资源，仅走 llms.txt，不进 sitemap。
- **品牌与运营方（重要）**：对外品牌名与运营方均为 **朕知道了**；域名 `zhenzhidaole.com`（主站 `webapp.zhenzhidaole.com`，其拼音即"朕知道了"）。仓库目录名 `unoecp` 仅为内部代码名，**禁止**作为对外品牌写入 llms.txt / JSON-LD / 页面文案（早期曾误用 `UNOECP` 作品牌，已于 2026-11-02 全部改为 朕知道了）。
- 兄弟项目部署惯例：`*.zhenzhidaole.com` 子域（legaldata/excelprocessor/player/utils.api 等），各含 `vercel.json`（SPA 改写到 index.html）。
- **部署通道区分（2026-11-18 用户明确）**：
  - **webapps 门户**：走 **Git 集成自动部署**——只需 `git commit` + `git push origin main`，Vercel 根据仓库变化自动构建部署（项目 `unoecp-webapps`，rootDirectory=`website/webapps`，绑定 `webapp.zhenzhidaole.com`）。**不要对 webapps 用 Vercel CLI 直传**：从子目录部署会拼接 rootDirectory 报路径错；从 repo 根部署会因 monorepo 17043 文件超 15000 限制而失败（除非 `--archive=tgz`，但没必要）。
  - **utils_api**：走 **Vercel CLI 部署**——在 `website/utils_api/` 目录执行 `vercel --prod --yes`（CLI 已 link 到项目 `unoecp_utils`，生产 `utils.api.zhenzhidaole.com` 别名自动跟随新部署）。该 API 不做 Git 自动部署。
  - Vercel CLI 在 PATH 中不可用，需用绝对路径 `/Users/samjoeyang/.nvm/versions/node/v24.15.0/bin/vercel`；CLI 退出时清理 telemetry 文件会被沙箱拦截导致退出码非零，但部署本身已成功，属噪音可忽略。
- **项目独立迁移（2026-11-23，当前 workspace 即新仓库）**：工作区 `/Users/samjoeyang/workspace/webapp` 已是独立仓库 `https://github.com/samjoeyang/webapp.git`（main）。**最终部署方案：GitHub Pages + main 分支自动部署**（用户当日放弃 Vercel）。`.github/workflows/deploy-pages.yml` 在 push 到 main 时构建 Vite 并发布 `dist/`；Pages 已启用 `build_type=workflow`，source `main:/`。自定义域名 `webapp.zhenzhidaole.com` 已在 GitHub Pages 设置（`cname`），DNS 待用户指向 Pages；`https_enforced` 暂为 false，DNS 就绪后再开。Vercel 项目 `webapp`（`prj_V4ae7NohKOyATieq8T7eANPEfVVy`）仅历史残留，用户自行删除，勿再改动。push 前须用户明确同意。

## 专家应用（WorkBuddy Expert）存放约定（2026-10-28 确立）
- 本项目的专家源码与打包文件统一放在 `webapps/experts/` 下：`experts/<name>/`（源码包）与 `experts/<name>.zip`（分享包）。可随仓库版本管理。**此约定仅限本项目（unoecp/website/webapps），不适用于其他项目；其他项目若需建专家，目录另行确定，不默认套用本路径。**
- **重要约束**：WorkBuddy 只在固定目录 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/<name>/` 检测并注册专家，`webapps/experts/` 不会被直接识别。
- **工作流**：`webapps/experts/<name>/` 为源码源（source of truth）；要让专家在 WorkBuddy 真正可用，需把该目录同步（复制）到 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/<name>/`，并跑 `expert-manager` 技能的 `register_expert.py` 写入 marketplace.json（本机实测 register 成功，专家即在 WorkBuddy 可见）。打包 zip 用 **Python `zipfile`**；**若包内含中文名文件必须强制 `flag_bits |= 0x800`（UTF-8 标记）防 Windows 乱码**（全 ASCII 名 Python 不置位属正常且安全）。落到 `webapps/experts/`（IP 专家归组 `ipswordmaster/`）。
- 二者可能漂移：以 `webapps/experts/` 为准，改动后重新同步到 `~/.workbuddy` 部署副本并重新注册。
- **IPSwordmaster 资产归组（2026-10-28）**：来自 `/Users/samjoeyang/workspace/IPSwordmaster` 的 13 个 IP 技能与 2 个 IP 专家，按用户要求统一归类到 `webapps/skills/ipswordmaster/` 与 `webapps/experts/ipswordmaster/`（两层结构）。注意：技能两层嵌套后需确认 WorkBuddy 技能加载能递归发现 `SKILL.md`；2 个 IP 专家**已注册**且 `~/.workbuddy` 副本与 `webapps/experts/ipswordmaster/` 源码内容一致（仅多一个无害的 `avatars/.gitkeep`）。
- **门户(skills) 接入机制**：门户内容在 `src/data.js`(APPS/SKILLS/APIS)+`src/App.jsx`，`index.html` 仅为外壳。Skill 安装地址=`skills/<slug>/SKILL.md`，由 `public/` 原样带进 `dist/`。新增技能需在 `src/data.js` SKILLS 加条目（slug 带 `ipswordmaster/` 前缀）**且**把技能拷到 `public/skills/<slug>/`，再 `npm run build`。技能在 `webapps/skills/`(源码源) 与 `public/skills/`(门户部署副本) 各一份，需同步。

## 已建技能：ai-friendly-site（官网 AI 友好化改造 / GEO，2026-11-02 建；2026-11-03 归入 geo 分组）
- **已归入 geo 分组（2026-11-03）**：参照 ipswordmaster 模式，源码迁至 `webapps/skills/geo/ai-friendly-site/`；`src/data.js` SKILLS 的 slug 改为 `geo/ai-friendly-site`；门户副本 `webapps/public/skills/geo/ai-friendly-site/`；分享包 `webapps/skills/geo/ai-friendly-site.zip`（旧 `skills/ai-friendly-site*` 已删并 commit）。安装副本保持扁平命名 `~/.workbuddy/skills/ai-friendly-site/`（与 ipswordmaster 一致，不进 geo 子目录）；改源后用 `rsync -a --delete webapps/skills/geo/ai-friendly-site/ ~/.workbuddy/skills/ai-friendly-site/` 同步。**无自动化同步**。
- **`skills/geo/docs/` 4 个 HTML（GEO完整培训资料 / GEO探索长文博客 / OPC-GEO-最小启动方案 / 官网AI友好化改造清单）仅本地参考**：不部署到门户、不进 llms.txt，随仓库留存（已 commit）。
- 能力：`analyze.py` 只读审计本地目录/文件/URL 的 AI 友好化缺口（llms.txt/robots/sitemap/JSON-LD/FAQ 页/正品页/实体一致性/内链）；`generate.py` 读取 facts.json 渲染模板，产出 llms.txt、schema-org.html（Organization JSON-LD 片段）、faq.html（FAQPage JSON-LD）、authentic.html（Brand JSON-LD）到**暂存目录**，绝不覆盖项目文件。方法论见 `references/checklist.md`。
- **已实际应用于本门户（2026-11-02）**：基于事实生成 `public/faq.html`、`public/authentic.html` 两静态页（含 FAQPage / Brand JSON-LD 与互相/首页内链）；`public/llms.txt` 增补「官方声明与帮助」章节指向两页；`public/sitemap.xml` 增补两页入口；`index.html` Organization JSON-LD 增补 `sameAs`+`department`；`src/App.jsx` footer 加 `/faq.html`、`/authentic.html` 链接。`npm run build` 验证通过。
- **模板/生成器修复（同次）**：authentic.html 原模板把 owner 错写成品牌名、且硬塞第二个占位 `same_as` 产生坏链；已改为 owner=运营方（朕知道了）、仅渲染真实 sameAs、空 logo 自动省略、商标注册号未知时输出中性说明而非编造。对应 `facts.json` 的 `trademark.reg_no` 仍是占位，需用户补真实注册号后重生成。
- ⚠️ **`experts/ai-friendly-site-expert/` 未随本次迁移改动**：其 agent 文件与 `.codebuddy-plugin/plugin.json` 仍引用 `skills/ai-friendly-site`（含内嵌副本 `experts/ai-friendly-site-expert/skills/ai-friendly-site/`）。专家目前自包含、仍可工作；如需与 geo 分组对齐需另议。

## 已建专家
- `wechat-attachment-organizer`（微信收纳师，Agent 型，分类 09-OperationsHR）：基于 `webapps/skills/wechat-attachment-organizer` 技能转化，已注册上线。源码 `webapps/experts/wechat-attachment-organizer/`，分享包 `webapps/experts/wechat-attachment-organizer.zip`。
- `ip-platform-complaint`（维权下架官，Agent 型，分类 11-SecurityCompliance，3 技能）：源自 IPSwordmaster，源码 `webapps/experts/ipswordmaster/ip-platform-complaint/`，**已注册**（~/.workbuddy 副本与源码内容一致）；分享包 `webapps/experts/ipswordmaster/ip-platform-complaint.zip`（UTF-8 标记，中文名不乱码）。
- `ip-fullchain-enforcement-expert`（知识产权全链路顾问，Agent 型，分类 12-IndustryConsultant，12 技能）：源自 IPSwordmaster，源码 `webapps/experts/ipswordmaster/ip-fullchain-enforcement-expert/`，**已注册**（~/.workbuddy 副本与源码内容一致）；分享包 `webapps/experts/ipswordmaster/ip-fullchain-enforcement-expert.zip`（UTF-8 标记，中文名不乱码）。
- `hidden-camera-scanner`（反偷拍扫描 · 摄像头与可疑设备探测，Agent 型，分类 11-SecurityCompliance）：基于同名 `webapps/skills/hidden-camera-scanner` 技能转化（资料转化模式），含完整 6 脚本+4 references。源码 `webapps/experts/hidden-camera-scanner/`，**已注册**（~/.workbuddy 副本由 init_expert.py 生成+同步，内容一致）；分享包 `webapps/experts/hidden-camera-scanner.zip`（516.6KB，15 条目，全 ASCII 名）。头像 ImageGen 生成（categoryId 11 背景 dark grey-blue，512×512/404KB）。
- ⚠️ **`init_expert.py` / `package_expert.py` 只认市场目录**：`--path` 传 `webapps/experts` 会被直接拒绝。流程固定为「在市场目录 init+编辑 → rsync 镜像到 `webapps/experts/` → 用**市场目录**调用 package_expert.py」，别反过来对 `webapps/experts/` 那份打包（会报「专家不在专家目录下」）。
- `ai-friendly-site-expert`（官网 AI 友好化改造 · GEO，Agent 型，分类 05-MarketingGrowth）：基于 `webapps/skills/ai-friendly-site` 技能转化（资料转化模式），含完整技能副本（scripts/analyze.py + generate.py、references、assets/templates）。源码 `webapps/experts/ai-friendly-site-expert/`，**已注册**（~/.workbuddy 副本与源码内容一致）；分享包 `webapps/experts/ai-friendly-site-expert.zip`（411.7KB，14 条目）。头像 ImageGen 生成（categoryId 05 背景 red-orange，512×512/389KB）。
