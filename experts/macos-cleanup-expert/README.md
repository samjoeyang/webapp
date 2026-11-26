# macOS 清理与开发环境管家

一个帮 Mac 用户和开发者「腾空间、看状态、做交付前安全核查」的专家：先只读取证，把风险讲清楚，逐项确认后才动手，默认移入回收站可恢复。

## 类型

Agent 型（单个 AI 专家）

## 功能

内置技能 `macos-system-cleaner` v2.2.0，覆盖三类事：

**① 清空间（36 个类目，跨 macOS 版本适配）**

- 用户级：用户缓存与日志、废纸篓、下载目录安装包、邮件垃圾（Mail `Vx` 目录）、Xcode 派生数据与 iOS 备份、容器与浏览器缓存、Homebrew、字体缓存、应用支持目录缓存、大文件与旧文件
- 开发环境：npm（`_cacache` / `_npx` / `node_modules`）、Python 虚拟环境与 pip/uv 缓存、Rust / Ruby / Maven / Gradle / NuGet、Docker 构建缓存 · 未使用镜像 · 已停止容器、AI 模型缓存（HuggingFace / Ollama / LM Studio）、iOS 模拟器
- 系统级（需 `--include-system` + sudo）：系统缓存与日志、`/private/tmp`、系统诊断数据、休眠镜像、外接卷废纸篓
- Time Machine 本地快照：只打印 `sudo tmutil deletelocalsnapshots` 命令，**永不代跑**

**② 看状态**：CPU 负载、内存压力与占用 TOP、网络接口与连通性、磁盘容量与 SMART（`--json` 可机读）

**③ 交付前安全**：首次 `git push` 前的凭据体检（退出码 1 = 有阻断项）、删除本地项目目录前的风险分级、Docker 构建完成监控、Docker Desktop 卡死恢复

**安全设计（这是它和普通清理脚本的区别）**

- `scan.py` 纯只读；`clean.py` 默认 dry-run，`--apply` 才动手
- 默认移入回收站（`~/.Trash` / `/.Trashes/<uid>`），仅 `--purge` 才永久删除
- 逐项确认类目（npm / Python / Docker / 快照 / 模型 / 模拟器）未拿到 `--approved` 清单时**直接拒绝删除**
- 每次清理写 `cleanup_log.json`，可追溯删了什么、去了哪
- 平台：macOS 12.7.6+，`python3` 系统自带即可，零第三方依赖

## 使用示例

- 先扫一遍我的 Mac，看看哪些垃圾能清、各占多大，别动手
- 把 npm、Python 虚拟环境和 Docker 缓存清一下，每删一个目录先问我
- 看下本机 CPU、内存、硬盘和网络状况
- Mac 空间不够了，Xcode 和 iOS 备份占了快 40G，能清哪些
- Docker 占了 60G，构建缓存和没用的镜像都回收掉
- 我要把这个项目推到 GitHub，先帮我查有没有泄露密钥

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 安装

将专家包目录放到专家目录下：

```
/Users/samjoeyang/.workbuddy/plugins/marketplaces/my-experts/plugins/macos-cleanup-expert/
```

然后运行注册命令使其可见：

```bash
python3 scripts/register_expert.py <expert-dir>
```

## 打包分享

```bash
python3 scripts/package_expert.py <expert-dir> <output-dir>
```

> 包内含中文文件名，必须用 `package_expert.py` 或 Python `zipfile` 打包（会写入 UTF-8 标记位），
> 不要用系统 `zip`，否则 Windows 解压会乱码。
