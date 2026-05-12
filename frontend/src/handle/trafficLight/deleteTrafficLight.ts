import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { DeleteStopLineCommand } from 'src/command/StopLineCommand';
import { DeleteTrafficLightCommand } from 'src/command/TrafficLightCommand';
import { MapElementType } from 'src/interface/commonInterFace';
import { TrafficSignal } from 'src/interface/trafficSignal';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchStopLineByStopLineId } from 'src/utils/search/stopLineSearch';

export function deleteTrafficLight(trafficLightId: string) {
    const state = useManagerStore.getState().mapState;
    const { trafficSignals, stopLines, boundarys } = state;
    const trafficSignal = trafficSignals[trafficLightId];
    const stopLine = stopLines[trafficSignal?.stopLineId];
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
    action.push(new DeleteTrafficLightCommand(trafficLightId));
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
