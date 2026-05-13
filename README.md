# Map Editor Standalone

这是从 WheelOS Apollo HDMap 镜像中拆出的独立地图编辑器工程。

## 目录

```text
frontend/          React + Three.js 地图编辑器
backend/           Express + WebSocket 后端
config/            底图生成和外参配置
data/
  bag/             输入 bag
  base_map/        tile_map_images_creator 输出
  editor_map/      前端保存的 editor_map JSON
  released_map/    editor_map_converter 发布结果
runtime/bin/       Apollo 工具二进制挂载位置
runtime/scripts/   Apollo runtime 容器脚本
```

## 当前状态

前端和后端已经脱离 `/apollo/modules/private_tools` 路径，可以作为普通 Node 项目运行。

底图生成和发布仍依赖 Apollo/ARM64 二进制：

- `tile_map_images_creator`
- `editor_map_converter`

推荐先用 Docker/WSL/Linux 容器提供这些二进制。完全脱离 Apollo 镜像需要恢复或获取 C++ 源码并重新构建。

## 推荐部署形态

```text
本地服务器
  map-editor-standalone
    frontend + backend
    data/
    runtime adapter
  Apollo runtime container
    tile_map_images_creator
    editor_map_converter

车辆边缘设备
  Apollo runtime / Dreamview
  modules/map/data/<map_name>
```

地图编辑、底图生成和发布在本地服务器完成。发布产物再通过 SSH/SCP 推送到车辆边缘设备，实现一键部署地图。

## 安装

```bash
npm run install:all
```

## 开发模式

开两个终端：

```bash
npm run dev:backend
npm run dev:frontend
```

前端开发服务器默认访问 `http://localhost:3000`，后端默认监听 `http://localhost:58000`。

如果后端不在本机 58000：

```bash
set REACT_APP_MAP_BACKEND=192.168.1.10:58000
npm run dev:frontend
```

## 单端口运行

先构建前端：

```bash
npm run build:frontend
npm start
```

然后访问：

```text
http://localhost:58000
```

## 后端配置

配置文件在 `backend/server.config.json`。也可以用环境变量覆盖：

- `MAP_BACKEND_PORT`
- `MAP_RUNTIME_MODE=local|docker`
- `MAP_RUNTIME_DOCKER_CONTAINER`
- `MAP_RUNTIME_DOCKER_IMAGE`
- `MAP_BASE_MAP_ROOT`
- `MAP_EDITOR_MAP_ROOT`
- `MAP_RELEASE_ROOT`
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

诊断接口：

```text
GET http://localhost:58000/healthz
GET http://localhost:58000/config
GET http://localhost:58000/runtime/status
```

## Docker Runtime

在服务器上推荐使用 Docker runtime：

```bash
export MAP_RUNTIME_MODE=docker
bash runtime/scripts/start-apollo-runtime.sh
npm start
```

Windows PowerShell：

```powershell
$env:MAP_RUNTIME_MODE="docker"
npm run runtime:start:win
npm start
```

状态检查：

```bash
npm run runtime:status
```

底图生成接口：

```text
POST /runtime/create-base-map
```

发布地图仍走前端原有“发布”按钮，后端会按 `runtimeMode` 自动选择本地二进制或 Docker 容器执行 `editor_map_converter`。

## 边缘设备一键部署

在 `backend/server.config.json` 中配置：

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

部署接口：

```text
POST /runtime/deploy-map
Content-Type: application/json

{
  "mapName": "ReleaseMap_202512150953"
}
```

服务端会把 `data/released_map/<mapName>` 复制到车辆边缘设备的 `targetMapRoot`。`postDeployCommand` 可用于重启 Dreamview 或刷新地图服务，具体命令需要按车辆边缘设备的 Apollo 部署方式配置。

## 本地二进制模式

把可执行文件放到：

```text
runtime/bin/editor_map_converter
runtime/bin/tile_map_images_creator
```

或设置：

```bash
set MAP_CONVERTER_BINARY=/absolute/path/editor_map_converter
set MAP_TILE_MAP_CREATOR_BINARY=/absolute/path/tile_map_images_creator
```

没有转换器时，编辑、打开、保存 editor_map JSON 仍可工作，但“发布地图”会返回转换器缺失错误。
