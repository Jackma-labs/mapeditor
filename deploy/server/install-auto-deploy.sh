#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/mapeditor}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-58000}"
INTERVAL="${INTERVAL:-60s}"
PATH_PREFIX="${PATH_PREFIX:-}"
SERVICE_NAME="${SERVICE_NAME:-mapeditor-auto-deploy}"

log() {
  printf '[mapeditor-auto-deploy] %s\n' "$*"
}

if [ ! -d "$APP_DIR/.git" ]; then
  printf 'APP_DIR must point to an existing Git checkout: %s\n' "$APP_DIR" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
  printf 'systemd user service is unavailable for %s\n' "${USER:-current user}" >&2
  exit 1
fi

SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
TIMER_FILE="$SERVICE_DIR/$SERVICE_NAME.timer"

mkdir -p "$SERVICE_DIR"

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Mapeditor auto deploy from Git

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
Environment=APP_DIR=$APP_DIR
Environment=BRANCH=$BRANCH
Environment=PORT=$PORT
Environment=PATH_PREFIX=$PATH_PREFIX
ExecStart=/usr/bin/env bash $APP_DIR/deploy/server/auto-deploy-pull.sh
SERVICE

cat > "$TIMER_FILE" <<TIMER
[Unit]
Description=Run Mapeditor auto deploy from Git

[Timer]
OnBootSec=2min
OnUnitActiveSec=$INTERVAL
RandomizedDelaySec=15s
Persistent=true
Unit=$SERVICE_NAME.service

[Install]
WantedBy=timers.target
TIMER

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME.timer"

log "installed $SERVICE_NAME.timer"
systemctl --user --no-pager --full list-timers "$SERVICE_NAME.timer" || true

if command -v loginctl >/dev/null 2>&1; then
  LINGER="$(loginctl show-user "$USER" -p Linger 2>/dev/null | cut -d= -f2 || true)"
  if [ "$LINGER" != "yes" ]; then
    log "run once for reboot persistence without login:"
    log "sudo loginctl enable-linger $USER"
  fi
fi
