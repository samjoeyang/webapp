# 首次推送远程仓库前的凭据体检与历史清理

配套脚本：`scripts/secretscan.py`（只读，输出阻断项 + 需人工确认项）。

## 为什么必须做

一个从没推送过的本地仓库，往往已经在本地提交了几十次。
**只要历史里进过一次 `.env`，`git clone` 之后 `git log -p` 就能翻到明文口令。**
清理必须在**首次推送前**做——推送之后再清理，就得让所有已 clone 的人重新克隆。

先问：**远程仓库是空的吗？**
- 空 → 随便重写历史，零副作用（最好的时机）
- 非空 → 重写历史需要强推，**必须先跟用户确认**并提醒协作者

```bash
GIT_SSH_COMMAND="ssh -o BatchMode=yes" git ls-remote git@github.com:<user>/<repo>.git
# 无输出 = 仓库存在但为空（最理想）；报错 = 不存在或没权限
# ⚠️ 必须走 SSH 形式：HTTPS 地址会因钥匙串而卡死（见坑二）
```

## 情形零：本地根本不是 git 仓库

```bash
git rev-parse --git-dir 2>&1     # 报 "not a git repository" = 还没初始化
```

- **零历史 ⇒ 不需要 filter-repo、不需要重写历史**，直接跳到「补 .gitignore 并提交」。
- 但**容错同样是零**：`.gitignore` 漏一项，第一次 `git add -A` 就把口令写进历史。顺序必须是：
  写 `.gitignore` → `git init` → `git check-ignore` 逐项验证
  → `git ls-files --others --exclude-standard` 列出全部将提交文件
  → **对它跑一遍凭据扫描**（最后这道闸门别跳）→ 才 `git add`。
- 提交拆分：`chore(security)`（.gitignore + 修掉硬编码口令）单独一个 commit，其余另一个
  ——日后回溯「安全基线是哪一版」一眼可见。

## 一、体检：先跑脚本，再人工核

```bash
python3 scripts/secretscan.py --repo .              # 人类可读
python3 scripts/secretscan.py --repo . --json       # 机读
python3 scripts/secretscan.py --repo . --history    # 额外查历史中的敏感路径
```

脚本会分两类输出：
- **🚫 需处理**（阻断项，退出码 1）：真凭据形态、敏感文件名（`.env` / `.envXXXXXX` / 私钥）
- **ℹ️ 需人工确认**（多为占位符、从环境变量读取）

脚本之外，手工再确认三件事：

```bash
git remote -v; git branch --show-current
git status --short                    # 重写历史前必须干净，否则会丢改动
git ls-files -z | xargs -0 du -h 2>/dev/null | sort -rh | head -20   # 超大文件
```

### 逐条核对命中项，不要一看命中就判定泄露

| 命中形态 | 是否泄露 |
|---|---|
| `.env.example` 里 `PASSWORD=please-change-this-password` | 否，占位符 |
| `export MINIO_SECRET_KEY="${MINIO_ROOT_PASSWORD:-}"` | 否，从环境变量读 |
| 脚本里 `printenv APP_PASSWORD` | 否 |
| 文档里 `PASSWORD=your_strong_password_here` | 否 |
| **`.env` 本体** | **是，必须处理** |
| **验收脚本的兜底默认值** `const PASS = process.env.UI_PASS \|\| '真实口令'` | **是**，等于把口令固化进仓库 |

最后一条特别容易漏：它不是「配置」，是**代码里的默认值**，看起来完全无害。
`secretscan.py` 已把它单列为「代码兜底默认值」并判 critical。

### 两条同样容易漏的

① **`.env` 的变体副本**。只写 `.env` 不够——编辑时工具会留下 `.envXXXXXX`（6 位随机字母数字）
   形态的临时副本，内容与 `.env` **逐字段相同**。实测一个项目里同时躺着 3 个：
   `.envGgHYK9` / `.envTdPZDr` / `.envvwOimT`，DB / Redis / JWT / AES / MinIO 全套真实密钥都在。
   → 规则必须写 **`.env*`**，末尾用 `!.env.example` 显式放行模板。
   同源的还有 `docker-compose.ymlXXXXXX` 这类「保存时产生的随机后缀副本」。

② **项目自己备份目录里的旧私钥**。`.backup/cert-before-*/server.key` 是「上次换证书前的旧证书」，
   加固 `angie/cert/*` 时极易漏掉。→ 这类目录（`.backup/`、`backups/`、`*.old/`）**整套忽略**，
   不要只忽略具体文件。

`.gitignore` **正反两个方向都要查**：

```bash
git check-ignore -v .env .env.local data/ models/ node_modules/   # 应逐条命中
git check-ignore -v .env.example angie/html/index.html            # 应**不**命中（不能误伤）
git ls-files --others --exclude-standard | wc -l                  # 待提交数，与预期对得上
```

