import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export class AddArrowCommand {
    private arrowId: string;

    private type: ThreeElementType;

    constructor(arrowId: string, type: ThreeElementType) {
        this.arrowId = arrowId;
        this.type = type;
    }

    async execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        mapState.prossibleDrivingDirections[this.arrowId] = {
            id: this.arrowId,
            type: this.type,
        };
        mapState.needRenderElements[ThreeObject.Arrow][this.arrowId] = this.type;

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        delete mapState.prossibleDrivingDirections[this.arrowId];
        mapState.needRenderElements[ThreeObject.Arrow][this.arrowId] = this.type;

        setMapState(mapState);
    }
}
export class DeleteArrowCommand {
    private arrowId: string;

    private originType: ThreeElementType;

    constructor(arrowId: string) {
        this.arrowId = arrowId;
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();
        const arrow = mapState.prossibleDrivingDirections[this.arrowId];
        if (!arrow) {
            console.warn(`DeleteArrowCommandid为${this.arrowId}的 arrow not found`);
            return;
        }
        this.originType = arrow.type;

        delete mapState.prossibleDrivingDirections[this.arrowId];
        mapState.needRenderElements[ThreeObject.Arrow][this.arrowId] = this.originType;

        setMapState(mapState);
    }

    async undo() {
        const { mapState, setMapState } = useManagerStore.getState();

        const arrow = {
            id: this.arrowId,
            type: this.originType,
        };

        mapState.prossibleDrivingDirections[this.arrowId] = arrow;
        mapState.needRenderElements[ThreeObject.Arrow][this.arrowId] = this.originType;

        setMapState(mapState);
    }
}
export class UpdateArrowCommand {
    private arrowId: string;

    constructor(id: string) {
        this.arrowId = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const arrow = state.prossibleDrivingDirections[this.arrowId];
        if (!arrow) {
            console.warn('UpdateArrowCommand arrow not found');
            return;
        }
        state.needRenderElements[ThreeObject.Arrow][this.arrowId] = arrow.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const arrow = state.prossibleDrivingDirections[this.arrowId];
        if (!arrow) {
            console.warn('UpdateArrowCommand undo arrow not found');
            return;
        }

        state.needRenderElements[ThreeObject.Arrow][this.arrowId] = arrow.type;

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
