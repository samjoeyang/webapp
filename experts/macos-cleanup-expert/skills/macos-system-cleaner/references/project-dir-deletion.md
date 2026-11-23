# 安全删除本地项目目录

配套脚本：`scripts/project_audit.py`（只读核查，给出高/中/低风险与判断依据）。

## 为什么值得走流程

工程目录往往同时包含三种东西：**可从远程恢复的代码**、**只在本地且不可恢复的数据**、
**可重建但昂贵的产物**。用户说「删掉」时通常只想到第一种。
删前把它们分开列出来，是让用户在有信息的状态下决定——而不是删完才发现丢了东西。

## 第 0 步：先确认「哪几个目录」

用户常用指代（「这两个」「本地那份」）。**不要猜**：先 `ls` 目标父目录，
用体积 + 最近修改时间锁定候选，再列给用户确认。注意 macOS 大小写不敏感——
用户写 `unokb`，磁盘上可能是 `UNOKB`。

## 第 1 步：核查风险（脚本 + 人工）

```bash
python3 scripts/project_audit.py <目录A> [<目录B> ...]
python3 scripts/project_audit.py <目录> --json --out /tmp/audit.json
```

风险分级逻辑（退出码 1 = 有中/高风险）：

| 情况 | 风险 | 含义 |
|---|---|---|
| 不是 git 仓库 | 🔴 高 | 全局唯一副本，删了彻底没有 |
| git 仓库但无 remote | 🔴 高 | 全局唯一副本（`.git` 里那份） |
| git + remote + 有未提交改动 | 🟡 中 | 代码可恢复，**未提交的改动不可** |
| git + remote + 工作区干净 | 🟢 低 | 代码可恢复，但本地运行态不可 |
| 任何情况 + 关键目录未被跟踪 | 🔴 高 | `.env`/`data`/`models` 这类删了没有第二份 |

**必做的第二遍**：确认哪些路径**不在**版本控制里——这些才是删了就真没了的：

```bash
for d in .env data models host-native deps logs backups; do
  printf "%-14s tracked=%s\n" "$d" "$(git ls-files "$d" | wc -l | tr -d ' ')"
done
```

`tracked=0` 的一律按「不可恢复」对待。**若是非 git 目录**：还要
`find -maxdepth 3 -name .git` 确认没有嵌套仓库，并全局搜一遍有没有别处的拷贝
（`~/.backup`、其他工作区）。

## 第 2 步：找出「独有内容」

两个同源项目可能高度重合但各有增量，用文件清单 diff 精确找出：

```bash
diff <(cd A && find app docs scripts -type f -not -path "*__pycache__*" | sort) \
     <(cd B && find app docs scripts -type f -not -path "*__pycache__*" | sort)
```

再**交叉核对远程**：你以为独有的大全套截图，远程可能已有近似版本，实际损失被高估。
**要如实告诉用户**，别为了显得谨慎而夸大风险。

## 第 3 步：告知 + 显式确认

按 `<personal_files_safety>` 要求：加粗警告 → 逐条列出受影响路径与体积 → 说明具体风险
→ **等用户明确选择**。用 `AskUserQuestion` 一次问清两件事：
**范围**（删哪些 / 是否先抢救独有内容）与**方式**（废纸篓 vs 彻底删除）。

## 第 4 步：删前落一份清单存档

80 KB 换一份事后可追溯，值。

```bash
cd <父目录> && mkdir -p .backup && MAN=".backup/deleted-$(date +%Y%m%d)-<项目>.txt"
{ echo "# 删除清单  $(date '+%F %T %Z')"; echo "# 用户确认: <原话>"
  echo "## <项目>"; echo "- 路径: $PWD/<项目>"
  (cd <项目> && echo "- git HEAD: $(git rev-parse HEAD 2>/dev/null)" \
               && echo "- remote: $(git remote get-url origin 2>/dev/null)")
  echo "- 顶层体积:"; (cd <项目> && du -sh .env app data deps docs models scripts 2>/dev/null | sed 's/^/    /')
  echo "- 本机独有(GitHub 上没有): <逐项列>"
  echo "- 文件清单:"; (cd <项目> && find . -type f -not -path './.git/*' | sort | sed 's/^/  /')
} > "$MAN" && ls -lh "$MAN"
```

