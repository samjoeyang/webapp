# CleanMyMac 官方 DMG 二进制分析（5.7.4）

> 分析日期：2026-11-25。对象：MacPaw 官方下载直链 `https://download.macpaw.com/BasicPlus/CleanMyMac.dmg`。
> 文件：211 MiB，SHA-256 `72160ec03c6110e642e388867f69d2907374550039ab1f86f38c27a5cce67a77`，HTTP `Last-Modified: 2026-11-06`。
> 方式：`hdiutil attach -readonly -nobrowse` 只读挂载，**未安装、未运行**。用 `Info.plist` / `codesign` / `strings` / `nm` / `swift-demangle` / `plutil` 读取，不反编译源码。
>
> **重要纠偏**：官网下载页文案仍写 5.5.7（2026-07-22），但 DMG 内 `CFBundleShortVersionString=5.7.4`，
> `CFBundleVersion=50704.0.2611060828`，SDK `macOS 26.5`，最低系统 11.0。本文件以 5.7.4 为准。

## 1. 包结构：不是「一个 App」，而是一组模块

- 主程序：`Contents/MacOS/CleanMyMac_5`
- 内嵌框架：**135 个** `.framework`，可执行 Mach-O 共 361 个。
- 登录项：`Library/LoginItems/CleanMyMac_5_Menu.app`（`LSUIElement=1`）、`CleanMyMac_5_HealthMonitor.app`（`LSUIElement=1`，额外有 `NSLocationWhenInUseUsageDescription`）。
- 更新器：`MacOS/CleanMyMac_5_Updater.app`（Sparkle + `SUPublicEDKey`，`SUEnableAutomaticChecks=0`）。
- 扩展：`AppIntentsExtension.appex`、`FinderSyncExtension.appex`；XPC：`MASUpdaterXPCService.xpc`、蓝牙设备 XPC。
- 特权助手：`Library/LaunchServices/com.macpaw.CleanMyMac5.Agent`（独立 5.3.2，x86_64+arm64）。

框架命名本身就是架构图：

| 层 | 代表 framework | 说明 |
|---|---|---|
| 模块 UI | `MainAppUI` / `JunkCleanupModule` / `PerformanceModule` / `ProtectionModule` / `ApplicationsModule` / `OrganizeModule` / `SpaceLensModule` / `CloudStorageModule` / `EmailCleanupModule` / `SmartCareModule` / `ToolboxModule` | 每个功能模块一个 UI + Domain 对 |
| 扫描 | `SystemJunkScanning` / `MailJunkScanning` / `TrashJunkScanning` / `DownloadsScanning` / `UninstallerScanning` / `MalwareScanning` / `AIToolScanning` / `LocalModelScanning` / `PrivacyScanning` / `SpaceLensScanning` | 扫描器与 UI 分离，统一走 `ScanningCore` |
| 执行 | `CleaningCore` / `FileManagerService` / `PerformanceService` / `PrivilegedOperationsPerformerService` / `PrivilegedRoutines` | `MoveToTrashFileRemover` / `PrivilegedFileRemover` 两条路径 |
| 规则/数据 | `KnowledgeBaseService` / `DatabaseKit` / `FMDB`（静态含 SQLCipher 符号） / `PANMalwareDatabase` | 规则库与恶意软件库独立；未见独立 `SQLCipher.framework` / `GRDB.framework` |
| 网络/账号 | `GmailService` / `GoogleAppAuthService` / `DropboxService` / `MicrosoftService` / `MacPawAccount` / `NetworkService` | OAuth 与云盘分服务 |

## 2. Safety Database 的真实形态

- 规则库文件：`Contents/Resources/info.cmmkb`（292 KB）与 `userInfo.cmmkb`（2 KB），在 Menu / HealthMonitor 内各有一份副本。
- 文件头是随机字节（`9042 dbbd b5f2 324d...`），`file` 判为 `data`，`strings` 无明文；复制到临时文件后 `sqlite3 .tables` 报 `file is not a database`。
- `KnowledgeBaseService` 字符串：`KnowledgeBaseCipherCompatibility`、`PRAGMA cipher_default_compatibility = 3`；
  `FMDB.framework` 内静态含 `kdf_iter` / `cipher_migrate` / `sqlcipher_export` 等 SQLCipher 符号 → **SQLCipher 3 兼容模式的加密 SQLite**，不是明文 JSON。
- ⚠️ 135 个 framework 中只找到 `FMDB.framework` / `DatabaseKit.framework` / `KnowledgeBaseService.framework`，**没有独立** `SQLCipher.framework` / `GRDB.framework`；
  SQLCipher 是静态链进 FMDB，不是单独的动态框架（此前表述已修正）。
