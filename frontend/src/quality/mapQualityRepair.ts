import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { LaneDireaciotn, LaneTrend, LaneType, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { MapState } from 'src/interface/mapStateInterface';
import { StopLineOrigin } from 'src/interface/stopLineInterFace';
import { buildLaneRelations } from 'src/quality/mapQuality';
import { useManagerStore } from 'src/store';
import * as THREE from 'three';

type RepairKind =
    | 'removeMissingBoundaryPoints'
    | 'fillLaneDirection'
    | 'fillLanePossibleDirection'
    | 'fillLaneType'
    | 'restoreLaneGroud'
    | 'restoreLaneArrow'
    | 'restoreTrafficSignalStopLine'
    | 'snapLaneSuccessorStart';

interface BoundaryPointPatch {
    boundaryId: string;
    pointIndex: number;
    pointId: string;
}

export interface MapQualityRepairAction {
    kind: RepairKind;
    title: string;
    description: string;
    targetId: string;
    nextPointIds?: string[];
    nextValue?: number;
    groudId?: string;
    arrowId?: string;
    stopLineId?: string;
    boundaryId?: string;
    targetLaneId?: string;
    pointPatches?: BoundaryPointPatch[];
    confidence?: number;
}

export interface MapQualityRepairResult {
    mapState: MapState;
    actions: MapQualityRepairAction[];
}

interface RepairSnapshot {
    boundarys: MapState['boundarys'];
    lanes: MapState['lanes'];
    stopLines: MapState['stopLines'];
    grouds: MapState['grouds'];
    prossibleDrivingDirections: MapState['prossibleDrivingDirections'];
    needRenderElements: MapState['needRenderElements'];
    currentDrawData: MapState['currentDrawData'];
    currentPickElement: MapState['currentPickElement'];
    onsave: boolean;
    needRender: boolean;
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

const validLaneTypes = new Set<number>([LaneType.CityDriving, LaneType.Biking, LaneType.Shared]);

const MAX_TOPOLOGY_REPAIR_CANDIDATES = 12;
const MAX_ENDPOINT_PAIR_DISTANCE = 4;
const MAX_ENDPOINT_ANGLE_DEGREES = 35;

function getNextNumericId(usedIds: Set<string>) {
    let maxId = 0;
    usedIds.forEach((id) => {
        maxId = Math.max(maxId, Number(id) || 0);
    });
    let nextId = `${maxId + 1}`;
    while (usedIds.has(nextId)) {
        nextId = `${Number(nextId) + 1}`;
    }
    usedIds.add(nextId);
    return nextId;
}

function getLaneGroudType(laneType: LaneTrend) {
    return laneType === LaneTrend.Curve ? ThreeElementType.LaneCurveGroud : ThreeElementType.LaneGroud;
}

function getBoundaryPointIndex(mapState: MapState, laneId: string, side: 'left' | 'right', endpoint: 'start' | 'end') {
    const lane = mapState.lanes[laneId];
    if (!lane) {
        return -1;
    }
    const boundaryId = side === 'left' ? lane.leftBoundaryId : lane.rightBoundaryId;
    const boundary = mapState.boundarys[boundaryId];
    if (!boundary?.pointIds?.length) {
        return -1;
    }
    const reverse = side === 'left' ? lane.leftBoundaryReverse : lane.rightBoundaryReverse;
    const isStart = endpoint === 'start';
    if ((isStart && reverse) || (!isStart && !reverse)) {
        return boundary.pointIds.length - 1;
    }
    return 0;
}

function getLaneEndpoint(
    mapState: MapState,
    laneId: string,
    endpoint: 'start' | 'end',
): {
    leftBoundaryId: string;
    rightBoundaryId: string;
    leftPointId: string;
    rightPointId: string;
    leftIndex: number;
    rightIndex: number;
    center: THREE.Vector2;
} | null {
    const lane = mapState.lanes[laneId];
    if (!lane) {
        return null;
    }
    const leftBoundary = mapState.boundarys[lane.leftBoundaryId];
    const rightBoundary = mapState.boundarys[lane.rightBoundaryId];
    const leftIndex = getBoundaryPointIndex(mapState, laneId, 'left', endpoint);
    const rightIndex = getBoundaryPointIndex(mapState, laneId, 'right', endpoint);
    const leftPointId = leftBoundary?.pointIds?.[leftIndex];
    const rightPointId = rightBoundary?.pointIds?.[rightIndex];
    const leftPoint = leftPointId && mapState.points[leftPointId];
    const rightPoint = rightPointId && mapState.points[rightPointId];
    if (!leftBoundary || !rightBoundary || !leftPoint || !rightPoint) {
        return null;
    }
    return {
        leftBoundaryId: lane.leftBoundaryId,
        rightBoundaryId: lane.rightBoundaryId,
        leftPointId,
        rightPointId,
        leftIndex,
        rightIndex,
        center: new THREE.Vector2(
            (leftPoint.position.x + rightPoint.position.x) / 2,
            (leftPoint.position.y + rightPoint.position.y) / 2,
        ),
    };
}

function getLaneDirectionVector(mapState: MapState, laneId: string) {
    const start = getLaneEndpoint(mapState, laneId, 'start');
    const end = getLaneEndpoint(mapState, laneId, 'end');
    if (!start || !end) {
        return null;
    }
    const vector = end.center.clone().sub(start.center);
    if (vector.length() < 0.001) {
        return null;
    }
    return vector.normalize();
}

function getEndpointDistance(mapState: MapState, sourceLaneId: string, targetLaneId: string) {
    const sourceEnd = getLaneEndpoint(mapState, sourceLaneId, 'end');
    const targetStart = getLaneEndpoint(mapState, targetLaneId, 'start');
    if (!sourceEnd || !targetStart) {
        return null;
    }
    const sourceLeftPoint = mapState.points[sourceEnd.leftPointId].position;
    const sourceRightPoint = mapState.points[sourceEnd.rightPointId].position;
    const targetLeftPoint = mapState.points[targetStart.leftPointId].position;
    const targetRightPoint = mapState.points[targetStart.rightPointId].position;
    const leftDistance = sourceLeftPoint.distanceTo(targetLeftPoint);
    const rightDistance = sourceRightPoint.distanceTo(targetRightPoint);
    const crossedLeftDistance = sourceLeftPoint.distanceTo(targetRightPoint);
    const crossedRightDistance = sourceRightPoint.distanceTo(targetLeftPoint);
    return {
        sourceEnd,
        targetStart,
        leftDistance,
        rightDistance,
        averageDistance: (leftDistance + rightDistance) / 2,
        crossedAverageDistance: (crossedLeftDistance + crossedRightDistance) / 2,
    };
}

function getDirectionAngleDegrees(mapState: MapState, sourceLaneId: string, targetLaneId: string) {
    const sourceVector = getLaneDirectionVector(mapState, sourceLaneId);
    const targetVector = getLaneDirectionVector(mapState, targetLaneId);
    if (!sourceVector || !targetVector) {
        return null;
    }
    const dot = THREE.MathUtils.clamp(sourceVector.dot(targetVector), -1, 1);
    return THREE.MathUtils.radToDeg(Math.acos(dot));
}

function buildTopologyRepairActions(mapState: MapState): MapQualityRepairAction[] {
    const lanes = Object.values(mapState.lanes);
    if (lanes.length < 2) {
        return [];
    }
    const relations = buildLaneRelations(mapState);
    const sourceCandidates = lanes
        .map((sourceLane) => {
            if (relations[sourceLane.id]?.successors.length > 0) {
                return null;
            }
            let bestAction: MapQualityRepairAction = null;
            lanes.forEach((targetLane) => {
                if (sourceLane.id === targetLane.id) {
                    return;
                }
                if (relations[targetLane.id]?.predecessors.length > 0) {
                    return;
                }
                const distance = getEndpointDistance(mapState, sourceLane.id, targetLane.id);
                const angle = getDirectionAngleDegrees(mapState, sourceLane.id, targetLane.id);
                if (!distance || angle === null) {
                    return;
                }
                if (
                    distance.sourceEnd.leftPointId === distance.targetStart.leftPointId &&
                    distance.sourceEnd.rightPointId === distance.targetStart.rightPointId
                ) {
                    return;
                }
                if (distance.crossedAverageDistance < distance.averageDistance) {
                    return;
                }
                if (distance.averageDistance > MAX_ENDPOINT_PAIR_DISTANCE || angle > MAX_ENDPOINT_ANGLE_DEGREES) {
                    return;
                }
                const action: MapQualityRepairAction = {
                    kind: 'snapLaneSuccessorStart',
                    targetId: sourceLane.id,
                    targetLaneId: targetLane.id,
                    title: `连接车道 ${sourceLane.id} -> ${targetLane.id}`,
                    description: `端点平均距离 ${distance.averageDistance.toFixed(2)}m，方向夹角 ${angle.toFixed(
                        1,
                    )}°，将前车道终点吸附到后车道起点。`,
                    pointPatches: [
                        {
                            boundaryId: distance.sourceEnd.leftBoundaryId,
                            pointIndex: distance.sourceEnd.leftIndex,
                            pointId: distance.targetStart.leftPointId,
                        },
                        {
                            boundaryId: distance.sourceEnd.rightBoundaryId,
                            pointIndex: distance.sourceEnd.rightIndex,
                            pointId: distance.targetStart.rightPointId,
                        },
                    ],
                    confidence: Math.max(0, 1 - distance.averageDistance / MAX_ENDPOINT_PAIR_DISTANCE),
                };
                if (!bestAction || (action.confidence || 0) > (bestAction.confidence || 0)) {
                    bestAction = action;
                }
            });
            return bestAction;
        })
        .filter(Boolean);
    const uniqueKeys = new Set<string>();
    return sourceCandidates
        .filter((action) => {
            const key = `${action.targetId}-${action.targetLaneId}`;
            if (uniqueKeys.has(key)) {
                return false;
            }
            uniqueKeys.add(key);
            return true;
        })
        .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))
        .slice(0, MAX_TOPOLOGY_REPAIR_CANDIDATES);
}

