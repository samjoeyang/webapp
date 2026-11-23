# Docker Desktop（macOS）卡死诊断与恢复

适用信号（命中任一即读下去）：
- `docker run` / `docker start` **挂住不返回**（几十秒到十几分钟无输出）
- `docker compose up -d` **打印了一堆 `Created` / `Starting`，但 `docker ps -a` 里什么都没变**
- 重启 Docker Desktop 后 `docker version` 仍报 `Cannot connect to the Docker daemon`
- `open -a Docker` 返回 0 但没有任何 Docker 进程起来

核心判断：**「API 能查」≠「引擎能用」**。Docker Desktop 会出现元数据 API 完全正常、
但容器生命周期操作全部挂起的中间态。

## 一、先分清是「创建」卡还是「启动」卡

```bash
docker create --name probe-test busybox:1.36 true   # 期待 <1s 返回容器 ID
docker run --rm busybox:1.36 sh -c 'echo OK'        # 卡住 = 卡在 runc 起进程
```

| create | run | 结论 |
|---|---|---|
| ✓ | ✗ | 卡在容器生命周期（runc/containerd），**必须重启 Docker Desktop** |
| ✗ | ✗ | daemon 本身有问题，先看日志（见第四节） |

**用本地已有镜像测**，别用需要 pull 的（否则先卡在拉镜像，结论无效）。先 `docker images` 挑一个在的。

## 二、别信 compose 的输出（重要）

```
 Container weknora-redis  Created
 Container weknora-db     Starting
```

**这不代表真的建了容器。** 实测过：compose 打印完全套 `Created`/`Starting`，
而 `docker ps -a` 里同名容器的 `CreatedAt` 还是几十小时前——一个都没重建。

以这些为准：

```bash
docker inspect <name> --format '{{.Created}} | {{.State.Status}}'
docker ps -a --format '{{.Names}}\t{{.CreatedAt}}'
# 验证 ps 视图是否实时（防止误判成缓存）：
docker create --name t busybox:1.36 true && docker rm -f t && docker ps -a | grep t
```

先排除两个常见嫌疑（都不是根因，但值得花 1 分钟）：

```bash
pgrep -fl "cli-plugins/docker-compose compose"   # 遗留僵死 build/up 进程
df -h /System/Volumes/Data                        # 宿主磁盘
ls -lh ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw   # 稀疏文件大小 ≠ 占用
```

## 三、恢复：重启 Docker Desktop 的正确姿势

### 坑 1：`osascript quit` 通常无效

```bash
osascript -e 'quit app "Docker"'   # 卡在中间态时经常不生效，别等
```

### 坑 2（最容易漏）：`Docker --autostart` 杀不干净

真正占着 launchd 实例记录的是**登录项启动器**：

```
/Applications/Docker.app/Contents/MacOS/Docker --autostart
```

它的**进程名里没有 "Docker Desktop"**，所以 `pkill -f "Docker Desktop"` 完全杀不到它。后果很隐蔽：

- `open -a Docker` 静默变空操作（exit 0，但什么都不起）
- 即使 `com.docker.backend` 起来了，**1 分钟内也会自己关掉**，日志里是：
  ```
  leading to shutdown: 1 error occurred: * context canceled
  supervisor stopped: context done
  ```

**完整清杀**：

```bash
pkill -9 -f "com.docker.backend"
pkill -9 -f "com.docker.virtualization"
pkill -9 -f "com.docker.build"
pkill -9 -f "com.docker.dev-envs"
pkill -9 -f "com.docker.extensions"
pkill -9 -f "com.docker.helper"
pkill -9 -f "Docker Desktop"
pkill -9 -f "/Applications/Docker.app/Contents/MacOS/Docker"
pkill -9 -x Docker            # ← 漏网之鱼：精确匹配进程名 "Docker"
sleep 4
pgrep -fl "docker|Docker" | grep -v vscode   # 确认只剩无关进程
```

### 拉起：必须用 `open -n`

```bash
open -n -a Docker             # -n = 强制新实例，绕开 stale 的 launchd 记录
```

### 判就绪：用 `docker version`，**不要**看 GUI 进程

反直觉但已实测：`open -n` 之后 GUI 主进程（`Docker Desktop.app/Contents/MacOS/Docker Desktop`）
**可能根本不存在**，但 `com.docker.backend` 已起来、引擎照样可用。

```bash
to() { perl -e 'alarm shift; exec @ARGV' "$@"; }   # macOS 没有 timeout，用 perl 模拟
for i in $(seq 1 30); do
  sleep 5
  to 8 docker version --format '{{.Server.Version}}' >/tmp/_dv 2>/dev/null && {
    echo "就绪: $(cat /tmp/_dv)"; break; }
done
```

⚠️ 一条挂住的 `docker info` 会冻住整个脚本，探测必须包 `to()`。

## 四、还起不来：看日志

```bash
tail -30 ~/Library/Containers/com.docker.docker/Data/log/host/com.docker.backend.log | cut -c1-190
```

`proxy >> / proxy <<` 行显示 CLI 请求进出，可确认 daemon 是「活的」还是「只剩壳」。特征串：

- `context canceled` + `supervisor stopped: context done` → 启动器残留（第三节）
- `dial unix procd.sock: connect: no such file or directory` → 后端组件没起全，同属重启不干净

## 五、恢复后必做

1. **冒烟**：`docker run --rm busybox:1.36 sh -c 'echo OK'` 必须秒回。
2. **注意 profile**：很多 compose 项目把重型服务放在 profile 里（如 `--profile ollama`），
   而 `.env` 里的 URL 可能指向 profile 中的服务。**`docker compose up -d` 只起不带 profile 的核心服务**，
   会漏掉它们导致功能静默降级。启动前对一遍：
   ```bash
   docker compose config --services              # 不带 profile
   docker compose --profile X config --services   # 带上后
   grep -nE "_(URL|HOST)=" .env                  # 谁被依赖
   ```
3. **网关/反代要刷上游缓存**：nginx/angie 的 `proxy_pass` 若写静态服务名，容器重建后 IP 变了、
   反代还缓存旧 IP → 所有 API 路径 502（首页却正常，极易误判）。
   立刻 reload：`docker compose exec <gw> angie -s reload`（nginx 同理）。
   注意 `make up` 里那次自动 reload **可能在网关起完前就跑了**，打印「跳过」不代表刷过。
4. **数据卷体检**（尤其被 gRPC-FUSE 折腾过的项目）：
   ```bash
   docker run --rm -v <volume>:/v busybox:1.36 du -sh /v
   ```

## 六、一句话总结

> 卡在启动容器 → 杀干净**所有** Docker 进程（别忘了 `-x Docker`）→ `open -n -a Docker`
> → 用 `docker version` 等就绪 → 补齐 profile 服务 → 手动 reload 网关。
