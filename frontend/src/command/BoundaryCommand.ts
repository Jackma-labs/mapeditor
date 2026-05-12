import { Boundary, BoundaryOriginType, BoundaryType } from 'src/interface/basicElementInterFace';
import { PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { LaneBoundaryAttr, LaneBoundaryType } from 'src/interface/laneInterFace';
import { insertPointToBoundary } from 'src/utils/geometryUtil';
import * as THREE from 'three';
import { useManagerStore } from 'src/store';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { contrlPointSearch } from 'src/utils/search/objectSearch';
import { searchSignByBoundaryId } from 'src/utils/search/signSearch';

export class AddBoundaryCommand {
    private id: string;

    private type: BoundaryType;

    private attr: LaneBoundaryAttr;

    private origin: BoundaryOriginType;

    private pointIds: string[];

    private controlPoints: THREE.Vector3[];

    private originCurrentPickElement: PickElementInfo[];

    constructor(
        id: string,
        type: BoundaryType,
        origin: BoundaryOriginType,
        pointIds: string[],
        controlPoints: THREE.Vector3[],
        attr?: LaneBoundaryAttr,
    ) {
        this.id = id;
        this.attr = attr ? { ...attr } : null;
        this.type = type;
        this.origin = origin;
        this.pointIds = [...pointIds];
        this.controlPoints = [...controlPoints];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();

        // 创建一个boundary对象，添加到state数据中
        const boundary: Boundary = {
            id: this.id,
            pointIds: [...this.pointIds],
            type: this.type,
            origin: this.origin,
            controlsPosition: [...this.controlPoints],
            relativeRoadBoundaryIds: [],
            relativeLaneBoundaryIds: [],
        };
        if (this.attr) {
            boundary.attr = { ...this.attr };
        }

        this.originCurrentPickElement = [...mapState.currentPickElement];

        mapState.boundarys[this.id] = boundary;
        mapState.onsave = true;
        mapState.needRenderElements[ThreeObject.Boundary][this.id] = this.type;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();

        mapState.onsave = true;

        delete mapState.boundarys[this.id];
        mapState.needRenderElements[ThreeObject.Boundary][this.id] = this.type;
        mapState.currentPickElement = [...this.originCurrentPickElement];

        setMapState(mapState);
    }
}

export class DeleteBoundaryCommand {
    private boundaryId: string;

    private originType: BoundaryType;

    private originAttr: LaneBoundaryAttr;

    private originPointIds: string[] = [];

    private originBoudaryOrigin: BoundaryOriginType;

    private originConrolPoints: THREE.Vector3[] = [];

    private originCurrentPickElement: PickElementInfo[];

    private originRelativeLaneBoundaryIds: string[];

    private originRelativeRoadBoundaryIds: string[];

    constructor(boundaryId: string) {
        this.boundaryId = boundaryId;
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = mapState.boundarys[this.boundaryId];
        if (!boundary) {
            console.warn(' DeleteBoundaryCommand 时没有找到对应的boundary');
            return;
        }
        const { attr, pointIds, type } = boundary;

        // 存储原始信息方便回显
        this.originAttr = { ...attr };
        this.originPointIds = [...pointIds];
        this.originType = type;
        this.originBoudaryOrigin = boundary.origin;
        this.originConrolPoints = [...boundary.controlsPosition];
        this.originCurrentPickElement = [...mapState.currentPickElement];
        this.originRelativeLaneBoundaryIds = [...boundary.relativeLaneBoundaryIds];
        this.originRelativeRoadBoundaryIds = [...boundary.relativeRoadBoundaryIds];

        delete mapState.boundarys[this.boundaryId];
        // 如果是laneBoundary或者roadBoundary的时候记得删除laneBoundary和roadBoundary的关联关系
        if (boundary.type === ThreeElementType.LaneBoundary && this.originRelativeRoadBoundaryIds?.length !== 0) {
            const relativeRoadBoundary = mapState.boundarys[this.originRelativeRoadBoundaryIds[0]];
            if (relativeRoadBoundary) {
                relativeRoadBoundary.relativeLaneBoundaryIds = relativeRoadBoundary.relativeLaneBoundaryIds.filter(
                    (id) => id !== this.boundaryId,
                );
            }
        }
        if (boundary.type === ThreeElementType.RoadBoundary && this.originRelativeLaneBoundaryIds?.length !== 0) {
            this.originRelativeLaneBoundaryIds.forEach((id) => {
                const relativeLaneBoundary = mapState.boundarys[id];
                if (relativeLaneBoundary) {
                    relativeLaneBoundary.relativeRoadBoundaryIds = [];
                }
            });
        }
        mapState.onsave = true;
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = this.originType;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        if (!this.originType) {
            console.warn(' DeleteBoundaryCommand execute时没有找到对应的boundary 回退操作');
            return;
        }
        const boundary: Boundary = {
            id: this.boundaryId,
            attr: this.originAttr ? { ...this.originAttr } : null,
            pointIds: [...this.originPointIds],
            type: this.originType,
            origin: this.originBoudaryOrigin,
            controlsPosition: [...this.originConrolPoints],
        };

        boundary.relativeLaneBoundaryIds = [...this.originRelativeLaneBoundaryIds];
        boundary.relativeRoadBoundaryIds = [...this.originRelativeRoadBoundaryIds];

        mapState.currentPickElement = [...this.originCurrentPickElement];
        mapState.onsave = true;
        mapState.boundarys[this.boundaryId] = boundary;
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = this.originType;

        // 如果是laneBoundary或者roadBoundary的时候记得还原相关联的laneBoundary和roadBoundary的关联关系
        if (boundary.type === ThreeElementType.LaneBoundary && this.originRelativeRoadBoundaryIds?.length !== 0) {
            const relativeRoadBoundary = mapState.boundarys[this.originRelativeRoadBoundaryIds[0]];
            if (relativeRoadBoundary) {
                relativeRoadBoundary.relativeLaneBoundaryIds.push(this.boundaryId);
            }
        }
        if (boundary.type === ThreeElementType.RoadBoundary && this.originRelativeLaneBoundaryIds?.length !== 0) {
            this.originRelativeLaneBoundaryIds.forEach((id) => {
                const relativeLaneBoundary = mapState.boundarys[id];
                if (relativeLaneBoundary) {
                    relativeLaneBoundary.relativeRoadBoundaryIds = [this.boundaryId];
                }
            });
        }

        setMapState(mapState);
    }
}
export class AddPointToBoundaryCommand {
    private pointId: string;

    private boundaryId: string;

    private last: boolean;

    private first: boolean;

    private originPointIds: string[];

    private originCurrentPickElement: PickElementInfo[];

    constructor(pointId: string, boundaryId: string, last: boolean, first: boolean) {
        this.pointId = pointId;
        this.boundaryId = boundaryId;
        this.last = last;
        this.first = first;
        this.originPointIds = [];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = mapState.boundarys[this.boundaryId];

        if (!boundary) {
            console.warn(' AddPointToBoundaryCommand execute时没有找到对应的boundary');
            return;
        }
        // 存储原始数据，方便还原
        this.originPointIds = [...boundary.pointIds];
        this.originCurrentPickElement = [...mapState.currentPickElement];
        // 获取最新的boundary对点的引用
        const boundaryPointIds = insertPointToBoundary(this.pointId, this.boundaryId, this.last, this.first);
        mapState.boundarys[this.boundaryId].pointIds = [...boundaryPointIds];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();

        const boundary = mapState.boundarys[this.boundaryId];
        if (!boundary) {
            return;
        }
        mapState.boundarys[this.boundaryId].pointIds = [...this.originPointIds];
        mapState.currentPickElement = [...this.originCurrentPickElement];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        this.originPointIds = [];
        setMapState(mapState);
    }
}

export class RemovePointFromBoundaryCommand {
    private pointId: string;

    private boundaryId: string;

    private originPointIds: string[];

    private originCurrentPickElement: PickElementInfo[];

    constructor(pointId: string, boundaryId: string) {
        this.pointId = pointId;
        this.boundaryId = boundaryId;
        this.originPointIds = [];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = mapState.boundarys[this.boundaryId];
        if (!boundary) {
            console.warn('RemovePointFromBoundaryCommand execute时没有找到对应的boundary');
            return;
        }
        const { pointIds, type } = boundary;
        this.originPointIds = [...pointIds];
        this.originCurrentPickElement = [...mapState.currentPickElement];
        const findIndex = boundary.pointIds.findIndex((id) => id === this.pointId);
        if (
            type === ThreeElementType.JunctionBoundary ||
            type === ThreeElementType.AreaBoundary ||
            type === ThreeElementType.BarrierGateBoundary
        ) {
            if (findIndex === 0) {
                // 如果删除的是第一个点，则需要将第一个点Id和最后一个点ID的引用删除
                boundary.pointIds.shift();
                if (pointIds[pointIds.length - 1] === this.pointId) {
                    pointIds.pop();
                    // 记得将最后一个点ID指向第一个点，形成闭环
                    pointIds.push(pointIds[0]);
                }
            } else if (findIndex !== -1) {
                pointIds.splice(findIndex, 1);
            }
        } else if (findIndex !== -1) {
            pointIds.splice(findIndex, 1);
        }
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = mapState.boundarys[this.boundaryId];
        if (!boundary) {
            console.warn(' RemovePointFromBoundaryCommand undo 时没有找到对应的boundary');
            return;
        }
        boundary.pointIds = [...this.originPointIds];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.currentPickElement = [...this.originCurrentPickElement];
        setMapState(mapState);
    }
}

export class UpdateBoundarycontrolsCommand {
    private boundaryId: string;

    private originControlsPosition: THREE.Vector3[];

    private originCurrentPickElement: PickElementInfo[];

    constructor(boundaryId: string) {
        this.boundaryId = boundaryId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        const isCurve =
            boundary?.type === ThreeElementType.LaneCurveBoundary ||
            (boundary?.type === ThreeElementType.RoadBoundary && boundary?.controlsPosition?.length === 2);
        if (!isCurve) {
            return;
        }

        const firstControlMesh = contrlPointSearch(ThreeObject.ControlPoint, this.boundaryId, true);
        const secondControlMesh = contrlPointSearch(ThreeObject.ControlPoint, this.boundaryId, false);

        let newControlsPosition: THREE.Vector3[] = null;
        if (this.originControlsPosition && this.originControlsPosition.length === 2) {
            newControlsPosition = [...this.originControlsPosition];
        } else if (firstControlMesh && secondControlMesh) {
            newControlsPosition = [firstControlMesh.position.clone(), secondControlMesh.position.clone()];
        }
        if (!newControlsPosition) {
            return;
        }

        this.originControlsPosition = [...boundary.controlsPosition];
        this.originCurrentPickElement = [...state.currentPickElement];
        boundary.controlsPosition[0] = newControlsPosition[0];
        state.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        boundary.controlsPosition[1] = newControlsPosition[1];

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        const isCurve =
            boundary?.type === ThreeElementType.LaneCurveBoundary ||
            (boundary?.type === ThreeElementType.RoadBoundary && boundary?.controlsPosition?.length === 2);
        if (!isCurve) {
            return;
        }

        const newControlsPosition = [...this.originControlsPosition];
        this.originControlsPosition = [...boundary.controlsPosition];

        boundary.controlsPosition[0] = newControlsPosition[0].clone();
        boundary.controlsPosition[1] = newControlsPosition[1].clone();
        mapState.boundarys[boundary.id] = boundary;
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.currentPickElement = [...this.originCurrentPickElement];
        setMapState(mapState);

        const firstControlMesh = contrlPointSearch(ThreeObject.ControlPoint, this.boundaryId, true);
        const secondControlMesh = contrlPointSearch(ThreeObject.ControlPoint, this.boundaryId, false);
        if (firstControlMesh && secondControlMesh) {
            firstControlMesh.position.copy(boundary.controlsPosition[0]);
            secondControlMesh.position.copy(boundary.controlsPosition[1]);
        }
    }
}

export class ChangeBoundaryTypeCommand {
    private boundaryId: string;

    private originType: LaneBoundaryType;

    private originCurrentPickElement: PickElementInfo[];

    constructor(boundaryId: string) {
        this.boundaryId = boundaryId;
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            console.warn('ChangeBoundaryTypeCommand execute时没有找到对应的boundary');
            return;
        }

        this.originType = boundary.attr.type;
        this.originCurrentPickElement = [...mapState.currentPickElement];
        const changeType =
            boundary.attr.type === LaneBoundaryType.WHITEDOTTED
                ? LaneBoundaryType.WHITESOLId
                : LaneBoundaryType.WHITEDOTTED;
        mapState.boundarys[this.boundaryId].attr.type = changeType;
        // 这样做是为了能让右侧的属性栏更新
        mapState.currentDrawData = { ...mapState.currentDrawData };
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.currentPickElement = [...mapState.currentPickElement];

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            console.warn('ChangeBoundaryTypeCommand execute时没有找到对应的boundary');
            return;
        }

        mapState.boundarys[this.boundaryId].attr.type = this.originType;
        // 这样做是为了能让右侧的属性栏更新
        mapState.currentDrawData = { ...mapState.currentDrawData };
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.currentPickElement = [...this.originCurrentPickElement];
        setMapState(mapState);
    }
}
export class ChangeBoundaryPointIdsCommand {
    private boundaryId: string;

