import { mapElementZ } from 'src/constant/mapElementZ';
import { PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { TrafficSignal, TrafficSubSignal, Type } from 'src/interface/trafficSignal';
import { useManagerStore } from 'src/store';
import { getTrafficLightInitPositionAndDeg } from 'src/utils/geometryUtil';
import { objectSearch } from 'src/utils/search/objectSearch';
import * as THREE from 'three';

export class AddTrafficLightCommand {
    private id: string;

    private stopLineId: string;

    private height: number;

    private type: Type;

    private center: THREE.Vector3;

    private subSignals: TrafficSubSignal[];

    constructor(id: string, stopLineId: string, height: number, type: Type, subSignals: TrafficSubSignal[]) {
        this.id = id;
        this.stopLineId = stopLineId;
        this.height = height;
        this.type = type;
        this.center = null;
        this.subSignals = subSignals;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        // 创建一个lane对象，添加到state数据中
        const trafficSignal: TrafficSignal = {
            id: this.id,
            height: this.height,
            type: this.type,
            center: this.center,
            subSignals: this.subSignals,
            stopLineId: this.stopLineId,
            heading: 0,
        };
        state.trafficSignals[this.id] = trafficSignal;
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.trafficSignals[this.id];
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteTrafficLightCommand {
    private id: string;

    private originStopLineId: string;

    private originHeight: number;

    private originType: Type;

    private originCenter: THREE.Vector3;

    private originSubSignals: TrafficSubSignal[];

    private originHeading: number;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const trafficSignal = state.trafficSignals[this.id];
        if (!trafficSignal) {
            return;
        }

        this.originStopLineId = trafficSignal.stopLineId;
        this.originCenter = trafficSignal.center;
        this.originHeight = trafficSignal.height;
        this.originSubSignals = trafficSignal.subSignals;
        this.originType = trafficSignal.type;
        this.originHeading = trafficSignal.heading;
        this.originCurrentPickElement = [...state.currentPickElement];
        delete state.trafficSignals[this.id];
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const trafficSignal: TrafficSignal = {
            id: this.id,
            stopLineId: this.originStopLineId,
            height: this.originHeight,
            subSignals: this.originSubSignals,
            type: this.originType,
            center: this.originCenter,
            heading: this.originHeading,
        };

        state.trafficSignals[this.id] = trafficSignal;
        state.currentPickElement = [...this.originCurrentPickElement];
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
export class FinishTrafficLightCommand {
    private id: string;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const trafficSignal = state.trafficSignals[this.id];
        if (!trafficSignal) {
            console.error(`FinishTrafficLightCommand execute时没找到id为${this.id}的信号灯`);
            return;
        }
        const { position: center, deg } = getTrafficLightInitPositionAndDeg(trafficSignal.stopLineId);
        trafficSignal.heading = deg;
        trafficSignal.center = center;
        state.onsave = true;
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const trafficSignal = state.trafficSignals[this.id];
        if (trafficSignal) {
            trafficSignal.center = null;
            trafficSignal.heading = 0;
        }
        state.onsave = true;
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        useManagerStore.getState().setMapState(state);
    }
}
export class DragTrafficeLightCommand {
    private id: string;

    private originCenter: THREE.Vector3;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const trafficSignal = state.trafficSignals[this.id];
        const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, this.id);
        if (!trafficLightMesh) {
            console.warn(`DragTrafficeLightCommand execute时没找到id为${this.id}的信号灯的mesh`);
            return;
        }

        this.originCenter = trafficSignal.center.clone();
        this.originCurrentPickElement = [...state.currentPickElement];
        const newPosition = trafficLightMesh.position.clone();
        trafficSignal.center = new THREE.Vector3(
            newPosition.x,
            newPosition.y,
            mapElementZ[ThreeElementType.TrafficLight],
        );
        state.onsave = true;
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const trafficSignal = state.trafficSignals[this.id];
        const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, this.id);
        if (!trafficLightMesh) {
            console.warn(`DragTrafficeLightCommand undo时没找到id为${this.id}的信号灯的mesh`);
            return;
        }

        trafficSignal.center = this.originCenter.clone();
        trafficLightMesh.position.x = this.originCenter.x;
        trafficLightMesh.position.y = this.originCenter.y;

        state.currentPickElement = [...this.originCurrentPickElement];
        state.onsave = true;
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        useManagerStore.getState().setMapState(state);
    }
}
export class RotateTrafficLightCommand {
    private id: string;

    private originHeading: number;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const trafficSignal = state.trafficSignals[this.id];
        const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, this.id);
        if (!trafficLightMesh || !trafficSignal) {
            return;
        }
        this.originHeading = trafficSignal.heading;
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        trafficSignal.heading = trafficLightMesh.rotation.z || 0;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const trafficSignal = state.trafficSignals[this.id];
        if (!trafficSignal) {
            return;
        }
        trafficSignal.heading = this.originHeading;
        const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, this.id);
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;

        if (trafficLightMesh) {
            trafficLightMesh.rotation.z = this.originHeading;
        }
        useManagerStore.getState().setMapState(state);
    }
}
export class ChangeTrafficLightTypeCommand {
    private id: string;

    private origjnType: Type;

    private type: Type;

    private subSignals: TrafficSubSignal[];

    private originSubSignals: TrafficSubSignal[];

    constructor(id: string, type: Type, subSignals: TrafficSubSignal[]) {
        this.id = id;
        this.type = type;
        this.subSignals = subSignals;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const trafficSignal = state.trafficSignals[this.id];
        if (!trafficSignal) {
            return;
        }
        this.origjnType = trafficSignal.type;
        this.originSubSignals = [...trafficSignal.subSignals];

        trafficSignal.type = this.type;
        trafficSignal.subSignals = [...this.subSignals];
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;
        state.onsave = true;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const trafficSignal = state.trafficSignals[this.id];
        if (!trafficSignal) {
            return;
        }
        trafficSignal.type = this.origjnType;
        trafficSignal.subSignals = [...this.originSubSignals];
        state.needRenderElements[ThreeObject.TrafficLight][this.id] = ThreeElementType.TrafficLight;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
