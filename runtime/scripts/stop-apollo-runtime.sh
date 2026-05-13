#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${MAP_RUNTIME_DOCKER_CONTAINER:-map_editor}"
docker rm -f "${CONTAINER_NAME}"
echo "Apollo runtime container stopped: ${CONTAINER_NAME}"
