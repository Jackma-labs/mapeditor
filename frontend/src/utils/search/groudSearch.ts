import { Groud } from 'src/interface/basicElementInterFace';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import * as THREE from 'three';
import { searchLaneFromGroudId } from './laneSearch';
import { searchPointsFromBoundaryId } from './pointSearch';
import { searchJunctionFromGroudId } from './junctionSearch';
import { searchCrosswalkByGroudId } from './crosswalkSearch';
import { searchSpeedBumpFromGroudId } from './speedBumpSearch';
import { searchParkingSpaceByGroudId } from './parkingSpaceSearch';
import { searchBoundaryByBoundaryId, searchCurvePointsAndControlsFromCurveId } from './boundarySearch';
import { getMeshWorldCoordinate, getRectanglePoints, vector3TransTpVector2 } from '../vectorUtil';
import { contrlPointSearch, objectSearch } from './objectSearch';
import { searchAreaFromGroudId } from './areaSearch';
import { searchBarrierGateFromGroudId } from './barrierGateSearch';

export const searchGroudFromGroudId = (groudId: string) => {
    const state = useManagerStore.getState().mapState;
    const { grouds } = state;
    if (!grouds[groudId]) {
        console.warn(`searchGroudFromGroudId时没有找到id为${groudId}的groud`);
        return null;
    }
    return grouds[groudId];
};
export const searchGroudFromBoundaryId = (boundaryId: string) => {
    const state = useManagerStore.getState().mapState;
    const { lanes, junctions, grouds, crosswalks, boundarys, speedBumps, parkingSpaces, areas, barrierGates } = state;
    const boundary = boundarys[boundaryId];
    if (!boundary) {
        console.warn(`searchGroudFromBoundaryId时没有找到id为${boundaryId}的boundary`);
        return [];
    }
    const { type } = boundary;
    const result: Groud[] = [];
    // 如果是lane的boundary，则去lanes中查找
    if (type === ThreeElementType.LaneBoundary || type === ThreeElementType.LaneCurveBoundary) {
        Object.keys(lanes).forEach((laneId: string) => {
            const lane = lanes[laneId];
            const { leftBoundaryId, rightBoundaryId, groudId } = lane;
            if (leftBoundaryId === boundaryId || rightBoundaryId === boundaryId) {
                result.push(grouds[groudId]);
            }
        });
    } else if (type === ThreeElementType.JunctionBoundary) {
        Object.keys(junctions).forEach((junctionId: string) => {
            const junction = junctions[junctionId];
            const { boundaryId: junctionBoundaryId, groudId } = junction;
            if (junctionBoundaryId === boundaryId && grouds[groudId]) {
                result.push(grouds[groudId]);
            }
        });
    } else if (type === ThreeElementType.AreaBoundary) {
        Object.keys(areas).forEach((areaId: string) => {
            const ares = areas[areaId];
            const { boundaryId: areaBoundaryId, groudId } = ares;
            if (areaBoundaryId === boundaryId && grouds[groudId]) {
                result.push(grouds[groudId]);
            }
        });
    } else if (type === ThreeElementType.BarrierGateBoundary) {
        Object.keys(barrierGates).forEach((barrierGateId: string) => {
            const barrierGate = barrierGates[barrierGateId];
            const { boundaryId: barrierGateBoundaryId, groudId } = barrierGate;
            if (barrierGateBoundaryId === boundaryId && grouds[groudId]) {
                result.push(grouds[groudId]);
            }
        });
    } else if (type === ThreeElementType.CrosswalkBoundary) {
        Object.keys(crosswalks).forEach((id: string) => {
            const crosswalk = crosswalks[id];
            if (crosswalk.boundaryId === boundaryId && grouds[crosswalk.groudId]) {
                result.push(grouds[crosswalk.groudId]);
            }
        });
    } else if (type === ThreeElementType.SpeedBumpBoundary) {
        Object.keys(speedBumps).forEach((id: string) => {
            const speedBump = speedBumps[id];
            if (speedBump.boundaryId === boundaryId && grouds[speedBump.groudId]) {
                result.push(grouds[speedBump.groudId]);
            }
        });
    } else if (type === ThreeElementType.ParkingSpaceBoundary) {
        Object.keys(parkingSpaces).forEach((id: string) => {
            const parkingSpace = parkingSpaces[id];
            if (parkingSpace.boundaryId === boundaryId && grouds[parkingSpace.groudId]) {
                result.push(grouds[parkingSpace.groudId]);
            }
        });
    }
    return result;
};

