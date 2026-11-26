---
name: macos-system-cleaner
version: 2.2.0
display_name: macOS 系统清理与本地开发环境维护
display_name_en: macOS System Cleaner & Local Dev Env Toolkit
description_zh: 跨 macOS 版本的清理与运维工具箱：磁盘垃圾扫描清理（对标 CleanMyMac，含缓存/日志/邮件/Docker/Homebrew/Xcode/iOS 备份/npm/Python 虚拟环境）、Docker 构建缓存与未使用镜像回收、Time Machine 本地快照、本机工况（CPU/内存/网络/硬盘）、Docker 构建完成监控、Docker Desktop 卡死恢复、推送远程前的凭据体检、删项目目录前的风险核查、本地网页交付前验证、同源项目文档合并。默认移入回收站可恢复，破坏性操作一律逐项确认。
description_en: Cross-version macOS cleanup & ops toolkit — CleanMyMac-style junk scanning, Docker build-cache/unused-image reclaim, Time Machine snapshots, system vitals (CPU/mem/net/disk), Docker build watching, Docker Desktop recovery, pre-push secret audit, project-dir deletion risk audit, local webapp verification, and sibling-repo doc merging. Recoverable by default; destructive steps always confirmed per item.
description: macOS 清理与本地开发环境维护工具箱（可被任意支持 Skill 的智能体安装使用）。①清理：自动探测 macOS 版本/芯片并按版本映射路径（Mail 的 Vx 目录、Catalina+ 密封系统卷、Apple Silicon Rosetta、Docker Desktop 差异），覆盖缓存/日志/废纸篓/安装包/邮件垃圾/Xcode 派生数据/iOS 备份/容器与浏览器缓存/Homebrew/字体缓存/应用支持目录缓存/大文件旧文件，以及 npm 生态缓存与 node_modules、Python 虚拟环境与 pip/uv 缓存、Rust/Ruby/其他包管理器缓存、Docker 构建缓存与未使用镜像与已停止容器、Time Machine 本地快照、临时文件（用户 $TMPDIR 与系统 /private/tmp，按 7 天未修改过滤）、系统诊断数据、休眠镜像、AI 模型缓存（HuggingFace/Ollama/LM Studio）、iOS 模拟器、外接卷废纸篓；②巡检：本机工况只读仪表盘（CPU/内存/网络/硬盘/SMART）；③运维：Docker 构建完成监控与通知、Docker Desktop 卡死诊断恢复；④安全与交付：首次推送前的凭据体检与历史清理、删除本地项目目录前的风险核查、本地网页交付前的浏览器验证、同源项目需求/设计文档合并。默认移入回收站（可恢复），系统级需 sudo，npm/Python/Docker/快照/模型/模拟器类目逐项目确认。当用户说"清理mac垃圾/释放磁盘空间/CleanMyMac/找出能删的大文件/清理缓存日志/清理临时文件/清理系统诊断/清理rust缓存/清理AI模型/清理模拟器/清理外接盘废纸篓/查看本机状态/系统监控/CPU占用/内存压力/硬盘空间/清理npm缓存/清理node_modules/清理python虚拟环境/清理conda环境/清理pip缓存/清理docker构建缓存/清理未使用镜像/清理停止的容器/清理Time Machine快照/关掉时间机器/docker构建完成告诉我/Docker起不来/docker卡死/推送到GitHub前检查有没有泄露密钥/删掉这个项目目录/网页跑起来看一眼/合并两个项目的文档"时使用。
---

# macOS 清理与本地开发环境维护

一个入口覆盖三类事：**清空间**、**查状态**、**做交付前的安全与验证**。
共性是一条纪律：**先只读取证 → 把风险讲清楚 → 逐项确认后才动手 → 留可审计的清单**。

## 先看这张表：你要做的事归哪一块

