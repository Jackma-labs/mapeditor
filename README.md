# Map Editor Standalone

Standalone wrapper for the Apollo HDMap editor frontend and lightweight backend
extracted from the WheelOS Apollo HDMap image.

## Layout

```text
frontend/          React + Three.js map editor
backend/           Express + WebSocket backend
config/            base-map generation and extrinsics config
data/
  bag/             input bag files
  base_map/        tile_map_images_creator output
  editor_map/      editor_map JSON saved by the frontend
  released_map/    editor_map_converter output
runtime/bin/       native Apollo helper binaries
runtime/scripts/   legacy Apollo runtime container helpers
runtime/native/    x86_64 native build helpers
deploy/server/     local-server deployment scripts
```

## Current status

The frontend and backend are decoupled from `/apollo/modules/private_tools` and
can run as a normal Node project.

Full base-map generation and map release require Apollo helper binaries:

- `tile_map_images_creator`
- `editor_map_converter`

The current public artifacts only provide aarch64 binaries. The final Apollo
HDMap image contains Bazel runfiles with symlinks to private source paths, but
not the source content itself. The public `wheelos/apollo-lite` repository also
does not include `modules/private_tools`.

## Recommended deployment shape

```text
Local x86_64 server
  map-editor-standalone
    frontend + backend
    data/
    runtime/bin/
  native Apollo helper binaries
    tile_map_images_creator
    editor_map_converter

Vehicle edge device
  Apollo runtime / Dreamview
  modules/map/data/<map_name>
```

Map editing, base-map preparation, and release generation happen on the local
server. Released map artifacts are then deployed to edge devices over SSH/SCP or
another controlled delivery channel.

## Install

```bash
npm run install:all
```

## Development

Use two terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

The frontend dev server defaults to `http://localhost:3000`; the backend
defaults to `http://localhost:58000`.

If the backend is not on local port 58000:

```bash
set REACT_APP_MAP_BACKEND=192.168.1.10:58000
npm run dev:frontend
```

## Single-port run

Build the frontend and start the backend:

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:58000
```

## Local server deployment

For the Dell server:

```bash
ssh dell@192.168.110.2
git clone git@github.com:Jackma-labs/mapeditor.git ~/mapeditor
cd ~/mapeditor
bash deploy/server/bootstrap.sh
```

After it starts, open:

```text
http://192.168.110.2:58000/
```

On the Dell server, LAN access currently requires the firewall rule:

```bash
sudo ufw allow 58000/tcp
```

See `deploy/server/README.md` and `runtime/native/README.md` for the server and
native Apollo runtime details.

## Backend configuration

Config file: `backend/server.config.json`.

Environment overrides:

- `MAP_BACKEND_PORT`
- `MAP_RUNTIME_MODE=local|docker`
- `MAP_RUNTIME_DOCKER_CONTAINER`
- `MAP_RUNTIME_DOCKER_IMAGE`
- `MAP_BASE_MAP_ROOT`
- `MAP_EDITOR_MAP_ROOT`
- `MAP_RELEASE_ROOT`
- `MAP_IMPORT_PACKAGE_ROOT`
- `MAP_IMPORT_PACKAGE_TRASH_ROOT`
- `MAP_CONVERTER_BINARY`
- `MAP_TILE_MAP_CREATOR_BINARY`
- `MAP_TILE_MAP_CONFIG`
- `MAP_FRONTEND_BUILD_ROOT`
- `MAP_SKIP_VALIDATION=true`
- `MAP_EDGE_DEPLOY_MODE=disabled|ssh`
- `MAP_EDGE_HOST`
- `MAP_EDGE_USER`
- `MAP_EDGE_TARGET_MAP_ROOT`
- `MAP_EDGE_POST_DEPLOY_COMMAND`

Diagnostics:

```text
GET http://localhost:58000/healthz
GET http://localhost:58000/config
GET http://localhost:58000/runtime/status
GET http://localhost:58000/runtime/doctor
GET http://localhost:58000/runtime/released-maps
GET http://localhost:58000/runtime/deploy-config
```

Base map import:

```text
POST /runtime/import-base-map
Content-Type: multipart/form-data

