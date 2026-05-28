#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/landing/apps/mapeditor}"
BRANCH="${BRANCH:-main}"
COMMIT_SHA="${COMMIT_SHA:-}"
FRONTEND_TARBALL="${FRONTEND_TARBALL:-}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/opt/landing/runtime/node/bin}"
SERVICE_NAME="${SERVICE_NAME:-landing-mapeditor.service}"
PORT="${PORT:-58000}"

if [ -z "$FRONTEND_TARBALL" ]; then
  printf 'FRONTEND_TARBALL is required\n' >&2
  exit 1
fi
if [ ! -f "$FRONTEND_TARBALL" ]; then
  printf 'frontend tarball not found: %s\n' "$FRONTEND_TARBALL" >&2
  exit 1
fi

export PATH="$NODE_BIN_DIR:$PATH"

log() {
  printf '[mapeditor-cloud-deploy] %s\n' "$*"
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
require_cmd tar
require_cmd systemctl
require_cmd curl

CURRENT="$APP_ROOT/current"
if [ ! -e "$CURRENT" ]; then
  printf 'current release is missing: %s\n' "$CURRENT" >&2
  exit 1
fi

SOURCE_DIR="$(readlink -f "$CURRENT")"
if [ ! -d "$SOURCE_DIR/.git" ]; then
  printf 'current release is not a Git checkout: %s\n' "$SOURCE_DIR" >&2
  exit 1
fi

SHORT_SHA="${COMMIT_SHA:0:7}"
if [ -z "$SHORT_SHA" ]; then
  SHORT_SHA="$(git -C "$SOURCE_DIR" rev-parse --short HEAD)"
fi
RELEASE_DIR="$APP_ROOT/releases/$(date +%Y%m%d%H%M%S)-$SHORT_SHA-main"

log "creating release $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
cp -a "$SOURCE_DIR/." "$RELEASE_DIR/"

OLD_BACKEND_LOCK=""
if [ -f "$SOURCE_DIR/backend/package-lock.json" ]; then
  OLD_BACKEND_LOCK="$(sha256sum "$SOURCE_DIR/backend/package-lock.json" | awk '{print $1}')"
fi

cd "$RELEASE_DIR"
git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_REF="refs/remotes/origin/$BRANCH"
if [ -n "$COMMIT_SHA" ]; then
  TARGET_REF="$COMMIT_SHA"
fi
git checkout -B "$BRANCH" "$TARGET_REF"

NEW_BACKEND_LOCK=""
if [ -f backend/package-lock.json ]; then
  NEW_BACKEND_LOCK="$(sha256sum backend/package-lock.json | awk '{print $1}')"
fi
if [ ! -d backend/node_modules ] || [ "$OLD_BACKEND_LOCK" != "$NEW_BACKEND_LOCK" ]; then
  log "installing backend dependencies"
  npm ci --prefix backend --omit=dev
else
  log "reusing backend dependencies"
fi

log "installing frontend build artifact"
rm -rf frontend/build/map_editor_frontend
mkdir -p frontend/build
tar -xzf "$FRONTEND_TARBALL" -C frontend/build
test -f frontend/build/map_editor_frontend/index.html

log "switching current release"
ln -sfnT "$RELEASE_DIR" "$CURRENT"
systemctl restart "$SERVICE_NAME"

HEALTH_URL="http://127.0.0.1:$PORT/healthz"
for _ in $(seq 1 30); do
  if HEALTH_RESPONSE="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    printf '%s\n' "$HEALTH_RESPONSE"
    log "deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

printf 'health check failed: %s\n' "$HEALTH_URL" >&2
exit 1
