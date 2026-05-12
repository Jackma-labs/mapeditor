import { useManagerStore } from 'src/store';
import { AddPointCommand } from 'src/command/PointCommand';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddStopLineCommand } from 'src/command/StopLineCommand';
import { StopLineOrigin } from 'src/interface/stopLineInterFace';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { AddBarrierGateCommand } from 'src/command/BarrierGateCommand';
import { getBarrierGateCenterByStopLinePositions, getBarrierGatePolygonPointPositions } from 'src/utils/geometryUtil';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { AddGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { getRotateAngle } from 'src/utils/vectorUtil';

export function addBarrierGateHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, points, boundarys, stopLines, barrierGates, grouds } = newState;

    PubSub.publishSync('removeMouseMoveElements');

    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.StopLinePoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        // 停止线的boundaryId
        const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        // 道闸polygon的id
        const polygonId = `${getElementMaxIndex(boundarys) + 2}`;
        const stopLineId = `${getElementMaxIndex(stopLines) + 1}`;
        const barrierGateId = `${getElementMaxIndex(barrierGates) + 1}`;
        const groudId = `${getElementMaxIndex(grouds) + 1}`;
        const cm2 = new SetCurrentDrawDataCommand(barrierGateId, MapElementType.BarrierGate);
        const cm3 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.StopLineBoundary,
            BoundaryOriginType.StopLine,
            [],
            [],
        );
        const cm4 = new AddBoundaryCommand(
            polygonId,
            ThreeElementType.BarrierGateBoundary,
            BoundaryOriginType.BarrierGate,
            [],
            [],
        );
        const cm5 = new AddGroudCommand(groudId, ThreeElementType.BarrierGateGroud);
        const cm6 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm7 = new AddStopLineCommand(stopLineId, boundaryId, StopLineOrigin.BarrierGate);
        const cm8 = new AddBarrierGateCommand(barrierGateId, stopLineId, polygonId, groudId);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6, cm7, cm8]);
    } else {
        // 绘制的是第二个点时，需要结束绘制
        const barrierGate = barrierGates[state.currentDrawData.currentDrawingElementId];
        const stopLine = stopLines[barrierGate?.stopLineId];
        if (!stopLine) {
            console.warn('addBarrierGateHandle时当前绘制的stopLine找不到了');
            return;
        }
        const stopLinePoints = searchPointsFromBoundaryId(stopLine.boundaryId);
        const barrierGateCenter = getBarrierGateCenterByStopLinePositions([stopLinePoints[0].position, position]);
        const rotateZ = getRotateAngle(stopLinePoints[0].position, position);
        const pologonPotions = getBarrierGatePolygonPointPositions(
            barrierGateCenter,
            barrierGate.width,
            barrierGate.length,
            rotateZ,
        );
        const action = [];
        action.push(new AddPointCommand(pointId, position, ThreeElementType.StopLinePoint));
        action.push(new AddPointToBoundaryCommand(pointId, stopLine.boundaryId, false, false));
        pologonPotions.forEach((item, index) => {
            action.push(new AddPointCommand(`${Number(pointId) + index + 1}`, item, ThreeElementType.BarrierGatePoint));
        });
        action.push(
            new AddBoundaryCommand(
                barrierGate.boundaryId,
                ThreeElementType.BarrierGateBoundary,
                BoundaryOriginType.BarrierGate,
                [
                    `${Number(pointId) + 1}`,
                    `${Number(pointId) + 2}`,
                    `${Number(pointId) + 3}`,
                    `${Number(pointId) + 4}`,
                    `${Number(pointId) + 1}`,
                ],
                [],
            ),
        );
        action.push(new UpdateGroudCommand(barrierGate.groudId));
        action.push(new SetCurrentDrawDataCommand(null, null));
        action.push(new SetOperationTypeCommand(null));
        useManagerStore.getState().addCommand(action);
    }
}