| 用户意图 | 走哪里 | 关键脚本 / 文档 |
|---|---|---|
| 清缓存/日志/废纸篓/安装包/大文件，释放空间 | 下面「主流程」 | `scripts/scan.py` → `scripts/clean.py` |
| 清 npm 缓存 / node_modules | 主流程（`npm_junk`，逐目录确认） | `references/node-cache.md` |
| 清 Python 虚拟环境 / pip、uv 缓存 | 主流程（`python_junk`，逐目录确认） | `references/python-env.md` |
| 清临时文件 / 系统诊断 / 休眠镜像 | 主流程（`tmp_user`/`tmp_system`/`system_diagnostics`/`sleepimage`） | `references/categories.md` §8 |
| 清 Rust / Ruby / Maven / Gradle / NuGet 缓存 | 主流程（`rust_cache`/`ruby_gem_cache`/`misc_pkg_cache`） | `references/categories.md` |
| 清 AI 模型 / iOS 模拟器 / 外接盘废纸篓 | 主流程（逐项确认，体积大但重建代价高） | `references/categories.md` §9 |
| 清 Docker 构建缓存 / 未使用镜像 / 已停止容器 | 主流程（命令式，逐项确认） | `references/categories.md` §7 |
| 清 Time Machine 本地快照 / 关自动备份 | 主流程（只出命令，不代跑） | `references/time-machine-snapshots.md` |
| 看本机工况：CPU/内存/网络/硬盘 | 直接跑 | `scripts/sysinfo.py` |
| 等 docker build 跑完再通知我 | 后台 watcher + 轮询 | `scripts/docker_watch.sh`、`references/docker-build-watch.md` |
| Docker Desktop 卡死 / 容器起不来 | 诊断 → 清杀 → 重启 | `references/docker-desktop-recovery.md` |
| 首次推 GitHub / 查有没有泄露密钥 | 体检 → 重写历史 → 克隆验收 | `scripts/secretscan.py`、`references/git-secret-scrub.md` |
| 删掉本地项目目录 | 风险核查 → 确认 → 存档 → 删 | `scripts/project_audit.py`、`references/project-dir-deletion.md` |
| 网页/小工具交付前跑起来看一眼 | 无头 Chrome / playwright 验证 | `references/webapp-verify.md` |
| 合并两个同源项目的需求/设计文档 | 判关系 → 通读 → 分段写 | `references/docs-merge.md` |

> 具体路径版本表、禁止清单、各类踩坑细节都在 `references/` 里，**执行前按需加载对应那一篇**，
> 不要凭记忆写命令。

## 关键安全原则（所有模块共用）

1. **先扫后清、默认只预览**：`scan.py` 只读；`clean.py` 默认 dry-run，需 `--apply` 才动手。
2. **优先回收站**：用户级移入 `~/.Trash`，系统级移入 `/.Trashes/<uid>`；仅 `--purge` 才永久删除。
   Docker 命令式清理（prune / rmi）**不经回收站、不可恢复**，必须先讲明。
3. **绝不动用户核心数据**：文档/桌面/照片/邮件正文/钥匙串/`.app` 本体/工程源码（见 `references/safety.md`）。
4. **逐项确认闸门**：`npm_junk`/`python_junk`/`docker_*`/`tm_local_snapshots`/`ai_model_cache`/
   `simulator_devices` 标记 `per_item_confirm=true`——必须逐个目录/资源向用户确认，把确认过的写进清单传 `--approved`；
   **未传 `--approved` 且非交互时脚本直接拒绝删除**（只记日志）。这是设计，不是故障，别绕过。
5. **系统级需 sudo**：含系统类目时必须 `--system --sudo`，否则跳过并提示；沙箱里 sudo 不可用时，
   把命令原样交给用户，不要反复重试。
6. **可审计**：每次清理写 `cleanup_log.json`（原路径/体积/结果/去向）。

## 主流程：扫描 → 交互选择 → 确认 → 清理

### 第一步：扫描（只读）