export function searchGroudPointsAndBoundaryFromGroudId(groudId: string) {
    const groud = searchGroudFromGroudId(groudId);
    const { type } = groud;
    if (type === ThreeElementType.LaneGroud || type === ThreeElementType.LaneCurveGroud) {
        const lane = searchLaneFromGroudId(groudId);
        const { leftBoundaryId, rightBoundaryId, leftBoundaryReverse, rightBoundaryReverse } = lane;
        const leftPoints = searchPointsFromBoundaryId(lane.leftBoundaryId);
        const rightPoints = searchPointsFromBoundaryId(lane.rightBoundaryId);
        const shapeLeftPoints = leftBoundaryReverse ? [...leftPoints].reverse() : [...leftPoints];
        const shapeRightPoints = rightBoundaryReverse ? [...rightPoints].reverse() : [...rightPoints];
        const points = shapeLeftPoints.concat(shapeRightPoints.reverse()).concat(shapeLeftPoints[0]);
        return {
            points,
            boundarys: [searchBoundaryByBoundaryId(leftBoundaryId), searchBoundaryByBoundaryId(rightBoundaryId)],
        };
    }
    if (type === ThreeElementType.JunctionGroud) {
        const junction = searchJunctionFromGroudId(groudId);
        return {
            points: [...searchPointsFromBoundaryId(junction.boundaryId)],
            boundarys: [searchBoundaryByBoundaryId(junction.boundaryId)],
        };
    }
    if (type === ThreeElementType.AreaGroud) {
        const area = searchAreaFromGroudId(groudId);
        return {
            points: [...searchPointsFromBoundaryId(area.boundaryId)],
            boundarys: [searchBoundaryByBoundaryId(area.boundaryId)],
        };
    }
    if (type === ThreeElementType.BarrierGateGroud) {
        const barrierGate = searchBarrierGateFromGroudId(groudId);
        return {
            points: [...searchPointsFromBoundaryId(barrierGate.boundaryId)],
            boundarys: [searchBoundaryByBoundaryId(barrierGate.boundaryId)],
        };
    }
    if (type === ThreeElementType.CrosswalkGroud) {
        const crosswalk = searchCrosswalkByGroudId(groudId);
        return {
            points: [...searchPointsFromBoundaryId(crosswalk.boundaryId)],
            boundarys: [searchBoundaryByBoundaryId(crosswalk.boundaryId)],
        };
    }
    if (type === ThreeElementType.SpeedBumpGroud) {
        const speedBump = searchSpeedBumpFromGroudId(groudId);
        return {
            points: [...searchPointsFromBoundaryId(speedBump.boundaryId)],
            boundarys: [searchBoundaryByBoundaryId(speedBump.boundaryId)],
        };
    }
    if (type === ThreeElementType.ParkingSpaceGroud) {
        const parkingSpace = searchParkingSpaceByGroudId(groudId);
        return {
            points: [...searchPointsFromBoundaryId(parkingSpace.boundaryId)],
            boundarys: [searchBoundaryByBoundaryId(parkingSpace.boundaryId)],
        };
    }
    return {
        points: [],
        boundarys: [],
    };
}

export function searchGroudShapePositions(groudId: string) {
    const groud = searchGroudFromGroudId(groudId);
    const positions: THREE.Vector2[] = [];
    if (!groud) {
        console.warn('searchGroudShapePositions: groud not found');
        return [];
    }
    const { type } = groud;
    const { points } = searchGroudPointsAndBoundaryFromGroudId(groudId);
    if (type === ThreeElementType.LaneCurveGroud) {
        const lane = searchLaneFromGroudId(groudId);
        if (!lane) {
            console.warn('searchGroudShapePositions: lane not found');
            return [];
        }
        const { controlsPosition: leftControlsPosition, points: leftPoints } = searchCurvePointsAndControlsFromCurveId(
            lane.leftBoundaryId,
        );
        const { controlsPosition: rightControlsPosition, points: rightPoints } =
            searchCurvePointsAndControlsFromCurveId(lane.rightBoundaryId);
        if (leftControlsPosition.length !== 2 || rightControlsPosition.length !== 2) {
            return [];
        }
        const leftPoint1Mesh = objectSearch(ThreeObject.Point, leftPoints[0]?.id);
        const leftPoint2Mesh = objectSearch(ThreeObject.Point, leftPoints[1]?.id);
        const rightPoint1Mesh = objectSearch(ThreeObject.Point, rightPoints[0]?.id);
        const rightPoint2Mesh = objectSearch(ThreeObject.Point, rightPoints[1]?.id);
        const leftFirstControlMesh = contrlPointSearch(ThreeObject.ControlPoint, lane.leftBoundaryId, true);
        const leftSecondControlMesh = contrlPointSearch(ThreeObject.ControlPoint, lane.leftBoundaryId, false);
        const rightFirstControlMesh = contrlPointSearch(ThreeObject.ControlPoint, lane.rightBoundaryId, true);
        const rightSecondControlMesh = contrlPointSearch(ThreeObject.ControlPoint, lane.rightBoundaryId, false);
        if (!leftPoint1Mesh || !leftPoint2Mesh || !rightPoint1Mesh || !rightPoint2Mesh) {
            return [];
        }
        positions.push(vector3TransTpVector2(leftPoint1Mesh.position.clone()));
        positions.push(vector3TransTpVector2(leftFirstControlMesh?.position?.clone() || leftControlsPosition[0]));
        positions.push(vector3TransTpVector2(leftSecondControlMesh?.position?.clone() || leftControlsPosition[1]));
        positions.push(vector3TransTpVector2(leftPoint2Mesh.position.clone()));
        positions.push(vector3TransTpVector2(rightPoint2Mesh.position.clone()));
        positions.push(vector3TransTpVector2(rightSecondControlMesh?.position?.clone() || rightControlsPosition[1]));
        positions.push(vector3TransTpVector2(rightFirstControlMesh?.position?.clone() || rightControlsPosition[0]));
        positions.push(vector3TransTpVector2(rightPoint1Mesh.position.clone()));
    } else if (type === ThreeElementType.SpeedBumpGroud) {
        const shapePoints = points.map((point) => {
            const pointMesh = objectSearch(ThreeObject.Point, point.id);
            if (!pointMesh) {
                return null;
            }
            return pointMesh.position.clone();
        });
        if (shapePoints.length < 2) {
            return [];
        }
        const firstPoint = shapePoints[0];
        const secondPoint = shapePoints[1];
        positions.push(...getRectanglePoints(firstPoint, secondPoint, 0.4));
    } else {
        points.forEach((item) => {
            if (!item) {
                return;
            }
            const pointMesh = objectSearch(ThreeObject.Point, item.id);
            if (pointMesh) {
                positions.push(vector3TransTpVector2(getMeshWorldCoordinate(pointMesh)));
            }
        });
    }
    return positions;
}
