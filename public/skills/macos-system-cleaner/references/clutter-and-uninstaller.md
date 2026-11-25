# 重复文件、相似图片与应用残留（只读盘点）

配套脚本：`scripts/clutter_scan.py`（只读）、`scripts/clean.py`（执行）。
对标 CleanMyMac 的 My Clutter / Uninstaller / Leftovers，但**不照搬其永久删除策略**。

## 0. 三条硬边界

1. 默认扫描根目录只有 `~/Downloads`、`~/Desktop`、`~/Documents`、`~/Pictures`、`~/Movies`；
   要扫别的目录必须显式传 `--roots`，且仍需逐项确认。
2. 跳过 `.photoslibrary` / `.app` / `.framework` / `.xcodeproj` 包内部。
   **不要删 Photos 库包内文件**——那会破坏照片库；CleanMyMac 是把 Photos 资产移到“最近删除”，CLI 做不到等价安全。
3. 本 skill 的清理默认移入回收站；CleanMyMac 的 Duplicates / Similar Images 是**永久删除并绕过废纸篓**，
   这个行为不引入。

## 1. 扫描重复文件与相似图片

```bash
python3 <skill>/scripts/clutter_scan.py \
  --out <工作目录>/macos_clutter_manifest.json \
  --min-kb 100              # 与 CleanMyMac 一致：小于 100KB 不显示
```

常用开关：

| 参数 | 用途 |
|---|---|
| `--roots A,B` | 指定扫描根目录，逗号分隔 |
| `--min-kb` | 最小体积，默认 100 |
| `--no-similar` | 只查完全重复文件，跳过 dHash 比对 |
| `--similar-threshold` | dHash 汉明距离阈值，默认 6/64；调小更严格 |
| `--max-images` | 相似图片最多比较张数，默认 2000 |
| `--max-hash-mb` | 超过此体积不做哈希，默认 4096 |
| `--ignore-file` | 与 `scan.py` 共用的持久化忽略清单 |

实现要点：

- 重复文件：**先按文件大小分桶，再对同尺寸文件算 SHA-256**，避免全盘逐字节比对。
- 相似图片：用系统 `sips` 生成缩略图，纯标准库解码 PNG，计算 9x8 差分哈希（dHash），
  汉明距离 ≤ 阈值的用并查集并成组。不依赖 Pillow。
- 每组输出 `suggested_keep`（体积最大 → 修改时间最新 → 路径最短）与 `suggested_remove`；
  但 **`items` 只含 `suggested_remove`，由用户逐项确认**，不会自动全选。
- 完全重复的文件不重复计入相似图片组，避免体积双算。

## 2. 复核顺序（别跳）

1. 先看 `groups[].suggested_keep` 是否合理。规则只是启发式；用户可能更想保留旧版本或另一路径的副本。
2. 展开 `groups[].files`，核对路径、体积、修改时间；必要时用 `qlmanage` 或 Finder Quick Look 预览。
3. 对不认识的项：本 skill 没有 CleanMyMac 的 Smart Insights（需 macOS 26 + Apple Intelligence），
   改用 `mdls <path>` 看 Spotlight 元数据，或直接在 Finder 里看。
4. 把**确认要删**的路径写进 approved 清单；不要把 `suggested_keep` 写进去。

```bash
cat > <工作目录>/clutter-approved.json <<'JSON'
[
  "/Users/me/Downloads/report (1).pdf",
  "/Users/me/Pictures/IMG_0124 copy.jpg"
]
JSON

# 预览
python3 <skill>/scripts/clean.py --manifest <工作目录>/macos_clutter_manifest.json \
  --categories duplicates,similar_images

# 执行（逐项确认闸门）
python3 <skill>/scripts/clean.py --manifest <工作目录>/macos_clutter_manifest.json \
  --categories duplicates,similar_images --apply \
  --approved <工作目录>/clutter-approved.json
```

`per_item_confirm=true`：未提供 `--approved` 且非交互时脚本拒绝删除。这是设计，不要绕过。

## 3. 加入忽略清单

某组重复文件确实都要保留时，把路径或目录前缀写进 `ignore.json`，下次扫描就不会再出现。
格式与用法见 `references/ignore-lists.md`。CleanMyMac 支持对「相似图片组」整体加忽略，
本 skill 用 `patterns` 通配实现同等效果。

## 4. 应用残留：只盘点，不自动删

CleanMyMac 的 Uninstaller 依赖 Safety Database 定位 daemon、配置、插件与非标准路径。
CLI 没有等价规则库，**只做只读盘点，结果交用户判断**。

```bash
APP="Foo"

# 1) 安装包收据（判断“是否装过”）
pkgutil --pkgs | grep -i "$APP"

# 2) 常见残留位置
ls -ld "$HOME/Library/Application Support/"*"$APP"* 2>/dev/null
ls -ld "$HOME/Library/Caches/"*"$APP"* 2>/dev/null
ls -ld "$HOME/Library/Preferences/"*"$APP"* 2>/dev/null
ls -ld "$HOME/Library/LaunchAgents/"*"$APP"* 2>/dev/null
ls -ld "/Library/LaunchAgents/"*"$APP"* "/Library/LaunchDaemons/"*"$APP"* 2>/dev/null
ls -ld "/Library/Application Support/"*"$APP"* 2>/dev/null

# 3) 登录项（会触发 System Events 自动化授权；被拒就跳过，不要反复试）
osascript -e 'tell application "System Events" to get name of every login item'
```

判定原则：

- **收据仍在**但 App 已不在 `/Applications`：可能是残留，也可能是仍被依赖的组件，先问用户。
- `LaunchAgents` / `LaunchDaemons` 里的 plist：先看 `ProgramArguments` 指向的二进制是否还存在；
  指向已删 App 才是“孤儿”，且删除前要确认没有任务依赖。
- `Application Support` 中可能有许可证、账号、本地数据库。**不能当垃圾清**；CleanMyMac 对此有例外规则，
  本 skill 没有，所以必须人工确认。
- 系统 App 与 Apple 自带组件默认忽略，不进入建议列表。
- 官方把「6 个月未打开」列为 Unused 分组；本 skill 只把 `atime`/`kMDItemLastUsedDate` 作为提示，
  不据此自动推荐卸载。

## 5. 明确不做

- 不自动卸载 App、不删 App 本体签名包、不改 `launchctl` 加载状态。
- 不做 Updater：应用更新涉及来源校验与版本决策，交给 App Store / Homebrew / 各应用自身。
- 不照搬 CleanMyMac 的「Suspicious apps（按开发者来源分组）」判据；那是厂商策略，不是安全事实。
- 不做 Cloud Cleanup / Email Cleanup 的自动删除：需要 OAuth 授权与远程数据删除，
  超出本地清理 skill 的信任边界。官方 Email Cleanup 的安全设计（最小权限、可随时断开、预览后操作、
  删除进 Gmail Trash 保留 30 天）值得借鉴，但应由用户自己在 Gmail 中完成。
