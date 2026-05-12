import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddPointCommand, DeletePointCommand } from 'src/command/PointCommand';
import { AddStopLineCommand, DeleteStopLineCommand } from 'src/command/StopLineCommand';
import { InterActiveType, MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { stopLineBoundaryColor } from 'src/constant/color';
import { StopLine, StopLineOrigin } from 'src/interface/stopLineInterFace';
import { searchStopLinesByOrigin } from 'src/utils/search/stopLineSearch';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { drawLine } from 'src/object/basicObject';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function getRemoveIrregularStopLineCommand(stopLineId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { stopLines, boundarys } = newState;
    const stopLine = stopLines[stopLineId];
    const pointIds = boundarys[stopLine.boundaryId].pointIds;

    const action = [];
    action.push(new DeleteBoundaryCommand(stopLine.boundaryId));
    pointIds.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteStopLineCommand(stopLine.id));
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}

export function addStopLineHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, points, boundarys, stopLines } = newState;

    PubSub.publishSync('removeMouseMoveElements');
    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.StopLinePoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const stopLineId = `${getElementMaxIndex(stopLines) + 1}`;
        const cm2 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.StopLineBoundary,
            BoundaryOriginType.StopLine,
            [],
            [],
        );
        const cm3 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm4 = new AddStopLineCommand(stopLineId, boundaryId, StopLineOrigin.StopLine);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4]);
    } else {
        // 绘制的是第二个点时，需要结束绘制
        const stopLine = stopLines[state.currentDrawData.currentDrawingElementId];
        if (!stopLine) {
            console.warn('addStopLineHandle时当前绘制的stopLine找不到了');
            return;
        }
        const cm2 = new AddPointToBoundaryCommand(pointId, stopLine.boundaryId, true, false);
        const cm3 = new SetCurrentDrawDataCommand(null, null);
        const cm4 = new SetOperationTypeCommand(null);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4]);
    }
}

export function getDrawStopLinePromptData(e: MouseEvent, dom: HTMLElement) {
    const rect = dom.getBoundingClientRect();
    const state = useManagerStore.getState().mapState;
    const { currentDrawData, stopLines, boundarys, operationType, trafficSignals, barrierGates } = state;
    const { currentDrawingElementId, drawElementType } = currentDrawData;
    const sigleStopLine = searchStopLinesByOrigin(StopLineOrigin.StopLine);
    const trafficSignalStopLine = searchStopLinesByOrigin(StopLineOrigin.TrafficLight);
    const signStopLine = searchStopLinesByOrigin(StopLineOrigin.Sign);
    const barrierGateStopLine = searchStopLinesByOrigin(StopLineOrigin.BarrierGate);
    let points = [];
    if (drawElementType === MapElementType.StopLine) {
        points = boundarys[stopLines[currentDrawingElementId]?.boundaryId]?.pointIds || [];
    } else if (drawElementType === MapElementType.TrafficSignal) {
        points = boundarys[stopLines[trafficSignals[currentDrawingElementId]?.stopLineId]?.boundaryId]?.pointIds || [];
    } else if (drawElementType === MapElementType.BarrierGate) {
        points = boundarys[stopLines[barrierGates[currentDrawingElementId]?.stopLineId]?.boundaryId]?.pointIds || [];
    }

    if (operationType === OperationType.Drawing) {
        if (
            (sigleStopLine.length === 0 && drawElementType === MapElementType.StopLine) ||
            (trafficSignalStopLine.length === 0 && drawElementType === MapElementType.TrafficSignal) ||
            (signStopLine.length === 0 && drawElementType === MapElementType.Sign) ||
            (barrierGateStopLine.length === 0 && drawElementType === MapElementType.BarrierGate)
        ) {
            return {
                text: '单击确定停止线的起点',
                left: e.clientX - rect.left + 10,
                top: e.clientY - rect.top + 10,
            };
        }

        if (
            (sigleStopLine.length === 1 && drawElementType === MapElementType.StopLine && points.length === 1) ||
            (trafficSignalStopLine.length === 1 &&
                drawElementType === MapElementType.TrafficSignal &&
                points.length === 1) ||
            (signStopLine.length === 1 && drawElementType === MapElementType.Sign && points.length === 1) ||
            (barrierGateStopLine.length === 1 && drawElementType === MapElementType.BarrierGate && points.length === 1)
        ) {
            return {
                text: '单击确定停止线的终点',
                left: e.clientX - rect.left + 10,
                top: e.clientY - rect.top + 10,
            };
        }
    }
    return {
        text: '',
        left: -10,
        top: -10,
    };
}

export function addStopLineMousemoveHandle(position: THREE.Vector3) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { stopLines, points, boundarys, trafficSignals, currentDrawData, signs, barrierGates } = newState;
    if (!currentDrawData.currentDrawingElementId) {
        return;
    }
    let stopLine: StopLine = null;
    // 如果当前绘制的地图元素非停止线，则需要根据当前绘制元素找到该绘制元素关联的停止线

    if (state.currentDrawData.drawElementType === MapElementType.TrafficSignal) {
        stopLine = stopLines[trafficSignals[currentDrawData.currentDrawingElementId]?.stopLineId];
    } else if (state.currentDrawData.drawElementType === MapElementType.Sign) {
        stopLine = stopLines[signs[currentDrawData.currentDrawingElementId]?.stopLineId];
    } else if (state.currentDrawData.drawElementType === MapElementType.BarrierGate) {
        stopLine = stopLines[barrierGates[currentDrawData.currentDrawingElementId]?.stopLineId];
    } else {
        stopLine = stopLines[state.currentDrawData.currentDrawingElementId];
    }
    if (!stopLine) {
        return;
    }
    const { boundaryId } = stopLine;
    const boundaryPointIds = boundarys[boundaryId]?.pointIds || [];
    if (boundaryPointIds.length === 0) {
        return;
    }
    const lastPointPosition = points[boundaryPointIds[0]]?.position;
    if (!lastPointPosition) {
        return;
    }
    const { line } = drawLine([lastPointPosition, position], stopLineBoundaryColor[InterActiveType.Default]) || {};
    PubSub.publishSync('addMouseMoveLine', line);
}