`df -h /` **删前删后各记一次**，用来验证回收结果。

## 第 5 步：执行（关键：先解软链接 + 路径白名单）

```bash
set -u
for d in "$T1" "$T2"; do
  [ -d "$d" ] || { echo "FAIL 不存在: $d"; exit 1; }
  case "$d" in
    /abs/path/A|/abs/path/B) echo "OK 白名单: $d" ;;
    *) echo "REFUSE: $d"; exit 1 ;;
  esac
done
find "$T1" "$T2" -maxdepth 2 -type l          # 先看有哪些软链接
rm -f "$T1/node_modules" "$T2/node_modules"   # 再解除
rm -rf "$T1"; rm -rf "$T2"
```

**⚠️ 坑一：项目里的 `node_modules` 常常是指向共享目录的软链接。**
在 WorkBuddy 托管运行时下，项目里会有
`node_modules -> ~/.workbuddy/binaries/node/workspace/node_modules`（约 28 MB）。
`rm -rf` 本身不跟随软链接（只删链接本身），但仍应**先 `rm -f` 解除**：
一是明确意图，二是万一后续改成 `cp -r`/`rsync` 之类会跟随的操作不至于误伤共享依赖。
删完必须回验共享目录仍完整：

```bash
du -sh ~/.workbuddy/binaries/node/workspace/node_modules   # 应仍为 28M
```

## 第 6 步：验证 + 解释空间去哪了

```bash
for d in A B; do [ -e "$PWD/$d" ] && echo "❌ 仍在" || echo "✅ 已消失"; done
df -h /System/Volumes/Data | tail -1
```

**⚠️ 坑二：删了 6.7 GB，可用空间可能只涨 1 GB。** 排查顺序：

1. `tmutil listlocalsnapshots /` —— 本地 Time Machine 快照会暂留已删文件
2. **`docker system df`** —— 最容易被忽略的一项。删目录**不会**回收它构建的镜像：

```bash
docker images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}" | sort -k2 -rh
```

删掉项目后，形如 `<项目名>/api:*`、`<项目名>/ocr:*` 的镜像以及一串 `<none>` 中间层
全部变成孤儿。注意 `Docker.raw`（`~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`）
是稀疏文件，**prune 之后宿主机空间也要等它压实才回来**，不是立刻。

3. 被进程持有句柄的已删文件（`lsof +L1`）——容器/服务没停时 `du` 看不到这部分

**主动告知用户这个落差**：只报「已释放 6.7 G」是不准确的。

## 第 7 步：扫一遍 `/tmp`

**⚠️ 坑三：临时目录里可能躺着资产的最后一份拷贝。**

```bash
ls /tmp/ | grep -iE '<项目名>'
```

实测案例：刚删掉的 `IPVault/docs/screenshots/m14/` 有 16/17 张副本正躺在 `/tmp/ipvault-shots/`；
同时 `unokb-hostenv.sh` 里有明文 `MINIO_SECRET_KEY`、`unokb-cookies.txt` 是会话 cookie jar。

处置：**先报告，不要顺手删**——如果 `/tmp` 是最后一份，删它等于真删。
但**明文凭据文件应当建议清掉**并提醒轮换。

## 交付话术要点

- 删前：把「可恢复 / 不可恢复」两类分开列，别用一个总体积数字盖过去。
- 删后：**主动报告三件事**——① 关键交付物现在在哪（若已推远程，给出路径并核实）；
  ② 空间实际回收多少、差额在哪；③ 还剩哪些残留（`/tmp`、Docker、备份包）。
- 若发现自己的前期判断偏保守（如「唯一存档」其实是近似副本），**明说纠正**。