- `KnowledgeBaseService` 字符串里能看到规则表/键名：`systemCaches`、`systemLogs`、`userCaches`、`userLogs`、`xcodeCaches`、
  `appLanguages`、`fileVersions`、`iOSBackups`、`iOSSoftwareUpdates`、`mailAttachments`、`mailTrashes`、`photosCaches`、`photosTrashes`、
  `leftoversApps`、`privilegedHelperTools`、`aiJunkFiles`、`aiLocalModels`、`derivedData`、`universalBinaries`、`unsupportedApps`。
  注意：这些键名来自 framework 二进制字符串，**不是从解密后的库里读出的记录**。
- 密钥来源线索（主二进制 `MacOS/CleanMyMac_5`）：`FMEncryptedDatabase`、`KeychainStorage`、
  `decryptionPasswordForUpdater:`、`Failed get encryption key or it's empty`、`KnowledgeBaseUpdater`、`KnowledgeBase/info.cmmkb`。
  → 密钥由运行时配置 / Keychain / updater 传入，规则库可在线更新；静态 DMG 里没有现成明文 key。
- 忽略清单有独立通知：`userIgnoreListUpdatedNotificationName`、`CustomIgnoreItemsSnapshotsStorage`；与官网「每类目 Ignore List + Other」一致。
- 结论：官方的「安全」来自**可更新的规则库 + 每类目忽略表**，不是靠路径硬编码。本 skill 没有规则库更新通道，只能靠显式路径白名单 + 逐项确认补偿。

### 2.1 能否解密（2026-11-25 复核）

- **技术上可以**：SQLCipher 是标准格式，只要拿到正确 key/passphrase 即可离线打开。
- 参数依据（SQLCipher 官方 API 文档 <https://www.zetetic.net/sqlcipher/sqlcipher-api/>）：对已有 3.x 兼容库，在 `PRAGMA key` **之前**执行 `PRAGMA cipher_compatibility = 3;`；
  3.x 默认 `kdf_iter=64000`、`PBKDF2_HMAC_SHA1`、`HMAC_SHA1`、`cipher_page_size=1024`。
  `PRAGMA key` 通常应是数据库上第一个操作；raw key 语法 `PRAGMA key = "x'<64 hex>'";`（32 字节，带 salt 用 96 hex）。
  错误 key 不会立刻报错，用 `SELECT count(*) FROM sqlite_master;` 验证。
- **本次没有解密**：DMG 静态文件里没有明文 key；主二进制显示密钥走 Keychain / `decryptionPasswordForUpdater:`。`hdiutil` 只读挂载、未运行 App、未读取 Keychain。
- 边界：仅限自己合法持有 / 自己设备上的数据分析；不提取、不分发密钥或解密后的商业规则库，不用于绕过许可。
- 落地（2026-11-25）：本 skill 已把全部类目 / 路径 / 阈值外置为明文 `rules/*.json`（见 `rules-library.md`），
  代码只留解释算法；默认规则带 SHA-256 校验，用户可用 `--rules-dir` 覆盖。借鉴的是架构，不是加密形式。

## 3. 具体扫描实现（从字符串/符号还原）

### 3.1 AI Clutter（本轮已借鉴）

`AIToolScanning.framework` 明确列出这些路径（节选）：

- Claude：`~/.claude/mcp-needs-auth-cache.json`、`plugins/install-counts-cache.json`、`shell-snapshots`、`stats-cache.json`、`telemetry`、`~/Library/Logs/Claude`
- Codex：`~/.codex/cache/codex_apps_server_info`、`codex_apps_tools`
- Gemini/Antigravity：`~/.gemini/antigravity-browser-profile/...` 下 `Cache` / `Code Cache` / `DawnGraphiteCache` / `DawnWebGPUCache` / `GPUCache` / `Service Worker/CacheStorage` 等
- Chrome DevTools MCP：`~/.cache/chrome-devtools-mcp/chrome-profile/...` 同类浏览器缓存
- 另扫 `com.anthropic.claudefordesktop`、`com.openai.codex`、`com.google.antigravity` 等容器

`LocalModelScanning.framework` 只有少量路径词：`ollama`、`models`、`models/manifests`、`lmStudio`。
`JunkCleanupModule` 还有 `aiClutterKindStaleVersions`（陈旧版本）与 `AIClutterOldestSelectionControlNodeType`。

→ 本 skill 已新增 `ai_tool_junk` 类目，但**刻意不收** `~/.local/share/claude/versions`、`.local/bin/claude`、`.local/share/cursor-agent` 与任何 `settings.json`/`backups`/`skills` 本体：
那些是工具链/配置，不是垃圾。官方会提示陈旧版本，CLI 无法可靠判定，不照搬。

