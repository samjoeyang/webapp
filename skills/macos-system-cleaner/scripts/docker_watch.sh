#!/bin/bash
# 监控 docker compose build 是否结束（参数化版）
#
# 用法：
#   bash docker_watch.sh <镜像名:tag> [匹配的进程名片段] [超时秒数]
# 例：
#   bash docker_watch.sh unoecp-backend:latest
#   bash docker_watch.sh myapp:dev 'cli-plugins/docker-compose compose build' 1800
#
# 设计要点（都是踩过的坑）：
#   - docker 不在 PATH：显式补 ~/.docker/bin 与 /usr/local/bin
#   - 受限会话里 ps 被拒，但 pgrep 可用 → 用它判断构建进程是否还活着
#   - 「镜像存在」不等于「构建结束」：必须比对 Created/Id 是否变化
#   - 结束信号有两个：进程归零（成功/失败/被杀）与镜像 ID 变化（成功打标）
#   - 通知不要交给本脚本发：MCP 工具在裸 shell 里调不到，由 agent 轮询 TaskOutput 后自己发

set -u
export PATH="$HOME/.docker/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

IMG="${1:-}"
PAT="${2:-docker-compose compose build}"
MAX_WAIT="${3:-3600}"

if [ -z "$IMG" ]; then
  echo "用法: bash docker_watch.sh <镜像名:tag> [进程匹配片段] [超时秒数]" >&2
  exit 2
fi

SAFE=$(printf '%s' "$IMG" | tr '/:' '__')
OUTDIR="/tmp/docker_watch"
mkdir -p "$OUTDIR"
LOG="$OUTDIR/${SAFE}.log"

ts() { date '+%F %T'; }

old_id=$(docker image inspect "$IMG" --format '{{.Id}}' 2>/dev/null)
old_created=$(docker image inspect "$IMG" --format '{{.Created}}' 2>/dev/null)
echo "[$(ts)] START img=$IMG old_id=${old_id:-<none>} old_created=${old_created:-<none>}" >> "$LOG"

start=$(date +%s)
reason=""
while :; do
  n=$(/usr/bin/pgrep -f "$PAT" 2>/dev/null | wc -l | tr -d ' ')
  cur_created=$(docker image inspect "$IMG" --format '{{.Created}}' 2>/dev/null)
  if [ "$n" -eq 0 ]; then
    reason="processes_gone"
    echo "[$(ts)] build 进程已全部退出 (pids=0)" >> "$LOG"
    break
  fi
  if [ -n "$cur_created" ] && [ "$cur_created" != "$old_created" ]; then
    reason="image_updated"
    echo "[$(ts)] 镜像时间戳已更新 -> $cur_created" >> "$LOG"
    sleep 5
    break
  fi
  if [ $(( $(date +%s) - start )) -gt "$MAX_WAIT" ]; then
    reason="timeout_${MAX_WAIT}s"
    echo "[$(ts)] 超时未结束 (pids=$n)" >> "$LOG"
    break
  fi
  echo "[$(ts)] building... pids=$n" >> "$LOG"
  sleep 15
done

sleep 8
new_id=$(docker image inspect "$IMG" --format '{{.Id}}' 2>/dev/null)
new_created=$(docker image inspect "$IMG" --format '{{.Created}}' 2>/dev/null)
{
  echo "[$(ts)] ===DONE=== reason=$reason"
  echo "img=$IMG"
  echo "old_id=${old_id:-<none>}"
  echo "new_id=${new_id:-<none>}"
  echo "new_created=${new_created:-<none>}"
  if [ -n "$new_id" ] && [ "$new_id" != "$old_id" ]; then
    echo "IMAGE_CHANGED=yes"
  else
    echo "IMAGE_CHANGED=no(镜像 ID 未变，可能是全缓存构建或构建失败)"
  fi
  echo "--- containers ---"
  docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' 2>&1
  echo "--- recent container logs ---"
  for c in $(docker ps -aq --filter "ancestor=$IMG" 2>/dev/null | head -3); do
    echo "## $c"
    docker logs --tail 25 "$c" 2>&1 | tail -25
  done
} >> "$LOG" 2>&1

changed="no"
[ -n "$new_id" ] && [ "$new_id" != "$old_id" ] && changed="yes"
echo "WATCHER_FINISHED reason=$reason image_changed=$changed log=$LOG"
