import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { DeleteSignCommand } from 'src/command/SignCommand';
import { DeleteStopLineCommand } from 'src/command/StopLineCommand';
import { Sign } from 'src/interface/SignInterFace';
import { MapElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchStopLineByStopLineId } from 'src/utils/search/stopLineSearch';

export function deleteSign(signId: string) {
    const state = useManagerStore.getState().mapState;
    const { signs, stopLines, boundarys } = state;
    const sign = signs[signId];
    const stopLine = stopLines[sign?.stopLineId];
    if (!stopLine) {
        return;
    }
    const action = [];
    action.push(new DeleteBoundaryCommand(stopLine.boundaryId));

    const pointIds = boundarys[stopLine.boundaryId]?.pointIds;
    pointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteStopLineCommand(stopLine.id));
    action.push(new DeleteSignCommand(signId));
    useManagerStore.getState().addCommand(action);
}

export function deleteSignLastDrawPoint(sign: Sign) {
    if (!sign) {
        return [];
    }
    let actions: any = [];
    const stopLine = searchStopLineByStopLineId(sign?.stopLineId);
    const boundaryPointIds = searchPointIdsFromBoundaryId(stopLine.boundaryId);
    if (boundaryPointIds.length === 1) {
        const deletePointId = boundaryPointIds[0];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, stopLine.boundaryId),
            new DeleteBoundaryCommand(stopLine.boundaryId),
            new DeleteStopLineCommand(sign.stopLineId),
            new DeletePointCommand(deletePointId),
            new DeleteSignCommand(sign.id),
            new SetCurrentDrawDataCommand(null, MapElementType.Sign),
        ];
    }
    return actions;
}
