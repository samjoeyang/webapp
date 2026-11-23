# Node / npm 生态缓存盘点与清除

对应 skill 类目：`npm_junk`（`per_item_confirm=true`，**每个目录删除前必须单独确认**）。

## 一、盘点：先只读

```bash
which -a node npm npx; node -v; npm -v
npm config get cache       # 通常 ~/.npm
npm config get prefix; npm root -g   # 全局包位置，不是缓存，别删

du -sh ~/.npm; du -sh ~/.npm/* 2>/dev/null | sort -hr
du -sh ~/.node-gyp ~/Library/pnpm ~/.yarn ~/.cache/yarn ~/.cache/pnpm ~/.pnpm-store 2>/dev/null
ls -ld /tmp/npm-* /tmp/.npm* "$TMPDIR"npm-* 2>/dev/null
```

或直接用本 skill：`python3 scripts/scan.py --categories npm_junk --out /tmp/npm.json`

## 二、各目录性质速查

| 路径 | 性质 | 可删 |
|---|---|---|
| `~/.npm/_npx/<hash>` | npx 临时下载的完整包（**最大头，MCP server 常占几十 M**） | ✅ 下次 npx 自动重下 |
| `~/.npm/_cacache` | HTTP 包缓存 | ✅ 常本来就没有 |
| `~/.npm/_prebuilds` | 预编译二进制（better-sqlite3 等） | ✅ |
| `~/.npm/_logs` | debug 日志 | ✅ |
| `~/.npm/_update-notifier-last-checked` | 0 B 时间戳 | ❌ 留着 |
| `~/.node-gyp/<ver>` | 编译头文件，删后重编原生模块会重新下载 | ✅ 建议单列确认 |
| `~/Library/pnpm/global` | pnpm 全局包（**不是缓存**，删了全局命令失效） | ⚠️ 必须单独确认 |
| `~/.yarn/lib` | yarn 本体程序 | ❌ 不是缓存 |
| `node_modules`（各项目内） | 依赖，`npm i` 可重建 | ⚠️ 逐项目确认 |

## 三、⚠️ 废纸篓通道可能不可用

两条路都可能堵死，别浪费时间反复试：

```bash
which trash trash-put          # -> not found（未装）
osascript -e 'tell application "Finder" to delete POSIX file "/tmp/x"'
# -> 29:69: execution error: 未获得授权将Apple事件发送给Finder。 (-1743)
```

此时只能 `rm`，合规路径：

1. **先写 manifest 备份**（≈ 上百 M 缓存没有可还原副本，清单是唯一凭证）：
   ```bash
   BK=./npm-cleanup-manifest-$(date +%Y%m%d).txt
   { echo "# npm 缓存清理清单  $(date '+%F %T')  主机: $(hostname)"
     echo "## 目标与体积"
     du -sh ~/.npm/_npx ~/.npm/_prebuilds ~/.npm/_logs ~/.node-gyp 2>/dev/null
     echo "## 完整文件清单"
     for t in ~/.npm/_npx ~/.npm/_prebuilds ~/.npm/_logs ~/.node-gyp; do
       du -ah "$t" 2>/dev/null | sed 's|^|  |'; done
   } > "$BK"
   ```
2. **加粗警告 + 列全部绝对路径 + 二次确认**（第一次"清理范围"，第二次"删除方式"）：
   说清「不可恢复」「下次 npx 需重新下载」「`~/.npm/_npx` 里的 MCP server 缓存会被清掉」。
3. 确认后 `rm -rf` **只删枚举出的绝对路径**，不要用通配符。
4. **分批执行**（每批 ≤ 5 个目标），每批后 `[ -e "$T" ]` 校验。

本 skill 的 `clean.py` 默认走「移入 `~/.Trash`」，上述手工流程只在回收站通道不可用时使用。

## 四、看 `_npx` 里到底是什么包（报告里必须点名）

```bash
for d in ~/.npm/_npx/*/; do
  n=$(basename "$d"); pj="$d/package.json"
  du -sh "$d" | cut -f1 | tr -d '\n'; echo -n "  $n  "
  [ -f "$pj" ] && node -e "const p=require('$pj');console.log(Object.keys(p.dependencies||{}).join(', '))"
done
ls -lutd ~/.npm/_npx/*/    # 最近使用时间，判断哪些超过半年没用
```

## 五、排除项（用户指定，任何清理都不得触碰）

- `/Users/samjoeyang/workspace/unokb-weknora` 与 `unokb-dify-weknora-ragflow`
  —— 用户的 Docker 知识栈（8.6 G，Docker 编排，无 node_modules）。
  全机清理前先确认目标与二者**零交集**，并在回复里明确声明保留。
- 可通过 `scan.py --keep <前缀>` 把这些路径从结果中永久剔除。

## 六、收尾校验（缺一不可）

```bash
ls -la ~/.npm/; du -sh ~/.npm                # 正常只剩 0B 的 _update-notifier-last-checked
node -v; npm -v                              # 工具必须仍可用
npx --version && npx -y cowsay hi >/dev/null 2>&1 | head -1   # 可选：验证 npx 能重新拉包
du -sh /Users/samjoeyang/workspace/unokb-weknora   # 必须仍是 8.6G
df -h / | tail -1                            # 对比清理前后
```

## 七、两个反直觉的点

- **`npm cache clean --force` 清不掉 `_npx`**，它只清 `_cacache`。用户说「清 npm 缓存」时，
  如果 `_cacache` 为空而 `_npx` 有 78 M，真正的大头在后者。
- **移到废纸篓不释放空间**（同一 APFS 卷）。既然目的是「释放空间」，用 `rm` 更直接，
  但必须先把「不可恢复」讲清楚。
- APFS 上 `df` 可用空间的跳变可能大于实删体积（purgeable / 快照回收），
  报告时**实删体积与 df 变化分开写**。
