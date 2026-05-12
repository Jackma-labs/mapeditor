import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { DeleteLaneCommand } from 'src/command/LaneCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { useManagerStore } from 'src/store';
import { searchBoundarysFromPointId } from 'src/utils/search/boundarySearch';
import { searchLaneIdsFromBoundaryId } from 'src/utils/search/laneSearch';
import { Lane } from 'src/interface/laneInterFace';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { DeleteArrowCommand, UpdateArrowCommand } from 'src/command/ArrowCommand';
import { searchPointsRelationObjects } from 'src/utils/search/common';

export function deleteLanePoint(pointId: string) {
    // 移除boundary对点的引用
    const action = [];
    /**
     * 判断是否可以删除该点
     * 如果boundary上只有两个点，则不可以删除点
     */
    const { boundarys: linkBoundarys, grouds: linkGrouds, arrows: linkArrows } = searchPointsRelationObjects([pointId]);
    let canDelete = true;
    linkBoundarys?.forEach((boundary) => {
        if (boundary.pointIds.length <= 2) {
            canDelete = false;
        }
    });
    if (!canDelete) {
        console.warn('该点关联的车道线中只有两个点，不能再删除了');
        return;
    }
    linkBoundarys?.forEach((boundary) => {
        action.push(new RemovePointFromBoundaryCommand(pointId, boundary.id));
    });
    linkGrouds?.forEach((groud) => {
        action.push(new UpdateGroudCommand(groud.id));
    });
    linkArrows?.forEach((arrow) => {
        action.push(new UpdateArrowCommand(arrow.id));
    });
    // 移除该点
    action.push(new DeletePointCommand(pointId));
    useManagerStore.getState().addCommand(action);
}
export function deleteLane(laneId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { lanes, boundarys } = newState;

    const lane = lanes[laneId];
    if (!lane) {
        console.warn(`deleteLane删除的lane未找到，lane的id为${laneId}`);
        return;
    }
    const { leftBoundaryId, rightBoundaryId } = lane;
    const leftBoundaryIdLinkLanes = searchLaneIdsFromBoundaryId(leftBoundaryId);
    const rightBoundaryIdLinkLanes = searchLaneIdsFromBoundaryId(rightBoundaryId);

    let leftBoundaryCanDel = false;
    let rightBoundaryCanDel = false;

    if (leftBoundaryIdLinkLanes.length === 1) {
        leftBoundaryCanDel = true;
    }
    if (rightBoundaryIdLinkLanes.length === 1) {
        rightBoundaryCanDel = true;
    }

    const action = [];
    action.push(new DeleteArrowCommand(lane.arrowId));
    action.push(new DeleteGroudCommand(lane.groudId));
    action.push(new DeleteLaneCommand(lane.id));
    if (leftBoundaryCanDel) {
        const pointIds = boundarys[leftBoundaryId]?.pointIds;
        action.push(new DeleteBoundaryCommand(leftBoundaryId));
        pointIds?.forEach((pId) => {
            const pLinkBoundarys = searchBoundarysFromPointId(pId);
            if (pLinkBoundarys?.length <= 1) {
                action.push(new DeletePointCommand(pId));
            }
        });
    }
    if (rightBoundaryCanDel) {
        const pointIds = boundarys[rightBoundaryId]?.pointIds;
        action.push(new DeleteBoundaryCommand(rightBoundaryId));
        pointIds?.forEach((pId) => {
            const pLinkBoundarys = searchBoundarysFromPointId(pId);
            if (pLinkBoundarys?.length <= 1) {
                action.push(new DeletePointCommand(pId));
            }
        });
    }
    useManagerStore.getState().addCommand(action);
}

export function deleteLaneLastDrawPoint(lane: Lane) {
    if (!lane) {
        return [];
    }
    const leftBoundaryPointIds = searchPointIdsFromBoundaryId(lane.leftBoundaryId);
    const rightBoundaryPointIds = searchPointIdsFromBoundaryId(lane.rightBoundaryId);

    let deletePointId = null;
    const groudId: string = lane.groudId;
    const leftBoundaryId: string = lane.leftBoundaryId;
    const rightBoundaryId: string = lane.rightBoundaryId;
    let actions: any = [];

    // 如果绘制的是第一个点，
    if (leftBoundaryPointIds.length === 1 && rightBoundaryPointIds.length === 0) {
        deletePointId = leftBoundaryPointIds[0];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, leftBoundaryId),
            new DeleteLaneCommand(lane.id),
            new DeleteGroudCommand(groudId),
            new DeleteBoundaryCommand(leftBoundaryId),
            new DeleteBoundaryCommand(rightBoundaryId),
            new DeletePointCommand(deletePointId),
            new SetCurrentDrawDataCommand(null, MapElementType.Lane),
        ];
    } else if (leftBoundaryPointIds.length === 1 && rightBoundaryPointIds.length === 1) {
        // 删除的是第二个点
        deletePointId = rightBoundaryPointIds[0];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, rightBoundaryId),
            new DeletePointCommand(deletePointId),
        ];
    } else if (leftBoundaryPointIds.length > 1 && rightBoundaryPointIds.length > 1) {
        // 如果删除的是第三个绘制点以上
        const deletePointId1 = rightBoundaryPointIds[rightBoundaryPointIds.length - 1];
        const deletePointId2 = leftBoundaryPointIds[leftBoundaryPointIds.length - 1];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId1, rightBoundaryId),
            new RemovePointFromBoundaryCommand(deletePointId2, leftBoundaryId),
            new DeletePointCommand(deletePointId1),
            new DeletePointCommand(deletePointId2),
        ];
    }
    return actions;
}