    private originPointIds: string[];

    private pointIds: string[];

    constructor(boundaryId: string, pointIds: string[]) {
        this.boundaryId = boundaryId;
        this.pointIds = [...pointIds];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }
        this.originPointIds = [...boundary.pointIds];

        boundary.pointIds = [...this.pointIds];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.boundarys[this.boundaryId] = boundary;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }

        boundary.pointIds = [...this.originPointIds];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.boundarys[this.boundaryId] = boundary;

        setMapState(mapState);
    }
}
export class ChangeControlsPositionCommand {
    private boundaryId: string;

    private originControlsPosition: THREE.Vector3[];

    private controlsPosition: THREE.Vector3[];

    constructor(boundaryId: string, controlsPosition: THREE.Vector3[]) {
        this.boundaryId = boundaryId;
        this.controlsPosition = [...controlsPosition];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }
        this.originControlsPosition = [...boundary.controlsPosition];

        boundary.controlsPosition = [...this.controlsPosition];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.boundarys[this.boundaryId] = boundary;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }

        boundary.controlsPosition = [...this.originControlsPosition];
        mapState.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        mapState.boundarys[this.boundaryId] = boundary;

        setMapState(mapState);
    }
}
export class UpdateBoundaryCommand {
    private boundaryId: string;

    private origincurrentPickElement: PickElementInfo[];

