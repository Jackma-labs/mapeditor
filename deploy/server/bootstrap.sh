#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:Jackma-labs/mapeditor.git}"
APP_DIR="${APP_DIR:-$HOME/mapeditor}"
PORT="${PORT:-58000}"
BRANCH="${BRANCH:-main}"

log() {
  printf '[mapeditor] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd node
require_cmd npm

if [ ! -d "$APP_DIR/.git" ]; then
  log "cloning $REPO_URL into $APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  log "updating $APP_DIR"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

cd "$APP_DIR"

log "installing backend dependencies"
npm ci --prefix backend

log "installing frontend dependencies"
npm ci --prefix frontend

log "building frontend"
npm run build:frontend

mkdir -p data/bag data/base_map data/editor_map data/released_map runtime/bin logs

SERVICE_TEMPLATE="$APP_DIR/deploy/server/mapeditor.service"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/mapeditor.service"
APP_DIR_ESCAPED="${APP_DIR//\//\\/}"

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  log "installing user systemd service"
  mkdir -p "$SERVICE_DIR"
  sed "s/__APP_DIR__/$APP_DIR_ESCAPED/g; s/__PORT__/$PORT/g" "$SERVICE_TEMPLATE" > "$SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable --now mapeditor.service
  systemctl --user restart mapeditor.service
  log "service status:"
  systemctl --user --no-pager --full status mapeditor.service || true
else
  log "systemd user service is unavailable; starting with nohup fallback"
  PID_FILE="$APP_DIR/logs/mapeditor.pid"
  if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
      kill "$OLD_PID" || true
    fi
  fi
  nohup env NODE_ENV=production MAP_BACKEND_PORT="$PORT" npm start > "$APP_DIR/logs/mapeditor.log" 2>&1 &
  echo "$!" > "$PID_FILE"
  sleep 2
  log "started pid $(cat "$PID_FILE"); logs: $APP_DIR/logs/mapeditor.log"
fi

log "health check"
HEALTH_URL="http://127.0.0.1:$PORT/healthz"
HEALTH_OK=0
for _ in $(seq 1 30); do
  if HEALTH_RESPONSE="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    printf '%s\n' "$HEALTH_RESPONSE"
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [ "$HEALTH_OK" -ne 1 ]; then
  printf 'health check failed: %s\n' "$HEALTH_URL" >&2
  exit 1
fi
log "ready at http://$(hostname -I | awk '{print $1}'):$PORT/"

if command -v ufw >/dev/null 2>&1 && systemctl is-active --quiet ufw 2>/dev/null; then
  if ! sudo -n ufw status >/dev/null 2>&1; then
    log "ufw is active; run this once if LAN access to port $PORT is blocked:"
    log "sudo ufw allow $PORT/tcp"
  fi
fi

if command -v loginctl >/dev/null 2>&1; then
  LINGER="$(loginctl show-user "$USER" -p Linger 2>/dev/null | cut -d= -f2 || true)"
  if [ "$LINGER" != "yes" ]; then
    log "user service is installed; run this once for reboot persistence without login:"
    log "sudo loginctl enable-linger $USER"
  fi
fi
