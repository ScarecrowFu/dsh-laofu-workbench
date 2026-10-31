#!/bin/sh
# Replace the running Laofu Workbench bundle with a verified release.
#
# The workbench spawns this script detached and then quits, so nothing here may
# assume the old app is still alive. Everything it needs arrives through the
# environment, because a path is the one argument that cannot be trusted to
# survive a shell: `LWB_UPDATE_TARGET`, `LWB_UPDATE_ARTIFACT`,
# `LWB_UPDATE_VERSION`, `LWB_UPDATE_LOG`, `LWB_UPDATE_RESULT`,
# `LWB_UPDATE_WAIT_PID`, `LWB_UPDATE_HOST_PID`.
#
# The replacement is a directory rename on both sides of the swap. A rename
# inside one volume is atomic, so the app is either the old bundle or the new
# one and never a half-copied tree. The old bundle is kept until the new one is
# in place and relaunched, and is moved back if any step fails.
set -u

TARGET="${LWB_UPDATE_TARGET:-}"
ARTIFACT="${LWB_UPDATE_ARTIFACT:-}"
VERSION="${LWB_UPDATE_VERSION:-unknown}"
LOG="${LWB_UPDATE_LOG:-/dev/null}"
RESULT="${LWB_UPDATE_RESULT:-}"
WAIT_PID="${LWB_UPDATE_WAIT_PID:-0}"
HOST_PID="${LWB_UPDATE_HOST_PID:-0}"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG" 2>/dev/null || true
}

# The workbench reads this file on its next start; a missing file means the
# script never finished, which is reported as an interrupted update.
report() {
  if [ -n "$RESULT" ]; then
    printf '%s\n' "$1" >"$RESULT" 2>/dev/null || true
  fi
}

fail() {
  log "FAILED: $*"
  report "fail $*"
  exit 1
}

cleanup_stage() {
  if [ -n "${STAGE:-}" ] && [ -d "$STAGE" ]; then
    rm -rf "$STAGE" 2>/dev/null || true
  fi
}

trap cleanup_stage EXIT HUP INT TERM

[ -n "$TARGET" ] || fail "未指定要替换的应用路径。"
[ -n "$ARTIFACT" ] || fail "未指定更新包路径。"
[ -f "$ARTIFACT" ] || fail "更新包已不存在：$ARTIFACT"
[ -d "$TARGET" ] || fail "当前应用不在预期位置：$TARGET"

log "applying $VERSION to $TARGET"

# Stop the workbench. SIGTERM first so Electron can close its windows and flush
# state, then SIGKILL, because a hung renderer must not keep the bundle locked
# forever — the user has already agreed to restart.
stop_process() {
  pid="$1"
  [ "$pid" -gt 1 ] 2>/dev/null || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  ticks=0
  while kill -0 "$pid" 2>/dev/null; do
    ticks=$((ticks + 1))
    if [ "$ticks" -eq 2 ]; then kill -TERM "$pid" 2>/dev/null || true; fi
    if [ "$ticks" -eq 8 ]; then kill -KILL "$pid" 2>/dev/null || true; fi
    if [ "$ticks" -ge 24 ]; then
      log "process $pid did not exit; continuing anyway"
      break
    fi
    sleep 0.5
  done
}

stop_process "$WAIT_PID"
[ "$HOST_PID" = "$WAIT_PID" ] || stop_process "$HOST_PID"

# Stage beside the target, never in /tmp: the final rename has to stay inside
# one volume to remain atomic.
STAGE_PARENT="$(dirname "$TARGET")"
STAGE="$(mktemp -d "$STAGE_PARENT/.lwb-update.XXXXXX" 2>/dev/null)" ||
  fail "无法在 $STAGE_PARENT 中创建临时目录，请确认该目录可写。"

log "extracting into $STAGE"
ditto -x -k "$ARTIFACT" "$STAGE" >>"$LOG" 2>&1 ||
  fail "解压更新包失败。"

NEW_APP="$(find "$STAGE" -maxdepth 2 -name '*.app' -type d -print -quit 2>/dev/null || true)"
[ -n "$NEW_APP" ] || fail "更新包中没有找到 .app 应用包。"

BACKUP="${TARGET}.lwb-old"
if [ -e "$BACKUP" ]; then
  rm -rf "$BACKUP" 2>/dev/null || fail "无法清理上一次遗留的备份：$BACKUP"
fi

log "moving $TARGET aside"
mv "$TARGET" "$BACKUP" || fail "无法移动旧版本，请确认 $STAGE_PARENT 可写。"

if ! mv "$NEW_APP" "$TARGET"; then
  log "installing the new bundle failed; restoring"
  mv "$BACKUP" "$TARGET" 2>/dev/null || log "restore failed; the old bundle is at $BACKUP"
  fail "替换新版本失败，已尝试恢复旧版本。"
fi

# A browser-downloaded artifact carries the quarantine flag; an update that
# cannot start is worse than one that asks for confirmation, so clear it.
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" >>"$LOG" 2>&1 || true

log "relaunching $TARGET"
if ! /usr/bin/open "$TARGET" >>"$LOG" 2>&1; then
  log "relaunch failed; the new bundle is installed at $TARGET"
fi

rm -rf "$BACKUP" 2>/dev/null || true
report "ok $VERSION"
log "done"
exit 0
