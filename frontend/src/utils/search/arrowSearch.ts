import { ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchLaneFromGroudId } from './laneSearch';
import { searchParkingSpaceByGroudId } from './parkingSpaceSearch';

export function searchArrowFromGroudId(groudId: string) {
    const { grouds, prossibleDrivingDirections } = useManagerStore.getState().mapState;
    const groud = grouds[groudId];
    if (!groud) {
        return null;
    }
    if (groud.type === ThreeElementType.LaneGroud) {
        const lane = searchLaneFromGroudId(groud.id);
        if (!lane) {
            return null;
        }
        return prossibleDrivingDirections[lane.arrowId];
    }
    const parkingSpace = searchParkingSpaceByGroudId(groud.id);
    if (!parkingSpace) {
        return null;
    }
    return prossibleDrivingDirections[parkingSpace.arrowId];
}
