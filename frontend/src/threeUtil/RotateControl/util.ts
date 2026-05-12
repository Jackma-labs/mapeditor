import {
    getRotateAngle,
    transScreenPositionToWorld,
    vector2TransTpVector3,
    worldPositionToScreen,
} from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { PointElement } from 'src/interface/basicElementInterFace';
import { Lane } from 'src/interface/laneInterFace';
import * as turf from '@turf/turf';
import { useManagerStore } from 'src/store';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { OperationType, ThreeObject } from 'src/interface/commonInterFace';
import PubSub from 'pubsub-js';
/**
 * 获取点绕着基点,旋转轴为z轴，旋转后的坐标
 */
export function getPointPositionAfterRotation(
    pointPosition: THREE.Vector3,
    angle: number,
    basePosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
) {
    if (!pointPosition) {
        console.error('getPointPositionAfterRotation pointPosition is null');
        return null;
    }
    const distance = basePosition.distanceTo(pointPosition);
    if (!distance) {
        return pointPosition;
    }
    const originAngle = getRotateAngle(basePosition, pointPosition);
    return new THREE.Vector3(
        basePosition.x + distance * Math.cos(originAngle + angle),
        basePosition.y + distance * Math.sin(originAngle + angle),
        basePosition.z,
    );
}
/**
 * 返回旋转boundary的手柄和旋转基点位置
 * @param lane
 * @returns [第一个旋转基点位置，第二个旋转基点的位置，第一个旋转手柄位置，第二个旋转手柄位置]
 */
export function getBoundaryRotateElementsPositionAndDeg(boundaryId: string) {
    const boundary = searchBoundaryByBoundaryId(boundaryId);
    if (!boundary) {
        return [null, null, null, null];
    }
    const { points } = useManagerStore.getState().mapState;
    // 确定的起始点和终点，需要绘制的两个旋转基点，和两个手柄
    let start: PointElement = null;
    let end: PointElement = null;
    let startId: string = null;
    let endId: string = null;
    const length = boundary.pointIds.length;
    startId = boundary.pointIds[0];
    start = points[startId]; // 旋转基线的第一个点center1
    endId = boundary.pointIds[length - 1];
    end = points[endId]; // 旋转基线的第二个点center2
    if (!start || !end) {
        return [null, null, null, null];
    }
    const startPointMesh = objectSearch(ThreeObject.Point, startId);
    const endPointMesh = objectSearch(ThreeObject.Point, endId);
    // center1的屏幕坐标
    const screenStartPosition = worldPositionToScreen(startPointMesh.position);
    // center2的屏幕坐标
    const screenEndPosition = worldPositionToScreen(endPointMesh.position);
    // 计算center2到center1的向量和沿x轴的单位向量的夹角
    const deg = getRotateAngle(screenStartPosition, screenEndPosition);
    // 计算旋转手柄的屏幕坐标（沿着center1到center2的方向偏移24个像素）
    const startHandlePosition = new THREE.Vector2(
        screenStartPosition.x + 24 * Math.cos(deg),
        screenStartPosition.y + 24 * Math.sin(deg),
    );
    // 计算旋转手柄的屏幕坐标（沿着center2到center1的方向偏移24个像素）
    const endHandlePosition = new THREE.Vector2(
        screenEndPosition.x - 24 * Math.cos(deg),
        screenEndPosition.y - 24 * Math.sin(deg),
    );

    return [
        { position: startPointMesh.position, deg: 0 },
        { position: endPointMesh.position, deg: 0 },
        // 旋转角度取反是因为getRotateAngle中旋转向量是由center2指向center1的，
        // 而我们需要的是center1指向center2的，所以取反
        { position: transScreenPositionToWorld(startHandlePosition), deg: -deg },
        { position: transScreenPositionToWorld(endHandlePosition), deg: -deg },
    ];
}
/**
 * 返回旋转lane的手柄和旋转基点位置
 * @param lane
 * @returns [第一个旋转基点位置，第二个旋转基点的位置，第一个旋转手柄位置，第二个旋转手柄位置]
 */
export function getLaneRotateElementsPosition(lane: Lane) {
    if (!lane) {
        return [null, null, null, null];
    }
    const { boundarys } = useManagerStore.getState().mapState;
    const { rightBoundaryId } = lane;
    const boundary = boundarys[rightBoundaryId];
    if (!boundary) {
        return [null, null, null, null];
    }

    return getBoundaryRotateElementsPositionAndDeg(boundary.id);
}
/**
 * 返回旋转junction的手柄和旋转基点位置
 * @param lane
 * @returns [旋转基点位置，第一个旋转手柄位置，第二个旋转手柄位置]
 */
export function getPolygonRotateElementsPosition(positions: number[][]) {
    if (!positions || positions.length < 3) {
        return [];
    }
    let maxDistance = 0;
    for (let i = 0; i < positions.length - 1; i += 1) {
        for (let j = i + 1; j < positions.length; j += 1) {
            const v1 = new THREE.Vector3(...positions[i]);
            const v2 = new THREE.Vector3(...positions[j]);
            const distance = v1.distanceTo(v2);
            if (distance > maxDistance) {
                maxDistance = distance;
            }
        }
    }
    maxDistance = Number(maxDistance.toFixed(3));

    const box = new THREE.Box3().setFromPoints(positions.map((p) => new THREE.Vector3(...p)));
    const center = box.getCenter(new THREE.Vector3());

    const startHandlePosition = new THREE.Vector2(center.x - (maxDistance / 2) * Math.sqrt(2), center.y);
    const endHandlePosition = new THREE.Vector2(center.x + (maxDistance / 2) * Math.sqrt(2), center.y);

    const deg = getRotateAngle(
        worldPositionToScreen(vector2TransTpVector3(startHandlePosition)),
        worldPositionToScreen(vector2TransTpVector3(endHandlePosition)),
    );
    return [
        { position: center, deg: 0 },
        null,
        { position: startHandlePosition, deg: -deg },
        { position: endHandlePosition, deg: -deg },
    ];
}
/**
 * 获取多个点的最大值和最小值[minX,minY,maxX,maxY]
 */
export function getPointsBox(positions: number[][]) {
    const line = turf.lineString([...positions]);
    const bbox = turf.bbox(line);
    return bbox;
}

export function rotateElementsUpdate() {
    const { mapState, setMapState } = useManagerStore.getState();
    const { operationType, currentPickElement } = useManagerStore.getState().mapState;
    if (operationType === OperationType.Rotating) {
        if (currentPickElement.length === 0) {
            mapState.operationType = null;
            setMapState(mapState);
            return;
        }
        PubSub.publishSync('drawOrUpdateRotateElements');
    } else {
        PubSub.publishSync('removeRotateElements');
    }
}
