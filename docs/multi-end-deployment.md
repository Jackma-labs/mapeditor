# Multi-End Mapeditor Deployment

GitHub is the source of truth for code:

```text
git@github.com:Jackma-labs/mapeditor.git
```

Use one deploy branch for both servers. Keep server-specific data and secrets out
of Git in `.env.server` and `data/`.

## Roles

```text
Local workstation
  development, verification, map data export/import tools

Dell mapeditor server
  LAN editing server, heavy base-map generation, edge-device deployment

Cloud mapeditor server
  public HTTPS editor at https://map.landingx.cn and /mapeditor/

Edge device
  Apollo runtime target; receives released map packages only
```

Known current endpoints:

```text
Dell mapeditor:  http://192.168.110.18:58000
Cloud mapeditor: https://map.landingx.cn
Cloud subpath:   https://map.landingx.cn/mapeditor/
Edge Apollo:     192.168.110.187
```

## Standard Server Deploy

Run the same bootstrap on Dell and cloud:

```bash
git clone git@github.com:Jackma-labs/mapeditor.git ~/mapeditor
cd ~/mapeditor
BRANCH=main PORT=58000 bash deploy/server/bootstrap.sh
```

For an existing checkout:

```bash
cd ~/mapeditor
BRANCH=main PORT=58000 bash deploy/server/bootstrap.sh
```

From a workstation that has SSH access, trigger the same flow remotely:

```bash
HOST=dell@192.168.110.18 BRANCH=main bash deploy/server/deploy-remote.sh
HOST=<cloud-user>@<cloud-host> BRANCH=main bash deploy/server/deploy-remote.sh
```

After deploy, verify:

```bash
curl -fsS http://127.0.0.1:58000/healthz
curl -fsS http://127.0.0.1:58000/runtime/doctor
```

## Dell Server Configuration

Dell owns edge deployment. Configure `~/mapeditor/.env.server`:

```bash
MAP_RUNTIME_MODE=local
MAP_SKIP_VALIDATION=false
MAP_EDGE_DEPLOY_MODE=ssh
MAP_EDGE_HOST=192.168.110.187
MAP_EDGE_USER=nvidia
MAP_EDGE_PASSWORD=nvidia
MAP_EDGE_PORT=22
MAP_EDGE_TARGET_MAP_ROOT=/apollo/modules/map/data
MAP_EDGE_DOCKER_CONTAINER=apollo_dev_nvidia
MAP_EDGE_NATIVE_MAP_TOOLS=true
MAP_EDGE_COORDINATE_MAX_DISTANCE_METERS=5000
```

Then restart:

```bash
systemctl --user restart mapeditor.service
```

Before deploying a map to the edge device, always run preflight:

```bash
curl -fsS -X POST http://127.0.0.1:58000/runtime/preflight-deploy \
  -H 'content-type: application/json' \
  -d '{"mapName":"<released-map-name>"}'
```

## Cloud Server Configuration

Cloud should run the same Git branch and build output, but normally keeps edge
deployment disabled:

```bash
MAP_RUNTIME_MODE=local
MAP_SKIP_VALIDATION=false
MAP_EDGE_DEPLOY_MODE=disabled
MAP_AUTH_ENABLED=true
MAP_AUTH_USERNAME=admin
MAP_AUTH_PASSWORD=<strong-password>
```

Install the nginx site from:

```text
deploy/server/map.landingx.cn.nginx.conf
```

The config supports both root access and `/mapeditor/` subpath access, including
WebSocket proxying for `/plugins/map`.

## Data Sync Direction

Code sync direction:

```text
GitHub main -> Dell
GitHub main -> Cloud
```

## Automatic Git Distribution

The target flow is:

```text
local workstation -> git push origin main -> GitHub main
GitHub main -> Dell pull timer
GitHub main -> Cloud GitHub Actions release
```

### Dell Pull Timer

Dell is usually inside the LAN, so a GitHub-hosted runner cannot reliably SSH
into it. Install a pull timer on Dell instead:

```bash
cd /home/dell/mapeditor-unified
APP_DIR=/home/dell/mapeditor-unified \
BRANCH=main \
PORT=58000 \
INTERVAL=60s \
bash deploy/server/install-auto-deploy.sh
```

The timer runs `deploy/server/auto-deploy-pull.sh`. It fetches `origin/main`,
deploys only when the commit changes, refuses to run when tracked files are
dirty, and reuses `deploy/server/bootstrap.sh` for the actual build and service
restart.

Check it with:

```bash
systemctl --user list-timers mapeditor-auto-deploy.timer
systemctl --user status mapeditor-auto-deploy.service
journalctl --user -u mapeditor-auto-deploy.service -n 80 --no-pager
```

### Cloud GitHub Actions Release

Cloud deployment is handled by `.github/workflows/deploy-cloud.yml`. The action
builds the frontend on GitHub, uploads the artifact to the cloud server, then
runs `deploy/server/deploy-cloud-release.sh` to create a timestamped release and
switch `/opt/landing/apps/mapeditor/current`.

Configure these GitHub repository secrets:

```text
CLOUD_SSH_HOST=106.8.105.69
CLOUD_SSH_PORT=35118
CLOUD_SSH_USER=root
CLOUD_SSH_KEY=<private key content>
```

Optional overrides:

```text
CLOUD_APP_ROOT=/opt/landing/apps/mapeditor
CLOUD_NODE_BIN_DIR=/opt/landing/runtime/node/bin
CLOUD_SERVICE_NAME=landing-mapeditor.service
```

After the secrets are set, pushing `main` automatically deploys the cloud
server. The workflow can also be run manually from GitHub Actions.

Map data sync direction when needed:

```text
Dell mapeditor -> local export -> cloud mapeditor
```

Use the local helper scripts under `D:\地图工具开发\deploy` for one-off data
migration until they are promoted into the repository:

```powershell
$env:DELL_MAPEDITOR_BASE="http://192.168.110.18:58000"
$env:CLOUD_MAPEDITOR_BASE="https://map.landingx.cn"
$env:CLOUD_MAPEDITOR_PASSWORD="<password>"
$env:SYNC_OUT_DIR="D:\地图工具开发\dell-mapeditor-export-20260528"
node D:\地图工具开发\deploy\sync-dell-mapeditor-via-api.js
```

## Coordinate Accuracy Rules

Released maps must use global Apollo coordinates before edge deployment. The JS
fallback converter applies the first available anchor from:

```text
apolloOrigin, utmOrigin, mapOrigin, coordinateOrigin, basemapCenter
```

For center-aligned maps, provide one of:

```text
apolloCenter, utmCenter, mapCenter, coordinateCenter
```

Edge deployment validates `base_map.txt` coordinates against the target Apollo
map root and rejects local editor-scale coordinates or maps farther than
`MAP_EDGE_COORDINATE_MAX_DISTANCE_METERS` from an existing global-coordinate map.

Operational rule:

```text
No anchor -> no edge deployment.
Preflight fails -> do not deploy.
Deploy succeeds -> verify Dreamview current map and run simulation.
```
