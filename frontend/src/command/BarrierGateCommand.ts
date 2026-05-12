import { BarrierGate, BarrierGateType } from 'src/interface/barrierGateInterFace';
import { PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export class AddBarrierGateCommand {
    private id: string;

    private stopLineId: string;

    private boundaryId: string;

    private type: BarrierGateType;

    private groudId: string;

    constructor(id: string, stopLineId: string, boundaryId: string, groudId: string) {
        this.id = id;
        this.stopLineId = stopLineId;
        this.boundaryId = boundaryId;
        this.type = BarrierGateType.Fence;
        this.groudId = groudId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const { width, length, height } = state.currentDrawData.barrierGateAttr;
        // 创建一个lane对象，添加到state数据中
        const barrierGate: BarrierGate = {
            id: this.id,
            height,
            width,
            length,
            type: this.type,
            stopLineId: this.stopLineId,
            boundaryId: this.boundaryId,
            groudId: this.groudId,
        };
        state.barrierGates[this.id] = barrierGate;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.barrierGates[this.id];

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteBarrierGateCommand {
    private id: string;

    private originStopLineId: string;

    private originBoundaryId: string;

    private originHeight: number;

    private originWidth: number;

    private originLength: number;

    private originType: BarrierGateType;

    private originGroudId: string;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const barrierGate = state.barrierGates[this.id];
        if (!barrierGate) {
            return;
        }

        this.originStopLineId = barrierGate.stopLineId;
        this.originHeight = barrierGate.height;
        this.originWidth = barrierGate.width;
        this.originLength = barrierGate.length;
        this.originBoundaryId = barrierGate.boundaryId;
        this.originType = barrierGate.type;
        this.originGroudId = barrierGate.groudId;
        this.originCurrentPickElement = [...state.currentPickElement];
        delete state.barrierGates[this.id];

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const barrierGate: BarrierGate = {
            id: this.id,
            stopLineId: this.originStopLineId,
            height: this.originHeight,
            width: this.originWidth,
            length: this.originLength,
            type: this.originType,
            boundaryId: this.originBoundaryId,
            groudId: this.originGroudId,
        };

        state.barrierGates[this.id] = barrierGate;
        state.currentPickElement = [...this.originCurrentPickElement];

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class UpdateBarrierSizeCommand {
    private id: string;

    private originWidth: number;

    private originLength: number;

    private originCurrentPickElement: PickElementInfo[];

    private width: number;

    private length: number;

    constructor(id: string, width: number, length: number) {
        this.id = id;
        this.width = width;
        this.length = length;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const barrierGate = state.barrierGates[this.id];
        if (!barrierGate) {
            return;
        }

        this.originWidth = barrierGate.width;
        this.originLength = barrierGate.length;
        this.originCurrentPickElement = [...state.currentPickElement];

        barrierGate.width = this.width;
        barrierGate.length = this.length;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        state.barrierGates[this.id].width = this.originWidth;
        state.barrierGates[this.id].length = this.originLength;
        state.currentPickElement = [...this.originCurrentPickElement];

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
export class UpdateBarrierGateTypeCommand {
    private id: string;

    private originType: BarrierGateType;

    private type: BarrierGateType;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string, type: number) {
        this.id = id;
        this.type = type;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const barrierGate = state.barrierGates[this.id];
        if (!barrierGate) {
            return;
        }

        this.originType = barrierGate.type;
        this.originCurrentPickElement = [...state.currentPickElement];

        barrierGate.type = this.type;
        state.needRenderElements[ThreeObject.Groud][barrierGate.groudId] = ThreeElementType.BarrierGateGroud;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        state.barrierGates[this.id].type = this.originType;
        state.currentPickElement = [...this.originCurrentPickElement];
        state.needRenderElements[ThreeObject.Groud][state.barrierGates[this.id].groudId] =
            ThreeElementType.BarrierGateGroud;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
