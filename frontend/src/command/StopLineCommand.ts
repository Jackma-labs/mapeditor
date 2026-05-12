import { StopLine, StopLineOrigin } from 'src/interface/stopLineInterFace';
import { useManagerStore } from 'src/store';

export class AddStopLineCommand {
    private id: string;

    private boundaryId: string;

    private origin: StopLineOrigin;

    constructor(id: string, boundaryId: string, origin: StopLineOrigin) {
        this.id = id;
        this.boundaryId = boundaryId;
        this.origin = origin;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const stopLine: StopLine = {
            id: this.id,
            boundaryId: this.boundaryId,
            origin: this.origin,
        };
        state.stopLines[this.id] = stopLine;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.stopLines[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
export class DeleteStopLineCommand {
    private stopLineId: string;

    private originBoundaryId: string;

    private originOrigin: StopLineOrigin;

    constructor(stopLineId: string) {
        this.stopLineId = stopLineId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const stopLine = state.stopLines[this.stopLineId];
        if (!stopLine) {
            console.warn(`DeleteStopLineCommand execute时没有找到id为${this.stopLineId}的stopLine`);
            return;
        }

        // 存储原始数据，以便回撤
        this.originBoundaryId = stopLine.boundaryId;
        this.originOrigin = stopLine.origin;
        delete state.stopLines[this.stopLineId];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originBoundaryId) {
            console.warn(`DeleteStopLineCommand undo时没有存储id为${this.stopLineId}的stopLine的原始数据`);
            return;
        }
        const stopLine: StopLine = {
            id: this.stopLineId,
            boundaryId: this.originBoundaryId,
            origin: this.originOrigin,
        };

        state.stopLines[this.stopLineId] = stopLine;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
