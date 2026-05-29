import { MapState } from 'src/interface/mapStateInterface';
import { Lane, LaneDireaciotn, LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';

export type MapQualitySeverity = 'error' | 'warning';

export type MapQualityTargetType = 'map' | 'lane' | 'boundary' | 'point' | 'stopLine' | 'trafficSignal' | 'sign';

export interface MapQualityTarget {
    type: MapQualityTargetType;
    id?: string;
    groudId?: string;
    boundaryIds?: string[];
    pointIds?: string[];
}

export interface MapQualityIssue {
    id: string;
    severity: MapQualitySeverity;
    title: string;
    description: string;
    suggestion: string;
    details?: string[];
    target: MapQualityTarget;
}

export interface LaneRelation {
    laneId: string;
    predecessors: string[];
    successors: string[];
    leftNeighbors: string[];
    rightNeighbors: string[];
    startPointIds: [string | null, string | null];
    endPointIds: [string | null, string | null];
}

export interface MapQualityReport {
    issues: MapQualityIssue[];
    summary: {
        errors: number;
        warnings: number;
        lanes: number;
        laneEdges: number;
        laneComponents: number;
    };
    laneRelations: Record<string, LaneRelation>;
}

interface LaneComponent {
    id: number;
    laneIds: string[];
}

interface LaneEndpointInfo {
    laneId: string;
    endpoint: 'start' | 'end';
    pointIds: [string | null, string | null];
    center: { x: number; y: number };
}

interface ComponentGap {
    fromComponentId: number;
    toComponentId: number;
    from: LaneEndpointInfo;
    to: LaneEndpointInfo;
    distance: number;
}

const validLaneDirections = new Set<number>([
    LaneDireaciotn.STRAIGHT,
    LaneDireaciotn.TURN_LEFT,
    LaneDireaciotn.TURN_RIGHT,
    LaneDireaciotn.TURN_AROUND,
]);

const validPossibleDirections = new Set<number>([
    ProssibleDrivingDirection.FORWARD,
    ProssibleDrivingDirection.BACKWARD,
    ProssibleDrivingDirection.RELATIVEDIRECTION,
]);

const LANE_MIN_USABLE_WIDTH_METERS = 1.8;
const LANE_NARROW_WIDTH_WARNING_METERS = 2.6;
const LANE_HARD_TURN_RADIUS_ERROR_METERS = 2.0;
const LANE_STRICT_TURN_RADIUS_ERROR_METERS = 3.0;
const LANE_MIN_TURN_RADIUS_WARNING_METERS = 4.5;
const LANE_LOW_SPEED_TURN_KPH = 10;
const LANE_MAX_SPEED_WARNING_KPH = 120;
const LANE_RECOVERABLE_TURN_WIDTH_METERS = 2.6;
const LANE_SUCCESSOR_SHARP_ANGLE_ERROR_DEGREES = 100;
const LANE_SUCCESSOR_SHARP_ANGLE_WARNING_DEGREES = 65;
const CURVE_SAMPLE_COUNT = 17;

interface Point2D {
    x: number;
    y: number;
    z?: number;
}

interface LaneGeometryAudit {
    leftPoints: Point2D[];
    rightPoints: Point2D[];
    centerPoints: Point2D[];
    minWidth: number;
    minTurnRadius: number;
    boundaryIntersects: boolean;
}

function buildIssue(issues: MapQualityIssue[], issue: Omit<MapQualityIssue, 'id'> & { id?: string }) {
    issues.push({
        ...issue,
        id: issue.id || `${issue.target.type}-${issue.target.id || 'map'}-${issues.length}`,
    });
}

function distance(left: Point2D, right: Point2D) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function cubicBezier(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
    const u = 1 - t;
    return {
        x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
        y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
        z: (p0.z || 0) * u ** 3 + 3 * (p1.z || 0) * u ** 2 * t + 3 * (p2.z || 0) * u * t ** 2 + (p3.z || 0) * t ** 3,
    };
}

function polylineLength(points: Point2D[]) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += distance(points[index - 1], points[index]);
    }
    return total;
}

function interpolatePolyline(points: Point2D[], ratio: number): Point2D {
    if (points.length === 0) {
        return { x: 0, y: 0, z: 0 };
    }
    if (points.length === 1) {
        return points[0];
    }
    const total = polylineLength(points);
    if (total <= 0) {
        return points[0];
    }
    const target = Math.max(0, Math.min(1, ratio)) * total;
    let walked = 0;
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const segmentLength = distance(start, end);
        if (walked + segmentLength >= target) {
            const localRatio = segmentLength > 0 ? (target - walked) / segmentLength : 0;
            return {
                x: start.x + (end.x - start.x) * localRatio,
                y: start.y + (end.y - start.y) * localRatio,
                z: (start.z || 0) + ((end.z || 0) - (start.z || 0)) * localRatio,
            };
        }
        walked += segmentLength;
    }
    return points[points.length - 1];
}

