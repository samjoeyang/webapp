# 持久化忽略清单（对标 CleanMyMac Ignore List）

官方行为参考：<https://macpaw.com/support/cleanmymac/knowledgebase/ignore-lists>（更新 2026-10-15）。
CleanMyMac 为支持忽略的类目各维护一份列表，另有跨模块的 Other 列表；本 skill 用**一份 JSON 文件**统一表达，
通过 `patterns` 区分作用范围，不再为每类单独存一份状态。

## 1. 文件格式

```json
{
  "paths": [
    "/Users/me/Library/Caches/com.example.keepme",
    "/Users/me/Downloads/archive"
  ],
  "prefixes": [
    "/Users/me/workspace/special-project"
  ],
  "patterns": [
    "/Users/*/Library/Caches/Fake*",
    "/Users/me/Pictures/*/keep-*.jpg"
  ]
}
```

也可简化为纯数组，此时每一项都按**路径前缀**处理：

```json
[
  "/Users/me/Library/Caches/com.example.keepme",
  "/Users/me/workspace/special-project"
]
```

- `paths` / `prefixes`：路径前缀匹配，等价于 `scan.py --keep`，但跨扫描持久生效。
- `patterns`：`fnmatch` 通配（支持 `*` `?` `[seq]`），用于一批相似路径。
- 三者都先做 `~` 展开与绝对路径归一化；匹配的是**归一化后的绝对路径**。
- 命中即**从扫描结果剔除**，不会从磁盘移动或删除任何东西。

## 2. 使用

```bash
# 主扫描
python3 <skill>/scripts/scan.py --ignore-file <工作目录>/ignore.json --out <工作目录>/manifest.json

# 重复文件 / 相似图片
python3 <skill>/scripts/clutter_scan.py --ignore-file <工作目录>/ignore.json \
  --out <工作目录>/clutter.json
```

`scan.py` 控制台会打印「持久化忽略规则: N 条」，可用于确认文件已载入。
文件不存在或 JSON 写错会**直接报错退出**，不会静默变成「零忽略」。

## 3. 与内置保护的区别

优先级从高到低：

1. `always_protected`（定义在 `rules/defaults.json`，不在脚本里）：WorkBuddy 托管 Python、uv 解释器、
   Rust toolchains、Gradle wrapper。这些是工具链本体，任何忽略清单都不能把它们重新纳入扫描。
2. `ignore.json`（持久化）：用户长期保留项。
3. `--keep`（运行时）：本次临时保留，不写盘。

`clean.py` 不读忽略清单——它只处理 manifest。忽略必须在**扫描阶段**完成；
一旦路径进了 manifest，就只能靠用户不把它写进 `--approved` 来避免删除。

## 4. 运维建议

- 忽略清单放在工作目录里随项目走；需要全局生效就固定放 `~/.config/macos-system-cleaner/ignore.json`，
  每次调用显式传路径（本 skill 不自动读取该默认位置，避免“忘了为什么扫不到”）。
- 重置：编辑文件删掉对应条目即可。CleanMyMac 在设置页提供 Reset Selected / Reset All；
  本 skill 用版本化 JSON 文件代替，建议把 ignore.json 纳入版本控制以便追溯。
- 组级忽略：CleanMyMac 可右键把「相似图片组」整体加入忽略。本 skill 用 `patterns` 通配该组路径实现同等效果。
- 不要忽略整个 `~/Library/Caches` 之类的大目录——那会让真正该清的缓存也消失，失去扫描意义。

## 5. 与 CleanMyMac 的差异

| 维度 | CleanMyMac | 本 skill |
|---|---|---|
| 存储 | 每类目一份 + 全局 Other，GUI 管理 | 单 JSON 文件，按路径/通配表达 |
| 生效时机 | 下次扫描 | 下次扫描（本次 manifest 不受影响） |
| 默认条目 | 系统语言文件、系统 App 等按规则预置 | 仅规则库 `always_protected` 工具链本体 |
| 重置 | 设置页 Reset Selected / Reset All | 编辑 JSON，可版本化回溯 |
| 组级忽略 | 支持 Duplicates / Similar 整组 | 用 `patterns` 通配近似实现 |
