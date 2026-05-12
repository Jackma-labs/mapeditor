import { Sign, SignType } from 'src/interface/SignInterFace';
import { PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export class AddSignCommand {
    private id: string;

    private stopLineId: string;

    private type: SignType;

    constructor(id: string, stopLineId: string, type: SignType) {
        this.id = id;
        this.stopLineId = stopLineId;
        this.type = type;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        // 创建一个lane对象，添加到state数据中
        const sign: Sign = {
            id: this.id,
            type: this.type,
            stopLineId: this.stopLineId,
        };
        state.signs[this.id] = sign;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.signs[this.id];

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteSignCommand {
    private id: string;

    private originStopLineId: string;

    private originType: SignType;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const sign = state.signs[this.id];
        if (!sign) {
            return;
        }

        this.originStopLineId = sign.stopLineId;
        this.originType = sign.type;
        this.originCurrentPickElement = [...state.currentPickElement];
        delete state.signs[this.id];
        state.needRenderElements[ThreeObject.Sign][this.id] = ThreeElementType.SignIcon;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const sign: Sign = {
            id: this.id,
            stopLineId: this.originStopLineId,
            type: this.originType,
        };

        state.signs[this.id] = sign;
        state.currentPickElement = [...this.originCurrentPickElement];
        state.needRenderElements[ThreeObject.Sign][this.id] = ThreeElementType.SignIcon;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
export class FinishSignCommand {
    private id: string;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const sign = state.signs[this.id];
        if (!sign) {
            console.error(`FinishSignCommand execute时没找到id为${this.id}的标志牌`);
            return;
        }
        state.onsave = true;
        state.needRenderElements[ThreeObject.Sign][this.id] = ThreeElementType.SignIcon;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const sign = state.signs[this.id];
        if (!sign) {
            return;
        }
        state.onsave = true;
        state.needRenderElements[ThreeObject.Sign][this.id] = ThreeElementType.SignIcon;

        useManagerStore.getState().setMapState(state);
    }
}
export class ChangeSignTypeCommand {
    private id: string;

    private originType: SignType;

    private type: SignType;

    constructor(id: string, type: SignType) {
        this.id = id;
        this.type = type;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const sign = state.signs[this.id];
        if (!sign) {
            console.error(`ChangeSignTypeCommand execute时没找到id为${this.id}的标志牌`);
            return;
        }

        this.originType = sign.type;
        sign.type = this.type;
        state.onsave = true;
        state.needRenderElements[ThreeObject.Sign][this.id] = ThreeElementType.SignIcon;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const sign = state.signs[this.id];
        if (!sign) {
            return;
        }
        sign.type = this.originType;
        state.onsave = true;
        state.needRenderElements[ThreeObject.Sign][this.id] = ThreeElementType.SignIcon;

        useManagerStore.getState().setMapState(state);
    }
}
