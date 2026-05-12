import { Junction, JunctionAttr } from 'src/interface/junctionInterFace';
import { useManagerStore } from 'src/store';

export class AddJunctionCommand {
    public id: string;

    public boundaryId: string;

    public attr: JunctionAttr;

    private groudId: string;

    constructor(id: string, boundaryId: string, groudId: string, attr: JunctionAttr) {
        this.id = id;
        this.boundaryId = boundaryId;
        this.groudId = groudId;
        this.attr = { ...attr };
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const junction: Junction = {
            id: this.id,
            attr: { ...this.attr },
            boundaryId: this.boundaryId,
            groudId: this.groudId,
        };
        state.junctions[this.id] = junction;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.junctions[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteJunctionCommand {
    public id: string;

    private originBoundaryId: string;

    private originAttr: JunctionAttr;

    private originGroudId: string | null;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const junction = state.junctions[this.id];
        if (!junction) {
            console.warn(`DeleteJunctionCommand execute时没有找到id为${this.id}的junction`);
            return;
        }
        const { boundaryId, attr, groudId } = junction;
        this.originBoundaryId = boundaryId;
        this.originAttr = { ...attr };
        this.originGroudId = groudId;

        delete state.junctions[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originBoundaryId || !this.originAttr || !this.originGroudId) {
            console.warn(`DeleteJunctionCommand undo时没有找到id为${this.id}的删除的junction原始数据`);
            return;
        }
        const junction: Junction = {
            id: this.id,
            attr: { ...this.originAttr },
            boundaryId: this.originBoundaryId,
            groudId: this.originGroudId,
        };
        state.junctions[this.id] = junction;
        state.onsave = true;

        useManagerStore.getState().setMapState(state);
    }
}
