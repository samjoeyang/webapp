# 垃圾分类目录与跨版本路径说明

本文件供 `scan.py` 与 `clean.py` 配合使用，列出每个清理类目的含义、扫描路径、
严重级别与 macOS 版本差异。CleanMyMac 覆盖的主要类目均已包含。

## 严重级别（severity）
- `safe`：可放心清理，App 下次运行会重建，几乎无副作用。
- `caution`：清理安全，但删除后不可自动恢复（如 iOS 备份、Xcode 派生数据、大文件），需用户确认。
- `system`：系统级目录，清理需 `sudo`，且默认移入系统回收站（`.Trashes`），不自动永久删除。

## 扫描范围（scope）
- `user`：用户级，移入 `~/.Trash` 即可恢复。
- `system`：系统级，需 `--system --sudo`，移入 `/.Trashes/<uid>`。

---

## 类目清单

| id | 名称 | 级别 | 范围 | 说明 |
|----|------|------|------|------|
| user_cache | 用户缓存 | safe | user | `~/Library/Caches` 各 App 缓存 |
| system_cache | 系统缓存 | system | system | `/Library/Caches`（Catalina+ 另含 `/System/Volumes/Data/Library/Caches`）；`/System/Library/Caches` 只读不可动 |
| user_logs | 用户日志 | safe | user | `~/Library/Logs` |
| system_logs | 系统日志 | system | system | `/Library/Logs`、`/var/log` |
| trash | 废纸篓 | safe | user | `~/.Trash` 已删除文件 |
| broken_downloads | 不完整下载 | safe | user | `~/Downloads` 下的 `.download/.part/.crdownload/.partial/.opdownload/.tmp` |
| dmg_installers | 安装镜像/安装包 | safe | user | `~/Downloads` 下 `.dmg/.iso/.pkg/.dmgpart/Install macOS*.app` |
| mail_junk | 邮件垃圾 | caution | user | 见下「Mail 版本目录」 |
| xcode_junk | Xcode/开发者垃圾 | caution | user | DerivedData / Archives / iOS DeviceSupport / 模拟器缓存 |
| ios_backups | iOS 备份 | caution | user | `~/Library/Application Support/MobileSync/Backup` |
| containers_cache | 容器缓存 | safe | user | `~/Library/Containers`、`~/Library/Group Containers` 内各 App 的 `Caches` |
| browser_cache | 浏览器缓存 | safe | user | Safari / Chrome / Firefox / Edge |
| saved_state | 应用残留状态 | safe | user | `~/Library/Saved Application State` |
| quicklook_cache | Quick Look 缓存 | safe | user | `com.apple.QuickLook.thumbnails` |
| docker_junk | Docker 垃圾 | caution | user | Docker VM 磁盘镜像（`Docker.raw` 稀疏文件）与 `~/.docker` 缓存。⚠️ 体积与后两个 Docker 类目**重叠**，不要相加 |
| homebrew_cache | Homebrew 缓存 | safe | user | `~/Library/Caches/Homebrew` 及 `/opt` 或 `/usr/local` 下 homebrew 缓存 |
| font_cache | 字体缓存 | safe | user | `com.apple.fonts` 缓存 |
| rosetta_cache | Rosetta 2 缓存 | system | system | 仅 Apple Silicon + macOS 11+：`/Library/Apple/usr/libexec/oah`、`/var/db/oah` |
| large_old_files | 大文件/旧文件 | caution | user | 用户目录下超过阈值且久未修改的文件（阈值可调） |
| npm_junk | npm 环境垃圾 | caution | user | `~/.npm`（`_npx`/`_cacache`/`_prebuilds`/`_logs`）、`~/.node-gyp`、`~/.cache/yarn`、`~/.cache/pnpm`、`~/.pnpm-store`、`~/Library/Caches/Yarn` + Electron 缓存（`~/.electron`、`~/.cache` 与 `~/Library/Caches` 下的 `electron`/`electron-builder`）+ 开发目录下 `node_modules`（深度≤2）。不含 `~/Library/pnpm/global`、`~/.yarn/lib`。**逐目录确认** |
| python_junk | Python 环境垃圾 | caution | user | `~/.cache/pip`、`~/Library/Caches/pip`、`~/.cache/uv`、`~/.virtualenvs`、`~/.pyenv/cache`、conda `<base>/envs/*`、pyenv `versions/*/envs/*`，及开发目录下 `.venv/venv/env/virtualenv`（深度≤2）。不含托管解释器。**逐目录确认** |
| docker_build_cache | Docker 构建缓存 | caution | user | BuildKit 构建缓存（`docker system df` 的 Build Cache 行）。命令式：`docker builder prune -af`。**逐项确认** |
| docker_unused_images | Docker 未使用镜像 | caution | user | 无任何容器（含已停止）引用的镜像，按镜像 ID 归并。命令式：`docker image rm <id>`。**逐项确认** |
| tm_local_snapshots | Time Machine 本地快照 | caution | user | `tmutil listlocalsnapshots`。写操作需 sudo + 完全磁盘访问权限，**只输出命令、永不代跑**。**逐项确认** |
| tmp_user | 临时文件（用户） | safe | user | `$TMPDIR` 下**超过 7 天未修改**的顶层项。近期改动一律跳过（可能被运行中进程占用）。`--tmp-days` 可调 |
| tmp_system | 临时文件（系统） | system | system | `/private/tmp` 下超过 7 天未修改的顶层项。需 sudo |
| system_diagnostics | 系统诊断数据 | system | system | `/private/var/db/{diagnostics,PowerLog,DiagnosticPipeline}`，系统按需重建 |
| sleepimage | 休眠镜像 | caution | system | `/private/var/vm/sleepimage`，大小≈物理内存；系统在下次休眠时重建 |
| rust_cache | Rust 缓存 | safe | user | `~/.cargo/{registry,git}`、`~/.rustup/{downloads,tmp}`。**不含 `~/.rustup/toolchains`**（工具链本体） |
| rust_junk | Rust 构建产物（target/） | caution | user | 开发目录下各 cargo 项目的 `target/`（深度≤2，可 `cargo build` 重建）。不含 `~/.cargo` 依赖缓存（见 rust_cache）。**逐目录确认** |
| cpp_junk | C/C++ 环境垃圾 | caution | user | 编译/包缓存：`~/.ccache`、`~/Library/Caches/ccache`、`~/.cache/{ccache,sccache,vcpkg}`、Conan `~/.conan/data`（v1）/`~/.conan2/p`（v2，均不含 profiles 等用户配置）；构建产物：开发目录下 `build/builddir/build-debug/build-release/cmake-build-*/out/obj/bin/CMakeFiles`（深度≤2，重新编译可恢复；bin/out 可能含交付产物）。位于 venv/node_modules/vendor/target 等**环境目录内部**的同名子目录自动跳过（如 venv 的 `bin/` 不是构建产物）。**逐目录确认** |
| php_junk | PHP 环境垃圾 | caution | user | Composer 下载缓存 `~/.composer/cache`、`~/.cache/composer`、`~/Library/Caches/composer` + 开发目录下 `vendor/`（深度≤2，`composer install` 可重建）。不含 PHP 本体与全局 bin。**逐目录确认** |
| ai_model_cache | AI 模型缓存 | caution | user | HuggingFace / PyTorch / Ollama / LM Studio 模型权重。**逐项确认**（重新下载成本高） |
| xdg_cache | 通用 XDG 缓存 | safe | user | `~/.cache` 下未被专用类目占用的子项（排除 pip/uv/huggingface/torch/yarn/pnpm/lm-studio/electron/electron-builder/ccache/sccache/vcpkg/composer） |
| ruby_gem_cache | Ruby gem 缓存 | safe | user | `~/.gem/{cache,specs}`、`~/.bundle/cache`。不含已安装 gem 本体 |
| misc_pkg_cache | 其他包管理器缓存 | safe | user | Maven `~/.m2/repository`、Gradle `~/.gradle/caches`、NuGet、SwiftPM、Ivy（Composer 缓存已归属 php_junk） |
| docker_stopped_containers | Docker 已停止容器 | safe | user | 命令式：`docker container prune -f`。不动运行中容器、镜像与数据卷。**逐项确认** |
| external_trashes | 外接卷废纸篓 | caution | system | `/Volumes/*/.Trashes/<uid>`。清空后该盘上这些文件不可恢复 |
| simulator_devices | iOS 模拟器 | caution | user | `~/Library/Developer/CoreSimulator/Devices` 各设备镜像。**逐项确认**（删后需重新下载运行时） |
| app_support_caches | 应用支持目录缓存 | safe | user | `~/Library/Application Support/*/Caches`（不走标准 `~/Library/Caches` 的 App） |