function addRenderElement(
    needRenderElements: MapState['needRenderElements'],
    threeObject: ThreeObject,
    id: string,
    type: ThreeElementType,
) {
    const renderElements = needRenderElements[threeObject];
    renderElements[id] = type;
}

function snapshotRepairState(mapState: MapState): RepairSnapshot {
    return {
        boundarys: { ...mapState.boundarys },
        lanes: { ...mapState.lanes },
        stopLines: { ...mapState.stopLines },
        grouds: { ...mapState.grouds },
        prossibleDrivingDirections: { ...mapState.prossibleDrivingDirections },
        needRenderElements: {
            ...mapState.needRenderElements,
            [ThreeObject.Boundary]: { ...mapState.needRenderElements[ThreeObject.Boundary] },
            [ThreeObject.Groud]: { ...mapState.needRenderElements[ThreeObject.Groud] },
            [ThreeObject.Arrow]: { ...mapState.needRenderElements[ThreeObject.Arrow] },
        },
        currentDrawData: { ...mapState.currentDrawData },
        currentPickElement: [...mapState.currentPickElement],
        onsave: mapState.onsave,
        needRender: mapState.needRender,
    };
}

function restoreRepairState(mapState: MapState, snapshot: RepairSnapshot): MapState {
    return {
        ...mapState,
        ...snapshot,
        currentDrawData: { ...snapshot.currentDrawData },
        currentPickElement: [...snapshot.currentPickElement],
        needRender: true,
    };
}

