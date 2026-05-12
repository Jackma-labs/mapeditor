import { PickElementInfo } from 'src/interface/commonInterFace';
import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { useManagerStore } from 'src/store';

export class AddParkingSpaceCommand {
    private id: string;

    private boundaryId: string;

    private length: number;

    private width: number;

    private heading: number;

    private groudId: string;

    private arrowId: string;

    constructor(id: string, boundaryId: string, groudId: string, arrowId: string) {
        this.id = id;
        this.boundaryId = boundaryId;
        this.length = 0;
        this.width = 0;
        this.heading = 0;
        this.groudId = groudId;
        this.arrowId = arrowId;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const prakingSpace: ParkingSpace = {
            id: this.id,
            boundaryId: this.boundaryId,
            heading: this.heading,
            length: this.length,
            width: this.width,
            groudId: this.groudId,
            arrowId: this.arrowId,
        };
        state.parkingSpaces[this.id] = prakingSpace;
        state.onsave = true;
        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        delete state.parkingSpaces[this.id];
        state.onsave = true;

        useManagerStore.getState().setMapState(state);
    }
}

export class DeleteParkingSpaceCommand {
    private id: string;

    private originBoundaryId: string;

    private originLength: number;

    private originWidth: number;

    private originHeading: number;

    private originGroudId: string;

    private originArrowId: string;

    constructor(id: string) {
        this.id = id;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const parkingSpace = state.parkingSpaces[this.id];
        if (!parkingSpace) {
            console.warn(`DeleteParkingSpaceCommand execute时id为${this.id}的parkingSpace没找到`);
            return;
        }
        // 存储原始点，以便回撤
        this.originBoundaryId = parkingSpace.boundaryId;
        this.originHeading = parkingSpace.heading;
        this.originWidth = parkingSpace.width;
        this.originLength = parkingSpace.length;
        this.originGroudId = parkingSpace.groudId;
        this.originArrowId = parkingSpace.arrowId;

        delete state.parkingSpaces[this.id];
        useManagerStore.getState().setMapState(state);
        state.onsave = true;
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        if (!this.originBoundaryId) {
            console.warn(`DeleteParkingSpaceCommand undo时id为${this.id}的originBoundaryId为null`);
            return;
        }

        const parkingSpace: ParkingSpace = {
            id: this.id,
            boundaryId: this.originBoundaryId,
            heading: this.originHeading,
            width: this.originWidth,
            length: this.originLength,
            groudId: this.originGroudId,
            arrowId: this.originArrowId,
        };
        state.parkingSpaces[this.id] = parkingSpace;
        state.onsave = true;

        useManagerStore.getState().setMapState(state);
    }
}

export class UpdateParkingSpaceWidthCommand {
    private id: string;

    private updateWidth: number;

    private originWidth: number;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string, updateWidth: number) {
        this.id = id;
        this.updateWidth = updateWidth;
    }

    execute() {
        const state = useManagerStore.getState().mapState;

        const parkingSpace = state.parkingSpaces[this.id];
        if (!parkingSpace) {
            return;
        }
        this.originWidth = parkingSpace.width;
        this.originCurrentPickElement = [...state.currentPickElement];

        parkingSpace.width = this.updateWidth;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const parkingSpace = state.parkingSpaces[this.id];
        if (!parkingSpace) {
            return;
        }
        parkingSpace.width = this.originWidth;
        state.currentPickElement = [...this.originCurrentPickElement];
        useManagerStore.getState().setMapState(state);
    }
}
export class UpdateParkingSpaceLengthCommand {
    private id: string;

    private updateLength: number;

    private originLength: number;

    private originCurrentPickElement: PickElementInfo[];

    constructor(id: string, updateLength: number) {
        this.id = id;
        this.updateLength = updateLength;
    }

    execute() {
        const state = useManagerStore.getState().mapState;
        const parkingSpace = state.parkingSpaces[this.id];
        if (!parkingSpace) {
            return;
        }
        this.originLength = parkingSpace.length;
        this.originCurrentPickElement = [...state.currentPickElement];
        parkingSpace.length = this.updateLength;

        useManagerStore.getState().setMapState(state);
    }

    undo() {
        const state = useManagerStore.getState().mapState;

        const parkingSpace = state.parkingSpaces[this.id];
        if (!parkingSpace) {
            return;
        }
        parkingSpace.length = this.originLength;
        state.currentPickElement = [...this.originCurrentPickElement];
        useManagerStore.getState().setMapState(state);
    }
}
