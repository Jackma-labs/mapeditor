# Native Apollo runtime

The recommended production route is to run the editor independently on the local
x86_64 server and compile the Apollo map helper tools natively for that server.
Vehicle edge devices remain isolated from editing and release workloads.

## Current status

Verified facts:

- Dell server `dell@192.168.110.2` is x86_64 and has enough CPU, memory, disk,
  Node, npm, Git, and Docker for this role.
- The extracted Apollo HDMap runtime layer contains aarch64 binaries.
- The apparent `.cc` files in Bazel runfiles are symlinks to
  `/apollo/modules/private_tools/...`.
- The final image layers do not contain those symlink targets.
- The public `wheelos/apollo-lite` checkout does not contain
  `modules/private_tools`.

Because of that, x86_64 rebuild is blocked until the private source package for
these directories is available:

- `modules/private_tools/map_tool`
- `modules/private_tools/tile_map_images_creator`

## Expected output

Once the source package is present, the build should produce:

```text
runtime/bin/editor_map_converter
runtime/bin/tile_map_images_creator
```

The backend already looks for those binaries in local runtime mode.

## Build flow

On the Dell server:

```bash
git clone git@github.com:wheelos/apollo-lite.git ~/apollo-lite
git clone git@github.com:Jackma-labs/mapeditor.git ~/mapeditor
```

Copy or mount the private source package so that the Apollo workspace contains:

```text
~/apollo-lite/modules/private_tools/map_tool
~/apollo-lite/modules/private_tools/tile_map_images_creator
```

Then run:

```bash
cd ~/mapeditor
APOLLO_WORKSPACE=~/apollo-lite bash runtime/native/build-apollo-tools.sh
```

If the private source is delivered separately, pass it explicitly:

```bash
PRIVATE_TOOLS_SOURCE=/path/to/private_tools APOLLO_WORKSPACE=~/apollo-lite bash runtime/native/build-apollo-tools.sh
```