function resamplePolyline(points: Point2D[], count: number) {
    return Array.from({ length: count }, (_unused, index) =>
        interpolatePolyline(points, count === 1 ? 0 : index / (count - 1)),
    );
}

function orientation(a: Point2D, b: Point2D, c: Point2D) {
    return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function pointOnSegment(a: Point2D, b: Point2D, c: Point2D) {
    return (
        Math.min(a.x, c.x) - 0.001 <= b.x &&
        b.x <= Math.max(a.x, c.x) + 0.001 &&
        Math.min(a.y, c.y) - 0.001 <= b.y &&
        b.y <= Math.max(a.y, c.y) + 0.001
    );
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D) {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);
    if (o1 * o2 < 0 && o3 * o4 < 0) {
        return true;
    }
    if (Math.abs(o1) <= 0.001 && pointOnSegment(a1, b1, a2)) return true;
    if (Math.abs(o2) <= 0.001 && pointOnSegment(a1, b2, a2)) return true;
    if (Math.abs(o3) <= 0.001 && pointOnSegment(b1, a1, b2)) return true;
    if (Math.abs(o4) <= 0.001 && pointOnSegment(b1, a2, b2)) return true;
    return false;
}

function polylinesIntersect(left: Point2D[], right: Point2D[]) {
    for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
            if (segmentsIntersect(left[leftIndex - 1], left[leftIndex], right[rightIndex - 1], right[rightIndex])) {
                return true;
            }
        }
    }
    return false;
}

function getBoundaryGeometryPoints(mapState: MapState, boundaryId: string, reverse: boolean): Point2D[] {
    const boundary = mapState.boundarys[boundaryId];
    if (!boundary) {
        return [];
    }
    const orderedPointIds = reverse ? [...boundary.pointIds].reverse() : [...boundary.pointIds];
    const points = orderedPointIds.map((pointId) => mapState.points[pointId]?.position).filter(Boolean);
    if (points.length >= 2 && boundary.controlsPosition?.length >= 2) {
        return Array.from({ length: CURVE_SAMPLE_COUNT }, (_unused, index) =>
            cubicBezier(
                points[0],
                boundary.controlsPosition[0],
                boundary.controlsPosition[1],
                points[points.length - 1],
                index / (CURVE_SAMPLE_COUNT - 1),
            ),
        );
    }
    return points;
}

function getPolylineMinRadius(points: Point2D[]) {
    let minRadius = Infinity;
    for (let index = 1; index < points.length - 1; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        const c = points[index + 1];
        const ab = distance(a, b);
        const bc = distance(b, c);
        const ac = distance(a, c);
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
        if (area >= 0.000001 && ab * bc * ac !== 0) {
            minRadius = Math.min(minRadius, (ab * bc * ac) / (4 * area));
        }
    }
    return minRadius;
}

function auditLaneGeometry(mapState: MapState, lane: Lane): LaneGeometryAudit | null {
    const leftPoints = getBoundaryGeometryPoints(mapState, lane.leftBoundaryId, lane.leftBoundaryReverse);
    const rightPoints = getBoundaryGeometryPoints(mapState, lane.rightBoundaryId, lane.rightBoundaryReverse);
    if (leftPoints.length < 2 || rightPoints.length < 2) {
        return null;
    }
    const sampleCount = Math.max(leftPoints.length, rightPoints.length, 3);
    const leftSamples = resamplePolyline(leftPoints, sampleCount);
    const rightSamples = resamplePolyline(rightPoints, sampleCount);
    const widths = leftSamples.map((leftPoint, index) => distance(leftPoint, rightSamples[index]));
    const centerPoints = leftSamples.map((leftPoint, index) => ({
        x: (leftPoint.x + rightSamples[index].x) / 2,
        y: (leftPoint.y + rightSamples[index].y) / 2,
        z: ((leftPoint.z || 0) + (rightSamples[index].z || 0)) / 2,
    }));
    return {
        leftPoints,
        rightPoints,
        centerPoints,
        minWidth: Math.min(...widths),
        minTurnRadius: getPolylineMinRadius(centerPoints),
        boundaryIntersects: polylinesIntersect(leftPoints, rightPoints),
    };
}

function isRecoverableLowSpeedTurn(lane: Lane, laneGeometryAudit: LaneGeometryAudit) {
    const laneDirection = Number(lane.attr?.direction);
    const laneSpeed = Number(lane.attr?.speed);
    const isLowSpeedSetting = Number.isFinite(laneSpeed) && laneSpeed <= LANE_LOW_SPEED_TURN_KPH;
    const isTurnGeometry =
        lane.type === LaneTrend.Curve ||
        laneDirection === LaneDireaciotn.TURN_LEFT ||
        laneDirection === LaneDireaciotn.TURN_RIGHT ||
        laneDirection === LaneDireaciotn.TURN_AROUND;
    return (
        isLowSpeedSetting &&
        isTurnGeometry &&
        laneGeometryAudit.minWidth >= LANE_RECOVERABLE_TURN_WIDTH_METERS &&
        laneGeometryAudit.minTurnRadius >= LANE_HARD_TURN_RADIUS_ERROR_METERS
    );
}

