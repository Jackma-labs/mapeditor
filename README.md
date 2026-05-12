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
```

## 当前状态

前端和后端已经脱离 `/apollo/modules/private_tools` 路径，可以作为普通 Node 项目运行。

底图生成和发布仍依赖 Apollo/ARM64 二进制：

- `tile_map_images_creator`
- `editor_map_converter`

第一阶段建议用 Docker/WSL/Linux 容器提供这些二进制。完全脱离 Apollo 镜像需要恢复或获取 C++ 源码并重新构建。

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
- `MAP_BASE_MAP_ROOT`
- `MAP_EDITOR_MAP_ROOT`
- `MAP_RELEASE_ROOT`
- `MAP_CONVERTER_BINARY`
- `MAP_FRONTEND_BUILD_ROOT`
- `MAP_SKIP_VALIDATION=true`

诊断接口：

```text
GET http://localhost:58000/healthz
GET http://localhost:58000/config
```

## 接入发布转换器

把可执行文件放到：

```text
runtime/bin/editor_map_converter
```

或设置：

```bash
set MAP_CONVERTER_BINARY=/absolute/path/editor_map_converter
```

没有转换器时，编辑、打开、保存 editor_map JSON 仍可工作，但“发布地图”会返回转换器缺失错误。
