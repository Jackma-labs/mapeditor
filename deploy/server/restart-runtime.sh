#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
PORT="${PORT:-58000}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/opt/landing/runtime/node/bin}"
SERVICE_NAME="${SERVICE_NAME:-mapeditor.service}"
SERVICE_SCOPE="${SERVICE_SCOPE:-auto}"
LOG_DIR="${LOG_DIR:-}"
PID_FILE="${PID_FILE:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-30}"

log() {
  printf '[mapeditor-runtime] %s\n' "$*"
}

fail() {
  printf '[mapeditor-runtime] ERROR: %s\n' "$*" >&2
  exit 1
}

if [ ! -d "$APP_DIR" ]; then
  fail "APP_DIR does not exist: $APP_DIR"
fi

APP_DIR="$(cd "$APP_DIR" && pwd -P)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend/build/map_editor_frontend"
ENV_FILE="$APP_DIR/.env.server"

if [ ! -f "$BACKEND_DIR/server.js" ]; then
  fail "backend entry is missing: $BACKEND_DIR/server.js"
fi
if [ ! -f "$FRONTEND_DIR/index.html" ]; then
  fail "frontend build is missing: $FRONTEND_DIR/index.html"
fi

if [ -d "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi

command -v node >/dev/null 2>&1 || fail "node is not available"

if [ -z "$LOG_DIR" ]; then
  if [ -d "$(dirname "$APP_DIR")/shared" ]; then
    LOG_DIR="$(dirname "$APP_DIR")/shared"
  else
    LOG_DIR="$APP_DIR/logs"
  fi
fi
mkdir -p "$LOG_DIR"

if [ -z "$PID_FILE" ]; then
  PID_FILE="$LOG_DIR/mapeditor.pid"
fi
LOG_FILE="$LOG_DIR/mapeditor-runtime.log"

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
  export NODE_ENV="${NODE_ENV:-production}"
  export MAP_BACKEND_PORT="$PORT"
}

restart_systemd_user() {
  systemctl --user list-unit-files "$SERVICE_NAME" >/dev/null 2>&1 || return 1
  log "restarting user service: $SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"
}

restart_systemd_system() {
  systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1 || return 1
  log "restarting system service: $SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
}

stop_pid_file_process() {
  if [ ! -f "$PID_FILE" ]; then
    return 0
  fi
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    log "stopping pid from $PID_FILE: $OLD_PID"
    kill "$OLD_PID" || true
    for _ in $(seq 1 10); do
      if ! kill -0 "$OLD_PID" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if kill -0 "$OLD_PID" >/dev/null 2>&1; then
      kill -9 "$OLD_PID" || true
    fi
  fi
}

stop_same_app_processes() {
  PIDS=""
  if command -v pgrep >/dev/null 2>&1; then
    PATTERN="$BACKEND_DIR/server.js"
    PIDS="$(pgrep -f "$PATTERN" 2>/dev/null || true)"
  fi
  for PROC_DIR in /proc/[0-9]*; do
    [ -d "$PROC_DIR" ] || continue
    PID="${PROC_DIR##*/}"
    [ "$PID" != "$$" ] || continue
    CWD="$(readlink "$PROC_DIR/cwd" 2>/dev/null || true)"
    [ "$CWD" = "$BACKEND_DIR" ] || continue
    CMDLINE="$(tr '\0' ' ' <"$PROC_DIR/cmdline" 2>/dev/null || true)"
    case "$CMDLINE" in
      *node*server.js*|*npm*start*)
        PIDS="$PIDS $PID"
        ;;
    esac
  done
  PIDS="$(printf '%s\n' $PIDS 2>/dev/null | sort -u | xargs 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    log "stopping existing backend processes: $PIDS"
    # shellcheck disable=SC2086
    kill $PIDS || true
  fi
}

start_nohup() {
  load_env
  stop_pid_file_process
  stop_same_app_processes
  log "starting backend directly: $BACKEND_DIR/server.js"
  nohup node "$BACKEND_DIR/server.js" >>"$LOG_FILE" 2>&1 &
  echo "$!" >"$PID_FILE"
}

restart_runtime() {
  case "$SERVICE_SCOPE" in
    user)
      restart_systemd_user
      ;;
    system)
      restart_systemd_system
      ;;
    none)
      start_nohup
      ;;
    auto)
      if restart_systemd_user; then
        return 0
      fi
      if restart_systemd_system; then
        return 0
      fi
      start_nohup
      ;;
    *)
      fail "unknown SERVICE_SCOPE: $SERVICE_SCOPE"
      ;;
  esac
}

wait_health() {
  HEALTH_URL="http://127.0.0.1:$PORT/healthz"
  for _ in $(seq 1 "$HEALTH_TIMEOUT_SECONDS"); do
    if HEALTH_RESPONSE="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
      printf '%s\n' "$HEALTH_RESPONSE"
      return 0
    fi
    sleep 1
  done
  fail "health check failed: $HEALTH_URL; log: $LOG_FILE"
}

print_doctor_summary() {
  DOCTOR_URL="http://127.0.0.1:$PORT/runtime/doctor"
  if ! DOCTOR_RESPONSE="$(curl -fsS "$DOCTOR_URL" 2>/dev/null)"; then
    log "doctor endpoint is not available or requires auth: $DOCTOR_URL"
    return 0
  fi
  node -e '
const input = process.argv[1];
const payload = JSON.parse(input);
const data = payload.data || {};
console.log(JSON.stringify({
  frontendCommit: data.frontendCommit || null,
  frontendBuildHash: data.frontendBuildHash || null,
  ready: data.ready === true
}));
' "$DOCTOR_RESPONSE"
}

restart_runtime
wait_health
print_doctor_summary
log "runtime ready: $APP_DIR"
