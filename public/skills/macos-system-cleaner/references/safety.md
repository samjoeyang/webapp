# 安全规则与禁止清单（macOS 系统清理）

本 skill 以「可恢复、不破坏系统、不误删用户数据」为第一原则。任何清理动作都必须遵守以下规则。

## 1. 默认只扫描、只预览
- `scan.py` 100% 只读：不修改、不删除、不写入任何源文件。
- `clean.py` 默认 `--dry-run`（仅打印计划），必须显式 `--apply` 才执行。
- 系统级（scope=system）类目默认不参与清理，需用户同时加 `--system --sudo`。

## 2. 优先移入回收站（可恢复）
- 用户级条目：默认移入 `~/.Trash`，可在 Finder 中恢复。
- 系统级条目：默认移入 `/.Trashes/<uid>`（系统废纸篓），Finder 中可恢复。
- 仅当用户显式加 `--purge` 才**永久删除**。永久删除不可恢复，必须再次向用户确认风险。

## 3. 绝不触碰的清单（硬禁止）
以下路径/文件永远不在清理范围，脚本也不应登记它们：
- 系统核心：`/System`（密封卷）、`/usr`、`/bin`、`/sbin`、`/etc`、`/var/db`（除已明确列出的 oah 缓存）、`/private/var/root`
- 用户核心数据：`~/Documents`、`~/Desktop`、`~/Pictures`、`~/Movies`、`~/Music`、`~/Downloads` 的**正常文件**（仅清理其中明确匹配的残留/安装包，绝不整目录删除）
- 邮件正文与账户：`~/Library/Mail` 下的 `Messages/`、`Mailboxes/`、`Accounts.plist` 等（只清理 `Envelope Index*`、`Attachments`、`Mail Downloads`）
- 钥匙串：`~/Library/Keychains/`
- 任何 `.app` 主程序包本身（只清理其缓存/派生数据，不删 App）
- 源码与版本库根：`node_modules/`、`*.git`、`*/src/` 等用户工程文件
- 任意用户文档（pdf/docx/xlsx/照片/视频等），除非用户明确选择「大文件/旧文件」类目且逐条确认

## 4. SIP 与权限
- macOS System Integrity Protection（SIP）保护 `/System`、`/usr` 等；即便 `sudo` 也无法修改受保护路径，脚本不应尝试。
- 系统级清理需要 `sudo`，脚本在 `--sudo` 下用 `sudo mv`/`sudo rm`，并写入日志。若用户无 sudo 权限，跳过并明确告知。

## 5. 可审计与可恢复
- 每次 `--apply` 都写入清理日志（`cleanup_log.json` + 控制台摘要），逐条记录：类目、原路径、体积、结果、目标（回收站路径或 deleted）。
- 日志可用于核实「到底删了什么」，以及从回收站恢复。

## 6. 大模型/智能体交互约定
- 智能体应先 `scan` → 展示各类目体积与条目数 → 用问答让用户勾选要清理的类目 → 再 `clean --categories <id,...> --apply`。
- 对 `caution`/`system` 类目，必须在执行前明确告知用户风险（iOS 备份删除不可恢复、系统级需 sudo 等）。
- 不得在未获用户明确选择的情况下，擅自清理 `caution`/`system` 类目。
- 清理前建议提醒用户：重要数据先 Time Machine / 备份；清理后可通过回收站反悔。

## 7. 逐项确认闸门（不可绕过）
以下类目在 manifest 里带 `per_item_confirm: true`：
`npm_junk`、`python_junk`、`docker_build_cache`、`docker_unused_images`、`tm_local_snapshots`。

- 必须把**每一个目录 / 镜像 / 快照**单独列给用户确认，不能只报总体积就整类目删除。
- 用户确认过的路径写入 JSON 清单，用 `--approved <清单>` 传入；脚本只处理清单内的条目。
- **未传 `--approved` 且非交互模式时，脚本拒绝删除并只写日志**——这是安全设计。
  不要为了「跑通」而伪造 approved 清单，也不要把未确认的路径塞进去。

## 8. 命令式资源（破坏性更强，单独约束）
- `kind: "command"`（Docker prune / rmi）：**永久生效、不经回收站、无法从废纸篓恢复**。
  执行前必须逐项列出将运行的完整命令与回收体积，并说明「镜像删除后需重新 pull/build」。
- `kind: "manual"`（Time Machine 快照）：**永不代跑**。只能用 `sudo` + TCC 授权在执行者自己的终端里跑。
  脚本只打印命令、日志记 `manual`。
- ⚠️ 硬禁止：不要手工执行 `tmutil deletelocalsnapshots` 去删 APFS 容器里那个
  `Sealed: Yes` 的系统启动快照——删了系统起不来。
- ⚠️ `docker_junk`（`Docker.raw`）与 `docker_build_cache`/`docker_unused_images` 体积重叠，
  报数时不能相加。

## 9. 权限边界不是 bug
以下现象属 macOS 权限设计，**如实报告并跳过，不要试图绕过**：
- `~/.Trash`、`com.apple.*` 容器等受 TCC 保护的路径，读取/移动返回 `Operation not permitted`。
- 沙箱内 `sudo` 不可用（exit 127）；`tmutil` 写操作还额外要求调用方 App 持有「完全磁盘访问权限」。
- 部分 `com.apple.*` 缓存（HomeKit / CloudKit / Safari History.db）需 FDA 才能动。
- 读取受限时长/统计会失真（如 `top`、`du` 在沙箱内），结论里要标注不确定性。
