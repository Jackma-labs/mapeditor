'use strict';

// Shared closed-loop thresholds. The auto-split detector (splitClosedLanes) and
// the release-gate safety net (editorMapConverter buildReleaseQualityGate) MUST
// agree on what "closed/fold-back" means; defining this once prevents the two
// from drifting and producing inconsistent behaviour in the 1.5-2.0m band.
module.exports = {
  // A lane whose centerline returns to within this many meters of its start...
  CLOSED_LANE_MAX_CHORD_METERS: 2.0,
  // ...while being at least this long is treated as a closed loop / fold-back.
  CLOSED_LANE_MIN_LENGTH_METERS: 8.0,
};
