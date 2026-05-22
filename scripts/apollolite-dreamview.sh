#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
CONTAINER="${MAP_APOLLOLITE_CONTAINER:-apollo_dev_dell_c7dbb59e}"
CONTAINER_USER="${MAP_APOLLOLITE_CONTAINER_USER:-1000}"
APOLLO_ROOT="${MAP_APOLLOLITE_ROOT_IN_CONTAINER:-/apollo}"
LOG_DIR="${MAP_APOLLOLITE_DREAMVIEW_LOG_DIR:-/apollo/data/log/mapeditor_dreamview}"
CONTAINER_HOME="${MAP_APOLLOLITE_CONTAINER_HOME:-/home/dell}"
DREAMVIEW_CONF="${MAP_APOLLOLITE_DREAMVIEW_CONF:-/apollo/modules/dreamview/conf/dreamview.conf}"
DREAMVIEW_SPAWN_MODE="${MAP_APOLLOLITE_SIM_CONTROL_SPAWN_MODE:-legacy}"
DREAMVIEW_PORT="${MAP_APOLLOLITE_DREAMVIEW_PORT:-8888}"
DREAMVIEW_BIN="${MAP_APOLLOLITE_DREAMVIEW_BIN:-${APOLLO_ROOT}/bazel-bin/modules/dreamview/dreamview}"
DREAMVIEW_STATIC_DIR="${MAP_APOLLOLITE_DREAMVIEW_STATIC_DIR:-${APOLLO_ROOT}/modules/dreamview/frontend/dist}"

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER}"
}

container_running() {
  docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -qx true
}

wait_for_docker() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
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
  if ! wait_for_docker; then
    echo "Docker daemon is not ready" >&2
    return 1
  fi
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
  case "${command}" in
    start)
      docker exec -u "${CONTAINER_USER}" "${CONTAINER}" bash -lc \
        "export HOME='${CONTAINER_HOME}' USER=dell LOGNAME=dell XDG_CONFIG_HOME='${CONTAINER_HOME}/.config'; cd '${APOLLO_ROOT}'; source '${APOLLO_ROOT}/scripts/apollo_base.sh' >/dev/null 2>&1 || true; mkdir -p '${LOG_DIR}' \"\${HOME}/.apollo/dreamview/plugins\"; if [ ! -d '${DREAMVIEW_STATIC_DIR}' ]; then asset_dir=\$(find '${APOLLO_ROOT}/.cache' -path '*dreamview_frontend_assets*/dist' -type d 2>/dev/null | head -n 1); if [ -n \"\${asset_dir}\" ]; then mkdir -p \"\$(dirname '${DREAMVIEW_STATIC_DIR}')\"; ln -snf \"\${asset_dir}\" '${DREAMVIEW_STATIC_DIR}'; fi; fi; pkill -f '[d]reamview/launch/dreamview.launch' || true; pkill -x dreamview || true; sleep 1; nohup '${DREAMVIEW_BIN}' --flagfile='${DREAMVIEW_CONF}' --server_ports='${DREAMVIEW_PORT}' --static_file_dir='${DREAMVIEW_STATIC_DIR}' >'${LOG_DIR}/dreamview_direct.log' 2>&1 &"
      ;;
    stop)
      docker exec -u "${CONTAINER_USER}" "${CONTAINER}" bash -lc \
        "pkill -f '[d]reamview/launch/dreamview.launch' || true; pkill -x dreamview || true"
      ;;
    status)
      docker exec "${CONTAINER}" bash -lc \
        "ps -e -o pid,cmd | grep -E 'dreamview|cyber_launch' | grep -v grep || true"
      ;;
    *)
      echo "Unsupported Dreamview command: ${command}" >&2
      return 2
      ;;
  esac
}

ensure_dreamview_flags() {
  docker exec -u "0" "${CONTAINER}" bash -lc \
    "set -e; touch '${DREAMVIEW_CONF}'; grep -v '^--sim_control_spawn_mode=' '${DREAMVIEW_CONF}' > /tmp/mapeditor_dreamview.conf; printf '%s\n' '--sim_control_spawn_mode=${DREAMVIEW_SPAWN_MODE}' >> /tmp/mapeditor_dreamview.conf; cp /tmp/mapeditor_dreamview.conf '${DREAMVIEW_CONF}'; chown ${CONTAINER_USER}:${CONTAINER_USER} '${DREAMVIEW_CONF}' || true"
}

case "${ACTION}" in
  start)
    start_container
    ensure_dreamview_flags
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
    run_dreamview status
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
