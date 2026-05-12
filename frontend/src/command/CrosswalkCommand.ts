import { Crosswalk } from 'src/interface/crosswalkInterFace';
import { useManagerStore } from 'src/store';

export class AddCrosswalkCommand {
    private crosswalkId: string;

    private boundaryId: string;

    private groudId: string;

    constructor(crosswalkId: string, boundaryId: string, groudId: string) {
        this.crosswalkId = crosswalkId;
        this.boundaryId = boundaryId;
        this.groudId = groudId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const crosswalk: Crosswalk = {
            id: this.crosswalkId,
            boundaryId: this.boundaryId,
            groudId: this.groudId,
        };
        state.crosswalks[this.crosswalkId] = crosswalk;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.crosswalks[this.crosswalkId];
        state.onsave = true;

        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteCrosswalkCommand {
    private corsswalkId: string;

    private originBoundaryId: string;

    private originGroudId: string;

    constructor(corsswalkId: string) {
        this.corsswalkId = corsswalkId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const crosswalk = state.crosswalks[this.corsswalkId];
        if (!crosswalk) {
            console.warn(`DeleteCrosswalkCommand execute时id为${this.corsswalkId}的crosswalk没找到`);
            return;
        }
        // 存储原始点，以便回撤
        this.originBoundaryId = crosswalk.boundaryId;
        this.originGroudId = crosswalk.groudId;

        // 删除当前crosswalk数据
        delete state.crosswalks[this.corsswalkId];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originBoundaryId || !this.originGroudId) {
            console.warn(
                `DeleteCrosswalkCommand undo时id为${this.corsswalkId}的originBoundaryId或者originGroudId数据为null`,
            );
            return;
        }

        const crosswalk: Crosswalk = {
            id: this.corsswalkId,
            boundaryId: this.originBoundaryId,
            groudId: this.originGroudId,
        };

        state.crosswalks[this.corsswalkId] = crosswalk;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