### 3.2 系统垃圾与 Xcode

`SystemJunkScanning` 的字符串显示扫描/ thinning 类型：`UniversalBinaryThinnerType`、`BrokenPreferencesRemoverType`、
`BrokenStartupItemRemoverType`、`XcodeSimulatorRemoverType`、`MobileBackupsKnowledgeBaseType`、
`ApplicationLanguagesKnowledgeBase`、`FileVersionRemover`，并出现 `simctl`、`xcode-select -p`、
`coresymbolicationdCaches`、`llvmModuleCache`/`llvmUserModuleCache`、`gradleCaches`、
`iOSDeviceSupport`/`tvOSDeviceSupport`/`watchOSDeviceSupport`、`xcodeDocumentationCache`、
`unifiedLog`、`aslLogs`、`diagnosticsLogs`、`quarantineLog`、`media_cache`、`prefetch_cache`。

→ 已覆盖 DerivedData / Archives / DeviceSupport / 模拟器；`UniversalBinaryThinner` 需要改签 App 包，**不照搬**。

### 3.3 Mail

`MailboxService.framework` 出现 `PersistenceInfo.plist` 与 `LastUsedVersionDirectoryName`，还有
`Didn't find last used version directory name for mail library URL`、`~/Library/Mail/%@/`、`Mail Downloads`、
对 Mail DB 的 SQL（attachments / subjects / messages）。
→ 本 skill 已改为优先读 `LastUsedVersionDirectoryName`，不再只靠 macOS 版本推 V10。

`TrashJunkScanning` 还识别 `com.apple.fileprovider.trash`、`iCloudTrashes`、`_mobileDocumentsTrashes`、外接卷 `.Trashes`。
→ 本 skill 有 `external_trashes`，但不碰 iCloud 邮件废纸篓，边界更保守。

### 3.4 重复文件 / 相似图片

`OrganizeModule` 反符号化后可见：

- `DuplicatesScanning.RegularFileHashCalculator.calculateHash(at:) -> Result<FileHash, Error>`
- `DuplicatesScanning.DuplicateAutoselectorType`、`DuplicatesGroupCollector(nodeBucketItemCalculator:autoselector:contentKindEvaluator:)`
- `SimilarImagesScanning.SimilarImageModel.isBestInGroup`
- 选择策略：`Smartly` / `Oldest` / `Newest` / `Largest` / `Smallest`（`*SelectionControlOption`）
- 过滤规则：`FileNameRegularExpressionIgnoreRule`、`FilePathPrefixIgnoreRule`、`AcceptedContentKindIgnoreRule`

→ 本 skill 的 `clutter_scan.py` 已用「大小分桶 + SHA-256」与 dHash 分组，并本轮把建议保留改为**画质（像素数）→ 体积 → 时间**，
对应官方 `isBestInGroup` 的保守近似；仍保留逐项确认，不自动删除。

### 3.5 恶意软件（Moonlock / PAN）

- `PANMalwareDatabase.framework` + `MalwareRulesRoutines`：初始化日志 `Signatures database was initialized successfully. Version: `，
  网络路径片段 `/engine/v3/database`，带 `DatabasePasswordProvider`、`SecuredStorage`、`networkQueue`/`storageQueue`。
- 规则类型（`*RuleDataObject`）：YARA、Path、Hash+Size、LaunchAgent、Chrome Extension、Safari Extension、
  Safari Homepage、Configuration Profile、Team Identifier（含 `IgnoreTeamIdentifierRuleDataObject`）。
- `YaraObjective.framework` 内嵌 `libyara.9.dylib`、`libcrypto.1.1.dylib`。
- `PANContainerUnpacker` / `ArchiveUtility(Container)` 负责解包；`MountedVolumesURLsSource` 追踪外接卷；
  `PANPrivilegedAccess*` 负责提权下的文件/进程/plist/profile 操作。
- `MalwareScanTask.backgroundExecution`、`MalwareBackgroundProgressBudget` 说明有后台扫描与进度预算。

→ 本 skill 明确不做恶意软件扫描；这是专业引擎 + 在线规则库 + 特权助手的组合，不是清理脚本能等价替代的。

### 3.6 权限与特权助手

- 主 App entitlements：App Group（含 `CleanMyMac4` 兼容组）、Photos Library、APS、 associated domain `webcredentials:my.macpaw.com`、
  keychain groups 含 `moonlock-site` / `moonlock.interoperability`。
