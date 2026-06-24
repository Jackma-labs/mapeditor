'use strict';
// Locks the edge map audit (completeness + orphan detection) and the deploy-time
// orphan-sibling cleanup command.
const assert = require('assert');
const { __test__ } = require('../backend/runtime');

function testParse() {
  const stdout = [
    'DIR\t2026_6_9_changqu5\t1\t1\t1',
    'DIR\thalf-finished\t1\t0\t0',
    'DIR\tbase-only\t1\t0\t0',
    'ORPHAN\t2026-6-23-XiaoQuanCeShi_default_cycle_routing.txt',
    'ACTIVE\t/apollo/modules/map/data/2026_6_9_changqu5',
  ].join('\n');
  const a = __test__.parseEdgeMapAudit(stdout);
  assert.strictEqual(a.summary.total, 3);
  assert.strictEqual(a.summary.complete, 1);
  assert.strictEqual(a.summary.partial, 2);
  assert.strictEqual(a.summary.orphans, 1);
  assert.deepStrictEqual(a.partial.sort(), ['base-only', 'half-finished']);
  assert.strictEqual(a.orphanedSiblings[0], '2026-6-23-XiaoQuanCeShi_default_cycle_routing.txt');
  assert.strictEqual(a.activeMapName, '2026_6_9_changqu5');
  assert.strictEqual(a.activeMapComplete, true);
  // A complete map is base+routing+sim.
  const complete = a.maps.find((m) => m.name === '2026_6_9_changqu5');
  assert.ok(complete.base && complete.routing && complete.sim && complete.complete);
  const broken = a.maps.find((m) => m.name === 'half-finished');
  assert.ok(broken.base && !broken.routing && !broken.complete);
}

function testAuditCommand() {
  const cmd = __test__.buildEdgeMapAuditCommand('/apollo/modules/map/data/');
  assert.ok(/base_map\.bin/.test(cmd) && /routing_map\.bin/.test(cmd) && /sim_map\.bin/.test(cmd), 'checks all 3 artifacts');
  assert.ok(/_default_cycle_routing\.txt/.test(cmd) && /ORPHAN/.test(cmd), 'detects orphan siblings');
  assert.ok(/--map_dir=/.test(cmd) && /ACTIVE/.test(cmd), 'reports active map');
  assert.ok(cmd.includes("'/apollo/modules/map/data'"), 'root shell-quoted, trailing slash trimmed');
}

function testOrphanCleanup() {
  const cmd = __test__.buildOrphanSiblingCleanupCommand('/apollo/modules/map/data');
  assert.ok(/\.mapeditor_orphans/.test(cmd), 'archives to .mapeditor_orphans (recoverable)');
  assert.ok(/if \[ ! -d "\$ROOT\/\$name" \]; then/.test(cmd), 'archives only when the map dir is gone');
  assert.ok(/mv "\$f" "\$ORPH\/"/.test(cmd), 'moves (not deletes) the orphan');
  assert.ok(/_default_cycle_routing\.txt/.test(cmd) && /_default_end_way_point\.txt/.test(cmd), 'covers both sibling kinds');
}

testParse();
testAuditCommand();
testOrphanCleanup();
console.log(JSON.stringify({ parse: 'ok', auditCommand: 'ok', orphanCleanup: 'ok' }));
console.log('[pass] edge-map-audit');
