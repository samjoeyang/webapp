# 开发缓存清理政策：官方口径与规则覆盖核对

> 核对日期：2026-11-25。来源均为厂商官方文档/官方 wiki，检索时间即核对时间。
> 结论先行：**主流包管理器的缓存普遍自带自动清理或官方 purge 命令，不该用通用路径删除去抢它们的活。**
> 本文件记录"哪些交给工具自己清、哪些本 skill 接管"，供 `rules/*.json` 增删类目时照此判断。

## 一、官方口径核实表

| 工具 | 默认缓存路径（macOS） | 官方清理机制 | 本 skill 处理 |
|---|---|---|---|
| Gradle | `~/.gradle`（caches/daemon/jdks/wrapper） | 官方明确"自动清理"：daemon 停止时后台跑，默认 24h 一次；release 30 天、snapshot 7 天、下载资源 30 天、自建资源 7 天、daemon 日志 14 天；`caches`/`daemon`/`jdks`/`wrapper/dists` 带 `CACHEDIR.TAG` | `misc_pkg_cache` 已含 `~/.gradle/caches`；**不新增路径删除**。`~/.gradle/wrapper` 在 `always_protected` |
| pip | `~/Library/Caches/pip`（23.3+ 内 `http-v2`；26.2+ 尊重 `XDG_CACHE_HOME`） | `pip cache purge` 清全部；`pip cache remove <pkg>` 精确移除；官方警告"不要禁用缓存，会显著变慢" | `python_junk` 已含 `~/Library/Caches/pip` 与 `~/.cache/pip`；**交给 `pip cache purge` 更稳** |
| npm | `~/.npm/_cacache`（Posix 默认 `~/.npm`） | 官方称缓存 self-healing、integrity 全程校验；`npm cache verify` GC 无用数据；`npm cache clean --force` 仅在回收空间时需要。缓存只增不减，但官方不建议常规清 | `npm_junk` 已含 `~/.npm`；**不单独拆 `_cacache`** |
| Go | `$GOPATH/pkg/mod`（模块下载）、`$GOPATH/pkg/sumdb`（校验和）；GOPATH 默认 `$HOME/go` | `go clean -modcache` 清整个模块下载缓存；`$GOPATH/bin` 是 `go install` 产物、`$GOPATH/src` 是源码，**均不在清理范围** | **缺口**：新增 `go_junk` 接管 `~/go/pkg/mod` + `~/go/pkg/sumdb`，caution + 逐项确认；`bin`/`src` 永不列入 |
| Maven | `~/.m2/repository` | 无官方 purge 命令；删除后重新下载 | `misc_pkg_cache` 已含 |
| Composer | `~/.composer/cache`、`~/.cache/composer`、`~/Library/Caches/composer` | `composer clearcache` | `php_junk` 已含 |
| ccache / sccache | `~/.cache/{ccache,sccache}`、`~/.ccache`、`~/Library/Caches/ccache` | 工具自带容量上限与清理 | `cpp_junk` 已含，xdg_cache 已排除避免重复 |
| Homebrew | `~/Library/Caches/Homebrew`、prefix 下 `var/cache/homebrew` | `brew cleanup` | `homebrew_cache` 已含 |
| Cargo | `~/.cargo/{registry,git}`、`~/.rustup/{downloads,tmp}` | 缓存可重建；`~/.rustup/toolchains` 是工具链本体不可动 | `rust_cache` 已含，toolchains 在 `always_protected` |

## 二、来源（核对于 2026-11-25）

- Gradle — *Gradle-managed Directories and Caches*（官方文档，当前版）：<https://docs.gradle.org/current/userguide/directory_layout.html>
  > "Gradle automatically cleans its caches in both the Gradle User Home and the project directory."
  > "By default, the cleanup runs in the background when the Gradle daemon is stopped or shut down."
- pip — *Caching*, pip documentation v26.3：<https://pip.pypa.io/en/stable/topics/caching/>
  > MacOS: `~/Library/Caches/pip` ｜ "Changed in version 26.2: Pip will also respect `XDG_CACHE_HOME` on macOS."
  > "`pip cache purge` will clear all files from pip's wheel and HTTP caches."
- npm — *npm-cache*, npm Docs v11.21.3：<https://docs.npmjs.com/cli/v11/commands/npm-cache>
  > "npm stores cache data in an opaque directory within the configured `cache`, named `_cacache`."
  > "npm's cache is self-healing and resistant to data corruption issues."
- Go — *Go Wiki: GOPATH*：<https://go.dev/wiki/GOPATH>
  > "The `go get` command caches downloaded modules in `$GOMODCACHE`, which defaults to `$GOPATH/pkg/mod`."
  > "The `go get` command caches downloaded checksum database state in `$GOPATH/pkg/sumdb`."
  > "The GOPATH variable ... defaults to `$HOME/go` on Unix."

## 三、对 CleanMyMac 公开资料的核对结论

- 官方 *Safety Database* 支持页（更新 2024-10-16；benchmark 文档记录另一入口 2026-10-26）只描述规则库的**用途与安全原则**（忽略系统路径、App 特例、进程退出后清理、卸载器残留定位），**不公开任何具体路径清单**。
- 因此"从公开资料补全 MacPaw 规则明细"这条路走不通：能核实的只有各工具官方缓存位置，而这些大多已被本 skill 覆盖。
- 网上检索未发现公开的 CleanMyMac 加密规则库（`info.cmmkb`）解密工具、教程或泄露密钥；相关破解讨论均为许可证校验绕过，与规则库无关。
- 决策：维持明文 `rules/*.json` + SHA-256 校验路线，**不提取、不分发商业密钥与解密规则库**。

## 四、新增/修改类目的判定清单

写入新类目前逐条过：

1. **是否已覆盖**？先 grep `rules/*.json` 的 roots/desc，避免重复计费（例：ccache 同时在 `cpp_junk` 与 `xdg_cache` exclude 中，属预期）。
2. **工具是否自带清理**？有官方 purge/cleanup 的，优先在 desc 里写明命令，不拆出独立路径删除类目。
3. **是否含本体/配置**？只收缓存/日志/下载件；可执行文件、工具链、源码、全局仓库、模型权重（另归 `ai_model_cache`）一律排除。
4. **离线成本**？模块/模型缓存删后需联网重下 → `caution` + `per_item_confirm=True`；纯临时缓存 → `safe`。
5. **同步四副本**：源 → 安装副本 → 门户副本 → zip，并重算 `rules/manifest.json` 的 SHA-256。
