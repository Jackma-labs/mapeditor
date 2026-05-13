$ErrorActionPreference = "Stop"

$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ContainerName = if ($env:MAP_RUNTIME_DOCKER_CONTAINER) { $env:MAP_RUNTIME_DOCKER_CONTAINER } else { "map_editor" }
$Image = if ($env:MAP_RUNTIME_DOCKER_IMAGE) { $env:MAP_RUNTIME_DOCKER_IMAGE } else { "registry.cn-hangzhou.aliyuncs.com/wheelos/apollo:hdmap-aarch64-20.04-20251212_2123" }
$Port = if ($env:MAP_BACKEND_PORT) { $env:MAP_BACKEND_PORT } else { "58000" }

New-Item -ItemType Directory -Force -Path `
  (Join-Path $AppRoot "data\log"), `
  (Join-Path $AppRoot "data\core"), `
  (Join-Path $AppRoot "data\bag"), `
  (Join-Path $AppRoot "data\base_map"), `
  (Join-Path $AppRoot "data\editor_map"), `
  (Join-Path $AppRoot "data\released_map") | Out-Null

docker rm -f $ContainerName 2>$null | Out-Null

docker run `
  -itd `
  --name $ContainerName `
  -e FORWARDED_PORT=$Port `
  -v "${AppRoot}\data:/apollo/data" `
  -v "${AppRoot}\config\image_creator_conf.pb.txt:/apollo/external_conf/image_creator_conf.pb.txt" `
  -v "${AppRoot}\config\main_extrinsics.yaml:/apollo/modules/drivers/lidar/params/main_extrinsics.yaml" `
  -w /apollo `
  -p "${Port}:3000" `
  $Image `
  bash

Write-Host "Apollo runtime container started: $ContainerName"
