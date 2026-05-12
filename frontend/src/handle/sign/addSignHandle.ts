import { useManagerStore } from 'src/store';
import { AddPointCommand, DeletePointCommand } from 'src/command/PointCommand';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddStopLineCommand, DeleteStopLineCommand } from 'src/command/StopLineCommand';
import { StopLineOrigin } from 'src/interface/stopLineInterFace';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { AddSignCommand, DeleteSignCommand, FinishSignCommand } from 'src/command/SignCommand';

export function getRemoveIrregularSignCommand(signId: string) {
    const state = useManagerStore.getState().mapState;
    const { stopLines, boundarys, signs } = state;
    const sign = signs[signId];
    const stopLine = stopLines[sign?.stopLineId];
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
    action.push(new DeleteSignCommand(signId));
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}

export function addSignHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, points, boundarys, stopLines, signs } = newState;
    const type = currentDrawData.signType;

    PubSub.publishSync('removeMouseMoveElements');

    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.StopLinePoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const stopLineId = `${getElementMaxIndex(stopLines) + 1}`;
        const signId = `${getElementMaxIndex(signs) + 1}`;
        const cm2 = new SetCurrentDrawDataCommand(signId, MapElementType.Sign);
        const cm3 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.StopLineBoundary,
            BoundaryOriginType.StopLine,
            [],
            [],
        );
        const cm4 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm5 = new AddStopLineCommand(stopLineId, boundaryId, StopLineOrigin.Sign);
        const cm6 = new AddSignCommand(signId, stopLineId, type);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6]);
    } else {
        // 绘制的是第二个点时，需要结束绘制
        const sign = signs[state.currentDrawData.currentDrawingElementId];
        const stopLine = stopLines[sign?.stopLineId];
        if (!stopLine) {
            console.warn('addSignHandle时当前绘制的stopLine找不到了');
            return;
        }
        const cm2 = new AddPointToBoundaryCommand(pointId, stopLine.boundaryId, true, false);
        const cm4 = new FinishSignCommand(sign.id);
        const cm5 = new SetCurrentDrawDataCommand(null, null);
        const cm6 = new SetOperationTypeCommand(null);
        useManagerStore.getState().addCommand([cm1, cm2, cm4, cm5, cm6]);
    }
}
