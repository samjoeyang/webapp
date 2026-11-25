# CleanMyMac 最新版对标与实现拆解

> 资料核对时间：2026-11-25。功能部分来自 MacPaw 官方页面 / 官方支持库；实现部分来自官方 DMG 的只读二进制分析。
> ⚠️ 官网下载页文案仍写 **5.5.7 / 2026-07-22**，但官方直链 DMG（2026-11-06 更新）内 `CFBundleShortVersionString` = **5.7.4**，
> `CFBundleVersion` = `50704.0.2611060828`。实际分析以 **5.7.4** 为准，详见 `cleanmymac-binary-analysis.md`。
> 官网：<https://macpaw.com/cleanmymac/> ｜ 版本/下载：<https://macpaw.com/download/cleanmymac>
> DMG 直链：<https://download.macpaw.com/BasicPlus/CleanMyMac.dmg>（SHA-256 `72160ec0…cce67a77`）
> 版本功能差异：<https://macpaw.com/support/cleanmymac/knowledgebase/missing-features>（更新 2026-10-26）

## 一、最新版功能版图

| 模块 | 官方能力 | 关键实现/安全机制 |
|---|---|---|
| Smart Care | 一次跑 5 件事：Cleanup / Protection / Performance / Applications / My Clutter | 逐模块串行扫描，结果按 tile 汇总；默认全选但可逐 tile 取消；可在设置里按模块/类目/组排除；忽略清单同样生效 |
| Cleanup | System Junk、AI Clutter、Mail Attachments、Trash Bins | 分类扫描 → Review All Junk → 逐组复核 → Clean Up；**只清理当前打开类目**，避免跨类目误删；View Log 审计 |
| Protection | Malware Removal、Privacy Items、Application Permissions | Moonlock Engine；扫描深度可选；可加扫磁盘映像/压缩包/USB/iCloud；可疑项需用户确认 |
| Performance | Flush DNS、Free Purgeable Space、Free RAM、Periodic Scripts、Reindex Spotlight、Repair Disk Permissions、Speed Up Mail、Thin TM Snapshots | 按版本/芯片裁剪：Periodic Scripts ≤ macOS 13；Free RAM 仅 Intel；App Store 版无 DNS/权限修复等 |
| Applications | Uninstaller、Updater、Leftovers | 按安装来源/厂商/插件/6 个月未打开分组；结合 Safety Database 定位配置、daemon、隐藏残留；系统 App 默认忽略；App Store/macOS 更新只检测不安装 |
| My Clutter | Duplicates、Similar Images、Large & Old Files、Downloads（Chrome/Safari/Slack） | 仅显示 >100 KB；重复文件按类型过滤、可“智能选择”；**默认不自动选择**；重复文件永久删除并绕过废纸篓（Photos 资产进“最近删除”） |
| Space Lens | 整卷或指定目录的泡泡式存储地图 | 扫描体积 → 可视化浏览 → Review and Remove；可按路径反查 Finder、取消选择后再删 |
| Cloud Cleanup | iCloud Drive / Google Drive / OneDrive / Dropbox | 官方 API 授权连接，扫描云端大文件与本地冗余副本，浏览/复核后清理 |
| Email Cleanup（2026-09-28 新增） | Gmail 批量清理：按年份、简报/促销、垃圾、草稿、按发件人；删除/归档/取消订阅 | 官方 Google API、最小权限、用户自定授权时长、操作前预览、删除进 Gmail Trash 保留 30 天；多账号支持 |
| My Tools | 21 个单项工具（AI Clutter、Browser Care、Login Items、Background Items 等） | 不跑全量扫描，按需直达；Browser Care 每 3 秒刷新 Chrome 标签 CPU/内存，Top Consumers/重复标签/旧标签，可暂停或关闭 |
| The Menu | CPU/RAM/网络/存储/电池/外接设备监控 + 告警（低空间、卡死 App、未卸载残留、待更新等） | 常驻菜单栏；部分告警受发行版限制（App Store 版无 Protection/Update Apps） |
| My Activity | Mac Health、推荐、使用统计、公告 | 状态聚合与引导，不属于清理动作 |

### 官方安全设计（最值得抄的三条）

1. **Safety Database**（<https://macpaw.com/support/cleanmymac/knowledgebase/safety-database>，更新 2026-10-26）
   - 从 2008 年起持续维护的「可删/保留」规则库：系统文件、敏感 App 数据、应用特例、清理规则与例外。
   - 例：Spotify 本地音乐库藏在缓存目录，被规则保护；Safari/Chrome/Electron/JetBrains 需「经同意退出进程 → 清理 → 重开」。
   - 卸载器也查同一库，定位配置、daemon 与非标准残留位置。
2. **每类独立 Ignore List + 全局 Other 列表**（<https://macpaw.com/support/cleanmymac/knowledgebase/ignore-lists>，更新 2026-10-15）
   - 扫描结果右键加入；设置页统一管理与重置；下次扫描生效；Smart Care 亦遵守。
   - 系统语言文件按 macOS 已选语言默认忽略；Uninstaller 默认忽略系统 App。
3. **先扫描、后复核、按类目隔离执行**
   - 结果默认预选可安全清理项，但用户可逐 tile / 逐条目取消；重复文件与相似图片刻意不自动全选。
   - 只在当前打开的类别内执行；日志可回溯；清理前建议备份。

### 说明性限制（不是我们缺功能）