function getLaneEndpointDirection(mapState: MapState, lane: Lane, endpoint: 'start' | 'end') {
    const audit = auditLaneGeometry(mapState, lane);
    const points = audit?.centerPoints || [];
    if (points.length < 2) {
        return null;
    }
    const start = endpoint === 'start' ? points[0] : points[points.length - 2];
    const end = endpoint === 'start' ? points[1] : points[points.length - 1];
    const length = distance(start, end);
    if (length <= 0.001) {
        return null;
    }
    return {
        x: (end.x - start.x) / length,
        y: (end.y - start.y) / length,
    };
}

function angleBetweenDirections(left: Point2D, right: Point2D) {
    const dot = Math.max(-1, Math.min(1, left.x * right.x + left.y * right.y));
    return (Math.acos(dot) * 180) / Math.PI;
}

function resolveStopLineBoundaryId(mapState: MapState, stopLineId: string) {
    const stopLine = mapState.stopLines[stopLineId];
    if (stopLine?.boundaryId && mapState.boundarys[stopLine.boundaryId]) {
        return stopLine.boundaryId;
    }
    if (Number(mapState.boundarys[stopLineId]?.type) === ThreeElementType.StopLineBoundary) {
        return stopLineId;
    }
    return '';
}

function getLaneStartPointIds(mapState: MapState, lane: Lane): [string | null, string | null] {
    const leftBoundary = mapState.boundarys[lane.leftBoundaryId];
    const rightBoundary = mapState.boundarys[lane.rightBoundaryId];
    if (!leftBoundary || !rightBoundary) {
        return [null, null];
    }
    const leftPoints = leftBoundary.pointIds || [];
    const rightPoints = rightBoundary.pointIds || [];
    const leftStart = lane.leftBoundaryReverse ? leftPoints[leftPoints.length - 1] : leftPoints[0];
    const rightStart = lane.rightBoundaryReverse ? rightPoints[rightPoints.length - 1] : rightPoints[0];
    return [leftStart || null, rightStart || null];
}

function getLaneEndPointIds(mapState: MapState, lane: Lane): [string | null, string | null] {
    const leftBoundary = mapState.boundarys[lane.leftBoundaryId];
    const rightBoundary = mapState.boundarys[lane.rightBoundaryId];
    if (!leftBoundary || !rightBoundary) {
        return [null, null];
    }
    const leftPoints = leftBoundary.pointIds || [];
    const rightPoints = rightBoundary.pointIds || [];
    const leftEnd = lane.leftBoundaryReverse ? leftPoints[0] : leftPoints[leftPoints.length - 1];
    const rightEnd = lane.rightBoundaryReverse ? rightPoints[0] : rightPoints[rightPoints.length - 1];
    return [leftEnd || null, rightEnd || null];
}

function samePointPair(left: [string | null, string | null], right: [string | null, string | null]) {
    return Boolean(left[0] && left[1] && left[0] === right[0] && left[1] === right[1]);
}

export function buildLaneRelations(mapState: MapState): Record<string, LaneRelation> {
    const lanes = Object.values(mapState.lanes);
    const relations: Record<string, LaneRelation> = {};
    lanes.forEach((lane) => {
        relations[lane.id] = {
            laneId: lane.id,
            predecessors: [],
            successors: [],
            leftNeighbors: [],
            rightNeighbors: [],
            startPointIds: getLaneStartPointIds(mapState, lane),
            endPointIds: getLaneEndPointIds(mapState, lane),
        };
    });

    lanes.forEach((lane) => {
        const relation = relations[lane.id];
        lanes.forEach((otherLane) => {
            if (otherLane.id === lane.id) {
                return;
            }
            const otherRelation = relations[otherLane.id];
            if (samePointPair(otherRelation.startPointIds, relation.endPointIds)) {
                relation.successors.push(otherLane.id);
            }
            if (samePointPair(otherRelation.endPointIds, relation.startPointIds)) {
                relation.predecessors.push(otherLane.id);
            }
            if ([otherLane.leftBoundaryId, otherLane.rightBoundaryId].includes(lane.leftBoundaryId)) {
                relation.leftNeighbors.push(otherLane.id);
            }
            if ([otherLane.leftBoundaryId, otherLane.rightBoundaryId].includes(lane.rightBoundaryId)) {
                relation.rightNeighbors.push(otherLane.id);
            }
        });
    });
    return relations;
}

