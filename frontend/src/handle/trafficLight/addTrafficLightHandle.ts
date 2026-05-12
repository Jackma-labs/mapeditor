import { useManagerStore } from 'src/store';
import { AddPointCommand, DeletePointCommand } from 'src/command/PointCommand';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddStopLineCommand, DeleteStopLineCommand } from 'src/command/StopLineCommand';
import {
    AddTrafficLightCommand,
    DeleteTrafficLightCommand,
    FinishTrafficLightCommand,
} from 'src/command/TrafficLightCommand';
import { StopLineOrigin } from 'src/interface/stopLineInterFace';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function getRemoveIrregularTrafficLightCommand(trafficLightId: string) {
    const state = useManagerStore.getState().mapState;
    const { stopLines, boundarys, trafficSignals } = state;
    const trafficSignal = trafficSignals[trafficLightId];
    const stopLine = stopLines[trafficSignal?.stopLineId];
    if (!stopLine) {
        return [];
    }
    const pointIds = boundarys[stopLine.boundaryId].pointIds;

    const action = [];
    action.push(new DeleteBoundaryCommand(stopLine.boundaryId));
    pointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteStopLineCommand(stopLine.id));
    action.push(new DeleteTrafficLightCommand(trafficLightId));
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}

export function addTrafficLightHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, points, boundarys, stopLines, trafficSignals } = newState;
    const { height, subSignals, type } = currentDrawData.trafficLightAttr;

    PubSub.publishSync('removeMouseMoveElements');

    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.StopLinePoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const stopLineId = `${getElementMaxIndex(stopLines) + 1}`;
        const trafficLightId = `${getElementMaxIndex(trafficSignals) + 1}`;
        const cm2 = new SetCurrentDrawDataCommand(trafficLightId, MapElementType.TrafficSignal);
        const cm3 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.StopLineBoundary,
            BoundaryOriginType.StopLine,
            [],
            [],
        );
        const cm4 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm5 = new AddStopLineCommand(stopLineId, boundaryId, StopLineOrigin.TrafficLight);
        const cm6 = new AddTrafficLightCommand(trafficLightId, stopLineId, height, type, [...subSignals]);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6]);
    } else {
        // 绘制的是第二个点时，需要结束绘制
        const trafficSignal = trafficSignals[state.currentDrawData.currentDrawingElementId];
        const stopLine = stopLines[trafficSignal?.stopLineId];
        if (!stopLine) {
            console.warn('addTrafficLightHandle时当前绘制的stopLine找不到了');
            return;
        }
        const cm2 = new AddPointToBoundaryCommand(pointId, stopLine.boundaryId, true, false);
        const cm4 = new FinishTrafficLightCommand(trafficSignal.id);
        const cm5 = new SetCurrentDrawDataCommand(null, null);
        const cm6 = new SetOperationTypeCommand(null);
        useManagerStore.getState().addCommand([cm1, cm2, cm4, cm5, cm6]);
    }
}
