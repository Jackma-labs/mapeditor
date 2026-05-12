import { Area, AreaType } from 'src/interface/areaInterFace';
import { useManagerStore } from 'src/store';

export class AddAreaCommand {
    public id: string;

    public boundaryId: string;

    private groudId: string;

    public type: AreaType;

    constructor(id: string, boundaryId: string, groudId: string, type: AreaType) {
        this.id = id;
        this.boundaryId = boundaryId;
        this.groudId = groudId;
        this.type = type;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const area: Area = {
            id: this.id,
            boundaryId: this.boundaryId,
            groudId: this.groudId,
            type: state.currentDrawData.areaAttr.type,
        };
        if (area.type === AreaType.Custom) {
            area.name = state.currentDrawData.areaAttr.name;
        }
        state.areas[this.id] = area;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.areas[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteAreaCommand {
    public id: string;

    private originBoundaryId: string;

    private originType: AreaType;

    private originGroudId: string | null;

    private originName: string;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const area = state.areas[this.id];
        if (!area) {
            console.warn(`DeleteAreaCommand execute时没有找到id为${this.id}的area`);
            return;
        }
        const { boundaryId, type, groudId, name } = area;
        this.originBoundaryId = boundaryId;
        this.originType = type;
        this.originGroudId = groudId;
        this.originName = name;

        delete state.areas[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originBoundaryId || !this.originType || !this.originGroudId) {
            console.warn(`DeleteAreaCommand undo时没有找到id为${this.id}的删除的area原始数据`);
            return;
        }
        const area: Area = {
            id: this.id,
            type: this.originType,
            boundaryId: this.originBoundaryId,
            groudId: this.originGroudId,
        };
        if (this.originName) {
            area.name = this.originName;
        }
        state.areas[this.id] = area;
        state.onsave = true;

        useManagerStore.getState().setMapState(state);
    }
}
