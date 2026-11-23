# 监控 Docker 构建完成并通知

触发场景：「docker 正在创建镜像 XXX，完成后发消息给我」「等这个 build 跑完告诉我」「盯着 docker 构建」。

## 〇、先纠正一个默认认知

用户说「正在跑 docker 创建镜像 XXX」时，**不要**先去翻代码或试图复现构建。
第一件事是**证明构建是否真的在跑**——用户常把「容器起不来」描述成「正在创建镜像」。
而且「镜像已存在」不代表构建结束，`docker images` 里那条记录可能是**上一次**构建留下的。

## 一、环境前置

`docker` 常不在 PATH；受限会话里 `ps` 会被拒，但 **`pgrep` 可用**：

```bash
export PATH="$HOME/.docker/bin:/usr/local/bin:$PATH"
docker version --format '{{.Server.Version}}'     # 确认 Docker Desktop 起着
/usr/bin/pgrep -fl "compose"                      # ps 的替代品，能拿 pid + 完整命令行
```

## 二、判断「是否有构建正在跑」

```bash
/usr/bin/pgrep -f 'cli-plugins/docker-compose compose build'
```

- 有输出 = 有 `docker compose build` 在跑（一次调用会出现 2~3 个进程：外层 →
  `com.docker.cli` → `cli-plugins/docker-compose`）。
- 副作用信号：`docker events --since 30m --filter type=image` 空输出说明这段时间没有新镜像打标签。
  （macOS 自带没有 `timeout`，用 `(cmd & p=$!; sleep 5; kill $p)` 代替。）

`pgrep -f` 是**全机匹配**，会匹配到别的项目的构建。多项目并行时结合镜像名交叉验证。

## 三、等构建结束：两个完成信号

| 信号 | 含义 | 可靠性 |
|---|---|---|
| `pgrep` 计数归零 | 进程退出（成功/失败/被杀都算） | 主信号 |
| 镜像 `Created` / `Id` 变化 | 构建成功并打了标签 | 早退信号 |

```bash
docker image inspect <img>:latest --format '{{.Id}} {{.Created}}'
```

⚠️ 全缓存构建会**打出新镜像但很快结束**；构建失败时进程退出但镜像 ID 不变 →
靠 `IMAGE_CHANGED` 区分「成功」和「失败/无变化」。

后台 watcher 用 `scripts/docker_watch.sh`（参数化，直接指定镜像名即可）：

```bash
bash scripts/docker_watch.sh <镜像名:tag>          # 日志 -> /tmp/docker_watch/<id>/watch.log
```

核心是每 15s 轮询 + 一次性写 `DONE` 段（`old_id/new_id/IMAGE_CHANGED` + `docker ps -a` + 容器日志尾）。

**运行方式**：用 `run_in_background=true` 起脚本拿 task_id，然后**在同一个 turn 里用 `TaskOutput`
轮询**（timeout 最大 600000ms，可反复调用），这样构建一结束就能立刻自己发通知。
**不要把「发通知」完全交给后台脚本**——MCP 工具（Agent Mail 等）在裸 shell 里调不到。

## 四、通知前必须先问通道（别自己定）

「收件人」和「发信通道」是两个独立问题，要一起跟用户确认：Agent Mail 邮件 / 企业微信消息 /
就在对话里回复。**不要**因为「工具调用成本」替用户选。代发邮件还须事先说明**以谁的名义**发。

## 五、完成后必查（这一步才是真正的价值）

1. **新镜像是否真的生效**：`docker compose ps` 里 IMAGE 列显示 `sha256:xxxx` 而不是 `name:tag`
   → 容器**还引用着旧镜像**，需 `docker compose up -d --force-recreate <svc>`。
2. **源码是不是 bind mount**：compose 里若有 `- ./backend:/code:rw`，则**改源码不需要重建镜像**；
   反之 COPY 进镜像的才需要重建。这条能立刻判断「用户是不是白等了一次构建」。
3. **容器是不是在 crash loop**：
   `docker inspect <c> --format '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}'`
   + `docker logs --tail 60 <c>`。报错行号可直接对宿主机文件行号核对（bind mount 场景下二者一致）。
4. **残留僵死进程**：构建早已结束但 `pgrep` 仍有 `compose build`，是上一轮挂死的残留，提醒用户确认后清理。

## 六、真实案例（教训）

- 用户说「正在创建镜像 unoecp-backend」，实际：镜像 17:07 就建好了，容器在 crash loop
  （`settings/database.py:84` 把 `DATABASES['default']['OPTIONS']` 写成了 `.OPTIONS`），
  用户随后又起了一次 `compose build`。
- 17:38 新镜像构建成功（`0ed42f6bae1e`），但容器 IMAGE 仍是旧 `fcb0ee05be65`
  → **构建成功与「服务能跑」是两件事**，通知里必须分开说。
- 源码是 `./backend:/code` 挂载的 → 真正卡住的是代码 bug，重建镜像解决不了。