## 二、重写历史：顺序不能错

### 2.1 先备份（不能省）

```bash
mkdir -p <项目父目录>/.backup
tar czf <项目父目录>/.backup/<项目>-git-$(date +%Y%m%d-%H%M%S).tar.gz .git
```

### 2.2 装 filter-repo 并写擦除清单

```bash
<python>/bin/pip install git-filter-repo
```

擦除清单（`literal:` 前缀避免正则误伤；**用完立刻删掉，它本身含明文口令**）：

```
literal:<真实口令1>==>***REMOVED***
literal:<真实口令2>==>***REMOVED***
```

### 2.3 一次跑完「移除路径」+「擦除内容」

```bash
FILTER_BRANCH_SQUELCH_WARNING=1 <python>/bin/git-filter-repo --force \
  --invert-paths --path .env --path <大目录> \
  --replace-text /tmp/scrub.txt
```

- `--invert-paths --path X` 表示「**保留除了 X 以外的一切**」（方向容易写反）
- 可同时给多个 `--path`
- `--replace-text` 作用于所有 blob，能把散落在脚本里的硬编码口令一起擦掉
- `--force` 必需：filter-repo 默认要求「新鲜克隆」

### 2.4 ⚠️ 坑一：filter-repo 会连工作区文件一起删掉

它结尾执行 `git reset --hard`。被移除路径的文件在新 HEAD 里不存在，于是**从磁盘上消失**——
`.env` 也一样没了。补救（用 `git archive` 比 checkout 干净，不动当前索引）：

```bash
mkdir -p /tmp/restore && tar xzf <备份>.tar.gz -C /tmp/restore
git --git-dir=/tmp/restore/.git archive <重写前的旧 HEAD> .env <大目录> | tar -x -C <项目目录>
```

重写前的旧 HEAD 要在动手前就记下来：`git rev-parse HEAD`。

### 2.5 瘦身与验证

```bash
git reflog expire --expire=now --all && git gc --prune=now --aggressive
du -sh .git; git ls-files | wc -l

# 三连验证（都应为空）
git log --all --oneline -- .env
git log --all --oneline -- <大目录>
git grep -I -n -E '<口令1>|<口令2>' $(git rev-list --all)
```

## 三、补 .gitignore 并提交

`.gitignore` 注释里**写清「为什么忽略」**（体积、机器相关、含凭据），否则下一个人会加回来。
按「一个问题一个提交」拆：`chore(security)` 一个，`docs/feat` 另一个。

## 四、⚠️ 坑二：macOS 钥匙串会卡死非交互 git

现象：`git push` / `git ls-remote` 返回 **Exit 137 / SIGTERM**，没有任何报错信息。
看起来像网络或沙箱问题，实际是：

```bash
git config --get credential.helper     # → osxkeychain
```

`osxkeychain` 读凭据会触发 GUI 授权弹窗，非交互环境（agent 沙箱 / CI / SSH 会话）里没人点，
进程一直挂到被杀。`security find-internet-password -s github.com -w` 同样会挂。

**先别怀疑网络**——用 `curl -o /dev/null -w "%{http_code}" https://github.com` 确认连通性。
**解法：改用 SSH**（本机常已注册好密钥）：

```bash
ssh -o BatchMode=yes -T git@github.com     # 期待 "Hi <user>! You've successfully authenticated"
git remote set-url origin git@github.com:<user>/<repo>.git
GIT_SSH_COMMAND="ssh -o BatchMode=yes" git push -u origin main
```

`BatchMode=yes` 保证缺密钥时立即失败而不是挂住等输入。

## 五、分支名

本地常见 `master`，GitHub 默认分支是 `main`。**推 `master` 会让仓库首页看起来是空的**
（默认分支指向不存在的 `main`）。推送前改名成本为零：`git branch -m master main`。

## 六、推送后的独立验证（必做）

不要只看 push 返回码，**克隆一份下来验**：

```bash
git clone -q <远程> /tmp/verify && cd /tmp/verify
ls -la .env                                        # 应 No such file
git grep -I -n -E '<口令>' $(git rev-list --all)    # 应为空
git ls-files | wc -l
python3 <skill>/scripts/secretscan.py --repo /tmp/verify   # 再扫一遍
```

## 七、收尾

- 删掉临时擦除清单（**含明文口令**）、还原目录、验证克隆目录
- 删掉 `/tmp` 下的测试产物（cookie jar、日志）
- **明确告知用户需要轮换口令**——历史清理只是止血，口令已经在本机明文存在过
- 提醒备份文件里保留的是**清理前的旧历史（含口令）**，确认无碍后应删除