---

## macOS 版本差异要点（scan.py 已自动处理）

### 1. Mail 版本目录（`~/Library/Mail/Vx`）
Mail 的数据目录随 macOS 大版本改变 `V` 编号，清理邮件索引/附件时必须对应当前版本：

| macOS 版本 | Mail 目录 |
|-----------|-----------|
| 10.7–10.9 (Lion–Mavericks) | V2 |
| 10.10 Yosemite | V3 |
| 10.11 El Capitan | V4 |
| 10.12 Sierra | V5 |
| 10.13 High Sierra | V6 |
| 10.14 Mojave | V7 |
| 10.15 Catalina | V8 |
| 11 Big Sur | V9 |
| 12 Monterey 及以后 | V10 |

`scan.py` 依据 `sw_vers` 探测到的版本自动选择 `Vx`，并清理 `Envelope Index*` 与 `Attachments`、以及 `~/Library/Mail Downloads`。

### 2. 系统卷语义（Catalina 10.15+）
- Catalina 起系统盘拆分为**只读密封系统卷** + 数据卷。因此：
  - `/System/Library/Caches` 在密封卷上，**只读、不可清理**，scan 跳过。
  - 可写系统缓存位于 `/Library/Caches`（数据卷）与 `/System/Volumes/Data/Library/Caches`。