export function buildMapQualityRepairActions(mapState: MapState): MapQualityRepairAction[] {
    const actions: MapQualityRepairAction[] = [];
    const usedGroudIds = new Set(Object.keys(mapState.grouds));
    const usedArrowIds = new Set(Object.keys(mapState.prossibleDrivingDirections));

    Object.values(mapState.boundarys).forEach((boundary) => {
        const nextPointIds = (boundary.pointIds || []).filter((pointId) => Boolean(mapState.points[pointId]));
        if (nextPointIds.length !== boundary.pointIds.length && nextPointIds.length >= 2) {
            actions.push({
                kind: 'removeMissingBoundaryPoints',
                targetId: boundary.id,
                title: `清理边界 ${boundary.id} 的失效点引用`,
                description: `删除 ${boundary.pointIds.length - nextPointIds.length} 个不存在的点引用，保留有效边界。`,
                nextPointIds,
            });
        }
    });

    Object.values(mapState.lanes).forEach((lane) => {
        if (!validLaneDirections.has(Number(lane.attr?.direction))) {
            actions.push({
                kind: 'fillLaneDirection',
                targetId: lane.id,
                title: `补齐车道 ${lane.id} 的行驶方向`,
                description: '方向缺失时按直行补齐，发布前仍建议人工复核。',
                nextValue: LaneDireaciotn.STRAIGHT,
            });
        }
        if (!validPossibleDirections.has(Number(lane.attr?.prossibleDrivingDirection))) {
            actions.push({
                kind: 'fillLanePossibleDirection',
                targetId: lane.id,
                title: `补齐车道 ${lane.id} 的相对方向`,
                description: '相对方向缺失时按同向补齐，避免后续转换缺少基础属性。',
                nextValue: ProssibleDrivingDirection.FORWARD,
            });
        }
        if (!validLaneTypes.has(Number(lane.attr?.laneType))) {
            actions.push({
                kind: 'fillLaneType',
                targetId: lane.id,
                title: `补齐车道 ${lane.id} 的车道类型`,
                description: '车道类型缺失时按城市机动车道补齐。',
                nextValue: LaneType.CityDriving,
            });
        }

        if (!lane.groudId || !mapState.grouds[lane.groudId]) {
            const groudId = lane.groudId || getNextNumericId(usedGroudIds);
            usedGroudIds.add(groudId);
            actions.push({
                kind: 'restoreLaneGroud',
                targetId: lane.id,
                title: `恢复车道 ${lane.id} 的面对象`,
                description: `为车道恢复可选择和高亮的面对象 ${groudId}。`,
                groudId,
            });
        }

        if (!lane.arrowId || !mapState.prossibleDrivingDirections[lane.arrowId]) {
            const arrowId = lane.arrowId || getNextNumericId(usedArrowIds);
            usedArrowIds.add(arrowId);
            actions.push({
                kind: 'restoreLaneArrow',
                targetId: lane.id,
                title: `恢复车道 ${lane.id} 的方向箭头`,
                description: `为车道恢复相对方向箭头 ${arrowId}。`,
                arrowId,
            });
        }
    });

    Object.values(mapState.trafficSignals).forEach((signal) => {
        if (
            !signal.stopLineId ||
            mapState.stopLines[signal.stopLineId] ||
            Number(mapState.boundarys[signal.stopLineId]?.type) !== ThreeElementType.StopLineBoundary
        ) {
            return;
        }
        actions.push({
            kind: 'restoreTrafficSignalStopLine',
            targetId: signal.id,
            stopLineId: signal.stopLineId,
            boundaryId: signal.stopLineId,
            title: `恢复交通灯 ${signal.id} 的停止线对象`,
            description: `交通灯 ${signal.id} 引用了边界 ${signal.stopLineId}，自动补齐 StopLine 数据对象。`,
        });
    });

    return [...actions, ...buildTopologyRepairActions(mapState)];
}

