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

function countLaneComponents(relations: Record<string, LaneRelation>) {
    const laneIds = Object.keys(relations);
    const visited = new Set<string>();
    let components = 0;
    laneIds.forEach((laneId) => {
        if (visited.has(laneId)) {
            return;
        }
        components += 1;
        const queue = [laneId];
        visited.add(laneId);
        while (queue.length > 0) {
            const current = queue.shift();
            const relation = relations[current];
            const nextLaneIds = [
                ...relation.predecessors,
                ...relation.successors,
                ...relation.leftNeighbors,
                ...relation.rightNeighbors,
            ];
            nextLaneIds.forEach((nextLaneId) => {
                if (!visited.has(nextLaneId) && relations[nextLaneId]) {
                    visited.add(nextLaneId);
                    queue.push(nextLaneId);
                }
            });
        }
    });
    return components;
}

function getLaneTarget(mapState: MapState, lane: Lane): MapQualityTarget {
    return {
        type: 'lane',
        id: lane.id,
        groudId: lane.groudId,
        boundaryIds: [lane.leftBoundaryId, lane.rightBoundaryId].filter(Boolean),
    };
}

export function inspectMapQuality(mapState: MapState): MapQualityReport {
    const issues: MapQualityIssue[] = [];
    const lanes = Object.values(mapState.lanes);
    const relations = buildLaneRelations(mapState);
    const laneEdges = Object.values(relations).reduce((sum, relation) => sum + relation.successors.length, 0);

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
                target,
            });
        }
        if (!validLaneDirections.has(Number(lane.attr?.direction))) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 行驶方向未设置`,
                description: '发布和仿真需要明确直行、左转、右转或掉头方向。',
                suggestion: '选中该车道，在属性面板设置正确方向。',
                target,
            });
        }
        if (!validPossibleDirections.has(Number(lane.attr?.prossibleDrivingDirection))) {
            buildIssue(issues, {
                severity: 'warning',
                title: `车道 ${lane.id} 相对方向未设置`,
                description: '相邻车道关系缺少同向、反向或双向语义，后续自动连接可能误判。',
                suggestion: '选中该车道，在属性面板确认相对方向。',
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
                target,
            });
        }
        if (relation.predecessors.length === 0 && relation.successors.length === 0 && lanes.length > 1) {
            buildIssue(issues, {
                severity: 'error',
                title: `车道 ${lane.id} 是孤立车道`,
                description: '该车道没有任何前驱或后继，车辆无法从路网中进入或离开。',
                suggestion: '使用自动连接或手动连接，把该车道接入正确的前后车道。',
                target,
            });
        } else {
            if (relation.predecessors.length === 0 && lanes.length > 1) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 没有前驱`,
                    description: '该车道可能是合法入口，也可能是断头；发布前需要确认。',
                    suggestion: '如果不是地图入口，请连接到上一段车道。',
                    target,
                });
            }
            if (relation.successors.length === 0 && lanes.length > 1) {
                buildIssue(issues, {
                    severity: 'warning',
                    title: `车道 ${lane.id} 没有后继`,
                    description: '该车道可能是合法出口，也可能是断头；仿真路线可能无法继续。',
                    suggestion: '如果不是地图出口，请连接到下一段车道。',
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
            target: {
                type: 'map',
            },
        });
    }

    const laneComponents = countLaneComponents(relations);
    if (lanes.length > 1 && laneComponents > 1) {
        buildIssue(issues, {
            severity: 'warning',
            title: '车道网络不连通',
            description: `当前车道网络被分成 ${laneComponents} 个连通块，可能存在分离路段或漏连。`,
            suggestion: '逐个检查孤立区域；如果是同一张运营地图，应补齐连接关系。',
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
            laneComponents,
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
