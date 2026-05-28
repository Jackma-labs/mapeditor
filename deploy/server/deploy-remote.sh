#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-}"
APP_DIR="${APP_DIR:-}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-58000}"
REPO_URL="${REPO_URL:-git@github.com:Jackma-labs/mapeditor.git}"

if [ -z "$HOST" ]; then
  printf 'HOST is required, for example: HOST=dell@192.168.110.18 BRANCH=main bash deploy/server/deploy-remote.sh\n' >&2
  exit 1
fi

ssh "$HOST" \
  "REPO_URL='$REPO_URL' APP_DIR='$APP_DIR' BRANCH='$BRANCH' PORT='$PORT' bash -s" <<'REMOTE'
set -euo pipefail

if [ -z "$APP_DIR" ]; then
  APP_DIR="$HOME/mapeditor"
fi

if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
bash deploy/server/bootstrap.sh
REMOTE
