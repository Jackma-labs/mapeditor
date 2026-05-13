$ErrorActionPreference = "Stop"

$ContainerName = if ($env:MAP_RUNTIME_DOCKER_CONTAINER) { $env:MAP_RUNTIME_DOCKER_CONTAINER } else { "map_editor" }
docker rm -f $ContainerName
Write-Host "Apollo runtime container stopped: $ContainerName"
