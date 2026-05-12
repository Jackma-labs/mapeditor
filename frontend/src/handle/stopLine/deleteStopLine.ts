import { DeleteBarrierGateCommand } from 'src/command/BarrierGateCommand';
import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { DeleteSignCommand } from 'src/command/SignCommand';
import { DeleteStopLineCommand } from 'src/command/StopLineCommand';
import { DeleteTrafficLightCommand } from 'src/command/TrafficLightCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { StopLine } from 'src/interface/stopLineInterFace';
import { useManagerStore } from 'src/store';
import { searchBarrierGateFromStopLintId } from 'src/utils/search/barrierGateSearch';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchSignFromStopLintId } from 'src/utils/search/signSearch';
import { searchTrafficLightFromStopLintId } from 'src/utils/search/trafficLightSearch';

export function deleteStopLine(stopLineId: string) {
    const state = useManagerStore.getState().mapState;

    const { boundarys, stopLines } = state;
    // 通过boundaryId查找到 speedBump
    const stopLine = stopLines[stopLineId];
    if (!stopLine) {
        console.warn(`deleteStopLine时删除的stopLine没找到，id为${stopLineId}`);
        return;
    }
    /**
     * 1. 清除boundary
     * 2. 清除点
     * 3. 清除speedbump
     */
    const action = [];
    action.push(new DeleteBoundaryCommand(stopLine.boundaryId));

    const pointIds = boundarys[stopLine.boundaryId]?.pointIds;
    pointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteStopLineCommand(stopLine.id));
    const linkTrafficLight = searchTrafficLightFromStopLintId(stopLineId);
    if (linkTrafficLight) {
        action.push(new DeleteTrafficLightCommand(linkTrafficLight.id));
    }
    const linkSign = searchSignFromStopLintId(stopLineId);
    if (linkSign) {
        action.push(new DeleteSignCommand(linkSign.id));
    }

    const linkBarrierGate = searchBarrierGateFromStopLintId(stopLineId);
    if (linkBarrierGate) {
        // 记得删除polygon以及polygon点以及groud
        boundarys[linkBarrierGate.boundaryId]?.pointIds?.forEach((pId) => {
            action.push(new DeletePointCommand(pId));
        });
        action.push(new DeleteBoundaryCommand(linkBarrierGate.boundaryId));
        action.push(new DeleteGroudCommand(linkBarrierGate.groudId));
        action.push(new DeleteBarrierGateCommand(linkBarrierGate.id));
    }
    useManagerStore.getState().addCommand(action);
}
export function deleteStopLineLastDrawPoint(stopLine: StopLine) {
    if (!stopLine) {
        return [];
    }
    let actions: any = [];
    const boundaryPoints = searchPointIdsFromBoundaryId(stopLine.boundaryId);
    const boundaryId = stopLine.boundaryId;

    if (boundaryPoints.length === 1) {
        const deletePointId = boundaryPoints[0];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeleteBoundaryCommand(boundaryId),
            new DeleteStopLineCommand(stopLine.id),
            new DeletePointCommand(deletePointId),
            new SetCurrentDrawDataCommand(null, MapElementType.StopLine),
        ];
    }
    return actions;
}
