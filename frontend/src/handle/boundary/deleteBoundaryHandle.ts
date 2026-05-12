import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { Boundary } from 'src/interface/basicElementInterFace';
import { MapElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundarysFromPointId } from 'src/utils/search/boundarySearch';
import { searchLanesFromBoundaryId } from 'src/utils/search/laneSearch';
import { searchPointIdsFromBoundaryId, searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';

export function deleteStraightLineLastDrawPoint(boundary: Boundary) {
    if (!boundary) {
        return [];
    }

    let actions: any = [];
    const boundaryPoints = searchPointIdsFromBoundaryId(boundary.id);

    if (boundaryPoints.length === 1) {
        const deletePointId = boundaryPoints[0];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, boundary.id),
            new DeleteBoundaryCommand(boundary.id),
            new DeletePointCommand(deletePointId),
            new SetCurrentDrawDataCommand(null, MapElementType.StraightLine),
        ];
    } else {
        const deletePointId = boundaryPoints[boundaryPoints.length - 1];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, boundary.id),
            new DeletePointCommand(deletePointId),
        ];
    }
    return actions;
}

export function deteleBoundaryHandle(boundaryId: string) {
    const lanes = searchLanesFromBoundaryId(boundaryId);
    if (lanes.length !== 0) {
        return;
    }
    const actions = [];
    const points = searchPointsFromBoundaryId(boundaryId);
    actions.push(new DeleteBoundaryCommand(boundaryId));
    points.forEach((item) => {
        const pLinkBoundarys = searchBoundarysFromPointId(item.id);
        if (pLinkBoundarys.length !== 1) {
            return;
        }
        actions.push(new DeletePointCommand(item.id));
    });
    useManagerStore.getState().addCommand(actions);
}
