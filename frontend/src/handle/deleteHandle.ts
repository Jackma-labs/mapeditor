import { MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import PubSub from 'pubsub-js';
import { useManagerStore } from 'src/store';
import { searchJunctionFromGroudId } from 'src/utils/search/junctionSearch';
import { searchLaneFromGroudId } from 'src/utils/search/laneSearch';
import { searchParkingSpaceByGroudId } from 'src/utils/search/parkingSpaceSearch';
import { searchCrosswalkByGroudId } from 'src/utils/search/crosswalkSearch';
import { searchSpeedBumpByBoundaryId, searchSpeedBumpFromGroudId } from 'src/utils/search/speedBumpSearch';
import { searchStopLineFromBoundaryId } from 'src/utils/search/stopLineSearch';
import { searchAreaFromGroudId } from 'src/utils/search/areaSearch';
import { deleteParkingSpace, deleteParkingSpaceLastDrawPoint } from './parkingSpace/deleteParingSpace';
import { deleteCrosswalk, deleteCrosswalkLastDrawPoint, deleteCrosswalkPoint } from './corsswalk/deleteCrosswalk';
import { deleteJunction } from './junction/deleteJunction';
import { deleteStopLine, deleteStopLineLastDrawPoint } from './stopLine/deleteStopLine';
import { deleteLane, deleteLaneLastDrawPoint, deleteLanePoint } from './lane/deleteLane';
import { deleteSpeedBump, deleteSpeedBumpLastDrawPoint } from './speedbump/deleteSpeedBump';
import { deleteTrafficLight, deleteTrafficLightLastDrawPoint } from './trafficLight/deleteTrafficLight';
import { deleteStraightLineLastDrawPoint, deteleBoundaryHandle } from './boundary/deleteBoundaryHandle';
import { deleteSign, deleteSignLastDrawPoint } from './sign/deleteSignHandle';
import { deletePolygonLastDrawPoint, deletePolygonPoint } from './polygon/deletePolygon';
import { deleteArea } from './area/deleteAreaHandle';
import { deleteBarrierGateByGroudId } from './barrierGate/deleteBarrierGateHandle';
/**
 * 删除最后一次绘制的点
 */
export function deleteLastDrawPointInDrawing() {
    const {
        currentDrawData,
        lanes,
        junctions,
        crosswalks,
        speedBumps,
        stopLines,
        trafficSignals,
        boundarys,
        parkingSpaces,
        signs,
        areas,
    } = useManagerStore.getState().mapState;
    const type = currentDrawData.drawElementType;
    let actions = [];
    if (type === MapElementType.Lane) {
        actions = deleteLaneLastDrawPoint(lanes[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.Junction) {
        actions = deletePolygonLastDrawPoint(junctions[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.Area) {
        actions = deletePolygonLastDrawPoint(areas[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.Crosswalk) {
        actions = deleteCrosswalkLastDrawPoint(crosswalks[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.SpeedBump) {
        actions = deleteSpeedBumpLastDrawPoint(speedBumps[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.StopLine) {
        actions = deleteStopLineLastDrawPoint(stopLines[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.TrafficSignal) {
        actions = deleteTrafficLightLastDrawPoint(trafficSignals[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.Sign) {
        actions = deleteSignLastDrawPoint(signs[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.StraightLine) {
        actions = deleteStraightLineLastDrawPoint(boundarys[currentDrawData.currentDrawingElementId]);
    } else if (type === MapElementType.ParkingSpace) {
        actions = deleteParkingSpaceLastDrawPoint(parkingSpaces[currentDrawData.currentDrawingElementId]);
    }
    useManagerStore.getState().addCommand(actions);
}
export function deleteHandle() {
    PubSub.publishSync('resetDragGroup');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentPickElement, operationType, currentDrawData } = newState;
    if (operationType === OperationType.Rotating || operationType === OperationType.SplitLaneInVertical) {
        return;
    }
    if (operationType === OperationType.Drawing && currentDrawData.currentDrawingElementId) {
        PubSub.publishSync('removeMouseMoveElements');
        deleteLastDrawPointInDrawing();
        PubSub.publish('render');
        return;
    }

    currentPickElement?.forEach((item) => {
        const { type, id } = item;
        // 删除的是车道线上的点
        if (type === ThreeElementType.LanePoint || type === ThreeElementType.RoadBoundaryPoint) {
            deleteLanePoint(id);
            return;
        }
        if (type === ThreeElementType.LaneBoundary || type === ThreeElementType.RoadBoundary) {
            deteleBoundaryHandle(id);
            return;
        }
        if (type === ThreeElementType.LaneGroud || type === ThreeElementType.LaneCurveGroud) {
            const linkLane = searchLaneFromGroudId(id);
            if (!linkLane) {
                return;
            }
            deleteLane(linkLane.id);
            return;
        }
        if (type === ThreeElementType.JunctionPoint) {
            deletePolygonPoint(id, MapElementType.Junction);
            return;
        }
        if (type === ThreeElementType.AreaPoint) {
            deletePolygonPoint(id, MapElementType.Area);
            return;
        }
        if (type === ThreeElementType.BarrierGatePoint) {
            return;
        }
        if (
            type === ThreeElementType.JunctionBoundary ||
            type === ThreeElementType.AreaBoundary ||
            type === ThreeElementType.BarrierGateBoundary
        ) {
            return;
        }
        if (type === ThreeElementType.JunctionGroud) {
            const linkJunction = searchJunctionFromGroudId(id);
            if (!linkJunction) {
                return;
            }
            deleteJunction(linkJunction.id);
            return;
        }
        if (type === ThreeElementType.AreaGroud) {
            const linkArea = searchAreaFromGroudId(id);
            if (!linkArea) {
                return;
            }
            deleteArea(linkArea.id);
            return;
        }
        if (type === ThreeElementType.CrosswalkPoint) {
            deleteCrosswalkPoint(id);
            return;
        }
        if (type === ThreeElementType.CrosswalkGroud) {
            const linkCrosswalk = searchCrosswalkByGroudId(id);
            if (!linkCrosswalk) {
                return;
            }
            deleteCrosswalk(linkCrosswalk.id);
            return;
        }
        if (type === ThreeElementType.SpeedBumpPoint) {
            return;
        }
        if (type === ThreeElementType.StopLinePoint) {
            return;
        }
        if (type === ThreeElementType.SpeedBumpBoundary) {
            const speedBump = searchSpeedBumpByBoundaryId(id);
            if (!speedBump) {
                return;
            }
            deleteSpeedBump(speedBump.id);
        }
        if (type === ThreeElementType.SpeedBumpGroud) {
            const speedBump = searchSpeedBumpFromGroudId(id);
            if (!speedBump) {
                return;
            }
            deleteSpeedBump(speedBump.id);
        }
        if (type === ThreeElementType.StopLineBoundary) {
            const stopLine = searchStopLineFromBoundaryId(id);
            if (!stopLine) {
                return;
            }
            deleteStopLine(stopLine.id);
        }
        if (type === ThreeElementType.TrafficLight) {
            deleteTrafficLight(id);
        }
        if (type === ThreeElementType.BarrierGateGroud) {
            deleteBarrierGateByGroudId(id);
        }
        if (type === ThreeElementType.SignIcon) {
            deleteSign(id);
        }
        if (type === ThreeElementType.ParkingSpaceGroud) {
            const parkingSpace = searchParkingSpaceByGroudId(id);
            if (!parkingSpace) {
                return;
            }
            deleteParkingSpace(parkingSpace.id);
        }
    });
}
