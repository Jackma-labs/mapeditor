import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { DeleteSpeedBumpCommand } from 'src/command/SpeedBumpCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { SpeedBump } from 'src/interface/speedBumpInterFace';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';

export function deleteSpeedBump(speedBumpId: string) {
    const state = useManagerStore.getState().mapState;

    const { boundarys, speedBumps } = state;
    // 通过boundaryId查找到 speedBump
    const speedBump = speedBumps[speedBumpId];
    if (!speedBump) {
        console.warn(`deleteSpeedBump时删除的speedBump没找到，id为${speedBumpId}`);
        return;
    }
    /**
     * 1. 清除boundary
     * 2. 清除点
     * 3. 清除speedbump
     */
    const action = [];
    action.push(new DeleteGroudCommand(speedBump.groudId));
    action.push(new DeleteBoundaryCommand(speedBump.boundaryId));

    const pointIds = boundarys[speedBump.boundaryId]?.pointIds;
    pointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteSpeedBumpCommand(speedBump.id));
    useManagerStore.getState().addCommand(action);
}
export function deleteSpeedBumpLastDrawPoint(speedBump: SpeedBump) {
    if (!speedBump) {
        return [];
    }
    let actions: any = [];
    const boundaryPoints = searchPointIdsFromBoundaryId(speedBump.boundaryId);
    const boundaryId = speedBump?.boundaryId;
    const groudId = speedBump.groudId;

    if (boundaryPoints.length === 1) {
        const deletePointId = boundaryPoints[0];
        actions = [
            new DeleteGroudCommand(groudId),
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeleteBoundaryCommand(boundaryId),
            new DeleteSpeedBumpCommand(speedBump.id),
            new DeletePointCommand(deletePointId),
            new SetCurrentDrawDataCommand(null, MapElementType.SpeedBump),
        ];
    }
    return actions;
}
