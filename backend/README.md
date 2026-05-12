# Simple Map Backend

轻量化的地图制作后台，脱离 Dreamview+ 也能跑通 “底图 → 编辑 → 发布” 流程。功能包括：

- 通过 HTTP 提供底图瓦片及 `tiles.json`
- WebSocket 接口（`ws://<host>:<port>/plugins/map`）对接 `map_editor_frontend`
  - 底图/标注地图列表
  - 标注地图读取、保存
  - 调用 `map_tool` 发布高精地图（生成 base_map / routing / sim_map 等）

## 快速开始

1. **准备底图与目录**

   ```text
   data/
     base_map/         # tile_map_images_creator 输出 (每个子目录包含 map_images/tiles.json)
     editor_map/       # 标注结果存放目录（自动创建）
     released_map/     # 发布成品输出目录（自动创建）
   ```

2. **构建 EditorMap 转换工具**

   ```bash
   bazel build //modules/private_tools/map_tool:editor_map_converter
   ```

3. **配置服务**

   在 `modules/private_tools/simple_map_backend/` 目录下复制示例配置并按需修改：

   ```bash
   cp server.config.example.json server.config.json
   ```

   `server.config.json` 字段说明：

   | 字段 | 说明 |
   |------|------|
   | `port` | 后端监听端口 |
   | `baseMapRoot` | 底图根目录（需包含 `map_images/tiles.json`） |
   | `editorMapRoot` | 标注地图 JSON 存放目录 |
   | `releaseRoot` | 发布结果输出目录 |
   | `converterBinary` | `bazel build //modules/private_tools/map_tool:editor_map_converter` 输出的可执行程序路径 |
   | `skipValidation` | 是否跳过地图质检（`false` 表示执行校验） |

   相对路径会自动相对 `simple_map_backend` 目录解析，也可以写绝对路径。

4. **安装依赖并启动后台**

   ```bash
   cd modules/private_tools/simple_map_backend
   npm install
   npm start
   ```

5. **启动前端**

   ```bash
   cd modules/map_editor_frontend
   npm install
   npm start   # 默认请求 http://localhost:8888
   ```

6. **流程**
   1. 在前端选择底图（HTTP 下载 `tiles.json` 与瓦片）
   2. 编辑地图元素，选择“保存”会写入 `data/editor_map/<name>.json`
   3. 点击“发布地图”会调用 `editor_map_converter`：
      - 将 JSON 转换为 Apollo HDMap
      - 输出到配置中 `releaseRoot/<name>/`
      - 自动生成 `base_map.bin`、`base_map.txt`、`routing_map.bin` 等文件

## WebSocket 接口概述

| 类型 (`type`) | 说明 | 返回字段 |
|---------------|------|-----------|
| `GetBaseMapDir` | 列出可用底图目录 | `info.data.map_list: string[]` |
| `GetMapFileList` | 列出已保存的 EditorMap | 同上 |
| `OpenMapFile` | 读取 EditorMap JSON | `info.data.map` |
| `SaveMapFile` | 保存 EditorMap JSON | `info.code=0` 或 `15007`（重复） |
| `ReleaseMapFile` | 调用 `editor_map_converter` 发布 hdmap | `info.data.output_dir` |
| `GetAccountMapToolInfo` | 权限占位（恒成功） | `info.data.mapEditorPrerogative` |

错误码参考前端约定：

- `15007` / `15017`：名称重复需确认覆盖
- `15018`：发布失败（转换器错误）
- `15099`：服务端异常

## 提示

- 首次发布前请确认底图目录下已有 `map_images/tiles.json`
- 若发布失败，可查看控制台日志以及返回的 `stdout` 信息
- 若需要 `local_map` 拷贝，请确保访问底图时位于同一目录（服务会自动记录）