file=<base-map.zip>
mapName=<name>
overwrite=false
```

The zip may contain `map_images/tiles.json` at the root or under one top-level
folder. After import, it is available in the "打开底图" dialog.

Point-cloud base map import:

```text
POST /runtime/import-point-cloud-base-map
Content-Type: multipart/form-data

file=<point-cloud.pcd|ply|xyz|txt|csv|las|zip>
files=<multiple point-cloud files, optional>
mapName=<name>
overwrite=false
```

The server builds enhanced Apollo-style raster layers from all parsed points.
The default `map_images` layer is a ground-filtered high-contrast layer for
editing; sibling diagnostic layers are also generated when populated:
`map_images_raw`, `map_images_ground`, `map_images_marking`, and
`map_images_edge`. The finest level uses the editor's native `0.03125m/px`
resolution, so full point-cloud detail is preserved in image tiles instead of
being downsampled into one browser JSON.
The upload can be one supported point-cloud file, one zip containing multiple
supported point-cloud files, or several files selected together in the browser.
Zips may use production-style folders such as `Image/`, `las/`, and `pcd/`.
Image files are extracted into `source_images/` and recorded in the map
metadata, but they are not projected unless matching camera intrinsics,
extrinsics, timestamps, and vehicle/lidar poses are available. The resulting
map is available from the base-map open dialog as a drawable base layer.

ResultOut asset sync:

```powershell
powershell -ExecutionPolicy Bypass -File tools/sync-resultout-assets.ps1 `
  -SourceRoot "\\LanDingDisk\地图数据\采图数据\结算数据" `
  -DestinationRoot "\\192.168.110.2\mapeditor-capture"
```

The sync script scans each source package for a `ResultOut` directory, copies
only `.las` files into a backend-compatible data-package layout, and writes
`package_metadata.json` plus `source_manifest.json` for audit. On the Dell
server, set `MAP_IMPORT_PACKAGE_ROOT=/data/mapeditor/capture_inbox` so synced
packages appear in the asset manager without browser uploads.

Apollo map package import:

```text
POST /runtime/import-map-package
Content-Type: multipart/form-data

file=<apollo-map.zip>
mapName=<name>
overwrite=false
```

The zip must contain `editor_map.json`; optional Apollo release outputs such as
`base_map.bin`, `routing_map.bin`, and `sim_map.bin` are copied into
`data/released_map/<name>/`. The editor JSON is copied into
`data/editor_map/<name>.json` and is available in the "打开标注地图" dialog.

## Edge deployment

Configure `backend/server.config.json`:

```json
{
  "edgeDeploy": {
    "mode": "ssh",
    "host": "192.168.1.100",
    "user": "nvidia",
    "targetMapRoot": "/apollo/modules/map/data",
    "postDeployCommand": "bash /apollo/scripts/bootstrap.sh restart"
  }
}
```

Deploy endpoint:

```text
POST /runtime/deploy-map
POST /runtime/deploy-latest
POST /runtime/preflight-deploy
Content-Type: application/json

{
  "mapName": "ReleaseMap_202512150953"
}
```

The backend copies `data/released_map/<mapName>` into the configured target map
root. `postDeployCommand` can restart Dreamview or refresh map services when the
edge device requires it.

## Local binary mode

Put executable files here:

```text
runtime/bin/editor_map_converter
runtime/bin/tile_map_images_creator
```

Or override the paths:

```bash
export MAP_CONVERTER_BINARY=/absolute/path/editor_map_converter
export MAP_TILE_MAP_CREATOR_BINARY=/absolute/path/tile_map_images_creator
```

Without these binaries, editing/opening/saving editor-map JSON still works, but
base-map generation and map release return a missing-binary error.
