# Python 虚拟环境与缓存盘点 / 清除

对应 skill 类目：`python_junk`（`per_item_confirm=true`，**每个目录删除前必须单独确认**）。

## 一、扫描：不要用 Glob / mdfind / 深层 find（都会翻车）

| 方法 | 结果 |
|---|---|
| Glob 工具搜 `*/pyvenv.cfg` | ✅ 会超时（家目录下有 8.6 G 的 Docker 项目），30s 超时 |
| `mdfind -name pyvenv.cfg` | ❌ 返回空——Spotlight 不索引 `~/.venv-*` 这类 dot 目录 |
| `mdfind ... kMDItemFSName == 'venv'` | ⚠️ **危险**：会返回 `.../python3.14/venv`（Python 自带 stdlib 模块目录），照它删会破坏 Python 安装 |
| `find ~ -maxdepth 7 -name pyvenv.cfg` | ❌ Exit 137（SIGTERM），被系统杀掉 |

**正确姿势：按根目录逐个限深 + prune 重型目录**

```bash
for root in ~/workspace ~/MiniProjects ~/WeChatProjects ~/airflow_docker ~/clawd \
            ~/Documents ~/Desktop ~/Downloads ~/WorkBuddy; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 4 \
    \( -name node_modules -o -name .git -o -name data -o -name "unokb-weknora*" \) -prune -o \
    -name pyvenv.cfg -print 2>/dev/null
done

# home 层单独扫一遍（抓 ~/.venv-xxx 这类隐藏环境）
find ~ -maxdepth 2 \( -name Library -o -name .Trash -o -name workspace -o -name node_modules \) -prune -o \
  -name pyvenv.cfg -print 2>/dev/null

# virtualenv 式（无 pyvenv.cfg）兜底
find ~/workspace -maxdepth 5 -name node_modules -prune -o -path "*/bin/activate" -print 2>/dev/null
```

本 skill 已实现上述限深 + prune 逻辑：`python3 scripts/scan.py --categories python_junk --out /tmp/py.json`

相关缓存体积：

```bash
du -sh ~/Library/Caches/pip ~/.cache/pip ~/.cache/uv ~/.local/share/uv 2>/dev/null
du -sh ~/.virtualenvs ~/miniconda3/envs ~/anaconda3/envs ~/.conda/envs 2>/dev/null
which pyenv conda 2>/dev/null
```

## 二、判定标准：名字不可信，只看标记文件

- **真 venv**：目录内含 `pyvenv.cfg`，或 `bin/activate`。
- 名字带 `venv`/`env` 的**未必**是环境。实例：`~/.docker/devenvironments`、
  Python 安装目录里的 `lib/python3.x/venv`（stdlib 模块）。
- 逐环境必读：`du -sh`、`stat -f '%Sm'`、`cat pyvenv.cfg`
  （注意 `command =` 行记录的**原始创建路径**，可判断环境是否被搬移/已成孤儿）、
  `ls site-packages | wc -l`。

## 三、必须保留（删了会破坏工具链，先声明再动手）

| 路径 | 为什么 |
|---|---|
| `~/.workbuddy/binaries/python/envs/default` | WorkBuddy 托管环境（aioquic / pylsqpack / pyopenssl），删了工具链直接挂 |
| `~/.workbuddy/binaries/python/versions/*` | 托管解释器本体 |
| `~/.local/share/uv/python/cpython-*` | uv 的**解释器**安装，不是虚拟环境；保留它重建 venv 才能秒装 |
| 用户点名保留的路径（本机：`~/workspace/.venv`，703 M，含 oci SDK） | 用户指定 |

前两行 + uv 解释器已写进 `scan.py` 的 `ALWAYS_PROTECTED`，永远不出现在扫描结果里。
用户点名保留的用 `--keep <前缀>` 传入。

## 四、⚠️ 白费力气的坑：`~/.venv-html-to-docx` 会自动重建

这是 WorkBuddy **HTML→docx 流水线**用 uv 按需创建的（`uv` 在 `~/.local/bin/uv`，
特征是同目录出现 `.lock` + `CACHEDIR.TAG`，内含 html4docx / docx / PIL / bs4 / pytest / httpx）。

- **删掉后约 1 分钟内自动重建**（实测：16:14 删掉 → 16:15 重建完成，35 M / 1332 文件）。
- `grep -r "venv-html-to-docx"` 搜不到任何引用，**但这不代表没被使用**——
  引用在技能运行逻辑里，不在可 grep 的文本里。**不要把「grep 无结果」当作可删依据。**
- 结论：**不要删**，删了只是白折腾。同理 `~/.cache/uv` 会随下次 uv 调用重建。

## 五、删除流程

优先用 `clean.py`（移入回收站，可恢复）：

```bash
# 1) 扫描
python3 scripts/scan.py --categories python_junk --out /tmp/py.json
# 2) 把用户逐个确认过的路径写进清单
echo '["/Users/xx/workspace/old-proj/.venv"]' > /tmp/approved.json
# 3) 只删清单内的
python3 scripts/clean.py --manifest /tmp/py.json --categories python_junk \
        --apply --approved /tmp/approved.json
```

回收站通道不可用、必须用 `rm` 时，走：

1. **生成 manifest 备份**（每个 venv 的 `pyvenv.cfg` + `pip freeze` 全量包清单，是唯一能据此重建的凭证）：
   ```bash
   BK=./python-venv-cleanup-manifest-$(date +%Y%m%d).txt
   { echo "# Python 虚拟环境/缓存清理清单  $(date '+%F %T')"
     echo "--- pyvenv.cfg ---"; cat "$V/pyvenv.cfg"
     echo "--- pip freeze ---";   "$V/bin/pip" freeze 2>/dev/null
     echo "--- 文件清单 ---";     du -ah "$V" 2>/dev/null
   } > "$BK"
   ```
2. 加粗警告「⚠️ 此操作非常危险，可能导致不可逆的数据丢失！」+ 列全部绝对路径 + 二次确认。
3. `rm -rf` **只删枚举出的绝对路径**，分批（每批 ≤ 5 项），每批后 `[ -e "$T" ]` 校验。
4. 收尾复核**保留项仍在原体积**，并分开报「实删体积」与「df 变化」
   （实测删 90 M、df 却涨 11 Gi，差额是 purgeable/快照回收，别把功劳算自己头上）。
5. 删完**过几分钟再复核一次**目标是否被自动重建（见第四节），否则会给用户错误的「已清理」结论。

## 六、排除项

`~/workspace/unokb-weknora`（8.6 G，Docker 编排）与 `unokb-dify-weknora-ragflow`
—— 任何全机清理都不得触碰，且要在回复中明确声明保留。
