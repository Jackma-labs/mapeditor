import { Arrow, Boundary, Groud } from 'src/interface/basicElementInterFace';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { Lane } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { unionBy } from 'lodash';
import { searchLaneFromGroudId, searchLanesFromBoundaryId } from './laneSearch';
import { searchBoundaryByBoundaryId, searchBoundarysFromPointId } from './boundarySearch';
import { searchGroudFromBoundaryId, searchGroudFromGroudId } from './groudSearch';
import { searchArrowFromGroudId } from './arrowSearch';
import { getLaneRelations } from '../geometryUtil';

export const findElementByIdAndType = (info: { id: string; type: ThreeElementType }) => {
    const { points, boundarys, grouds, trafficSignals, signs } = useManagerStore.getState().mapState;
    const { id, type } = info;
    switch (type) {
        case ThreeElementType.LanePoint:
        case ThreeElementType.RoadBoundaryPoint:
        case ThreeElementType.JunctionPoint:
        case ThreeElementType.AreaPoint:
        case ThreeElementType.BarrierGatePoint:
        case ThreeElementType.CrosswalkPoint:
        case ThreeElementType.SpeedBumpPoint:
        case ThreeElementType.StopLinePoint:
        case ThreeElementType.ParkingSpacePoint:
            return points[id];

        case ThreeElementType.LaneBoundary:
        case ThreeElementType.RoadBoundary:
        case ThreeElementType.LaneCurveBoundary:
        case ThreeElementType.JunctionBoundary:
        case ThreeElementType.AreaBoundary:
        case ThreeElementType.BarrierGateBoundary:
        case ThreeElementType.CrosswalkBoundary:
        case ThreeElementType.SpeedBumpBoundary:
        case ThreeElementType.StopLineBoundary:
            return boundarys[id];

        case ThreeElementType.LaneGroud:
        case ThreeElementType.JunctionGroud:
        case ThreeElementType.AreaGroud:
        case ThreeElementType.BarrierGateGroud:
        case ThreeElementType.CrosswalkGroud:
        case ThreeElementType.SpeedBumpGroud:
        case ThreeElementType.ParkingSpaceGroud:
        case ThreeElementType.LaneCurveGroud:
            return grouds[id];

        case ThreeElementType.TrafficLight:
            return trafficSignals[id];

        case ThreeElementType.SignIcon:
            return signs[id];

        default:
            return null;
    }
};
// 根据当前选中的元素，去获取选中lane关联的lane groud boundary
export function searchLanesRelationObjectsByCurrentPick() {
    const result: { lanes: Lane[]; grouds: Groud[]; boundarys: Boundary[] } = {
        lanes: [],
        grouds: [],
        boundarys: [],
    };
    const { currentPickElement } = useManagerStore.getState().mapState;
    if (currentPickElement.length === 0) {
        return result;
    }
    const { type } = currentPickElement[0];
    if (type !== ThreeElementType.LaneGroud && type !== ThreeElementType.LaneCurveGroud) {
        return result;
    }

    currentPickElement.forEach(({ id: groudId }) => {
        const lane = searchLaneFromGroudId(groudId);
        if (!lane) {
            return;
        }
        const { leftBoundaryId, rightBoundaryId } = lane;
        result.lanes = [
            ...result.lanes,
            ...searchLanesFromBoundaryId(leftBoundaryId),
            ...searchLanesFromBoundaryId(rightBoundaryId),
        ];
    });
    result.lanes = unionBy(result.lanes, 'id');
    result.lanes.forEach((lane) => {
        const { leftBoundaryId, rightBoundaryId } = lane;
        if (searchBoundaryByBoundaryId(leftBoundaryId)) {
            result.boundarys.push(searchBoundaryByBoundaryId(leftBoundaryId));
        }
        if (searchBoundaryByBoundaryId(rightBoundaryId)) {
            result.boundarys.push(searchBoundaryByBoundaryId(rightBoundaryId));
        }
        if (searchGroudFromGroudId(lane.groudId)) {
            result.grouds.push(searchGroudFromGroudId(lane.groudId));
        }
    });
    result.boundarys = unionBy(result.boundarys, 'id');
    result.grouds = unionBy(result.grouds, 'id');
    return result;
}

/**
 * 判断当前选中元素，是不是都有相邻的车道
 */
export function isCurrentPickElementHaveAdjacentLane() {
    let result = true;
    const { currentPickElement } = useManagerStore.getState().mapState;
    if (currentPickElement.length < 1) {
        return false;
    }

    const { type } = currentPickElement[0];
    if (type !== ThreeElementType.LaneGroud && type !== ThreeElementType.LaneCurveGroud) {
        return false;
    }
    if (currentPickElement.length === 1) {
        return true;
    }
    for (let i = 0; i < currentPickElement.length; i += 1) {
        for (let j = 0; j < currentPickElement.length; j += 1) {
            if (i === j) {
                return true;
            }
            const { id: id1 } = currentPickElement[i];
            const lane1 = searchLaneFromGroudId(id1);
            const { id: id2 } = currentPickElement[j];
            const lane2 = searchLaneFromGroudId(id2);
            if (!lane1 || !lane2) {
                result = false;
                break;
            }
            const [, , leftN1, rightN1] = getLaneRelations(lane1.id);
            // 主要判断当前选中项中有一个lane和当前lane有关系，就可以
            if (leftN1.includes(lane2.id) || rightN1.includes(lane2.id)) {
                return true;
            }
            if (j === currentPickElement.length - 1 && !leftN1.includes(lane2.id) && !rightN1.includes(lane2.id)) {
                result = false;
                break;
            }
        }
    }
    return result;
}
/**
 * 根据id获取相关联的boundarys和grouds
 */
export function searchPointsRelationObjects(pointIds: string[]) {
    const result: { boundarys: Boundary[]; grouds: Groud[]; arrows: Arrow[] } = {
        boundarys: [],
        grouds: [],
        arrows: [],
    };
    pointIds.forEach((id) => {
        const boundarys = searchBoundarysFromPointId(id);
        result.boundarys = [...result.boundarys, ...boundarys];
    });
    result.boundarys = unionBy(result.boundarys, 'id');

    result.boundarys.forEach(({ id }) => {
        const grouds = searchGroudFromBoundaryId(id);
        result.grouds = [...result.grouds, ...grouds];
    });
    result.grouds = unionBy(result.grouds, 'id');

    result.grouds.forEach(({ id }) => {
        const arrow = searchArrowFromGroudId(id);
        if (arrow) {
            result.arrows = [...result.arrows, arrow];
        }
    });
    result.arrows = unionBy(result.arrows, 'id');

    return result;
}
