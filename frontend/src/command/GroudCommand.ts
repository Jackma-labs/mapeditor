import { Groud, GroudType } from 'src/interface/basicElementInterFace';
import { PickElementInfo, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export class AddGroudCommand {
    private id: string;

    private type: GroudType;

    constructor(id: string, type: GroudType) {
        this.id = id;
        this.type = type;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const groud: Groud = {
            id: this.id,
            type: this.type,
        };

        state.grouds[this.id] = groud;
        state.needRenderElements[ThreeObject.Groud][this.id] = groud.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.grouds[this.id];
        state.needRenderElements[ThreeObject.Groud][this.id] = this.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteGroudCommand {
    private groudId: string;

    private originType: GroudType;

    private origincurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.groudId = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const groud = state.grouds[this.groudId];
        if (!groud) {
            console.warn('DeleteGroudCommand groud not found');
            return;
        }
        this.origincurrentPickElement = [...state.currentPickElement];
        this.originType = groud.type;
        delete state.grouds[this.groudId];
        state.needRenderElements[ThreeObject.Groud][this.groudId] = groud.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const groudNew: Groud = {
            id: this.groudId,
            type: this.originType,
        };

        state.grouds[this.groudId] = groudNew;
        state.currentPickElement = [...this.origincurrentPickElement];
        state.needRenderElements[ThreeObject.Groud][this.groudId] = this.originType;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
export class UpdateGroudCommand {
    private groudId: string;

    private origincurrentPickElement: PickElementInfo[];

    constructor(id: string) {
        this.groudId = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const groud = state.grouds[this.groudId];
        if (!groud) {
            console.warn('UpdateGroudCommand groud not found');
            return;
        }
        this.origincurrentPickElement = [...state.currentPickElement];
        state.needRenderElements[ThreeObject.Groud][this.groudId] = groud.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const groud = state.grouds[this.groudId];
        if (!groud) {
            console.warn('UpdateGroudCommand undo groud not found');
            return;
        }

        state.currentPickElement = [...this.origincurrentPickElement];
        state.needRenderElements[ThreeObject.Groud][this.groudId] = groud.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
