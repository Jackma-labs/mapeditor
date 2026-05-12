import { isNull } from 'lodash';
import { PointElement } from 'src/interface/basicElementInterFace';
import { OperationType, PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { objectSearch } from 'src/utils/search/objectSearch';
import * as THREE from 'three';

export class AddPointCommand {
    public id: string;

    public position: THREE.Vector3; // 这个position是世界坐标系下的

    public matrixWorld: THREE.Matrix4;

    public type: ThreeElementType;

    private originOperationType: OperationType;

    constructor(id: string, position: THREE.Vector3, type: ThreeElementType) {
        this.id = id;
        this.position = position;
        this.type = type;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const pointElement: PointElement = {
            id: this.id,
            position: this.position,
            type: this.type,
        };
        state.points = {
            ...state.points,
            [this.id]: pointElement,
        };
        state.onsave = true;
        if (isNull(this.originOperationType) || this.originOperationType) {
            [state.operationType, this.originOperationType] = [this.originOperationType, state.operationType];
        } else {
            this.originOperationType = state.operationType;
        }
        state.needRenderElements[ThreeObject.Point][this.id] = this.type;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        delete state.points[this.id];
        state.onsave = true;
        state.needRenderElements[ThreeObject.Point][this.id] = this.type;
        [state.operationType, this.originOperationType] = [this.originOperationType, state.operationType];

        useManagerStore.getState().setMapState(state);
    }
}
export class DeletePointCommand {
    private pointId: string;

    private originPosition: THREE.Vector3;

    private originType: ThreeElementType;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.pointId = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const point = state.points[this.pointId];
        if (!point) {
            console.warn(`DeletePointCommand execute时没找到id为${this.pointId}的点`);
            return;
        }
        this.originPosition = point.position.clone();
        this.originType = point.type;
        this.originCurrentPickElement = [...state.currentPickElement];
        delete state.points[this.pointId];
        state.onsave = true;
        state.needRenderElements[ThreeObject.Point][this.pointId] = this.originType;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originPosition || !this.pointId) {
            console.warn(`DeletePointCommand undo时没找到id为${this.pointId}的点的原始信息`);
            return;
        }

        const pointElement: PointElement = {
            id: this.pointId,
            position: this.originPosition,
            type: this.originType,
        };
        state.points[this.pointId] = pointElement;
        state.currentPickElement = [...this.originCurrentPickElement];
        state.onsave = true;
        state.needRenderElements[ThreeObject.Point][this.pointId] = this.originType;

        useManagerStore.getState().setMapState(state);
    }
}

export class DragPointCommand {
    private id: string;

    private originPosition: THREE.Vector3;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const point = state.points[this.id];
        if (!point) {
            console.warn(`DragPointCommand execute时没找到id为${this.id}的点`);
            return;
        }
        const pointMesh = objectSearch(ThreeObject.Point, this.id);
        if (!pointMesh) {
            return;
        }
        // 当 new DragPointCommand时，这个时候 newPosition取拖拽后的点mesh的position，但是，当执行了execute或者undo后
        // originPosition已经存储好了执行前的点mesh的position，所以这里取originPosition
        const newPosition = this.originPosition?.clone() || pointMesh.position.clone();

        this.originPosition = point.position.clone();
        this.originCurrentPickElement = [...state.currentPickElement];
        point.position.copy(newPosition);
        state.onsave = true;
        state.needRenderElements[ThreeObject.Point][this.id] = point.type;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const point = state.points[this.id];
        if (!point) {
            return;
        }
        const pointMesh = objectSearch(ThreeObject.Point, this.id);
        const tempPosition = pointMesh.position.clone();
        point.position.copy(this.originPosition);
        this.originPosition.copy(tempPosition);
        state.currentPickElement = [...this.originCurrentPickElement];
        state.onsave = true;
        state.needRenderElements[ThreeObject.Point][this.id] = point.type;

        useManagerStore.getState().setMapState(state);
    }
}