- `scan.py` 在 `sealed_system=True` 时自动追加 Data 卷路径，且不会尝试写入系统卷。

### 3. Apple Silicon 与 Rosetta 2（macOS 11+）
- 仅在 Apple Silicon 机器上扫描 `rosetta_cache`（Intel 转译缓存）。
- Homebrew 路径在 Apple Silicon 为 `/opt/homebrew`，Intel 为 `/usr/local`，脚本按芯片自动选。

### 4. 容器缓存路径
- App Store / 沙盒 App 的真实数据在 `~/Library/Containers/<id>/Data/...`，缓存位于 `Data/Library/Caches`。
- `Group Containers` 则直接在 `<group_id>/Library/Caches`。脚本分别处理。

### 5. 大文件/旧文件
- 扫描 `Downloads/Desktop/Documents/Movies/Music/Pictures` 及家目录顶层，跳过 `.git`、`node_modules`、`Caches`、`Mail`、`Library` 等重目录，避免误报与极慢遍历。
- 阈值：`--large-gb`（默认 1GB）、`--old-days`（默认 90 天），结果按体积降序，最多 500 条。

### 6. npm / Python / Rust / C++ / PHP 环境类目（逐目录确认）
- `npm_junk`/`python_junk`/`rust_junk`/`cpp_junk`/`php_junk` 标记 `per_item_confirm=True`：
  **每个目录删除前都必须单独确认**，不能整类目一键删除。
- 开发目录基准（五类共用）：`Projects/projects/code/dev/Developer/work/workspace/Documents/Desktop/Downloads`
  （不存在则跳过），过程产物仅在深度 ≤2 内查找，避免极深遍历。
- 过程产物对照：npm→`node_modules`；Python→`.venv/venv/env/virtualenv`；Rust→`target/`；
  C++→`build/builddir/cmake-build-*/out/obj/bin/CMakeFiles`；PHP→`vendor/`。均可由包管理器/构建系统重建，但仍可能含本地改动，必须让用户逐个确认。
