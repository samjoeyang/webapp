# Time Machine 关闭与本地快照清理

对应 skill 类目：`tm_local_snapshots`（`scan.py` 只读列出；`clean.py` 只输出命令、**永不代跑**）。

## 〇、先定调：这类任务九成是「无事可做」

本地快照只在**自动备份开启期间**由系统按小时生成，并在需要空间时自动回收。所以顺序永远是：
**先取证 → 再判断有没有东西可删 → 最后才动手。** 不要上来就 `tmutil deletelocalsnapshots`。

实测一台 macOS 15 的机器跑下来就是：TM 早关了、快照 0 个、唯一那个快照是系统的不能碰。

## 一、取证：四条只读命令就够

```bash
# 1) 自动备份开关（权威）：0 = 关，1 = 开
defaults read /Library/Preferences/com.apple.TimeMachine.plist AutoBackup

# 2) 备份目的地是否还注册着（RESULT=101 表示目标不可达）
defaults read /Library/Preferences/com.apple.TimeMachine.plist

# 3) 本地快照清单（逐卷都要查）
tmutil listlocalsnapshots /

# 4) 容器内 APFS 全部快照（关键：区分 TM 快照 vs 系统密封快照）
diskutil apfs list /dev/disk1 | grep -Ei "APFS Volume|Snapshot|Capacity"
diskutil apfs listSnapshots /System/Volumes/Data    # "No snapshots for disk1s1" 即为干净
```

**`tmutil disable` 等价于把 `AutoBackup` 置 0**，所以 `AutoBackup = 0` 就已经是关闭状态，不必再跑一次 disable。

## 二、四个必踩的坑

### 坑 1：`tmutil status` / `destinationinfo` 在受限会话里必挂

直接跑会被 SIGTERM（Exit 137），stdout 全空——这两个命令要走 XPC 连 `backupd`。绕行：

```bash
cd <工作目录>
(tmutil destinationinfo > .tm_dest.txt 2>&1 &) ; sleep 8 ; cat .tm_dest.txt
```

干净态输出 `tmutil: No destinations configured.`。`tmutil status` 用同样姿势多半仍是空文件，别死磕，用 plist 判据代替。

### 坑 2：`sudo` 在沙箱里彻底不可用（exit 127 / operation not permitted）

即便加 `dangerouslyDisableSandbox` 也一样被拦。结论：

- **`tmutil disable` / `enable` / `removedestination` / `deletelocalsnapshots` 四个写操作，
  只能把命令原样交给用户在终端执行**，不要代劳、不要反复重试。
- 先把只读取证做足。若 `AutoBackup` 已是 0、快照已是 0，**根本不需要 sudo，任务已完成**——这才是常态。

### 坑 2b：交回用户后，用户还会撞上 TCC（务必预先提醒）

```
$ sudo tmutil disable
tmutil: disable requires Full Disk Access privileges.
```

**根因：macOS 把 tmutil 的写操作归入 TCC 管辖的敏感操作，root 权限不够，还要求调用方 App 持有
「完全磁盘访问权限」（FDA）。**

- **只有写操作要 FDA**。`listlocalsnapshots` / `listSnapshots` / `defaults read` 一律不需要，
  所以取证阶段永远能跑通——别被这条报错带偏成「什么都读不到」。
- 给用户的第一句话应该是：**「这条命令对你多半是空操作，因为 `AutoBackup` 已经是 0」**，
  先给判断，再讲怎么授权，省得白折腾。
- 授权路径：系统设置 → 隐私与安全性 → 完全磁盘访问权限 → `+` → `Shift+Cmd+G` 输入
  `/System/Applications/Utilities/Terminal.app` → 开开关 → **Cmd+Q 完全退出终端后重开**
  （TCC 在进程启动时读取，只关窗口不生效）。
- **授权必须给「用户实际敲命令的那个 App」**。报错文本永远写 Terminal，但用户可能在用
  iTerm2 / VS Code / Warp / Kitty——给 Terminal 加授权对他们无效。交回命令时顺带问一句。
- 兜底：`tccutil reset SystemPolicyAllFiles com.apple.Terminal`。
- 自检：`sudo cat "/Library/Application Support/com.apple.TCC/TCC.db" | head -c 16`
  ——有内容说明有 FDA，否则 `Operation not permitted`。
- **首选替代（不需要任何 FDA）**：让用户走 GUI——系统设置 → 通用 → 时间机器。
  GUI 走另一条授权通道，效果等同 `tmutil disable`，还能顺手移除失效目标盘。

### 坑 3：APFS 容器里那唯一一个快照是「系统密封快照」，删了系统起不来

```
Snapshot:         416E22E7-...
Snapshot Disk:    disk1s5s1
Snapshot Mount Point: /
Snapshot Sealed:  Yes
```

这是 **SSV（Signed System Volume）启动快照**，`/dev/disk1s5s1` 就是当前挂载在 `/` 的只读系统卷本体。

| 快照长相 | 身份 | 处置 |
|---|---|---|
| `Sealed: Yes` + 挂 `/` + UUID 与 `RootVolumeUUID` 相同 | 系统 SSV 启动快照 | **永不删** |
| `com.apple.TimeMachine.2026-09-28-123456.local` | TM 本地快照 | 可删 |
| `disk1s3 (Recovery)` 无挂载点、查不到快照 | 正常现象 | 忽略 |

`tmutil listlocalsnapshots` 只列 TM 快照，输出空 = 没有可清理的东西。
**不要**因为 `diskutil` 里看到一个快照就以为漏了。

## 三、真要清理时的命令（交用户执行）

```bash
sudo tmutil deletelocalsnapshots 2026-09-28-123456   # 逐条删（日期取自 listlocalsnapshots）
sudo tmutil deletelocalsnapshots /                   # 清掉全部本地快照
sudo tmutil disable                                  # 彻底关自动备份
sudo tmutil removedestination <DestinationID>        # 注销备份目标
```

删完复查：`tmutil listlocalsnapshots /` 只剩表头、`df -h` 的 Avail 变化。

## 四、报告口径（重要）

- **实删体积与 `df` 变化必须分开报**。APFS 上 `df` 随「可清除空间」自动伸缩，跳变远大于实删量，
  别把 df 的差值当成自己的功劳。
- 交付时写明三项即可说清账目：`AutoBackup` 当前值、快照条数、容器 `Capacity Not Allocated`。
- 探测中若偏好文件被改写，**如实说明**，不要默认认领成自己的操作。

## 五、可选收尾：失效的备份挂载点

`ls -ld /Volumes/*备份*` 常见残留（旧目标盘卸载后留下的空目录，权限 `d--x--x--x`），
占地约 0，清理纯为整洁，需 `sudo rmdir`。低价值项，报告里提一句即可，**不要主动删**。

## 六、与 scan/clean 的衔接

```bash
python3 scripts/scan.py --categories tm_local_snapshots --out /tmp/tm.json   # 只读列出快照
python3 scripts/clean.py --manifest /tmp/tm.json --categories tm_local_snapshots  # 预览
```

`clean.py` 对这些条目只会打印 `sudo tmutil deletelocalsnapshots <日期>`，状态记为 `manual`，**不会执行**。
`manifest.time_machine` 里有 `auto_backup` / `snapshot_count` / `data_volume` 三个字段可直接引用。
