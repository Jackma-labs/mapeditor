import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { LaneDireaciotn, LaneTrend, LaneType, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { MapState } from 'src/interface/mapStateInterface';
import { useManagerStore } from 'src/store';

type RepairKind =
    | 'removeMissingBoundaryPoints'
    | 'fillLaneDirection'
    | 'fillLanePossibleDirection'
    | 'fillLaneType'
    | 'restoreLaneGroud'
    | 'restoreLaneArrow';

export interface MapQualityRepairAction {
    kind: RepairKind;
    title: string;
    description: string;
    targetId: string;
    nextPointIds?: string[];
    nextValue?: number;
    groudId?: string;
    arrowId?: string;
}

export interface MapQualityRepairResult {
    mapState: MapState;
    actions: MapQualityRepairAction[];
}

interface RepairSnapshot {
    boundarys: MapState['boundarys'];
    lanes: MapState['lanes'];
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

    return actions;
}

export function applyMapQualityRepairs(mapState: MapState, actions: MapQualityRepairAction[]): MapQualityRepairResult {
    const nextMapState: MapState = {
        ...mapState,
        boundarys: { ...mapState.boundarys },
        lanes: { ...mapState.lanes },
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