function buildLaneComponents(relations: Record<string, LaneRelation>): LaneComponent[] {
    const laneIds = Object.keys(relations);
    const visited = new Set<string>();
    const components: LaneComponent[] = [];
    laneIds.forEach((laneId) => {
        if (visited.has(laneId)) {
            return;
        }
        const laneIdsInComponent: string[] = [];
        const queue = [laneId];
        visited.add(laneId);
        while (queue.length > 0) {
            const current = queue.shift();
            laneIdsInComponent.push(current);
            const relation = relations[current];
            const nextLaneIds = [...relation.predecessors, ...relation.successors];
            nextLaneIds.forEach((nextLaneId) => {
                if (!visited.has(nextLaneId) && relations[nextLaneId]) {
                    visited.add(nextLaneId);
                    queue.push(nextLaneId);
                }
            });
        }
        components.push({
            id: components.length + 1,
            laneIds: laneIdsInComponent,
        });
    });
    return components;
}

function formatLaneIds(laneIds: string[]) {
    if (laneIds.length === 0) {
        return '无';
    }
    const visibleLaneIds = laneIds.slice(0, 5).join('、');
    if (laneIds.length > 5) {
        return `${visibleLaneIds} 等 ${laneIds.length} 条`;
    }
    return visibleLaneIds;
}

function formatReadableLaneIds(laneIds: string[]) {
    if (laneIds.length === 0) {
        return '无';
    }
    const visibleLaneIds = laneIds.slice(0, 8).join('、');
    if (laneIds.length > 8) {
        return `${visibleLaneIds} 等 ${laneIds.length} 条`;
    }
    return visibleLaneIds;
}

function buildLaneRelationDetails(
    relation: LaneRelation,
    laneComponentIndex: Record<string, number>,
    extraDetails: string[] = [],
) {
    return [
        `前驱：${formatLaneIds(relation.predecessors)}`,
        `后继：${formatLaneIds(relation.successors)}`,
        `拓扑区域：${laneComponentIndex[relation.laneId] || 1}`,
        ...extraDetails,
    ];
}

function getLaneTarget(mapState: MapState, lane: Lane): MapQualityTarget {
    return {
        type: 'lane',
        id: lane.id,
        groudId: lane.groudId,
        boundaryIds: [lane.leftBoundaryId, lane.rightBoundaryId].filter(Boolean),
    };
}

function getEndpointCenter(mapState: MapState, pointIds: [string | null, string | null]) {
    const leftPoint = pointIds[0] ? mapState.points[pointIds[0]] : null;
    const rightPoint = pointIds[1] ? mapState.points[pointIds[1]] : null;
    if (!leftPoint || !rightPoint) {
        return null;
    }
    return {
        x: (leftPoint.position.x + rightPoint.position.x) / 2,
        y: (leftPoint.position.y + rightPoint.position.y) / 2,
    };
}

function getLaneEndpointsForGap(mapState: MapState, relation: LaneRelation): LaneEndpointInfo[] {
    const startCenter = getEndpointCenter(mapState, relation.startPointIds);
    const endCenter = getEndpointCenter(mapState, relation.endPointIds);
    return [
        startCenter && {
            laneId: relation.laneId,
            endpoint: 'start' as const,
            pointIds: relation.startPointIds,
            center: startCenter,
        },
        endCenter && {
            laneId: relation.laneId,
            endpoint: 'end' as const,
            pointIds: relation.endPointIds,
            center: endCenter,
        },
    ].filter(Boolean) as LaneEndpointInfo[];
}

function distanceBetweenEndpoints(left: LaneEndpointInfo, right: LaneEndpointInfo) {
    return Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y);
}

function formatEndpoint(endpoint: LaneEndpointInfo) {
    const endpointLabel = endpoint.endpoint === 'start' ? '起点' : '终点';
    return `车道 ${endpoint.laneId} ${endpointLabel}(${formatReadableLaneIds(
        endpoint.pointIds.filter(Boolean) as string[],
    )})`;
}

function findNearestComponentGaps(
    mapState: MapState,
    laneComponents: LaneComponent[],
    relations: Record<string, LaneRelation>,
) {
    const gaps: ComponentGap[] = [];
    for (let i = 0; i < laneComponents.length; i += 1) {
        for (let j = i + 1; j < laneComponents.length; j += 1) {
            const fromComponent = laneComponents[i];
            const toComponent = laneComponents[j];
            const fromEndpoints = fromComponent.laneIds.flatMap((laneId) =>
                getLaneEndpointsForGap(mapState, relations[laneId]),
            );
            const toEndpoints = toComponent.laneIds.flatMap((laneId) =>
                getLaneEndpointsForGap(mapState, relations[laneId]),
            );
            let bestGap: ComponentGap = null;
            fromEndpoints.forEach((from) => {
                toEndpoints.forEach((to) => {
                    const endpointDistance = distanceBetweenEndpoints(from, to);
                    if (!bestGap || endpointDistance < bestGap.distance) {
                        bestGap = {
                            fromComponentId: fromComponent.id,
                            toComponentId: toComponent.id,
                            from,
                            to,
                            distance: endpointDistance,
                        };
                    }
                });
            });
            if (bestGap) {
                gaps.push(bestGap);
            }
        }
    }
    return gaps.sort((left, right) => left.distance - right.distance);
}

