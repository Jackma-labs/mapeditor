import { mapElementZ } from 'src/constant/mapElementZ';
import { ThreeElementType, ThreeObject, OperationType } from 'src/interface/commonInterFace';
import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { useManagerStore } from 'src/store';
import {
    searchBoundaryByBoundaryId,
    searchBoundaryFirstPeriodPoints,
    searchBoundaryLastPeriodPoints,
} from 'src/utils/search/boundarySearch';
import {
    searchLaneFirstPeriodPoints,
    searchLaneLastPeriodPoints,
    searchLaneFromGroudId,
    searchLaneByLaneId,
} from 'src/utils/search/laneSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import {
    getBooleanClockwise,
    getMiddlePosition,
    getRotateAngle,
    worldPositionToScreen,
    transScreenPositionToWorld,
} from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { searchParkingSpaceByGroudId } from 'src/utils/search/parkingSpaceSearch';
import { LaneTrend } from 'src/interface/laneInterFace';
import { getBezierHalfLengthPosition } from '../BezierCurve3Control/util';
/**
 * 获取lane的延长lane图标的位置和deg
 */
export function getExtendLaneSvgPositionAndDeg(laneId: string) {
    const [, leftPoint2, rightPoint1, rightPoint2] = searchLaneLastPeriodPoints(laneId);
    if (!leftPoint2 || !rightPoint1 || !rightPoint2) {
        return {};
    }
    const leftPoint2Mesh = objectSearch(ThreeObject.Point, leftPoint2.id);
    const rightPoint1Mesh = objectSearch(ThreeObject.Point, rightPoint1.id);
    const rightPoint2Mesh = objectSearch(ThreeObject.Point, rightPoint2.id);
    if (!leftPoint2Mesh || !rightPoint1Mesh || !rightPoint2Mesh) {
        return {};
    }

    const rightPoint1ScreenPosition = worldPositionToScreen(rightPoint1Mesh.position);
    const rightPoint2ScreenPosition = worldPositionToScreen(rightPoint2Mesh.position);
    const leftPoint2ScreenPosition = worldPositionToScreen(leftPoint2Mesh.position);
    const deg = getRotateAngle(rightPoint1ScreenPosition, rightPoint2ScreenPosition);
    const middlePosition = getMiddlePosition(leftPoint2ScreenPosition, rightPoint2ScreenPosition);
    // 让屏幕坐标沿着车道方向移动24px，绘制延长车道图标
    const handledScreenPosition = new THREE.Vector2(
        middlePosition.x + 24 * Math.cos(deg),
        middlePosition.y + 24 * Math.sin(deg),
    );
    // 然后把这个屏幕坐标转换成世界坐标
    const worldPosition = transScreenPositionToWorld(handledScreenPosition);
    return {
        deg: -deg,
        position: worldPosition,
    };
}
/**
 * 获取复制lane的两个图标的位置，第一个为左boundary上的图标，第二个为右boundary上的图标
 */
