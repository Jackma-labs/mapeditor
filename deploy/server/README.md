# Server deployment

This deployment mode runs the standalone editor on an x86_64 local server. The
server owns map editing, base-map preparation, release generation, and later
edge-device deployment. Vehicle edge devices should only receive released maps.

## Dell server

The verified target is:

- Host: `dell@192.168.110.18`
- OS: Ubuntu 22.04
- Architecture: x86_64
- CPU: 64 hardware threads
- Memory: 31 GiB
- Disk: about 2.5 TiB free on `/`
- Docker: installed
- Node: v20.20.0
- npm: 10.8.2

This is enough for the standalone web/backend service and for building/running
the Apollo map tools natively once their source package is available.

## Bootstrap

Run this on the server:

```bash
git clone git@github.com:Jackma-labs/mapeditor.git ~/mapeditor
cd ~/mapeditor
bash deploy/server/bootstrap.sh
```

Environment overrides:

```bash
APP_DIR=$HOME/mapeditor PORT=58000 BRANCH=main bash deploy/server/bootstrap.sh
```

The script installs dependencies, builds the frontend, and starts the backend.
It prefers a user `systemd` service and falls back to `nohup` if user services
are not available in the SSH session.

Server-specific settings live in:

```text
~/mapeditor/.env.server
```

The bootstrap script creates this file from
`deploy/server/env.server.example` when it does not exist. Configure edge
deployment there after passwordless SSH from the server to the edge device is
ready.

Minimum edge deployment settings:

```bash
MAP_EDGE_DEPLOY_MODE=ssh
MAP_EDGE_HOST=192.168.110.10
MAP_EDGE_USER=nvidia
MAP_EDGE_TARGET_MAP_ROOT=/apollo/modules/map/data
MAP_EDGE_POST_DEPLOY_COMMAND=
```

After changing `.env.server`, restart the service:

```bash
systemctl --user restart mapeditor.service
```

Then run the preflight check from the UI or through HTTP:

```bash
curl -fsS -X POST http://127.0.0.1:58000/runtime/preflight-deploy
```

After deployment, open:

```text
http://192.168.110.18:58000/
```

If the service is healthy on the server but another machine cannot open the URL,
allow the backend port through the server firewall:

```bash
sudo ufw allow 58000/tcp
```

For reboot persistence without an interactive login session, enable lingering
for the `dell` user:

```bash
sudo loginctl enable-linger dell
```

## Runtime boundary

The web system can run independently today. Native Apollo helper binaries are
still preferred in `runtime/bin`:

- `runtime/bin/editor_map_converter`
- `runtime/bin/tile_map_images_creator`

The available Apollo HDMap image contains aarch64 binaries and Bazel runfiles.
The C++ source files for `modules/private_tools` are not present in the final
image or the public `wheelos/apollo-lite` repository, so these binaries cannot
be rebuilt for x86_64 from the current public artifacts alone.

If `runtime/bin/editor_map_converter` is absent, the backend uses its JS
compatibility converter and keeps the original frontend `ReleaseMapFile`
protocol unchanged. Installing the native binary later automatically restores
the original converter path.

## Cloud release runtime contract

Cloud deployments under `/opt/landing/apps/mapeditor` must start the backend
through the repository backend entrypoint:

```text
backend/server.js
```

Do not start `server.js` from the repository root. The root directory does not
own a backend entrypoint, and starting it directly can leave `/healthz` down
even after the frontend build succeeds.

The standard release deploy script is:

```bash
APP_ROOT=/opt/landing/apps/mapeditor \
NODE_BIN_DIR=/opt/landing/runtime/node/bin \
SERVICE_SCOPE=auto \
bash deploy/server/deploy-cloud-release.sh
```

The script updates the release, switches `current`, and delegates runtime
startup to:

```bash
APP_DIR=/opt/landing/apps/mapeditor/current \
NODE_BIN_DIR=/opt/landing/runtime/node/bin \
SERVICE_SCOPE=auto \
bash deploy/server/restart-runtime.sh
```

`restart-runtime.sh` validates the backend entrypoint, validates the frontend
build, loads `.env.server`, restarts systemd when a configured service exists,
or falls back to a PID-file based `nohup node backend/server.js` startup. It
then verifies `/healthz` and prints a compact `/runtime/doctor` summary when
the endpoint is accessible.

Post-deploy checks:

```bash
curl -fsS http://127.0.0.1:58000/healthz
curl -fsS http://127.0.0.1:58000/runtime/doctor
```

For environments where `/runtime/doctor` requires authentication, `/healthz`
is still the non-authenticated process liveness gate; authenticate before
checking build hash through the browser or API.
