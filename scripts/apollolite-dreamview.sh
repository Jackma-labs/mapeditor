#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
CONTAINER="${MAP_APOLLOLITE_CONTAINER:-apollo_dev_dell_c7dbb59e}"
CONTAINER_USER="${MAP_APOLLOLITE_CONTAINER_USER:-1000}"
APOLLO_ROOT="${MAP_APOLLOLITE_ROOT_IN_CONTAINER:-/apollo}"
LOG_DIR="${MAP_APOLLOLITE_DREAMVIEW_LOG_DIR:-/apollo/data/log/mapeditor_dreamview}"

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER}"
}

container_running() {
  docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -qx true
}

wait_for_container() {
  local attempt
  for attempt in $(seq 1 30); do
    if container_running; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_container() {
  if ! container_exists; then
    echo "ApolloLite container is missing: ${CONTAINER}" >&2
    return 1
  fi
  if ! container_running; then
    docker start "${CONTAINER}" >/dev/null
  fi
  wait_for_container
}

run_dreamview() {
  local command="$1"
  docker exec -u "${CONTAINER_USER}" "${CONTAINER}" bash -lc \
    "cd '${APOLLO_ROOT}' && mkdir -p '${LOG_DIR}' && ./scripts/dreamview.sh ${command}"
}

case "${ACTION}" in
  start)
    start_container
    set +e
    output="$(run_dreamview start 2>&1)"
    rc=$?
    set -e
    printf '%s\n' "${output}"
    # Apollo's start script returns 2 when the module is already running.
    if [ "${rc}" -eq 0 ] || [ "${rc}" -eq 2 ]; then
      exit 0
    fi
    exit "${rc}"
    ;;
  stop)
    if container_running; then
      run_dreamview stop || true
    fi
    ;;
  status)
    if ! container_running; then
      echo "container stopped"
      exit 3
    fi
    docker exec "${CONTAINER}" bash -lc \
      "ps -e -o pid,cmd | grep -E 'dreamview|cyber_launch' | grep -v grep || true"
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