- **环境目录防护**：位于 `.venv/venv/env/virtualenv/node_modules/vendor/target/site-packages/__pycache__/.git`
  内部的同名子目录一律跳过——venv 的 `bin/`、node_modules 里的 `out/` 不是构建产物，删了会破坏环境本体。
- 缓存部分（无重建成本或重建即可）：npm/Python/Rust/C++/PHP 的各类下载与编译缓存也在对应类目内整体列出。
- 清理端：未提供 `--approved`（确认路径清单）且非交互时，脚本**拒绝删除**此类目、仅记日志；智能体应把用户确认过的路径写入 JSON 清单再传入 `--approved`。

### 7. 命令式资源（Docker / Time Machine）
这三类**不是普通文件**，scan 只做只读探测，clean 按 `item.kind` 分流：

| kind | 含义 | clean.py 行为 |
|---|---|---|
| `file`（默认） | 普通文件/目录 | 移入回收站（`--purge` 才永久删除） |
| `command` | manifest 里带 `cmd` 的 Docker 资源 | 执行 `docker <cmd>`，**永久生效、不经回收站**，需 `--approved` |
| `manual` | 带 `manual` 命令字符串、需提权 | **永不执行**，只把命令打印给用户，日志记 `manual` |

- `docker_junk`（VM 镜像）与 `docker_build_cache` / `docker_unused_images` / `docker_stopped_containers`
  的**体积互相重叠**（后三者就装在 `Docker.raw` 里），报告时不能相加。正确顺序：先用
  `docker_build_cache` → `docker_unused_images` → `docker_stopped_containers` 回收内部资源，
  `Docker.raw` 才会随之收缩（且宿主机空间要等它压实才回来）。
- 判断「未使用镜像」用「有没有容器引用它」（含已停止容器），不是看 dangling。
- TM 快照体积无法精确计量（与系统共享数据块），manifest 里 `bytes=0`；
  `manifest.time_machine` 另给 `auto_backup` / `snapshot_count` / `data_volume` 三字段。
- `--no-docker` 可跳过 Docker 探测（未启动 Docker 时更快）。

### 8. 临时文件：唯一按「时间」而非「路径」判定安全的类目
- `tmp_user` / `tmp_system` 只收**最后修改时间超过 7 天**的顶层项（`--tmp-days` 可调）。
- 近期改动的项**一律跳过**——临时目录里的新文件很可能正被运行中的进程占用，删了会导致程序异常。
  这是临时目录清理唯一可靠的安全边界，不要为了多清几百 MB 去调低阈值。
- 实测参考：`$TMPDIR` 常有数百个子项，但 7 天内的通常占 90%+，最终可清的多是几年前的僵尸目录。
- 清理仍走回收站（`tmp_user` → `~/.Trash`；`tmp_system` → `/.Trashes/<uid>`），不直接 `rm`。

### 9. AI 模型缓存与模拟器：体积大但重建代价高
- `ai_model_cache` / `simulator_devices` 标 `per_item_confirm=True`。
- 模型权重动辄数 GB～数十 GB，重下要流量和时间；模拟器删后需在 Xcode 重新下载运行时。
  **不要因为「体积大」就建议优先清** —— 对开发机而言这两类往往是刚需而非垃圾。

### 10. 保留与剔除
- `ALWAYS_PROTECTED`（写死在 scan.py）：`~/.workbuddy/binaries/python`、`~/.local/share/uv/python`、
  `~/.rustup/toolchains`、`~/.gradle/wrapper`
  ——工具链本体，永不进扫描结果。
- `--keep <前缀>`（可多次给）：用户点名保留的目录，命中即剔除。本机示例：
  `--keep ~/workspace/.venv --keep ~/workspace/unokb-weknora`。

---

## 聚合粒度
- `dir_top`：把根目录的**直接子项**各作为一条明细（如每个 App 的缓存文件夹），清单可读、体积可控。
- `dir_whole`：整个根目录作为一条明细（如废纸篓、Rosetta 缓存）。
- `globs`：按文件名模式匹配（如下载残留、安装包）。
- 自定义收集器：Mail、容器、浏览器。
