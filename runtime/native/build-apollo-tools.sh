#!/usr/bin/env bash
set -euo pipefail

APOLLO_WORKSPACE="${APOLLO_WORKSPACE:-$HOME/apollo-lite}"
PRIVATE_TOOLS_SOURCE="${PRIVATE_TOOLS_SOURCE:-}"
OUTPUT_DIR="${OUTPUT_DIR:-$(pwd)/runtime/bin}"

log() {
  printf '[native-build] %s\n' "$*"
}

if [ ! -d "$APOLLO_WORKSPACE" ]; then
  printf 'Apollo workspace not found: %s\n' "$APOLLO_WORKSPACE" >&2
  exit 1
fi

if [ -n "$PRIVATE_TOOLS_SOURCE" ]; then
  if [ ! -d "$PRIVATE_TOOLS_SOURCE" ]; then
    printf 'PRIVATE_TOOLS_SOURCE not found: %s\n' "$PRIVATE_TOOLS_SOURCE" >&2
    exit 1
  fi
  log "syncing private tools source into Apollo workspace"
  mkdir -p "$APOLLO_WORKSPACE/modules/private_tools"
  rsync -a "$PRIVATE_TOOLS_SOURCE"/ "$APOLLO_WORKSPACE/modules/private_tools"/
fi

for required_dir in \
  "$APOLLO_WORKSPACE/modules/private_tools/map_tool" \
  "$APOLLO_WORKSPACE/modules/private_tools/tile_map_images_creator"
do
  if [ ! -d "$required_dir" ]; then
    printf 'missing required source directory: %s\n' "$required_dir" >&2
    printf 'x86_64 rebuild requires the private modules/private_tools source package.\n' >&2
    exit 2
  fi
done

cd "$APOLLO_WORKSPACE"

if ! command -v bazel >/dev/null 2>&1; then
  printf 'bazel is required but was not found in PATH\n' >&2
  exit 1
fi

log "building Apollo private tool targets"
bazel build -c opt \
  //modules/private_tools/map_tool:editor_map_converter \
  //modules/private_tools/tile_map_images_creator:tile_map_images_creator

mkdir -p "$OUTPUT_DIR"
install -m 0755 \
  bazel-bin/modules/private_tools/map_tool/editor_map_converter \
  "$OUTPUT_DIR/editor_map_converter"
install -m 0755 \
  bazel-bin/modules/private_tools/tile_map_images_creator/tile_map_images_creator \
  "$OUTPUT_DIR/tile_map_images_creator"

log "installed native tools into $OUTPUT_DIR"
file "$OUTPUT_DIR/editor_map_converter" "$OUTPUT_DIR/tile_map_images_creator"