```bash
python3 <skill>/scripts/scan.py --out <工作目录>/macos_clean_manifest.json
```

常用开关：`--include-system`（含系统级）｜`--no-large`（跳过大文件扫描，快）｜
`--min-size 10`（单条低于 10MB 不登记）｜`--categories a,b`（只扫指定类目）｜
`--no-docker`（跳过 Docker 探测）｜`--keep <前缀>`（指定保留目录，可多次给）｜
`--tmp-days 7`（临时文件只清超过 N 天未修改的，默认 7）｜
`--large-gb 2 --old-days 120`（大文件阈值）。

脚本打印摘要并写入 manifest：`macos`（版本/芯片/密封卷）、`time_machine`（自动备份/快照数）。

### 第二步：与用户交互选择

**主动展示每个类目的体积与条目数**，让用户勾选。`caution`（邮件垃圾、Xcode、iOS 备份、
大文件、Docker、各环境类目）和 `system`（系统级）**必须明确告知风险**后再纳入。
逐项确认类目要**把每个目录/镜像/快照单独列出**再问，不能只报一个总体积。

### 第三步：预览 → 确认 → 执行

```bash
# 预览（不改任何东西）
python3 <skill>/scripts/clean.py --manifest m.json --categories <选中 id>

# 需逐项确认的类目：先把用户确认过的写进清单
echo '["/path/a","/path/b"]' > approved.json
python3 <skill>/scripts/clean.py --manifest m.json \
  --categories npm_junk,python_junk,docker_build_cache \
  --apply --approved approved.json

# 普通安全类目可直接执行（移入回收站）
python3 <skill>/scripts/clean.py --manifest m.json --categories user_cache,user_logs --apply

# 系统级
python3 <skill>/scripts/clean.py --manifest m.json --categories system_cache --apply --system --sudo
```

终端交互版：`--interactive`（选类目）＋ `--confirm-each`（逐条问 y/N）。
`--approved` 既接受**清单文件路径**，也接受**内联 JSON**（`'["/path/a"]'` 或 `'{"approved":["/path/a"]}'`）；
路径要与 manifest 中的 `path` 一致（`/var` 与 `/private/var` 这类符号链接差异会自动兼容，命令式条目同理）。
清单文件不存在或 JSON 写错会**直接报错退出**，不会静默变成「零批准」。

### 第四步：交付与收尾

- 报清：**体积、条目数、去向（回收站/永久）、需用户自己执行的命令**。
- 保留 `cleanup_log.json`，说明可从回收站恢复、彻底释放需清空回收站。
- **实删体积与 `df` 变化分开报**——APFS 上 df 会随可清除空间跳变，别把差额算成自己的功劳。
- 建议重要数据先 Time Machine 备份；空间异常时用日志核对删了什么。

## 命令式资源：与文件不同的三类

| 类目 | 做什么 | 安全边界 |
|---|---|---|
| `docker_build_cache` | `docker builder prune -af` | 永久生效，只影响下次构建速度 |
| `docker_unused_images` | `docker image rm <id>`（按镜像 ID，无容器引用才列） | 永久生效，再用须重新 pull/build |
| `docker_stopped_containers` | `docker container prune -f` | 只删已退出容器记录，不动运行中容器与数据卷 |
| `tm_local_snapshots` | 只打印 `sudo tmutil deletelocalsnapshots <日期>` | **永不代跑**：写操作需 sudo + 完全磁盘访问权限 |

⚠️ `docker_junk`（`Docker.raw` 稀疏文件）与上面三个 Docker 类目**体积重叠**，不要相加；
先按 build cache → unused images → stopped containers 的顺序回收内部资源，raw 才会收缩。

⚠️ 临时文件（`tmp_user`/`tmp_system`）是**唯一按时间判安全**的类目：只收 7 天未修改的顶层项，
近期改动一律跳过——临时目录里的新文件很可能正被运行中进程占用。不要为了多清几百 MB 调低阈值。