export function applyMapQualityRepairs(mapState: MapState, actions: MapQualityRepairAction[]): MapQualityRepairResult {
    const nextMapState: MapState = {
        ...mapState,
        boundarys: { ...mapState.boundarys },
        lanes: { ...mapState.lanes },
        stopLines: { ...mapState.stopLines },
        grouds: { ...mapState.grouds },
        prossibleDrivingDirections: { ...mapState.prossibleDrivingDirections },
        needRenderElements: {
            ...mapState.needRenderElements,
            [ThreeObject.Boundary]: { ...mapState.needRenderElements[ThreeObject.Boundary] },
            [ThreeObject.Groud]: { ...mapState.needRenderElements[ThreeObject.Groud] },
            [ThreeObject.Arrow]: { ...mapState.needRenderElements[ThreeObject.Arrow] },
        },
        currentDrawData: { ...mapState.currentDrawData },
        currentPickElement: [...mapState.currentPickElement],
        onsave: true,
        needRender: true,
    };

    actions.forEach((action) => {
        if (action.kind === 'removeMissingBoundaryPoints') {
            const boundary = nextMapState.boundarys[action.targetId];
            if (!boundary || !action.nextPointIds || action.nextPointIds.length < 2) {
                return;
            }
            nextMapState.boundarys[action.targetId] = {
                ...boundary,
                pointIds: [...action.nextPointIds],
            };
            addRenderElement(nextMapState.needRenderElements, ThreeObject.Boundary, boundary.id, boundary.type);
            return;
        }

        if (action.kind === 'restoreTrafficSignalStopLine' && action.stopLineId && action.boundaryId) {
            if (!nextMapState.boundarys[action.boundaryId]) {
                return;
            }
            nextMapState.stopLines[action.stopLineId] = {
                id: action.stopLineId,
                boundaryId: action.boundaryId,
                origin: StopLineOrigin.TrafficLight,
            };
            return;
        }

        const lane = nextMapState.lanes[action.targetId];
        if (!lane) {
            return;
        }

        if (action.kind === 'fillLaneDirection' && action.nextValue) {
            nextMapState.lanes[lane.id] = {
                ...lane,
                attr: {
                    ...lane.attr,
                    direction: action.nextValue,
                },
            };
            return;
        }
        if (action.kind === 'fillLanePossibleDirection' && action.nextValue) {
            nextMapState.lanes[lane.id] = {
                ...lane,
                attr: {
                    ...lane.attr,
                    prossibleDrivingDirection: action.nextValue,
                },
            };
            addRenderElement(
                nextMapState.needRenderElements,
                ThreeObject.Arrow,
                lane.arrowId,
                ThreeElementType.LaneRelativeDirection,
            );
            return;
        }
        if (action.kind === 'fillLaneType' && action.nextValue) {
            nextMapState.lanes[lane.id] = {
                ...lane,
                attr: {
                    ...lane.attr,
                    laneType: action.nextValue,
                },
            };
            return;
        }
        if (action.kind === 'restoreLaneGroud' && action.groudId) {
            const groudType = getLaneGroudType(lane.type);
            nextMapState.lanes[lane.id] = {
                ...lane,
                groudId: action.groudId,
            };
            nextMapState.grouds[action.groudId] = {
                id: action.groudId,
                type: groudType,
            };
            addRenderElement(nextMapState.needRenderElements, ThreeObject.Groud, action.groudId, groudType);
            return;
        }
        if (action.kind === 'restoreLaneArrow' && action.arrowId) {
            nextMapState.lanes[lane.id] = {
                ...lane,
                arrowId: action.arrowId,
                prossibleDrivingDirectionArrowId: action.arrowId,
            };
            nextMapState.prossibleDrivingDirections[action.arrowId] = {
                id: action.arrowId,
                type: ThreeElementType.LaneRelativeDirection,
            };
            addRenderElement(
                nextMapState.needRenderElements,
                ThreeObject.Arrow,
                action.arrowId,
                ThreeElementType.LaneRelativeDirection,
            );
            return;
        }
        if (action.kind === 'snapLaneSuccessorStart' && action.pointPatches) {
            action.pointPatches.forEach((patch) => {
                const boundary = nextMapState.boundarys[patch.boundaryId];
                if (!boundary || !nextMapState.points[patch.pointId] || !boundary.pointIds[patch.pointIndex]) {
                    return;
                }
                const nextPointIds = [...boundary.pointIds];
                nextPointIds[patch.pointIndex] = patch.pointId;
                nextMapState.boundarys[patch.boundaryId] = {
                    ...boundary,
                    pointIds: nextPointIds,
                };
                addRenderElement(
                    nextMapState.needRenderElements,
                    ThreeObject.Boundary,
                    patch.boundaryId,
                    boundary.type,
                );
            });
        }
    });

    return {
        mapState: nextMapState,
        actions,
    };
}

export class ApplyMapQualityRepairsCommand {
    private actions: MapQualityRepairAction[];

    private originState: RepairSnapshot;

    constructor(actions: MapQualityRepairAction[]) {
        this.actions = actions.map((action) => ({
            ...action,
            nextPointIds: action.nextPointIds && [...action.nextPointIds],
        }));
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        this.originState = snapshotRepairState(mapState);
        const result = applyMapQualityRepairs(mapState, this.actions);
        setMapState(result.mapState);
    }

    undo() {
        if (!this.originState) {
            return;
        }
        const { mapState, setMapState } = useManagerStore.getState();
        setMapState(restoreRepairState(mapState, this.originState));
    }
}
