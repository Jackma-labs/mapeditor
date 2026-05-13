# Server deployment

This deployment mode runs the standalone editor on an x86_64 local server. The
server owns map editing, base-map preparation, release generation, and later
edge-device deployment. Vehicle edge devices should only receive released maps.

## Dell server

The verified target is:

- Host: `dell@192.168.110.2`
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
curl -fsSL https://raw.githubusercontent.com/Jackma-labs/mapeditor/main/deploy/server/bootstrap.sh | bash
```

Or from a checked-out repository:

```bash
bash deploy/server/bootstrap.sh
```

Environment overrides:

```bash
APP_DIR=$HOME/mapeditor PORT=58000 BRANCH=main bash deploy/server/bootstrap.sh
```

The script installs dependencies, builds the frontend, and starts the backend.
It prefers a user `systemd` service and falls back to `nohup` if user services
are not available in the SSH session.

After deployment, open:

```text
http://192.168.110.2:58000/
```

## Runtime boundary

The web system can run independently today. Full one-click map release still
requires x86_64 native Apollo helper binaries in `runtime/bin`:

- `runtime/bin/editor_map_converter`
- `runtime/bin/tile_map_images_creator`

The available Apollo HDMap image contains aarch64 binaries and Bazel runfiles.
The C++ source files for `modules/private_tools` are not present in the final
image or the public `wheelos/apollo-lite` repository, so these binaries cannot
be rebuilt for x86_64 from the current public artifacts alone.