export function getCopyLaneSvgPositions(laneId: string) {
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return [];
    }
    const [leftPoint1, leftPoint2, rightPoint1, rightPoint2] = searchLaneFirstPeriodPoints(laneId);

    if (!rightPoint1 || !rightPoint2 || !leftPoint1 || !leftPoint2) {
        console.warn('drawAddLaneSvg 是绘制点没有获取到');
        return [];
    }
    const rightPoint1Mesh = objectSearch(ThreeObject.Point, rightPoint1.id);
    const rightPoint2Mesh = objectSearch(ThreeObject.Point, rightPoint2.id);
    const leftPoint1Mesh = objectSearch(ThreeObject.Point, leftPoint1.id);
    const leftPoint2Mesh = objectSearch(ThreeObject.Point, leftPoint2.id);
    const leftPoint1ScreenPosition = worldPositionToScreen(leftPoint1Mesh.position);
    const leftPoint2ScreenPosition = worldPositionToScreen(leftPoint2Mesh.position);
    const rightPoint1ScreenPosition = worldPositionToScreen(rightPoint1Mesh.position);
    const rightPoint2ScreenPosition = worldPositionToScreen(rightPoint2Mesh.position);
    const deg1 = getRotateAngle(leftPoint1ScreenPosition, leftPoint2ScreenPosition);
    const deg2 = getRotateAngle(rightPoint1ScreenPosition, rightPoint2ScreenPosition);

    let position1: THREE.Vector2 = null;
    let position2: THREE.Vector2 = null;
    if (lane.type === LaneTrend.Straight) {
        const screenPosition1 = getMiddlePosition(leftPoint1ScreenPosition, leftPoint2ScreenPosition);
        const handledScreenPosition1 = new THREE.Vector2(
            screenPosition1.x + 24 * Math.sin(deg1),
            screenPosition1.y - 24 * Math.cos(deg1),
        );
        position1 = transScreenPositionToWorld(handledScreenPosition1);

        const screenPosition2 = getMiddlePosition(rightPoint1ScreenPosition, rightPoint2ScreenPosition);
        const handledScreenPosition2 = new THREE.Vector2(
            screenPosition2.x - 24 * Math.sin(deg2),
            screenPosition2.y + 24 * Math.cos(deg2),
        );
        position2 = transScreenPositionToWorld(handledScreenPosition2);
    } else {
        const halfPosition1 = getBezierHalfLengthPosition(lane.leftBoundaryId);
        const halfPosition2 = getBezierHalfLengthPosition(lane.rightBoundaryId);
        if (!halfPosition1 || !halfPosition2) {
            return [];
        }
        position1 = new THREE.Vector2(halfPosition1.x + 1.5 * Math.sin(deg1), halfPosition1.y + 1.5 * Math.cos(deg1));
        position2 = new THREE.Vector2(halfPosition2.x - 1.5 * Math.sin(deg2), halfPosition2.y - 1.5 * Math.cos(deg2));
    }

    return [
        { position: position1, deg: -deg1 },
        { position: position2, deg: -deg2 },
    ];
}

/**
 * 设置位置和deg
 */
export function setAddIconPositionAndDeg(icon: THREE.Sprite, position: THREE.Vector2, deg: number) {
    icon.material.map.center.set(0.5, 0.5);
    icon.material.rotation = deg;
    icon.position.set(position.x, position.y, mapElementZ[ThreeElementType.AddLaneSvg]);
}
/**
 * 设置group的userData
 */
export function setAddIconUserData(icon: THREE.Sprite, data: any) {
    if (!icon) {
        return;
    }
    icon.userData = { ...icon.userData, ...data };
}

/**
 * 返回复制停车位的四个图标的位置
 */
export function getCopyParkingSpaceIconPositions(parkingSpace: ParkingSpace) {
    if (!parkingSpace) {
        console.warn('getCopyParkingSpaceIconPositions: parkingSpace is null');
        return [];
    }
    const { boundaryId } = parkingSpace;
    const points = searchPointsFromBoundaryId(boundaryId);
    if (!points || points.length === 0) {
        console.warn('getCopyParkingSpaceIconPositions: points is null');
        return [];
    }
    const screenPositions = points.map((point) => {
        const pointMesh = objectSearch(ThreeObject.Point, point.id);
        return worldPositionToScreen(pointMesh.position);
    });
    const isClockWise = getBooleanClockwise([
        [screenPositions[0].x, screenPositions[0].y],
        [screenPositions[1].x, screenPositions[1].y],
        [screenPositions[2].x, screenPositions[2].y],
        [screenPositions[3].x, screenPositions[3].y],
        [screenPositions[0].x, screenPositions[0].y],
    ]);
    let distance = -24;
    if (isClockWise) {
        distance = 24;
    }
    const result = [];
    for (let i = 0; i < screenPositions.length - 1; i += 1) {
        const p1 = screenPositions[i];
        const p2 = screenPositions[i + 1];
        const deg = getRotateAngle(p1, p2);
        const screenPosition = getMiddlePosition(p1, p2);
        const handledScreenPosition = new THREE.Vector2(
            screenPosition.x - distance * Math.sin(deg),
            screenPosition.y + distance * Math.cos(deg),
        );
        const position = transScreenPositionToWorld(handledScreenPosition);
        result.push({
            position,
            deg: -deg,
        });
    }
    return result;
}
/**
 * 获取lane的延长lane图标的位置和deg
 */
