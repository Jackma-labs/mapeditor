import { DeleteBarrierGateCommand } from 'src/command/BarrierGateCommand';
import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { DeleteStopLineCommand } from 'src/command/StopLineCommand';
import { DeleteTrafficLightCommand } from 'src/command/TrafficLightCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { TrafficSignal } from 'src/interface/trafficSignal';
import { useManagerStore } from 'src/store';
import { searchBarrierGateFromGroudId } from 'src/utils/search/barrierGateSearch';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchStopLineByStopLineId } from 'src/utils/search/stopLineSearch';

export function getRemoveIrregularBarrierGateCommand(barrierGateId: string) {
    const state = useManagerStore.getState().mapState;
    const { stopLines, boundarys, barrierGates } = state;
    const barrierGate = barrierGates[barrierGateId];
    const stopLine = stopLines[barrierGate?.stopLineId];
    if (!stopLine) {
        return [];
    }
    const action = [];
    boundarys[stopLine.boundaryId]?.pointIds?.forEach((pId) => action.push(new DeletePointCommand(pId)));
    action.push(new DeleteBoundaryCommand(stopLine.boundaryId));

    boundarys[barrierGate.boundaryId]?.pointIds?.forEach((pId) => action.push(new DeletePointCommand(pId)));
    action.push(new DeleteBoundaryCommand(barrierGate.boundaryId));
    action.push(new DeleteGroudCommand(barrierGate.groudId));
    action.push(new DeleteStopLineCommand(stopLine.id));
    action.push(new DeleteBarrierGateCommand(barrierGateId));
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}
export function deleteBarrierGateByGroudId(groudId: string) {
    const state = useManagerStore.getState().mapState;
    const { stopLines, boundarys } = state;
    const barrierGate = searchBarrierGateFromGroudId(groudId);
    const stopLine = stopLines[barrierGate?.stopLineId];
    if (!stopLine) {
        return;
    }
    const action = [];
    const stoplinePointIds = boundarys[stopLine.boundaryId]?.pointIds;
    stoplinePointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteBoundaryCommand(stopLine.boundaryId));

    const polygonPointIds = boundarys[barrierGate.boundaryId]?.pointIds;
    polygonPointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteBoundaryCommand(barrierGate.boundaryId));

    action.push(new DeleteGroudCommand(groudId));

    action.push(new DeleteStopLineCommand(stopLine.id));
    action.push(new DeleteBarrierGateCommand(barrierGate.id));
    useManagerStore.getState().addCommand(action);
}

export function deleteTrafficLightLastDrawPoint(trafficLight: TrafficSignal) {
    if (!trafficLight) {
        return [];
    }
    let actions: any = [];
    const stopLine = searchStopLineByStopLineId(trafficLight?.stopLineId);
    const boundaryPointIds = searchPointIdsFromBoundaryId(stopLine.boundaryId);
    if (boundaryPointIds.length === 1) {
        const deletePointId = boundaryPointIds[0];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, stopLine.boundaryId),
            new DeleteBoundaryCommand(stopLine.boundaryId),
            new DeleteStopLineCommand(trafficLight.stopLineId),
            new DeletePointCommand(deletePointId),
            new DeleteTrafficLightCommand(trafficLight.id),
            new SetCurrentDrawDataCommand(null, MapElementType.TrafficSignal),
        ];
    }
    return actions;
}
