# MapEditor 系统级加固记录

日期：2026-06-15
分支：`harden/systems-optimization`（基于 `5673bfd`）

本轮针对画图工具本身做系统级加固，分四轮顺序完成。前三轮全部改动均已构建/测试验证；
第四轮完成安全子项，并明确推迟两项高风险重构（见末尾）。

## 第一轮：生产安全

- 鉴权改为 fail-closed 但不致瘫痪：未显式 `MAP_AUTH_ENABLED=false` 且配置了
  `MAP_AUTH_PASSWORD` 时自动开启；请求开启但无密码时保持开放并在启动日志打印醒目告警，
  避免直接锁死正在运行的 Dell/云端。`backend/config.js`、`backend/server.js`（启动日志）。
  - 动作项：在 `.env.server` 设置 `MAP_AUTH_PASSWORD` 即可真正关闭未授权访问。
- 边缘 `postDeployCommand` 不再接受请求体注入，只能由服务端 `.env.server`
  （`MAP_EDGE_POST_DEPLOY_COMMAND`）配置，消除“通过 API 在边缘设备执行任意命令”的设计性 RCE。
  `backend/runtime/index.js` `normalizeEdgeDeployParams`。
- `/mapcreator/:mapName/...` 全部瓦片路由经 `safeBaseMapJoin` 校验，解析后路径越出
  `baseMapRoot` 一律 404，堵住路径穿越。`backend/server.js`。
- 命令执行失败时不再把完整命令行/二进制路径回传客户端，仅保留 stderr 末尾若干行；
  完整信息保留在 `error.result` 供服务端日志。`backend/runtime/process.js`。

验证：启动日志告警生效；autosave 端点 200 且生成草稿；`..%2f` 穿越返回 404（本机冒烟）。

## 第二轮：数据安全

- 加载健壮性：`loadHdmp` 跳过缺少有效坐标的点记录（不再因单条坏记录整图崩溃并计数告警）；
  `renderHDMap` 导入包 try/catch，失败弹错误提示而非停留半加载。
  `frontend/src/utils/common.ts`、`frontend/src/components/MapEditor/index.tsx`。
- 本地自动备份：`requestAnimationFrame` 空转改为定时器；localStorage 写入失败（配额满）
  改为**可见告警**而非静默吞掉；快照与恢复均补齐坐标元数据（coordinateFrame/targetCrs/
  apolloOrigin/coordinateAnchor/baseMapDir）。`frontend/src/components/RecoverDataRemind/index.tsx`。
- 服务端草稿兜底（非破坏性）：新增 `POST /runtime/editor-map-autosave`，写入
  `data/editor_map/.autosave/<map>/`，仅保留最近 5 份，绝不覆盖正式地图/发布物；前端在
  本地备份之外按 60s 低频、失败静默地推送草稿。`backend/server.js`、`frontend/src/service/index.ts`。

## 第三轮：规模化性能

- 渲染热路径：`updateElements` 由每次渲染 8 次 `getObjectsByProperty` 全场景遍历，
  收敛为单次 `scene.traverse` 分桶。`frontend/src/diff/updateElement.ts`。
- 质量检查：`MapQualityPanel` 的 O(L²) `inspectMapQuality`/`buildMapQualityRepairActions`
  改为对 `mapState` 防抖（停止操作 ~400ms 后才重算），消除大图下每次编辑的卡顿。
- 发布转换：JS 版 Apollo 转换器移入 `worker_thread`，避免大图发布阻塞整个 HTTP/WS
  事件循环；worker 创建失败时降级为进程内转换。`backend/runtime/editorMapConverterWorker.js`、
  `backend/runtime/index.js` `runConverterInWorker`。新增回归测试 `scripts/test-converter-worker.js`
  （`npm run test:converter-worker`）。

## 第四轮：地基

- 生命周期清理：MapEditor 的 6 个 PubSub 订阅、BaseMap 的 4 个订阅 + 相机 `update` 监听、
  PickObjectsControl 的订阅，全部在卸载时解绑（新增各自 `dispose()`），消除重复挂载
  （含 React StrictMode）造成的事件叠加与闭包泄漏。
- 纹理释放：标注元素移除/整图清空时一并释放其 `material.map`/`alphaMap`（每元素独立的
  canvas/克隆纹理，不影响底图瓦片），修复反复导入/重绘的 GPU 显存泄漏。
  `frontend/src/utils/threeObjectUtil.ts`。

### 本轮明确推迟的两项（高风险，建议单独立项 + 测试护航）

1. **状态模型 Immer 化**：当前 store 为“原地修改 + 浅 spread 伪不可变”，撤销/重做正确性
   依赖其上。全量迁移会触及核心 store 与每个 command，需对每种要素的撤销/重做做完整手测，
   不适合在无人值守、无法逐一手测的加固轮中改动生产工具。
2. **前后端质检规则完全统一**：前端 `mapQuality.ts` 与后端 `editorMapConverter.js` 的
   质量门控阈值/严重级存在分歧（限速单位 km/h vs m/s、连通性 error vs warning），且几何
   原语在三处复制。改阈值/严重级会直接改变发布门控的通过/拒绝行为，需产品确认“何为正确”，
   且要先合并几何原语并逐一比对，属设计决策 + 重构，不宜盲改。

## 受影响文件

后端：`config.js`、`server.js`、`runtime/index.js`、`runtime/process.js`、
`runtime/editorMapConverterWorker.js`（新增）。
前端：`components/MapEditor/index.tsx`、`components/RecoverDataRemind/index.tsx`、
`components/Toolbar/MapQualityPanel.tsx`、`diff/updateElement.ts`、`object/baseMap.ts`、
`service/index.ts`、`threeUtil/PickObjectsControl.ts`、`utils/common.ts`、`utils/threeObjectUtil.ts`。
脚本：`scripts/test-converter-worker.js`（新增）、`package.json`。

## 验证基线

- `npm run build`：通过（仅历史 ESLint hook-deps 告警）。
- `node scripts/test-editor-map-converter-contract.js`：通过。
- `npm run test:converter-worker`：通过。
- `npm run regression:maps`：失败 2 例，原因为 fixture 地图缺坐标锚点
  （`apollo-coordinate-anchor-missing`/`lane-missing-boundary`），与本轮改动无关，
  在 `5673bfd` 上同样失败（`editorMapConverter.js` 未改动）。