export function getExtendBoundarySvgPositionAndDeg(boundaryId: string) {
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;
    const boundary = boundarys[boundaryId];
    if (!boundary) {
        console.warn(`getExtendBoundarySvgPositionAndDeg中没有找到Id为${boundaryId}的boundary`);
        return [];
    }
    const [firstPeriodfirstPoint, firstPeriodSecondPoint] = searchBoundaryFirstPeriodPoints(boundaryId);
    const [lastPeriodFirstPoint, lastPeriodSecondPoint] = searchBoundaryLastPeriodPoints(boundaryId);

    const firstPeriodfirstScreenPosition = worldPositionToScreen(firstPeriodfirstPoint.position);
    const firstPeriodSecondScreenPosition = worldPositionToScreen(firstPeriodSecondPoint.position);
    const lastPeriodFirstScreenPosition = worldPositionToScreen(lastPeriodFirstPoint.position);
    const lastPeriodSecondScreenPosition = worldPositionToScreen(lastPeriodSecondPoint.position);
    const deg1 = getRotateAngle(firstPeriodSecondScreenPosition, firstPeriodfirstScreenPosition);
    const deg2 = getRotateAngle(lastPeriodFirstScreenPosition, lastPeriodSecondScreenPosition);

    const handledScreenPosition1 = new THREE.Vector2(
        firstPeriodfirstScreenPosition.x + 24 * Math.cos(deg1),
        firstPeriodfirstScreenPosition.y + 24 * Math.sin(deg1),
    );
    const handledScreenPosition2 = new THREE.Vector2(
        lastPeriodSecondScreenPosition.x + 24 * Math.cos(deg2),
        lastPeriodSecondScreenPosition.y + 24 * Math.sin(deg2),
    );
    const position1 = transScreenPositionToWorld(handledScreenPosition1);
    const position2 = transScreenPositionToWorld(handledScreenPosition2);

    return [
        {
            deg: -deg1,
            position: position1,
        },
        {
            deg: -deg2,
            position: position2,
        },
    ];
}

export function addIconUpdate() {
    const { mapState, setMapState } = useManagerStore.getState();
    const { operationType, currentPickElement } = mapState;
    if (!operationType) {
        if (
            mapState.currentPickElement.length === 1 &&
            mapState.currentPickElement[0].type === ThreeElementType.LaneGroud
        ) {
            const lane = searchLaneFromGroudId(mapState.currentPickElement[0].id);
            PubSub.publish('drawExtendLaneGroup', lane?.id);
        } else if (
            mapState.currentPickElement.length === 1 &&
            mapState.currentPickElement[0].type === ThreeElementType.LaneBoundary
        ) {
            PubSub.publish('drawExtendBoundaryGroup', mapState.currentPickElement[0].id);
        } else if (
            mapState.currentPickElement.length === 1 &&
            mapState.currentPickElement[0].type === ThreeElementType.RoadBoundary
        ) {
            const boundary = searchBoundaryByBoundaryId(mapState.currentPickElement[0].id);
            if (boundary?.controlsPosition?.length !== 2) {
                PubSub.publish('drawExtendBoundaryGroup', mapState.currentPickElement[0].id);
            }
        } else {
            PubSub.publish('removeSvgGroups');
        }
    } else if (operationType === OperationType.CopyLane) {
        if (
            currentPickElement?.length === 0 ||
            (currentPickElement[0].type !== ThreeElementType.LaneGroud &&
                currentPickElement[0].type !== ThreeElementType.LaneCurveGroud)
        ) {
            mapState.operationType = null;
            PubSub.publish('removeSvgGroups');
            setMapState(mapState);
        } else {
            const lane = searchLaneFromGroudId(currentPickElement[0].id);
            if (!lane) {
                mapState.operationType = null;
                PubSub.publish('removeSvgGroups');
                setMapState(mapState);
            } else {
                PubSub.publish('drawCopyLaneGroup', lane.id);
            }
        }
    } else if (operationType === OperationType.CopyParkingSpace) {
        if (currentPickElement?.length === 0 || currentPickElement[0].type !== ThreeElementType.ParkingSpaceGroud) {
            mapState.operationType = null;
            PubSub.publish('removeSvgGroups');
            setMapState(mapState);
        } else {
            const parkingSpace = searchParkingSpaceByGroudId(currentPickElement[0].id);
            if (!parkingSpace) {
                mapState.operationType = null;
                PubSub.publish('removeSvgGroups');
                setMapState(mapState);
            } else {
                PubSub.publish('drawCopyParkingSpaceGroup', parkingSpace.id);
            }
        }
    } else {
        PubSub.publish('removeSvgGroups');
    }
}
