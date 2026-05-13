#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

CONTAINER_NAME="${MAP_RUNTIME_DOCKER_CONTAINER:-map_editor}"
IMAGE="${MAP_RUNTIME_DOCKER_IMAGE:-registry.cn-hangzhou.aliyuncs.com/wheelos/apollo:hdmap-aarch64-20.04-20251212_2123}"
PORT="${MAP_BACKEND_PORT:-58000}"

mkdir -p \
  "${APP_ROOT}/data/log" \
  "${APP_ROOT}/data/core" \
  "${APP_ROOT}/data/bag" \
  "${APP_ROOT}/data/base_map" \
  "${APP_ROOT}/data/editor_map" \
  "${APP_ROOT}/data/released_map"

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

docker run \
  -itd \
  --name "${CONTAINER_NAME}" \
  -e FORWARDED_PORT="${PORT}" \
  -e DISPLAY="${DISPLAY:-:0}" \
  -v "${APP_ROOT}/data:/apollo/data" \
  -v "${APP_ROOT}/config/image_creator_conf.pb.txt:/apollo/external_conf/image_creator_conf.pb.txt" \
  -v "${APP_ROOT}/config/main_extrinsics.yaml:/apollo/modules/drivers/lidar/params/main_extrinsics.yaml" \
  -w /apollo \
  -p "${PORT}:3000" \
  "${IMAGE}" \
  bash

echo "Apollo runtime container started: ${CONTAINER_NAME}"