export function inspectMapQuality(mapState: MapState): MapQualityReport {
    const issues: MapQualityIssue[] = [];
    const lanes = Object.values(mapState.lanes);
    const relations = buildLaneRelations(mapState);
    const laneEdges = Object.values(relations).reduce((sum, relation) => sum + relation.successors.length, 0);
    const laneComponents = buildLaneComponents(relations);
    const laneComponentIndex: Record<string, number> = {};
    laneComponents.forEach((component) => {
        component.laneIds.forEach((laneId) => {
            laneComponentIndex[laneId] = component.id;
        });
    });
    const hasDraftGeometry =
        lanes.length > 0 ||
        Object.keys(mapState.boundarys).length > 0 ||
        Object.keys(mapState.grouds).length > 0 ||
        Object.keys(mapState.stopLines).length > 0 ||
        Object.keys(mapState.trafficSignals).length > 0 ||
        Object.keys(mapState.signs).length > 0;

    if (hasDraftGeometry && lanes.length === 0) {
        buildIssue(issues, {
            severity: 'error',
            title: '地图没有车道',
            description: '发布 Apollo 地图包至少需要完整车道，否则 Dreamview 无法生成路线。',
            suggestion: '先按车道绘制流程生成主车道，再补充停止线、交通灯和标志。',
            target: {
                type: 'map',
            },
        });
    }

    Object.values(mapState.boundarys).forEach((boundary) => {
        const pointIds = boundary.pointIds || [];
        if (pointIds.length < 2) {
            buildIssue(issues, {
                severity: 'error',
                title: `边界 ${boundary.id} 点数不足`,
                description: '边界至少需要两个点才能形成有效线段。',
                suggestion: '补齐边界点，或删除这条无效边界后重新绘制。',
                target: {
                    type: 'boundary',
                    id: boundary.id,
                    pointIds,
                },
            });
        }
        pointIds.forEach((pointId) => {
            if (!mapState.points[pointId]) {
                buildIssue(issues, {
                    severity: 'error',
                    title: `边界 ${boundary.id} 引用了不存在的点`,
                    description: `点 ${pointId} 不在当前地图点集中，后续转换和渲染都会不稳定。`,
                    suggestion: '删除该边界并重新绘制，或撤销导致点丢失的操作。',
                    target: {
                        type: 'boundary',
                        id: boundary.id,
                        pointIds: [pointId],
                    },
                });
            }
        });
    });

    lanes.forEach((lane) => {
        const target = getLaneTarget(mapState, lane);
        const leftBoundary = mapState.boundarys[lane.leftBoundaryId];
        const rightBoundary = mapState.boundarys[lane.rightBoundaryId];
        const relation = relations[lane.id];

        if (!leftBoundary || !rightBoundary) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 缺少左右边界`,
                description: '车道必须同时拥有左边界和右边界，否则无法生成稳定的 Apollo lane。',
                suggestion: '重新绘制车道，或修复车道属性中的左右边界引用。',
                details: [`左边界：${lane.leftBoundaryId || '无'}`, `右边界：${lane.rightBoundaryId || '无'}`],
                target,
            });
            return;
        }
        if (!mapState.grouds[lane.groudId]) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 缺少面对象`,
                description: '车道缺少可选择和高亮的面对象，可能由异常拆分或导入造成。',
                suggestion: '重新生成车道或撤销异常操作后再保存。',
                details: buildLaneRelationDetails(relation, laneComponentIndex, [`面对象：${lane.groudId || '无'}`]),
                target,
            });
        }
        if (!validLaneDirections.has(Number(lane.attr?.direction))) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 行驶方向未设置`,
                description: '发布和仿真需要明确直行、左转、右转或掉头方向。',
                suggestion: '选中该车道，在属性面板设置正确方向。',
                details: buildLaneRelationDetails(relation, laneComponentIndex),
                target,
            });
        }
        if (!validPossibleDirections.has(Number(lane.attr?.prossibleDrivingDirection))) {
            buildIssue(issues, {
                severity: 'warning',
                title: `车道 ${lane.id} 相对方向未设置`,
                description: '相邻车道关系缺少同向、反向或双向语义，后续自动连接可能误判。',
                suggestion: '选中该车道，在属性面板确认相对方向。',
                details: buildLaneRelationDetails(relation, laneComponentIndex),
                target,
            });
        }
        const laneSpeedKph = Number(lane.attr?.speed);
        if (!Number.isFinite(laneSpeedKph) || laneSpeedKph < 1) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 限速无效`,
                description: '限速必须是大于 0 的 km/h 数值，否则导出 Apollo 时无法生成可靠速度限制。',
                suggestion: '选中该车道，在属性面板重新输入 km/h 限速。',
                details: buildLaneRelationDetails(relation, laneComponentIndex, [
                    `当前限速：${lane.attr?.speed ?? '未设置'} km/h`,
                ]),
                target,
            });
        } else if (laneSpeedKph > LANE_MAX_SPEED_WARNING_KPH) {
            buildIssue(issues, {
                severity: 'warning',
                title: `车道 ${lane.id} 限速过高`,
                description: `当前限速为 ${laneSpeedKph} km/h，园区或低速车场景下通常需要复核。`,
                suggestion: '确认这里不是把 m/s 当成 km/h 输入；发布后 Apollo 会按 km/h 换算成 m/s。',
                details: buildLaneRelationDetails(relation, laneComponentIndex, [
                    `Apollo 写入约 ${(laneSpeedKph / 3.6).toFixed(2)} m/s`,
                ]),
                target,
            });
        }
        const laneGeometryAudit = auditLaneGeometry(mapState, lane);
        if (laneGeometryAudit) {
            if (laneGeometryAudit.boundaryIntersects) {
                buildIssue(issues, {
                    severity: 'error',
                    title: `车道 ${lane.id} 左右边界相交`,
                    description: '车道左右边界发生交叉，Apollo 可能生成无效可行驶区域，车辆可能无法通过。',
                    suggestion: '调整车道端点或弯道控制点，确保左右边界全程不交叉。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `左边界：${lane.leftBoundaryId}`,
                        `右边界：${lane.rightBoundaryId}`,
                    ]),
                    target,
                });
            }
            if (laneGeometryAudit.minWidth < LANE_MIN_USABLE_WIDTH_METERS) {
                buildIssue(issues, {
                    severity: 'error',
                    title: `车道 ${lane.id} 宽度塌缩`,
                    description: `车道最窄处只有 ${laneGeometryAudit.minWidth.toFixed(
                        2,
                    )}m，低于车辆稳定通过所需的最小宽度。`,
                    suggestion: '加宽车道，或重新生成连接段，让最小宽度保持在 1.8m 以上。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `最小宽度：${laneGeometryAudit.minWidth.toFixed(2)}m`,
                    ]),
                    target,
                });
            } else if (laneGeometryAudit.minWidth < LANE_NARROW_WIDTH_WARNING_METERS) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 偏窄`,
                    description: `车道最窄处为 ${laneGeometryAudit.minWidth.toFixed(
                        2,
                    )}m，特殊场景可能有效，但会降低仿真容错。`,
                    suggestion: '检查车道宽度，尤其是自动生成的弯道和合流段。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `最小宽度：${laneGeometryAudit.minWidth.toFixed(2)}m`,
                    ]),
                    target,
                });
            }
            const recoverableLowSpeedTurn = isRecoverableLowSpeedTurn(lane, laneGeometryAudit);
            if (
                laneGeometryAudit.minTurnRadius < LANE_HARD_TURN_RADIUS_ERROR_METERS ||
                (laneGeometryAudit.minTurnRadius < LANE_STRICT_TURN_RADIUS_ERROR_METERS && !recoverableLowSpeedTurn)
            ) {
                buildIssue(issues, {
                    severity: 'error',
                    title: `车道 ${lane.id} 转弯半径过小`,
                    description: `中心线最小半径为 ${laneGeometryAudit.minTurnRadius.toFixed(
                        2,
                    )}m，对 Apollo 仿真和车辆通过来说过急。`,
                    suggestion: '使用更平顺的弯道连接，或先把端点拉开后再发布。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `最小半径：${laneGeometryAudit.minTurnRadius.toFixed(2)}m`,
                    ]),
                    target,
                });
            } else if (laneGeometryAudit.minTurnRadius < LANE_MIN_TURN_RADIUS_WARNING_METERS) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 转弯半径偏小`,
                    description: `中心线最小半径为 ${laneGeometryAudit.minTurnRadius.toFixed(
                        2,
                    )}m，车辆可能需要更低速度或更平顺的连接段。`,
                    suggestion: '在 Dreamview 中检查该转弯；如果车辆犹豫或压线，需要拉开端点并重建连接。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `最小半径：${laneGeometryAudit.minTurnRadius.toFixed(2)}m`,
                    ]),
                    target,
                });
            }
        }
        if (
            !relation.startPointIds[0] ||
            !relation.startPointIds[1] ||
            !relation.endPointIds[0] ||
            !relation.endPointIds[1]
        ) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 起终点不完整`,
                description: '左右边界起点或终点缺失，车道方向和前后继无法可靠判断。',
                suggestion: '检查左右边界点，确保每条边界至少有两个有效点。',
                details: [
                    `起点：${formatLaneIds(relation.startPointIds.filter(Boolean) as string[])}`,
                    `终点：${formatLaneIds(relation.endPointIds.filter(Boolean) as string[])}`,
                ],
                target,
            });
        }
        if (relation.predecessors.length === 0 && relation.successors.length === 0 && lanes.length > 1) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 是孤立车道`,
                description: '该车道没有任何前驱或后继，车辆无法从路网中进入或离开。',
                suggestion: '使用自动连接或手动连接，把该车道接入正确的前后车道。',
                details: buildLaneRelationDetails(relation, laneComponentIndex, [
                    '选中该车道和相邻目标车道后使用直道连接或弯道连接。',
                ]),
                target,
            });
        } else {
            if (relation.predecessors.length === 0 && lanes.length > 1) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 没有前驱`,
                    description: '该车道可能是合法入口，也可能是断头；发布前需要确认。',
                    suggestion: '如果不是地图入口，请连接到上一段车道。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex),
                    target,
                });
            }
            if (relation.successors.length === 0 && lanes.length > 1) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 没有后继`,
                    description: '该车道可能是合法出口，也可能是断头；仿真路线可能无法继续。',
                    suggestion: '如果不是地图出口，请连接到下一段车道。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex),
                    target,
                });
            }
        }
        relation.successors.forEach((successorLaneId) => {
            const successorLane = mapState.lanes[successorLaneId];
            if (!successorLane) {
                return;
            }
            const currentDirection = getLaneEndpointDirection(mapState, lane, 'end');
            const successorDirection = getLaneEndpointDirection(mapState, successorLane, 'start');
            if (!currentDirection || !successorDirection) {
                return;
            }
            const angle = angleBetweenDirections(currentDirection, successorDirection);
            if (angle >= LANE_SUCCESSOR_SHARP_ANGLE_ERROR_DEGREES) {
                buildIssue(issues, {
                    severity: 'error',
                    title: `车道 ${lane.id} 到 ${successorLaneId} 方向断裂`,
                    description: `两条车道共享端点，但航向突变 ${angle.toFixed(1)} 度，拓扑已连接但几何过渡不稳定。`,
                    suggestion: '插入弯道连接段，或调整端点方向让连接更平顺。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `后继：${successorLaneId}`,
                        `航向变化：${angle.toFixed(1)} 度`,
                    ]),
                    target,
                });
            } else if (angle >= LANE_SUCCESSOR_SHARP_ANGLE_WARNING_DEGREES) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 到 ${successorLaneId} 转向突变`,
                    description: `两条车道连接处航向变化 ${angle.toFixed(
                        1,
                    )} 度，路口场景可能合理，但通常应使用弯道连接段表达。`,
                    suggestion: '检查这里是否需要单独的转弯连接段。',
                    details: buildLaneRelationDetails(relation, laneComponentIndex, [
                        `后继：${successorLaneId}`,
                        `航向变化：${angle.toFixed(1)} 度`,
                    ]),
                    target,
                });
            }
        });
    });

    if (lanes.length > 2 && laneEdges < lanes.length - 1) {
        buildIssue(issues, {
            severity: 'error',
            title: '车道拓扑连接不足',
            description: `当前 ${lanes.length} 条车道只有 ${laneEdges} 条前后继连接，路网没有形成可连续导航的拓扑。`,
            suggestion: '先用自动连接检查断点，再逐段补齐前驱和后继。',
            details: [`车道总数：${lanes.length}`, `前后继连接：${laneEdges}`, `拓扑区域：${laneComponents.length}`],
            target: {
                type: 'map',
            },
        });
    }

    if (lanes.length > 1 && laneComponents.length > 1) {
        const nearestGaps = findNearestComponentGaps(mapState, laneComponents, relations);
        const actionableGaps = nearestGaps.filter((gap) => gap.distance <= 6);
        const isolatedComponents = laneComponents.filter((component) => component.laneIds.length === 1);
        actionableGaps.slice(0, 12).forEach((gap) => {
            buildIssue(issues, {
                id: `topology-gap-${gap.from.laneId}-${gap.to.laneId}-${gap.from.endpoint}-${gap.to.endpoint}`,
                severity: 'warning',
                title: `车道 ${gap.from.laneId} 到 ${gap.to.laneId} 疑似断点`,
                description: `两个拓扑区域的端点距离 ${gap.distance.toFixed(2)}m，可能需要直道连接或弯道连接。`,
                suggestion: '点击后检查两个端点；如果它们属于同一条可通行路线，请用直道连接或弯道连接补齐。',
                details: [
                    `来源：${formatEndpoint(gap.from)}`,
                    `目标：${formatEndpoint(gap.to)}`,
                    `中心距离：${gap.distance.toFixed(2)}m`,
                ],
                target: {
                    type: 'point',
                    pointIds: [...gap.from.pointIds, ...gap.to.pointIds].filter(Boolean) as string[],
                },
            });
        });
        isolatedComponents.slice(0, 12).forEach((component) => {
            const laneId = component.laneIds[0];
            const lane = mapState.lanes[laneId];
            if (!lane) {
                return;
            }
            buildIssue(issues, {
                id: `topology-isolated-${laneId}`,
                severity: 'warning',
                title: `车道 ${laneId} 位于孤立拓扑区域`,
                description: '该车道所在连通块只有一条车道，可能是合法入口/出口，也可能是漏连断点。',
                suggestion: '点击定位后检查前后端点；如果不是地图入口或出口，请补齐前驱或后继连接。',
                details: buildLaneRelationDetails(relations[laneId], laneComponentIndex),
                target: getLaneTarget(mapState, lane),
            });
        });
        if (actionableGaps.length > 0 || isolatedComponents.length > 0) {
            buildIssue(issues, {
                severity: 'warning',
                title: '车道网络存在可疑断点',
                description: `当前车道网络被分成 ${laneComponents.length} 个连通块；系统只在发现近距离断点或孤岛车道时提示，避免把合法双向车道误报成问题。`,
                suggestion: '优先检查下方最近断点和孤岛车道；如果这些车道属于同一条可行驶路线，请补齐前后继连接。',
                details: laneComponents
                    .slice(0, 6)
                    .map(
                        (component) =>
                            `连通块 ${component.id}（${component.laneIds.length} 条）：${formatReadableLaneIds(
                                component.laneIds,
                            )}`,
                    )
                    .concat(
                        actionableGaps
                            .slice(0, 5)
                            .map(
                                (gap) =>
                                    `最近断点：连通块 ${gap.fromComponentId} ${formatEndpoint(gap.from)} -> 连通块 ${
                                        gap.toComponentId
                                    } ${formatEndpoint(gap.to)}，中心距 ${gap.distance.toFixed(2)}m`,
                            ),
                    )
                    .concat(
                        isolatedComponents
                            .slice(0, 5)
                            .map(
                                (component) =>
                                    `孤岛车道：连通块 ${component.id}，${formatReadableLaneIds(component.laneIds)}`,
                            ),
                    ),
                target: {
                    type: 'map',
                },
            });
        }
    }

    Object.values(mapState.stopLines).forEach((stopLine) => {
        if (!mapState.boundarys[stopLine.boundaryId]) {
            buildIssue(issues, {
                severity: 'error',
                title: `停止线 ${stopLine.id} 缺少边界`,
                description: '停止线没有有效边界，信号灯和让行关系无法定位。',
                suggestion: '重新绘制停止线，或修复停止线边界引用。',
                target: {
                    type: 'stopLine',
                    id: stopLine.id,
                    boundaryIds: [stopLine.boundaryId],
                },
            });
        }
    });

    Object.values(mapState.trafficSignals).forEach((signal) => {
        if (!signal.stopLineId || !resolveStopLineBoundaryId(mapState, signal.stopLineId)) {
            buildIssue(issues, {
                severity: 'error',
                title: `交通灯 ${signal.id} 未关联停止线`,
                description: '交通灯必须知道控制哪条停止线，否则车辆不知道在哪里停车。',
                suggestion: '为交通灯选择正确停止线，或先补画停止线。',
                target: {
                    type: 'trafficSignal',
                    id: signal.id,
                },
            });
        }
    });

    Object.values(mapState.signs).forEach((sign) => {
        if (sign.stopLineId && !resolveStopLineBoundaryId(mapState, sign.stopLineId)) {
            buildIssue(issues, {
                severity: 'error',
                title: `标志 ${sign.id} 关联的停止线不存在`,
                description: '停车或让行标志关联到了不存在的停止线。',
                suggestion: '重新选择标志对应的停止线。',
                target: {
                    type: 'sign',
                    id: sign.id,
                },
            });
        }
    });

    return {
        issues,
        summary: {
            errors: issues.filter((item) => item.severity === 'error').length,
            warnings: issues.filter((item) => item.severity === 'warning').length,
            lanes: lanes.length,
            laneEdges,
            laneComponents: laneComponents.length,
        },
        laneRelations: relations,
    };
}

export function pickElementFromIssue(mapState: MapState, issue: MapQualityIssue) {
    const { target } = issue;
    if (target.type === 'lane' && target.groudId && mapState.grouds[target.groudId]) {
        return {
            id: target.groudId,
            type: mapState.grouds[target.groudId].type,
            threeObject: ThreeObject.Groud,
        };
    }
    if (target.type === 'boundary' && target.id && mapState.boundarys[target.id]) {
        return {
            id: target.id,
            type: mapState.boundarys[target.id].type,
            threeObject: ThreeObject.Boundary,
        };
    }
    if (target.type === 'point' && target.id && mapState.points[target.id]) {
        return {
            id: target.id,
            type: mapState.points[target.id].type,
            threeObject: ThreeObject.Point,
        };
    }
    if (target.type === 'point' && target.pointIds?.[0] && mapState.points[target.pointIds[0]]) {
        return {
            id: target.pointIds[0],
            type: mapState.points[target.pointIds[0]].type,
            threeObject: ThreeObject.Point,
        };
    }
    if (target.type === 'trafficSignal' && target.id && mapState.trafficSignals[target.id]) {
        return {
            id: target.id,
            type: ThreeElementType.TrafficLight,
            threeObject: ThreeObject.TrafficLight,
        };
    }
    return null;
}
