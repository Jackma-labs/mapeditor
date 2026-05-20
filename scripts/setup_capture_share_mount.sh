#!/usr/bin/env bash
set -euo pipefail

NAS_HOST="${1:-192.168.110.104}"
SHARE_NAME="${2:-地图数据}"
MOUNT_POINT="${3:-/mnt/map_capture_source}"
CAPTURE_SUBDIR="${4:-采图数据/结算数据}"
CREDENTIAL_FILE="${5:-/etc/samba/credentials/mapeditor-capture-source}"
APP_ENV_FILE="${MAPEDITOR_ENV_FILE:-/home/dell/mapeditor/.env.server}"
APP_USER="${SUDO_USER:-$(id -un)}"
APP_UID="$(id -u "${APP_USER}")"
APP_GID="$(id -g "${APP_USER}")"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

apt-get update
apt-get install -y cifs-utils

install -d -m 700 "$(dirname "${CREDENTIAL_FILE}")"
if [[ ! -f "${CREDENTIAL_FILE}" ]]; then
  read -r -p "SMB username: " SMB_USER
  read -r -s -p "SMB password: " SMB_PASS
  echo
  {
    printf 'username=%s\n' "${SMB_USER}"
    printf 'password=%s\n' "${SMB_PASS}"
  } > "${CREDENTIAL_FILE}"
  chmod 600 "${CREDENTIAL_FILE}"
fi

install -d -m 775 -o "${APP_UID}" -g "${APP_GID}" "${MOUNT_POINT}"
REMOTE="//${NAS_HOST}/${SHARE_NAME}"
OPTIONS="credentials=${CREDENTIAL_FILE},iocharset=utf8,vers=3.0,uid=${APP_UID},gid=${APP_GID},file_mode=0664,dir_mode=0775,noperm,_netdev,nofail"

if mountpoint -q "${MOUNT_POINT}"; then
  umount "${MOUNT_POINT}"
fi
mount -t cifs "${REMOTE}" "${MOUNT_POINT}" -o "${OPTIONS}"

if [[ ! -d "${MOUNT_POINT}/${CAPTURE_SUBDIR}" ]]; then
  echo "Mounted ${REMOTE}, but ${MOUNT_POINT}/${CAPTURE_SUBDIR} was not found."
  exit 2
fi

FSTAB_LINE="${REMOTE} ${MOUNT_POINT} cifs ${OPTIONS},x-systemd.automount 0 0"
grep -v " ${MOUNT_POINT} cifs " /etc/fstab > /tmp/mapeditor-fstab
printf '%s\n' "${FSTAB_LINE}" >> /tmp/mapeditor-fstab
cat /tmp/mapeditor-fstab > /etc/fstab
rm -f /tmp/mapeditor-fstab

touch "${APP_ENV_FILE}"
grep -v '^MAP_CAPTURE_SOURCE_ROOT=' "${APP_ENV_FILE}" \
  | grep -v '^MAP_CAPTURE_AUTO_SYNC=' \
  | grep -v '^MAP_CAPTURE_AUTO_SYNC_INTERVAL_MINUTES=' \
  | grep -v '^MAP_CAPTURE_AUTO_MIN_AGE_MINUTES=' \
  | grep -v '^MAP_CAPTURE_AUTO_GENERATE_BASE_MAPS=' \
  | grep -v '^MAP_CAPTURE_AUTO_MERGE=' \
  | grep -v '^MAP_INBOX_AUTO_PREBUILD=' \
  | grep -v '^MAP_INBOX_AUTO_PREBUILD_INTERVAL_MINUTES=' > /tmp/mapeditor-env
printf 'MAP_CAPTURE_SOURCE_ROOT=%s\n' "${MOUNT_POINT}/${CAPTURE_SUBDIR}" >> /tmp/mapeditor-env
printf 'MAP_CAPTURE_AUTO_SYNC=true\n' >> /tmp/mapeditor-env
printf 'MAP_CAPTURE_AUTO_SYNC_INTERVAL_MINUTES=10\n' >> /tmp/mapeditor-env
printf 'MAP_CAPTURE_AUTO_MIN_AGE_MINUTES=15\n' >> /tmp/mapeditor-env
printf 'MAP_CAPTURE_AUTO_GENERATE_BASE_MAPS=true\n' >> /tmp/mapeditor-env
printf 'MAP_CAPTURE_AUTO_MERGE=true\n' >> /tmp/mapeditor-env
printf 'MAP_INBOX_AUTO_PREBUILD=true\n' >> /tmp/mapeditor-env
printf 'MAP_INBOX_AUTO_PREBUILD_INTERVAL_MINUTES=10\n' >> /tmp/mapeditor-env
cat /tmp/mapeditor-env > "${APP_ENV_FILE}"
rm -f /tmp/mapeditor-env
chown "${APP_UID}:${APP_GID}" "${APP_ENV_FILE}"

echo "Capture source mounted at ${MOUNT_POINT}/${CAPTURE_SUBDIR}"
echo "Updated ${APP_ENV_FILE}; restart mapeditor.service to apply it."