    private originFirstrControlPointPosition: THREE.Vector3;

    private originSecondControlPointPosition: THREE.Vector3;

    constructor(id: string) {
        this.boundaryId = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const boundary = state.boundarys[this.boundaryId];
        if (!boundary) {
            console.warn('UpdateBoundaryCommand boundary not found');
            return;
        }
        this.origincurrentPickElement = [...state.currentPickElement];
        state.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        const linkSign = searchSignByBoundaryId(this.boundaryId);
        if (linkSign) {
            state.needRenderElements[ThreeObject.Sign][linkSign.id] = ThreeElementType.SignIcon;
        }

        const isCurve =
            boundary.type === ThreeElementType.LaneCurveBoundary ||
            (boundary.type === ThreeElementType.RoadBoundary && boundary.controlsPosition?.length === 2);
        if (isCurve) {
            this.originFirstrControlPointPosition = boundary.controlsPosition[0].clone();
            this.originSecondControlPointPosition = boundary.controlsPosition[1].clone();
        }
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const boundary = state.boundarys[this.boundaryId];
        if (!boundary) {
            console.warn('UpdateBoundaryCommand undo boundary not found');
            return;
        }
        state.currentPickElement = [...this.origincurrentPickElement];
        state.needRenderElements[ThreeObject.Boundary][this.boundaryId] = boundary.type;

        const linkSign = searchSignByBoundaryId(this.boundaryId);
        if (linkSign) {
            state.needRenderElements[ThreeObject.Sign][linkSign.id] = ThreeElementType.SignIcon;
        }

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
        const isCurve =
            boundary.type === ThreeElementType.LaneCurveBoundary ||
            (boundary.type === ThreeElementType.RoadBoundary && boundary.controlsPosition?.length === 2);
        if (isCurve) {
            const firstControlMesh = contrlPointSearch(ThreeObject.ControlPoint, this.boundaryId, true);
            const secondControlMesh = contrlPointSearch(ThreeObject.ControlPoint, this.boundaryId, false);
            if (!firstControlMesh || !secondControlMesh) {
                return;
            }
            firstControlMesh.position.copy(this.originFirstrControlPointPosition);
            secondControlMesh.position.copy(this.originSecondControlPointPosition);
            PubSub.publish('dragControlPoint', firstControlMesh);
            PubSub.publish('dragControlPoint', secondControlMesh);
        }
    }
}

