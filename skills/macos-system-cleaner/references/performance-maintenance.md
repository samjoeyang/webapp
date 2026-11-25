# 性能维护任务（对标 CleanMyMac Performance）

官方功能清单见：<https://macpaw.com/support/cleanmymac/knowledgebase/maintenance-tasks>（更新 2026-10-27）。
**App Store 版没有这些能力**；MacPaw Store / Setapp 才完整。

## 0. 统一纪律

- 先只读诊断，再判断是不是该跑任务；「磁盘满」不等于「该清 purgeable」。
- 需要 `sudo` 的命令：**只打印给用户，不代跑**。沙箱内 sudo 不可用，反复重试没有意义。
- 会改变系统状态的命令（重建索引、删快照、清 DNS）都要先说明影响窗口。
- 不跑 `Free Up RAM` 类操作：现代 macOS 内存管理不需要外力干预，CleanMyMac 也仅限 Intel 机型。

## 1. 只读诊断入口

```bash
python3 <skill>/scripts/sysinfo.py            # CPU / 内存 / 网络 / 磁盘 / SMART
python3 <skill>/scripts/sysinfo.py --json     # 机读

mdutil -s /                                  # Spotlight 索引状态
tmutil listlocalsnapshots /                  # 本地快照清单
diskutil info / | grep -Ei 'Free Space|Volume Name'
log show --last 30m --predicate 'process == "mDNSResponder"' --style compact | tail -40
```

判读：`sysinfo.py` 在受限会话里 `top` 可能失败，会降级为负载均值；这不是故障。

## 2. 任务对照表

| CleanMyMac 任务 | 何时值得做 | 本 skill 口径 |
|---|---|---|
| Flush DNS Cache | DNS 改动后、部分站点连不上、持续网络异常 | 给用户命令，不代跑 |
| Free Up Purgeable Space | 系统标记的临时/缓存数据占空间 | 不主动跑 `purge`；先按 `scan.py` 明确类目清理 |
| Reindex Spotlight | 搜索变慢、明明存在的文件搜不到 | 给用户 `mdutil -E /`，告知索引期间会变慢 |
| Repair Disk Permissions | 权限异常、App 打不开 | 现代 macOS 已移除 `diskutil repairPermissions`；只做只读权限核对 |
| Periodic Scripts | 日志轮转、临时文件、系统库重建 | 仅 macOS 13 及更早；给用户 `sudo periodic daily weekly monthly` |
| Speed Up Mail | Mail 搜索慢/删信异常 | 先清 Junk/Trash；重建索引走 Mail 自带流程，不直接删 Envelope Index 以外的数据 |
| Free Up RAM | 官方仅 Intel 机型 | 不追 |
| Thin Time Machine Snapshots | 开启了 TM 且本地快照异常大 | 见 `references/time-machine-snapshots.md`，只输出命令 |

## 3. 交给用户的命令模板

按需复制，不要一次性全给：

```bash
# DNS 缓存
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

# Spotlight 重建（索引期间机器会变慢）
sudo mdutil -E /

# 周期维护脚本（仅 macOS 13 及更早）
sudo periodic daily weekly monthly

# 精简 Time Machine 本地快照（先确认 tmutil listlocalsnapshots / 有输出）
sudo tmutil thinlocalsnapshots / 10000000000 4
```

说明口径：

- `mdutil -E /` 会重建索引，期间 Spotlight 结果不完整；不要与大量文件移动同时进行。
- `tmutil thinlocalsnapshots` 需要 sudo + 完全磁盘访问权限，且**必须授权给用户实际敲命令的那个终端 App**。
- 不要承诺「清完 df 一定涨」：APFS 可清除空间会跳变，实删体积与 `df` 差额分开报。

## 4. 不做的项目

- 不做常驻菜单栏监控（CleanMyMac The Menu）。需要时重复跑 `sysinfo.py`。
- 不做 Browser Care：Chrome 标签级 CPU/内存需要调试协议 + 后台项授权，超出本 skill 边界。
- 不做应用更新检测与安装；那是包管理器 / App Store 的职责。
- 不做 Moonlock 式恶意软件扫描；系统 XProtect 与专业安全软件更合适，本 skill 不冒充。