- UsageDescription 覆盖 Desktop/Documents/Downloads/Photos/Contacts/Calendars/Reminders/Apple Music/Bluetooth。
- `SMPrivilegedExecutables` 指向 `com.macpaw.CleanMyMac5.Agent`，助手 `SMAuthorizedClients` 只允许同团队三个 App。
- 助手内字符串：`/Library/PrivilegedHelperTools/`、`/Library/LaunchDaemons/`、`/usr/bin/dscacheutil`、`/usr/bin/killall`、`/usr/sbin/periodic`；
  并有 **"Symlink escape blocked: … resolved to … which is outside allowed roots"** —— 明确的符号链接逃逸防护。
- 所有相关二进制：`Developer ID Application: MacPaw Way Ltd (S8EX82NJP6)` 签名，runtime hardened。

→ 这是 Developer ID + SMJobBless 路线。本项目是 ad-hoc 签名 + 手动放行，**不能照搬**；权限设计上本 skill 仍用「sudo 命令只输出、不代跑」。
可在自己的实现里借鉴的是「符号链接逃逸检查」和「按客户端白名单限制 XPC 调用者」的思想，而不是 SMJobBless 本身。

### 3.7 网络 / OAuth / Email Cleanup

- Gmail：端点 `gmail.googleapis.com/gmail/v1/users/me`（messages / drafts / history / profile / batchModify），
  scope 仅 `gmail.modify` + `userinfo.email`。本地缓存用 keychain 随机密钥 + SQLCipher（日志提到 `0700` 目录权限、无 key 时退回内存缓存）。
- Google Drive：OAuth 端点 `accounts.google.com/o/oauth2/v2/auth`，scope 列表里实际使用 `drive.file` / `drive.metadata` 一类，不是全盘 `drive`。
- OneDrive：`graph.microsoft.com/v1.0` + MSAL；Dropbox：`api.dropbox.com` + SwiftyDropbox。
- Email Cleanup：`gmail/v1/users/me/messages/batchModify`、`gmail rate limited`、`Gmail throttling dropped`、`unsubscribe endpoints … from the cache`，
  说明有批量修改、限流退避、退订端点缓存。
- 激活/统计：`activation.macpaw.com/api/v2/public/activation*`、`my.macpaw.com`、Sentry `o36975.ingest.sentry.io`。

→ 这些都需要 OAuth 令牌与远程删除，超出本地清理 skill 的信任边界；只记录，不自动化。

### 3.8 其他值得注意的实现

- `ScreenCleaningMode`：全屏遮罩 + `InputSuppressing`，**退出键是 Cmd+Esc**；日志含 "Could not install the input monitor, refusing to suppress"——
  输入监控失败就拒绝黑屏，避免把用户困住。这是很好的安全设计，但 CLI 无对应场景。
- `HealthMonitoringCore`：`PeriodicMonitor` / `MeasuredMonitor`，配合 HealthMonitor 登录项与蓝牙 XPC。
- `SpaceLensScanning`：`SpaceLensEntityTree` / `DeletionPlanner` / `VolumeChecker`，并检查 `/System/Volumes/Data/`、外接卷与可清除空间。
- `BrowserCareExtensionService`：读 `Library/Application Support/Google/Chrome` 的 Chrome prefs；需要后台项授权。

## 4. 本轮据此对 skill 做的修改

| 发现 | 落地 |
|---|---|
| 官方按 `LastUsedVersionDirectoryName` 定位 Mail 目录 | `scan.py` 改为优先读 `Mail/PersistenceInfo.plist`，失败再退化到目录扫描 / 版本映射 |
| AI Clutter 有明确缓存路径清单 | 新增 `ai_tool_junk` 类目（只缓存/日志/遥测），`xdg_cache` 排除 `chrome-devtools-mcp` 避免双算 |
| 重复文件有 `DuplicateAutoselector` / `isBestInGroup` / Smartly | `clutter_scan.py` 建议保留改为画质（像素）→ 体积 → 时间 |
| `--categories` 过滤漏掉 large_old_files | 顺手修复：显式指定类目时不再强行追加 |
| 官网版本文案滞后 | 基准文档改为以 DMG 实测 5.7.4 为准 |

## 5. 明确不借鉴

- 加密规则库的自动更新通道：本 skill 无服务端，也不应偷偷下载规则执行；继续用显式路径 + 确认闸门。
- 提取 / 分发 CleanMyMac 的规则库密钥或解密后的商业规则库；仅限自己合法持有数据的分析边界。
- `UniversalBinaryThinner`：修改 App 包内二进制会破坏签名，风险远大于收益。
- 特权助手 / SMJobBless：见 3.6。
- Malware / YARA / 在线签名库、OAuth 云盘与邮件、常驻 HealthMonitor、Screen Cleaning Mode。
- CleanMyMac 的永久删除策略；本 skill 一律回收站 + 逐项确认。
