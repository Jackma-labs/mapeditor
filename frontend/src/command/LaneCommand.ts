import { getBoundarysReverse } from 'src/handle/boundary/combineLaneHandle';
import { swapLaneBoundaryHandle } from 'src/handle/lane/addLaneHandle';
import { Lane, LaneAttr, LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';

export class AddLaneCommand {
    public id: string;

    public leftBoundaryId: string;

    public rightBoundaryId: string;

    public groudId: string;

    private arrowId: string;

    public attr: LaneAttr;

    private leftBoundaryReverse: boolean;

    private rightBoundaryReverse: boolean;

    private laneTrend: LaneTrend;

    constructor(
        id: string,
        leftBoundaryId: string,
        rightBoundaryId: string,
        groudId: string,
        arrowId: string,
        attr: LaneAttr,
        leftBoundaryReverse: boolean,
        rightBoundaryReverse: boolean,
        laneTrend: LaneTrend = LaneTrend.Straight,
    ) {
        this.id = id;
        this.leftBoundaryId = leftBoundaryId;
        this.rightBoundaryId = rightBoundaryId;
        this.groudId = groudId;
        this.arrowId = arrowId;
        this.attr = { ...attr };
        this.leftBoundaryReverse = leftBoundaryReverse;
        this.rightBoundaryReverse = rightBoundaryReverse;
        this.laneTrend = laneTrend;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        // 创建一个lane对象，添加到state数据中
        const lane: Lane = {
            id: this.id,
            attr: { ...this.attr },
            leftBoundaryId: this.leftBoundaryId,
            rightBoundaryId: this.rightBoundaryId,
            groudId: this.groudId,
            arrowId: this.arrowId,
            leftBoundaryReverse: this.leftBoundaryReverse,
            rightBoundaryReverse: this.rightBoundaryReverse,
            width: 4,
            prossibleDrivingDirectionArrowId: this.arrowId,
            type: this.laneTrend,
        };
        state.lanes[this.id] = lane;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.lanes[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteLaneCommand {
    public id: string;

    private originLeftBoundaryId: string;

    private originRightBoundaryId: string;

    private originGroudId: string;

    private originArrowId: string;

    private originAttr: LaneAttr;

    private originLeftBoundaryReverse: boolean;

    private originRightBoundaryReverse: boolean;

    private originWidth: number;

    private originLaneTrend: LaneTrend;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const lane = state.lanes[this.id];
        if (!lane) {
            console.warn(`DeleteLaneCommand execute时没有找到id为${this.id}的lane`);
            return;
        }
        const {
            leftBoundaryId,
            rightBoundaryId,
            groudId,
            attr,
            leftBoundaryReverse,
            rightBoundaryReverse,
            width,
            arrowId,
        } = lane;

        // 保存删除lane的信息
        this.originLeftBoundaryId = leftBoundaryId;
        this.originRightBoundaryId = rightBoundaryId;
        this.originGroudId = groudId;
        this.originArrowId = arrowId;
        this.originAttr = { ...attr };
        this.originLeftBoundaryReverse = leftBoundaryReverse;
        this.originRightBoundaryReverse = rightBoundaryReverse;
        this.originWidth = width;
        this.originLaneTrend = lane.type;

        delete state.lanes[this.id];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originLeftBoundaryId || !this.originRightBoundaryId || !this.originGroudId) {
            console.warn(`DeleteLaneCommand undo时没有存储id为${this.id}的lane的原始数据`);
            return;
        }
        // 创建一个lane对象，添加到state数据中
        const lane: Lane = {
            id: this.id,
            attr: { ...this.originAttr },
            leftBoundaryId: this.originLeftBoundaryId,
            rightBoundaryId: this.originRightBoundaryId,
            groudId: this.originGroudId,
            arrowId: this.originArrowId,
            leftBoundaryReverse: this.originLeftBoundaryReverse,
            rightBoundaryReverse: this.originRightBoundaryReverse,
            width: this.originWidth,
            prossibleDrivingDirectionArrowId: this.originArrowId,
            type: this.originLaneTrend,
        };
        state.lanes[this.id] = lane;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class UpdateLaneWidthCommand {
    private id: string;

    private width: number;

    private originWidth: number;

    constructor(id: string, width: number) {
        this.id = id;
        this.width = width;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const lane = state.lanes[this.id];
        if (!lane) {
            console.warn(`UpdateLaneWidthCommand execute时没有找到id为${this.id}的lane`);
            return;
        }
        this.originWidth = lane.width;

        lane.width = this.width;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const lane = state.lanes[this.id];
        if (!lane) {
            console.warn(`UpdateLaneWidthCommand undo时没有找到id为${this.id}的lane`);
            return;
        }
        lane.width = this.originWidth;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

export class FinishLaneCommand {
    private laneId: string;

    constructor(laneId: string) {
        this.laneId = laneId;
    }

    execute() {
        let state = useManagerStore.getState().mapState;

        // 如果绘制的时候描边基于左车道，则需要交换lane的左右车道
        const lane = state.lanes[this.laneId];
        if (!lane) {
            return;
        }
        // 如果相对方向是反向，则需要交换左右车道，且将左右车道的reverse设置为true
        if (lane.attr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD) {
            state = swapLaneBoundaryHandle(this.laneId);
            state.lanes[this.laneId].leftBoundaryReverse = true;
            state.lanes[this.laneId].rightBoundaryReverse = true;
        }

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        let state = useManagerStore.getState().mapState;

        const lane = state.lanes[this.laneId];
        if (!lane) {
            return;
        }
        // 如果相对方向是反向，则需要交换左右车道，且将左右车道的reverse设置为true
        if (lane.attr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD) {
            state = swapLaneBoundaryHandle(this.laneId);
            state.lanes[this.laneId].leftBoundaryReverse = false;
            state.lanes[this.laneId].rightBoundaryReverse = false;
        }

        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}
/**
 * 交换两个lane的左右边界
 */
export class SwapLaneBoundary {
    private id: string;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        let state = useManagerStore.getState().mapState;
        state = swapLaneBoundaryHandle(this.id);
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        let state = useManagerStore.getState().mapState;

        state = swapLaneBoundaryHandle(this.id);
        useManagerStore.getState().setMapState(state);
    }
}
/**
 * 更新lane的boundary引用
 */
export class ChangeLaneBoundary {
    private laneId: string;

    private leftBoundaryId: string;

    private rightBoundaryId: string;

    private originLeftBoundaryId: string;

    private originRightBoundaryId: string;

    constructor(laneId: string, leftBoundaryId: string, rightBoundaryId: string) {
        this.laneId = laneId;
        this.leftBoundaryId = leftBoundaryId;
        this.rightBoundaryId = rightBoundaryId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const lane = state.lanes[this.laneId];
        this.originLeftBoundaryId = lane.leftBoundaryId;
        this.originRightBoundaryId = lane.rightBoundaryId;

        lane.leftBoundaryId = this.leftBoundaryId;
        lane.rightBoundaryId = this.rightBoundaryId;

        const leftPoints = searchPointsFromBoundaryId(this.leftBoundaryId).map((item) => item.position);
        const rightPoints = searchPointsFromBoundaryId(this.rightBoundaryId).map((item) => item.position);
        const [leftReverse, rightReverse] = getBoundarysReverse(leftPoints, rightPoints);
        lane.leftBoundaryReverse = leftReverse;
        lane.rightBoundaryReverse = rightReverse;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const lane = state.lanes[this.laneId];

        lane.leftBoundaryId = this.originLeftBoundaryId;
        lane.rightBoundaryId = this.originRightBoundaryId;

        const leftPoints = searchPointsFromBoundaryId(this.originLeftBoundaryId).map((item) => item.position);
        const rightPoints = searchPointsFromBoundaryId(this.originRightBoundaryId).map((item) => item.position);
        const [leftReverse, rightReverse] = getBoundarysReverse(leftPoints, rightPoints);
        lane.leftBoundaryReverse = leftReverse;
        lane.rightBoundaryReverse = rightReverse;

        useManagerStore.getState().setMapState(state);
    }
}

export class UpdateLaneAttrCommand {
    private laneId: string;

    private patch: Partial<LaneAttr>;

    private originAttr: LaneAttr;

    constructor(laneId: string, patch: Partial<LaneAttr>) {
        this.laneId = laneId;
        this.patch = { ...patch };
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const lane = state.lanes[this.laneId];
        if (!lane) {
            console.warn(`UpdateLaneAttrCommand execute时没有找到id为${this.laneId}的lane`);
            return;
        }
        this.originAttr = { ...lane.attr };
        const nextAttr = {
            ...lane.attr,
            ...this.patch,
        };
        if (this.patch.speed !== undefined && this.patch.speedKph === undefined) {
            nextAttr.speedKph = this.patch.speed;
        }
        state.lanes[this.laneId].attr = nextAttr;
        state.currentDrawData = { ...state.currentDrawData };
        state.currentPickElement = [...state.currentPickElement];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;
        const lane = state.lanes[this.laneId];
        if (!lane) {
            console.warn(`UpdateLaneAttrCommand undo时没有找到id为${this.laneId}的lane`);
            return;
        }
        state.lanes[this.laneId].attr = { ...this.originAttr };
        state.currentDrawData = { ...state.currentDrawData };
        state.currentPickElement = [...state.currentPickElement];
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }
}

function reverseBoundary(laneId: string) {
    const { mapState } = useManagerStore.getState();
    const lane = mapState.lanes[laneId];
    if (!lane) {
        return mapState;
    }
    const temp = mapState.lanes[laneId].rightBoundaryId;
    mapState.lanes[laneId].rightBoundaryId = lane.leftBoundaryId;
    mapState.lanes[laneId].leftBoundaryId = temp;

    const leftPoints = searchPointsFromBoundaryId(mapState.lanes[laneId].leftBoundaryId).map((item) => item.position);
    const rightPoints = searchPointsFromBoundaryId(mapState.lanes[laneId].rightBoundaryId).map((item) => item.position);
    const [leftBoundaryReverse, rightBoundaryReverse] = getBoundarysReverse(leftPoints, rightPoints);

    mapState.lanes[laneId].leftBoundaryReverse = leftBoundaryReverse;
    mapState.lanes[laneId].rightBoundaryReverse = rightBoundaryReverse;
    return mapState;
}
export class ChangeLaneProssibleDrivingDirectionCommand {
    prossibleDrivingDirection: ProssibleDrivingDirection;

    laneId: string;

    originProssibleDrivingDirection: ProssibleDrivingDirection;

    constructor(laneId: string, prossibleDrivingDirection: ProssibleDrivingDirection) {
        this.laneId = laneId;
        this.prossibleDrivingDirection = prossibleDrivingDirection;
    }

    execute() {
        let { mapState } = useManagerStore.getState();
        const lane = mapState.lanes[this.laneId];
        if (!lane) {
            console.warn('ChangeLaneProssibleDrivingDirectionCommand lane not found');
            return;
        }
        this.originProssibleDrivingDirection = lane.attr.prossibleDrivingDirection;

        const needReverse =
            lane.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
            this.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION;

        if (needReverse) {
            mapState = { ...reverseBoundary(this.laneId) };
        }
        mapState.lanes[this.laneId].attr.prossibleDrivingDirection = this.prossibleDrivingDirection;
        mapState.currentDrawData = { ...mapState.currentDrawData };
        mapState.currentPickElement = [...mapState.currentPickElement];
        mapState.onsave = true;
        useManagerStore.getState().setMapState(mapState);
    }

    undo() {
        let { mapState } = useManagerStore.getState();
        const lane = mapState.lanes[this.laneId];
        if (!lane) {
            console.warn('ChangeLaneProssibleDrivingDirectionCommand lane not found');
            return;
        }
        const needReverse =
            lane.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
            this.originProssibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION;

        if (needReverse) {
            mapState = { ...reverseBoundary(this.laneId) };
        }
        mapState.lanes[this.laneId].attr.prossibleDrivingDirection = this.originProssibleDrivingDirection;
        mapState.currentDrawData = { ...mapState.currentDrawData };
        mapState.currentPickElement = [...mapState.currentPickElement];
        mapState.onsave = true;
        useManagerStore.getState().setMapState(mapState);
    }
}
