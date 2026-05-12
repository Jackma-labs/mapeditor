import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { DeleteCrosswalkCommand } from 'src/command/CrosswalkCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { Crosswalk } from 'src/interface/crosswalkInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundarysFromPointId } from 'src/utils/search/boundarySearch';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';

export function deleteCrosswalkPoint(pointId: string) {
    const linkBoundary = searchBoundarysFromPointId(pointId);
    // crosswalk 一个点仅关联一个boundary
    if (linkBoundary[0].pointIds.length <= 5) {
        console.warn('crosswalk至少需要4个点，不能再删除点了');
        return;
    }
    const action = [];
    action.push(new RemovePointFromBoundaryCommand(pointId, linkBoundary[0].id));
    action.push(new DeletePointCommand(pointId));
    useManagerStore.getState().addCommand(action);
}
export function deleteCrosswalk(crosswalkId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { crosswalks, boundarys } = newState;
    const crosswalk = crosswalks[crosswalkId];
    if (!crosswalk) {
        console.warn(`deleteCrosswalk时删除的crosswalk没找到，id为${crosswalkId}`);
        return;
    }
    /**
     * 1. 清除groud
     * 2. 清除boundary
     * 3. 清除点
     * 4. 清除crosswalk
     */
    const action = [];
    action.push(new DeleteGroudCommand(crosswalk.groudId));
    action.push(new DeleteBoundaryCommand(crosswalk.boundaryId));

    const pointIds = boundarys[crosswalk.boundaryId]?.pointIds;
    const actualPointIds = pointIds?.slice(0, pointIds.length - 1);
    actualPointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteCrosswalkCommand(crosswalk.id));
    useManagerStore.getState().addCommand(action);
}
export function deleteCrosswalkLastDrawPoint(crosswalk: Crosswalk) {
    if (!crosswalk) {
        return [];
    }
    let actions: any = [];
    const boundaryPoints = searchPointIdsFromBoundaryId(crosswalk.boundaryId);
    const boundaryId = crosswalk.boundaryId;
    const groudId = crosswalk.groudId;

    if (boundaryPoints.length === 1) {
        const deletePointId = boundaryPoints[0];
        actions = [
            new DeleteGroudCommand(groudId),
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeleteBoundaryCommand(boundaryId),
            new DeleteCrosswalkCommand(crosswalk.id),
            new DeletePointCommand(deletePointId),
            new SetCurrentDrawDataCommand(null, MapElementType.Crosswalk),
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
