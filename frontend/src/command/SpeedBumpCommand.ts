import { SpeedBump } from 'src/interface/speedBumpInterFace';
import { useManagerStore } from 'src/store';

export class AddSpeedBumpCommand {
    private id: string;

    private boundaryId: string;

    private groudId: string;

    constructor(id: string, boundaryId: string, groudId: string) {
        this.id = id;
        this.boundaryId = boundaryId;
        this.groudId = groudId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const speedBump: SpeedBump = {
            id: this.id,
            boundaryId: this.boundaryId,
            groudId: this.groudId,
        };
        state.speedBumps[this.id] = speedBump;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.speedBumps[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
export class DeleteSpeedBumpCommand {
    private speedBumpId: string;

    private originBoundaryId: string;

    private originGroudId: string;

    constructor(speedBumpId: string) {
        this.speedBumpId = speedBumpId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const speedBump = state.speedBumps[this.speedBumpId];
        if (!speedBump) {
            console.warn(`DeleteSpeedBumpCommand execute时没有找到id为${this.speedBumpId}的SpeedBump`);
            return;
        }

        // 存储原始数据，以便回撤
        this.originBoundaryId = speedBump.boundaryId;
        this.originGroudId = speedBump.groudId;
        // 删除当前speedBump数据
        delete state.speedBumps[this.speedBumpId];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originBoundaryId || !this.originGroudId) {
            console.warn(`DeleteSpeedBumpCommand undo时没有存储id为${this.speedBumpId}的SpeedBump的原始数据`);
            return;
        }
        const speedBump: SpeedBump = {
            id: this.speedBumpId,
            boundaryId: this.originBoundaryId,
            groudId: this.originGroudId,
        };

        state.speedBumps[this.speedBumpId] = speedBump;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
