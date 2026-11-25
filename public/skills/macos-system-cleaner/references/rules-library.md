# 规则库：扫描策略与代码分离（v2.6.0）

## 1. 为什么外置

CleanMyMac 的 Safety Database 是加密 SQLite（`info.cmmkb`，SQLCipher 3），规则可在线热更、按类目组织。
本 skill 借鉴的是**「规则与代码分离 + 按类目组织 + 用户可覆盖」**，**不加密**：

- 这是本地脚本，用户本就该看懂要删什么；加密会破坏「逐项确认、可审计」的核心纪律。
- 本项目是 ad-hoc 签名，没有安全 keystore；硬编码 key 等于没加密。
- 没有服务端，无法热更；加密后仍需手动换文件，只剩维护成本。

详见 `cleanmymac-binary-analysis.md` §2.1。

## 2. 文件清单

| 文件 | 内容 |
|---|---|
| `rules/manifest.json` | `schema_version`、`version`、四个规则文件的 SHA-256 |
| `rules/categories.json` | 40 个类目定义：`id/name/severity/scope/desc/collector` + `roots/exclude/patterns/names/...` |
| `rules/collectors.json` | 自定义收集器的路径清单与命令模板：AI 工具路径、浏览器 targets、Mail 子目录、Docker/TM 命令等 |
| `rules/defaults.json` | CLI 默认阈值、`macos_names`、`mail_v`、快速巡检跳过表、永久保护路径、开发目录、`large_old_files` 类目 |
| `rules/clutter.json` | 重复/相似图扫描的默认根目录、跳过目录、图片扩展名、dHash 参数与类目文案 |

代码侧（`scripts/scan.py` / `clutter_scan.py`）只保留**如何解释这些数据的算法**，不含任何路径清单、类名、版本映射或阈值副本。
`scripts/rules.py` 是唯一加载器。

## 3. 占位符与条件

路径字符串支持以下占位符，加载时展开：

| 占位符 | 含义 |
|---|---|
| `{HOME}` | 用户主目录 |
| `{CACHE_HOME}` | `~/Library/Caches` |
| `{TMP}` | `tempfile.gettempdir()` |
| `{UID}` | 当前 uid 字符串 |
| `{MAIL_V}` | 当前 Mail 数据目录版本（先读 `PersistenceInfo.plist`） |
| `{FAMILY}` / `{MAJOR_NUM}` | macOS 版本族 / 数值 |

其他语法：

- `@DEV_BASES`、`@npm_named_dirs` 等以 `@` 开头的字符串 = 引用 `defaults`/`collectors` 中的键，避免重复写。
- 条件项：`{"path": "/opt/homebrew/var/cache/homebrew", "when": {"apple_silicon": true}}`。
  支持 `apple_silicon`、`sealed`、`major_min`、`major_max`；不满足的路径被剔除，不满足的类目整体不出现。
- 类目级 `when` 例：`rosetta_cache` 仅在 Apple Silicon 且 macOS ≥ 11 时出现。

## 4. 校验与自定义

```bash
# 默认规则库（带 manifest 校验）
python3 <skill>/scripts/scan.py --out manifest.json

# 自定义规则库（可无 manifest；有则照样校验）
python3 <skill>/scripts/scan.py --rules-dir ~/my-rules --out manifest.json
python3 <skill>/scripts/clutter_scan.py --rules-dir ~/my-rules --out clutter.json
```

- 默认目录缺任一 JSON、schema 不匹配或 SHA-256 不一致 → **直接报错退出**，不会静默用内置规则兜底。
- 自定义目录允许没有 `manifest.json`，便于试验；要防手滑就自己生成一份。
- `clean.py` 不读规则库，只消费 manifest。规则改动必须**重新扫描**才生效。

## 5. 常见改法

1. **新增类目**：在 `categories.json` 追加一项，`collector` 选现有实现（`dir_top` / `dir_whole` / `globs` /
   `custom_*`），配好 `roots`。若需要全新收集器，才改 `scan.py` 的 `run_collector`。
2. **改路径**：编辑对应类目的 `roots` / `exclude`，或 `collectors.json` 的清单。不要回写脚本。
3. **改阈值**：`defaults.json` 的 `cli_defaults`；命令行参数仍可覆盖。
4. **改 Mail 映射**：`defaults.json` 的 `mail_v` / `mail_v_default`；运行时仍优先读 `PersistenceInfo.plist`。
5. **改完刷新校验**：

```bash
python3 - <<'PY'
import json, hashlib, os
d = '/Users/<you>/.workbuddy/skills/macos-system-cleaner/rules'
files = ['defaults.json', 'collectors.json', 'clutter.json', 'categories.json']
m = {'schema_version': 1, 'version': '1.0.0',
     'files': {f: hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest() for f in files}}
json.dump(m, open(os.path.join(d, 'manifest.json'), 'w'), ensure_ascii=False, indent=2)
PY
```

## 6. 优先级

从高到低：`--keep`（本次）→ `ignore.json`（持久）→ `always_protected`（规则库定义，永不可覆盖）→ 规则库默认路径。
忽略只影响 manifest，不删除磁盘上的东西。

## 7. 回归方法

改规则后应验证类目定义与路径集合未意外漂移：

```bash
python3 -m py_compile scripts/scan.py scripts/rules.py scripts/clutter_scan.py
python3 scripts/scan.py --no-large --no-docker --out /tmp/after.json
# 与改前 manifest 比较 categories[].id/name/severity/desc/items[].path
```

注意日志文件与浏览器缓存会在两次扫描之间自然增长，`bytes` 字段不必完全相等。
