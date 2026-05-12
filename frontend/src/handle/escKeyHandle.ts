import { AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { FinishLaneCommand } from 'src/command/LaneCommand';
import { MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { AddArrowCommand } from 'src/command/ArrowCommand';
import { AddGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { Junction } from 'src/interface/junctionInterFace';
import { Area } from 'src/interface/areaInterFace';
import { getRemoveIrregularLaneCommand } from './lane/addLaneHandle';
import { deletePolygonLastDrawPoint, getRemoveIrregularPolygonCommand } from './polygon/deletePolygon';
import { getRemoveIrregularTrafficLightCommand } from './trafficLight/addTrafficLightHandle';
import { getRemoveIrregularStraightLineCommand } from './boundary/addBoundaryHandle';
import { deleteLaneLastDrawPoint } from './lane/deleteLane';
import { deleteStraightLineLastDrawPoint } from './boundary/deleteBoundaryHandle';
import { message as messageFunc } from '../components/Message/index';
import { getRemoveIrregularCrosswalkCommand } from './corsswalk/addCrosswalkClickHandle';
import { getRemoveIrregularSpeedbumpCommand } from './speedbump/addSpeedBumpHandle';
import { getRemoveIrregularStopLineCommand } from './stopLine/addStopLineHandle';
import { getRemoveIrregularParkingSpaceCommand } from './parkingSpace/addParkingSpace';
import { getRemoveIrregularSignCommand } from './sign/addSignHandle';
import { getRemoveIrregularBarrierGateCommand } from './barrierGate/deleteBarrierGateHandle';

export function escKeyExitDrawHandle(dbclick: boolean = false) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    let isIrregularDraw = false;

    const {
        currentDrawData,
        lanes,
        boundarys,
        junctions,
        crosswalks,
        speedBumps,
        stopLines,
        parkingSpaces,
        trafficSignals,
        prossibleDrivingDirections,
        signs,
        areas,
        barrierGates,
    } = newState;
    const { currentDrawingElementId, drawElementType } = currentDrawData;
    if (!currentDrawingElementId) {
        newState.currentDrawData = {
            ...newState.currentDrawData,
            drawElementType: null,
            currentDrawingElementId: null,
        };
        newState.operationType = null;
        useManagerStore.getState().setMapState(newState);
        return;
    }
    if (drawElementType === MapElementType.Lane) {
        PubSub.publishSync('removeMouseMoveElements');
        const lane = lanes[currentDrawingElementId];
        if (!lane) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的lane找不到`);
            return;
        }
        const leftBoundaryPointIds = searchPointIdsFromBoundaryId(lane.leftBoundaryId);
        if ((dbclick && leftBoundaryPointIds.length <= 2) || (!dbclick && leftBoundaryPointIds.length <= 1)) {
            isIrregularDraw = true;
            useManagerStore.getState().addCommand(getRemoveIrregularLaneCommand(lane.id));
        } else {
            const actions = dbclick ? deleteLaneLastDrawPoint(lane) : [];
            const newArrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
            actions.push(new AddArrowCommand(newArrowId, ThreeElementType.LaneRelativeDirection));
            actions.push(new FinishLaneCommand(lane.id));
            actions.push(new UpdateGroudCommand(lane.groudId));
            actions.push(new SetOperationTypeCommand(null));
            actions.push(new SetCurrentDrawDataCommand(null, null));
            useManagerStore.getState().addCommand(actions);
        }
    } else if (drawElementType === MapElementType.Junction || drawElementType === MapElementType.Area) {
        PubSub.publishSync('removeMouseMoveElements');
        let mapElement: Junction | Area = null;
        if (drawElementType === MapElementType.Junction) {
            mapElement = junctions[currentDrawingElementId];
        } else if (drawElementType === MapElementType.Area) {
            mapElement = areas[currentDrawingElementId];
        }

        if (!mapElement) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的元素找不到`);
            return;
        }
        const { boundaryId } = mapElement;
        if (!boundarys[boundaryId]) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的元素的boundary找不到`);
            return;
        }
        const pointIds = [...boundarys[boundaryId].pointIds];
        // 如果少于3个点，则需要清除不成型的junction
        if ((dbclick && pointIds.length <= 3) || (!dbclick && pointIds.length <= 2)) {
            isIrregularDraw = true;
            useManagerStore.getState().addCommand(getRemoveIrregularPolygonCommand());
        } else {
            const groudType =
                drawElementType === MapElementType.Junction
                    ? ThreeElementType.JunctionGroud
                    : ThreeElementType.AreaGroud;
            const actions = dbclick ? deletePolygonLastDrawPoint(mapElement) : [];
            actions.push(new AddPointToBoundaryCommand(boundarys[boundaryId].pointIds[0], boundaryId, true, false));
            actions.push(new AddGroudCommand(mapElement.groudId, groudType));
            actions.push(new SetCurrentDrawDataCommand(null, null));
            actions.push(new SetOperationTypeCommand(null));
            useManagerStore.getState().addCommand(actions);
        }
    } else if (drawElementType === MapElementType.Crosswalk) {
        PubSub.publishSync('removeMouseMoveElements');
        const crosswalk = crosswalks[currentDrawingElementId];
        if (!crosswalk) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的crosswalk找不到`);
            return;
        }
        useManagerStore.getState().addCommand(getRemoveIrregularCrosswalkCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.SpeedBump) {
        PubSub.publishSync('removeMouseMoveElements');
        const speedBump = speedBumps[currentDrawingElementId];
        if (!speedBump) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的speedBump找不到`);
            return;
        }
        useManagerStore.getState().addCommand(getRemoveIrregularSpeedbumpCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.StopLine) {
        PubSub.publishSync('removeMouseMoveElements');
        const stopLine = stopLines[currentDrawingElementId];
        if (!stopLine) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的stopLine找不到`);
            return;
        }
        useManagerStore.getState().addCommand(getRemoveIrregularStopLineCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.ParkingSpace) {
        PubSub.publishSync('removeMouseMoveElements');
        const parkingSpace = parkingSpaces[currentDrawingElementId];
        if (!parkingSpace) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的parkingSpace找不到`);
            return;
        }
        useManagerStore.getState().addCommand(getRemoveIrregularParkingSpaceCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.TrafficSignal) {
        PubSub.publishSync('removeMouseMoveElements');
        const trafficLight = trafficSignals[currentDrawingElementId];
        if (!trafficLight) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的trafficLight找不到`);
            return;
        }

        useManagerStore.getState().addCommand(getRemoveIrregularTrafficLightCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.BarrierGate) {
        PubSub.publishSync('removeMouseMoveElements');
        const barrierGate = barrierGates[currentDrawingElementId];
        if (!barrierGate) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的barrierGate找不到`);
            return;
        }

        useManagerStore.getState().addCommand(getRemoveIrregularBarrierGateCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.Sign) {
        PubSub.publishSync('removeMouseMoveElements');
        const sign = signs[currentDrawingElementId];
        if (!sign) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的sign找不到`);
            return;
        }

        useManagerStore.getState().addCommand(getRemoveIrregularSignCommand(currentDrawingElementId));
        isIrregularDraw = true;
    } else if (drawElementType === MapElementType.StraightLine || drawElementType === MapElementType.RoadBoundary) {
        PubSub.publishSync('removeMouseMoveElements');
        const straightLine = boundarys[currentDrawingElementId];
        const pointIds = straightLine?.pointIds || [];
        if (!straightLine) {
            console.warn(`escKeyExitDrawHandle时当前绘制id为${currentDrawingElementId}的boundary找不到`);
            return;
        }

        if ((dbclick && pointIds.length <= 2) || (!dbclick && pointIds.length <= 1)) {
            useManagerStore.getState().addCommand(getRemoveIrregularStraightLineCommand(currentDrawingElementId));
            isIrregularDraw = true;
        } else {
            const actions = dbclick ? deleteStraightLineLastDrawPoint(straightLine) : [];
            actions.push(new SetOperationTypeCommand(null));
            actions.push(new SetCurrentDrawDataCommand(null, null));
            useManagerStore.getState().addCommand(actions);
        }
    }
    if (isIrregularDraw) {
        messageFunc(
            {
                type: 'warning',
                content: '当前绘制的地图元素不合法，已删除相关绘制元素',
            },
            100,
        );
    }
}
export function escKeyHandle(dbclick: boolean = false) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };

    const { operationType, ranging } = newState;

    if (operationType === OperationType.Drawing) {
        escKeyExitDrawHandle(dbclick);
    } else if (operationType === OperationType.Rotating) {
        PubSub.publish('disableRotate');
    } else if (
        operationType === OperationType.SplitLaneInVertical ||
        operationType === OperationType.InsertPointToBoundary ||
        operationType === OperationType.CopyLane ||
        operationType === OperationType.CopyParkingSpace
    ) {
        useManagerStore.getState().addCommand([new SetOperationTypeCommand(null)]);
    }
    if (ranging) {
        PubSub.publishSync('exitRanging');
        PubSub.publish('render');
    }
}
