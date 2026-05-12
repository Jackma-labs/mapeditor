import { DeleteArrowCommand } from 'src/command/ArrowCommand';
import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { DeleteParkingSpaceCommand } from 'src/command/ParkingSpaceCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';

export function deleteParkingSpace(parkingSpaceId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { parkingSpaces, boundarys } = newState;
    const parkingSpace = parkingSpaces[parkingSpaceId];
    if (!parkingSpace) {
        console.warn(`deleteParkingSpace时删除的parkingSpace没找到，id为${parkingSpaceId}`);
        return;
    }
    /**
     * 1. 清除groud
     * 2. 清除boundary
     * 3. 清除点
     * 4. 清除crosswalk
     */
    const { id, groudId, boundaryId } = parkingSpace;
    const action = [];
    action.push(new DeleteArrowCommand(parkingSpace.arrowId));
    action.push(new DeleteGroudCommand(groudId));
    action.push(new DeleteParkingSpaceCommand(id));
    action.push(new DeleteBoundaryCommand(boundaryId));

    const pointIds = boundarys[boundaryId]?.pointIds;
    const actualPointIds = pointIds?.slice(0, pointIds.length - 1);
    actualPointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    useManagerStore.getState().addCommand(action);
}

export function deleteParkingSpaceLastDrawPoint(parkingSpace: ParkingSpace) {
    if (!parkingSpace) {
        return [];
    }
    let actions: any = [];
    const boundaryPoints = searchPointIdsFromBoundaryId(parkingSpace.boundaryId);
    const boundaryId = parkingSpace.boundaryId;
    const groudId = parkingSpace.groudId;

    if (boundaryPoints.length === 1) {
        const deletePointId = boundaryPoints[0];
        actions = [
            new DeleteGroudCommand(groudId),
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeleteBoundaryCommand(boundaryId),
            new DeleteParkingSpaceCommand(parkingSpace.id),
            new DeletePointCommand(deletePointId),
            new SetCurrentDrawDataCommand(null, MapElementType.ParkingSpace),
        ];
    } else if (boundaryPoints.length === 2) {
        const deletePointId = boundaryPoints[1];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeletePointCommand(deletePointId),
        ];
    }
    return actions;
}