## 交付类模块的硬要求

- **推送前体检**（`secretscan.py`）：退出码 1 = 有阻断项；`.env*` 变体副本、
  代码里的兜底默认值（`process.env.X || '真实口令'`）是最易漏的两类。推送后再改历史代价极高，
  必须在首次推送前做；**推送（git push）必须用户明确同意**。
- **删项目目录**（`project_audit.py`）：先分出「可恢复 / 不可恢复」两类，`df -h` 删前删后各记一次，
  落清单存档，先 `rm -f` 解软链接，删后解释空间差额（快照 / Docker 孤儿 / `lsof +L1`）。
- **网页验证**（`webapp-verify.md`）：能用真实浏览器跑就别只读代码；断言必须落在「终态」，
  写完先证明它会失败。
- **文档合并**（`docs-merge.md`）：先判两个项目是分支/平行/上下游，再动笔；每个结论都要能追到源。

## 权限与环境须知（会反复遇到）

- 平台：macOS 12.7.6+；`python3` 系统自带即可，脚本**零第三方依赖**。
- 受限会话里：`ps` 被拒但 `pgrep` 可用；`top` 可能受限（`sysinfo.py` 会降级为负载均值）；
  没有 `timeout`（用 `perl -e 'alarm shift; exec @ARGV'` 或后台+重定向代替）。
- `sudo` 在沙箱内不可用；`tmutil` 写操作还额外要 TCC「完全磁盘访问权限」，
  且**必须授权给用户实际敲命令的那个 App**（给 Terminal 加对 iTerm2/VS Code 无效）。
- 部分系统路径（`~/.Trash`、`com.apple.*` 容器）受 TCC 保护，读取/移动会失败——
  这是权限边界，不是脚本 bug，如实报告并跳过。

## 脚本与文档索引

| 脚本 | 作用 |
|---|---|
| `scripts/scan.py` | 跨版本只读扫描器，产出 manifest JSON（含命令式资源） |
| `scripts/clean.py` | 基于 manifest 的清理器（预览/回收站/永久/sudo/逐项确认/命令式） |
| `scripts/sysinfo.py` | 本机工况仪表盘（CPU/内存/网络/硬盘，`--json` 机读） |
| `scripts/secretscan.py` | 推送前凭据体检（阻断项 + 需人工确认项，退出码 1 表示有阻断） |
| `scripts/project_audit.py` | 删目录前风险核查（高/中/低风险 + 判断依据） |
| `scripts/docker_watch.sh` | Docker 构建完成监控，写 `DONE` 段到 `/tmp/docker_watch/` |

| 文档 | 内容 |
|---|---|
| `references/categories.md` | 类目清单 + 各 macOS 版本路径表 + 聚合粒度 + 命令式资源语义 |
| `references/safety.md` | SIP/受保护路径、禁止删除清单、回收站策略、sudo 处理 |
| `references/time-machine-snapshots.md` | TM 快照取证、四个坑、密封快照不可删、报告口径 |
| `references/docker-build-watch.md` | 构建监控、两个完成信号、通知通道、完成后必查 |
| `references/docker-desktop-recovery.md` | 卡死分级、`Docker --autostart` 清杀、`open -n`、profile 与网关 |
| `references/node-cache.md` | npm 各目录性质、`_npx` 是大头、废纸篓不可用时的合规删除 |
| `references/python-env.md` | 扫描三陷阱、真 venv 判定、必须保留清单、自动重建的坑 |
| `references/git-secret-scrub.md` | 凭据清单、`.env*` 变体、filter-repo 顺序、钥匙串卡死 |
| `references/project-dir-deletion.md` | 风险分级、清单存档、软链接解链、空间去哪了 |
| `references/webapp-verify.md` | 无头 Chrome、playwright、登录态、诊断纪律 |
| `references/docs-merge.md` | 关系判定、需求/设计文档骨架、写作纪律 |
