'use strict';
// Deploy-hygiene regression: the edge Dreamview map switch must (1) always force
// a clean Dreamview restart so the previous map's rendered scene is cleared
// (prevents render "ghosting" when switching between maps), (2) dedupe the
// global_flagfile to a single --map_dir in every path, and (3) degrade
// gracefully to the blessed hot-switch when the restart toolchain is absent.
const assert = require('assert');
const { __test__ } = require('../backend/runtime/index');

const cmd = __test__.buildEdgeDreamviewSwitchCommand('/apollo/modules/map/data/2026-6-17-1_af2d5a96');

// (1) The blessed hot-switch must NOT exit early on success — the old code did
// `exit 0` right after switch-map, skipping the scene-clearing restart.
assert.ok(
  !/switch-map "\$MAP_DIR"; then\s*\n\s*'?\s*exit 0/.test(cmd) && /SWITCHED=1/.test(cmd),
  'hot switch-map must set SWITCHED=1 and fall through, not exit 0',
);

// (2) Flag dedupe is defined once and invoked in both the toolchain-missing
// branch and after the restart.
assert.ok(/write_map_flag\(\) \{/.test(cmd), 'write_map_flag must be defined');
assert.ok(/\$0 !~ \/\^--map_dir=\//.test(cmd), 'flag writer must strip stale --map_dir lines');
assert.ok((cmd.match(/^\s*write_map_flag\s*$/gm) || []).length >= 2, 'write_map_flag must be called in multiple paths');

// (3) A real restart (kill + relaunch dreamview) is always present.
assert.ok(/kill \$pids/.test(cmd), 'must kill running dreamview');
assert.ok(/cyber_launch[\s\S]*start/.test(cmd) || /"\$LAUNCH" start/.test(cmd), 'must relaunch dreamview');
assert.ok(/curl -fsS http:\/\/127\.0\.0\.1:8888\//.test(cmd), 'must verify dreamview came back up');

// (4) Graceful degradation: if the restart toolchain is unavailable but the hot
// switch succeeded, rely on it instead of failing the deploy.
assert.ok(/if \[ "\$SWITCHED" = "1" \]; then/.test(cmd), 'must fall back to hot switch when toolchain missing');

// The map dir must be shell-quoted into the command.
assert.ok(cmd.includes('2026-6-17-1_af2d5a96'), 'map dir must be embedded');

console.log(JSON.stringify({ checks: 8, mapSwitchForcesCleanRestart: true }));
console.log('[pass] edge-dreamview-switch');
