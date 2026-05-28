#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/mapeditor}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-58000}"
PATH_PREFIX="${PATH_PREFIX:-}"
LOCK_FILE="${LOCK_FILE:-/tmp/mapeditor-auto-deploy-${USER:-user}.lock}"

if [ -n "$PATH_PREFIX" ]; then
  export PATH="$PATH_PREFIX:$PATH"
fi

log() {
  printf '[mapeditor-auto-deploy] %s\n' "$*"
}

if ! command -v git >/dev/null 2>&1; then
  log "git is not available"
  exit 1
fi

exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    log "another deploy is running"
    exit 0
  fi
fi

if [ ! -d "$APP_DIR/.git" ]; then
  log "missing Git checkout: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "tracked files are dirty; refusing to deploy automatically"
  git status --short
  exit 2
fi

git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "refs/remotes/origin/$BRANCH")"

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  log "already up to date: $BRANCH@$LOCAL_HEAD"
  exit 0
fi

log "deploying $BRANCH: $LOCAL_HEAD -> $REMOTE_HEAD"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

APP_DIR="$APP_DIR" BRANCH="$BRANCH" PORT="$PORT" bash deploy/server/bootstrap.sh
log "deployed $BRANCH@$REMOTE_HEAD"
