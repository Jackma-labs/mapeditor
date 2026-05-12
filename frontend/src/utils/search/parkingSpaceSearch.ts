import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { useManagerStore } from 'src/store';

export const searchParkingSpaceByGroudId = (groudId: string): ParkingSpace => {
    const state = useManagerStore.getState().mapState;
    const { parkingSpaces } = state;
    let result: ParkingSpace = null;
    Object.keys(parkingSpaces).forEach((id) => {
        const parkingSpace = parkingSpaces[id];
        if (parkingSpace.groudId === groudId) {
            result = parkingSpace;
        }
    });
    if (!result) {
        console.warn(`searchParkingSpaceByGroudId: ${groudId} not found`);
    }
    return result;
};
export function searchParkingSpaceByParkingSpaceId(parkingSpaceId: string) {
    if (!parkingSpaceId) {
        console.warn('searchParkingSpaceByParkingSpaceId: parkingSpaceId is null');
        return null;
    }
    const state = useManagerStore.getState().mapState;
    const { parkingSpaces } = state;
    if (!parkingSpaces[parkingSpaceId]) {
        console.warn(`parkingSpaceId: ${parkingSpaceId} not found`);
    }
    return parkingSpaces[parkingSpaceId];
}
export function searchParkingSpaceByBoundaryId(boundaryId: string) {
    let result: ParkingSpace = null;
    const state = useManagerStore.getState().mapState;
    const { parkingSpaces } = state;
    Object.keys(parkingSpaces).forEach((id) => {
        const parkingSpace = parkingSpaces[id];
        if (parkingSpace.boundaryId === boundaryId) {
            result = parkingSpace;
        }
    });
    if (!result) {
        console.warn('searchParkingSpaceByBoundaryId: parkingSpace not found');
    }
    return result;
}
export function searchParkingSpaceByArrowId(arrowId: string) {
    let result: ParkingSpace = null;
    const { prossibleDrivingDirections, parkingSpaces } = useManagerStore.getState().mapState;
    const arrow = prossibleDrivingDirections[arrowId];
    if (!arrow) {
        return null;
    }
    Object.keys(parkingSpaces).forEach((id) => {
        const parkingSpace = parkingSpaces[id];
        if (parkingSpace.arrowId === arrowId) {
            result = parkingSpace;
        }
    });
    return result;
}