- App Store 版因 Apple 审核限制缺少系统日志、DNS、权限修复、macOS 更新安装等能力；MacPaw Store / Setapp 才是完整版。
- Smart Insights（对陌生文件/App 给解释）要求 **macOS Tahoe 26+ 且开启 Apple Intelligence**，CLI 环境无法等价实现。
- 「Suspicious apps」是厂商自定分组，不代表客观安全结论；本 skill 不照搬该判据。

## 二、与 macos-system-cleaner 的差距矩阵

| CleanMyMac 能力 | 本 skill 现状 | 处理 |
|---|---|---|
| System Junk（缓存/日志/废纸篓/下载残留/安装包） | 已覆盖，Mail Vx 此前按 macOS 版本硬映射，密封卷/Rosetta 已处理 | 本轮改为优先读 `Mail/PersistenceInfo.plist.LastUsedVersionDirectoryName`（官方做法），失败再退化 |
| User/System Cache、Xcode Junk、iOS 备份、语言文件、Universal Binaries | 前 3 项已覆盖；语言文件/Universal Binaries 未做 | 语言文件需读系统已选语言，风险/收益低；Universal Binaries 修改签名后的 App 包风险高，**不追** |
| Document Versions | 未覆盖 | 官方规则很细（永不删最早/最新，仅删 4h 内相邻版本）；CLI 可后续单独做，**本轮不追** |
| Broken Login Items / Broken Preferences / Deleted Users | 未覆盖 | 需 System Events TCC + plist 损坏判定；先写入参考文档，不自动删 |
| AI Clutter（Claude/Codex/Gemini/Cursor 缓存 + Ollama/LM Studio 本地模型） | `ai_model_cache` 已覆盖模型权重；工具缓存此前只靠 `xdg_cache` 兜底，路径不全 | 本轮按 5.7.4 字符串新增 `ai_tool_junk` 类目：只收缓存/日志/遥测，不碰配置与模型版本目录 |
| Trash Bins（启动盘/外接盘/邮件废纸篓） | `trash` + `external_trashes`；Mail Trash 未单列 | 保持；不碰邮件正文 |
| Duplicates / Similar Images | **缺失** | 本轮新增 `scripts/clutter_scan.py`；二进制确认官方用 `FileHashCalculator` + `DuplicateAutoselector` + `isBestInGroup`，本轮已把建议保留改为「画质(像素)→体积→时间」 |
| Large & Old Files / Downloads 分类 | `large_old_files` + `broken_downloads`/`dmg_installers` | 保持 |
| Space Lens | 无可视化泡泡图 | CLI 不追；用 `du` + manifest 体积排序替代，参考文档中说明 |
| Cloud Cleanup | 未覆盖 | 涉及云盘 OAuth/远程删除，**不做自动清理**；仅文档中给手动复核流程 |
| Email Cleanup | 未覆盖 | 涉及 Gmail OAuth 与邮件正文，**不做自动清理**；文档中记录官方安全边界 |
| Maintenance Tasks | `sysinfo.py` 只读巡检；无维护任务 | 本轮新增 `references/performance-maintenance.md`：只读诊断 + 把 sudo 命令交给用户，不代跑 |
| Uninstaller / Leftovers / Updater | 无 | 本轮新增 `references/clutter-and-uninstaller.md`：只读残留盘点与判定；不自动卸载/更新 |
| Browser Care（标签资源监控） | 无 | 需 Chrome 调试协议与后台项授权，CLI 成本高；文档中列为不追 |
| Ignore List | 仅运行时 `--keep` | 本轮新增持久化 `--ignore-file`（paths/prefixes/patterns），scan 与 clutter 共用 |
| Smart Care 一键组合 | 手动多步 | 本轮新增 `scan.py --quick`：低风险类目快速巡检，跳过重型/需确认类目 |
| 菜单栏监控与告警 | `sysinfo.py` 一次性仪表盘 | 不追常驻进程；按需要重复运行 |

## 三、本轮落地清单

1. `scripts/clutter_scan.py`：重复文件（按大小分桶 + SHA-256）、相似图片（sips 缩略图 + 标准库 PNG 解码 + 9x8 dHash + 并查集）、每组建议保留 1 份、输出兼容 `clean.py` 的 manifest、`per_item_confirm=true`。
2. `scripts/scan.py`：新增 `--ignore-file` 持久化忽略清单、`--quick` 快速巡检。
3. `references/cleanmymac-benchmark.md`：本文件，功能/实现/差距来源可追溯。
4. `references/clutter-and-uninstaller.md`：重复文件与相似图片的复核流程、应用残留只读盘点。
5. `references/performance-maintenance.md`：维护任务口径与 sudo 命令边界。
6. `references/ignore-lists.md`：忽略清单格式与运维方式。
7. `references/cleanmymac-binary-analysis.md`：官方 DMG 只读分析结果（framework 版图、规则库、特权 agent、网络/OAuth、可借鉴项）。
8. `SKILL.md` / `references/categories.md`：入口、触发词、类目表与流程同步更新。

## 四、不可照搬的红线

- CleanMyMac 的 My Clutter **永久删除、绕过废纸篓**；本 skill 一律走回收站 + 逐项确认。
- 不自动执行 `sudo`、不自动卸载 App、不自动更新软件、不自动发 OAuth 授权请求。
- 不修改 `*.photoslibrary`、`.app`、`.framework` 包内部；照片库资产删除应由 Photos 自己完成。
- 工具更新/系统更新有专门流程；清理 skill 不越界替用户做版本决策。
- 二进制分析确认的 Developer ID + SMJobBless 特权助手、加密规则库自动更新、YARA/Moonlock 引擎：本项目 ad-hoc 签名环境不具备前提，也不应偷偷下载规则执行。
