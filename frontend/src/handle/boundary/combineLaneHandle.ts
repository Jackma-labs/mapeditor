import { AddArrowCommand } from 'src/command/ArrowCommand';
import { AddGroudCommand } from 'src/command/GroudCommand';
import { AddLaneCommand } from 'src/command/LaneCommand';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { LaneTrend } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { getBooleanClockwise } from 'src/utils/vectorUtil';
// import { getMiddlePoint, getNearPointAndSegmentInLine } from 'src/utils/vectorUtil';
import * as THREE from 'three';
/**
 * 获取两个线去组成一个车道时，左右车道是否需要反转,第一个是左车道，第二个是右车道
 */
export function getBoundarysReverse(leftPoints: THREE.Vector3[], rightPoints: THREE.Vector3[]) {
    if (leftPoints.length < 2 || rightPoints.length < 2) {
        return [false, false];
    }

    let leftReverse = false;
    let rightReverse = false;

    let leftP1 = new THREE.Vector2(leftPoints[0].x, leftPoints[0].y);
    const leftLastP = new THREE.Vector2(leftPoints[leftPoints.length - 1].x, leftPoints[leftPoints.length - 1].y);
    const leftP2 = new THREE.Vector2(leftPoints[1].x, leftPoints[1].y);
    let rightP1 = new THREE.Vector2(rightPoints[0].x, rightPoints[0].y);
    const rightP2 = new THREE.Vector2(rightPoints[1].x, rightPoints[1].y);
    const rightLastP = new THREE.Vector2(rightPoints[rightPoints.length - 1].x, rightPoints[rightPoints.length - 1].y);
    if (rightP1.distanceTo(leftP1) > rightLastP.distanceTo(leftP1)) {
        rightP1 = rightLastP;
    }
    leftReverse = !getBooleanClockwise([
        [leftP1.x, leftP1.y],
        [leftP2.x, leftP2.y],
        [rightP1.x, rightP1.y],
    ]);
    rightP1 = new THREE.Vector2(rightPoints[0].x, rightPoints[0].y);
    if (leftP1.distanceTo(rightP1) > leftLastP.distanceTo(rightP1)) {
        leftP1 = leftLastP;
    }
    rightReverse = getBooleanClockwise([
        [rightP1.x, rightP1.y],
        [rightP2.x, rightP2.y],
        [leftP1.x, leftP1.y],
    ]);
    return [leftReverse, rightReverse];
}
/**
 * 将两个boundary合并成一个lane
 */
export function combineLaneHandle(boundary1Id: string, boundary2Id: string) {
    const { lanes, grouds, currentDrawData, prossibleDrivingDirections } = useManagerStore.getState().mapState;
    const laneId = `${getElementMaxIndex(lanes) + 1}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const leftPoints = searchPointsFromBoundaryId(boundary1Id).map((item) => item.position);
    const rightPoints = searchPointsFromBoundaryId(boundary2Id).map((item) => item.position);
    const [leftBoundaryReverse, rightBoundaryReverse] = getBoundarysReverse(leftPoints, rightPoints);

    const cm1 = new AddLaneCommand(
        laneId,
        boundary1Id,
        boundary2Id,
        groudId,
        arrowId,
        { ...currentDrawData.laneAttr },
        leftBoundaryReverse,
        rightBoundaryReverse,
        LaneTrend.Straight,
    );
    const cm2 = new AddGroudCommand(groudId, ThreeElementType.LaneGroud);
    const cm4 = new AddArrowCommand(arrowId, ThreeElementType.LaneRelativeDirection);
    useManagerStore.getState().addCommand([cm1, cm2, cm4]);
}
