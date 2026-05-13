#!/usr/bin/env bash
set -euo pipefail

section() {
  printf '\n== %s ==\n' "$1"
}

section "Host"
hostname
uname -a

section "CPU"
lscpu | sed -n '1,25p'

section "Memory"
free -h

section "Disk"
df -h /

section "Node"
node -v || true
npm -v || true

section "Git"
git --version || true

section "Docker"
docker version || true

section "Bazel"
bazel --version || true

section "Ports"
ss -ltnp | grep -E ':58000|:3000' || true