export class UpdateBoundaryRelativeLaneBoundaryIdsCommand {
    private boundaryId: string;

    private originRelationLaneBoundaryIds: string[];

    private newRelationLaneBoundaryIds: string[];

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string, relationLaneBoundaryIds: string[]) {
        this.boundaryId = id;
        this.newRelationLaneBoundaryIds = [...relationLaneBoundaryIds];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }
        this.originRelationLaneBoundaryIds = [...boundary.relativeLaneBoundaryIds];
        this.originCurrentPickElement = [...mapState.currentPickElement];

        mapState.currentPickElement = [...mapState.currentPickElement];
        boundary.relativeLaneBoundaryIds = [...this.newRelationLaneBoundaryIds];
        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }

        boundary.relativeLaneBoundaryIds = [...this.originRelationLaneBoundaryIds];
        mapState.currentPickElement = [...this.originCurrentPickElement];

        setMapState(mapState);
    }
}

export class UpdateBoundaryRelativeRoadBoundaryIdsCommand {
    private boundaryId: string;

    private originRelationRoadBoundaryIds: string[];

    private newRelationRoadBoundaryIds: string[];

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string, relationRoadBoundaryIds: string[]) {
        this.boundaryId = id;
        this.newRelationRoadBoundaryIds = [...relationRoadBoundaryIds];
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }
        this.originRelationRoadBoundaryIds = [...boundary.relativeRoadBoundaryIds];
        this.originCurrentPickElement = [...mapState.currentPickElement];
        mapState.currentPickElement = [...mapState.currentPickElement];

        boundary.relativeRoadBoundaryIds = [...this.newRelationRoadBoundaryIds];
        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        const boundary = searchBoundaryByBoundaryId(this.boundaryId);
        if (!boundary) {
            return;
        }

        boundary.relativeRoadBoundaryIds = [...this.originRelationRoadBoundaryIds];
        mapState.currentPickElement = [...this.originCurrentPickElement];

        setMapState(mapState);
    }
}
