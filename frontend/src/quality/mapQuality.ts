import { MapState } from 'src/interface/mapStateInterface';
import { Lane, LaneDireaciotn, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
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

function buildIssue(issues: MapQualityIssue[], issue: Omit<MapQualityIssue, 'id'> & { id?: string }) {
    issues.push({
        ...issue,
        id: issue.id || `${issue.target.type}-${issue.target.id || 'map'}-${issues.length}`,
    });
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
                    const distance = distanceBetweenEndpoints(from, to);
                    if (!bestGap || distance < bestGap.distance) {
                        bestGap = {
                            fromComponentId: fromComponent.id,
                            toComponentId: toComponent.id,
                            from,
                            to,
                            distance,
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
        buildIssue(issues, {
            severity: 'warning',
            title: '车道网络不连通',
            description: `当前车道网络被分成 ${laneComponents.length} 个连通块，可能是双向道路合法分离，也可能存在漏连。`,
            suggestion: '先检查下方列出的连通块和最近断点；如果这些车道属于同一条可行驶路线，请补齐前后继连接。',
            details: laneComponents
                .slice(0, 6)
                .map(
                    (component) =>
                        `连通块 ${component.id}（${component.laneIds.length} 条）：${formatReadableLaneIds(
                            component.laneIds,
                        )}`,
                )
                .concat(
                    nearestGaps
                        .slice(0, 5)
                        .map(
                            (gap) =>
                                `最近断点：连通块 ${gap.fromComponentId} ${formatEndpoint(gap.from)} ↔ 连通块 ${
                                    gap.toComponentId
                                } ${formatEndpoint(gap.to)}，中心距 ${gap.distance.toFixed(2)}m`,
                        ),
                ),
            target: {
                type: 'map',
            },
        });
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
        if (!signal.stopLineId || !mapState.stopLines[signal.stopLineId]) {
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
        if (sign.stopLineId && !mapState.stopLines[sign.stopLineId]) {
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
    if (target.type === 'trafficSignal' && target.id && mapState.trafficSignals[target.id]) {
        return {
            id: target.id,
            type: ThreeElementType.TrafficLight,
            threeObject: ThreeObject.TrafficLight,
        };
    }
    return null;
}
