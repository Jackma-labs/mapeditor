import { ThreeElementType } from 'src/interface/commonInterFace';
import * as THREE from 'three';
import Flatten from '@flatten-js/core';
import { Lane } from 'src/interface/laneInterFace';
import * as turf from '@turf/turf';
import { useManagerStore } from 'src/store';
import { mapElementZ } from 'src/constant/mapElementZ';
import { Boundary, Groud } from 'src/interface/basicElementInterFace';
import { unionBy } from 'lodash';
import { updateBoundary } from 'src/object/boundary';
import { updateArrow } from 'src/object/arrow';
import { updateGroud } from 'src/object/groud';
import { updateSignIcon } from 'src/object/sign';
import { computedLeftBoundaryPointPosition, getExtendPoint, getMiddlePosition, getRotateAngle } from './vectorUtil';
import { searchPointByPointId, searchPointIdsFromBoundaryId, searchPointsFromBoundaryId } from './search/pointSearch';
import { searchBoundarysFromPointId, searchCurvePointsAndControlsFromCurveId } from './search/boundarySearch';
import { searchGroudFromBoundaryId } from './search/groudSearch';
import { searchLaneByLaneId, searchLaneFromGroudId } from './search/laneSearch';
import { searchParkingSpaceByGroudId } from './search/parkingSpaceSearch';
import { searchSignByBoundaryId, searchSignByPointId } from './search/signSearch';

/**
 * 获取插入的点在boundary中的index
 */
export function getInsertIndex(pointPosition: THREE.Vector3, boundaryId: string, last: boolean, first: boolean) {
    const boundaryPoints = searchPointsFromBoundaryId(boundaryId);
    // 默认添加点到Boundary的最后面
    if (last) {
        return boundaryPoints.length;
    }
    if (first) {
        return 0;
    }
    let distance = Infinity;
    let insertIndex = -1;
    for (let i = 0; i < boundaryPoints.length - 1; i += 1) {
        const point1 = boundaryPoints[i];
        const point2 = boundaryPoints[i + 1];

        const p1 = point1.position;
        const p2 = point2.position;
        const pt = turf.point([pointPosition.x, pointPosition.y]);
        const line = turf.lineString([
            [p1.x, p1.y],
            [p2.x, p2.y],
        ]);
        const curDistance = turf.pointToLineDistance(pt, line, { units: 'miles' });
        if (distance > curDistance) {
            distance = curDistance;
            insertIndex = i + 1;
        }
    }
    return insertIndex;
}
/**
 * 将一个点加入到绘制的boundary中，且保持有序
 * @param pointId
 * @param boundaryId
 * @param boundaryType
 * @param last 是否是最后一个点，当绘制过程中一般为最后一个点，在已经绘制好的junction中加入一个点，last则为false
 * @param first 是否是第一个点
 * @returns
 */
export function insertPointToBoundary(pointId: string, boundaryId: string, last: boolean, first: boolean): string[] {
    const point = searchPointByPointId(pointId);
    const insertIndex = getInsertIndex(point.position, boundaryId, last, first);
    const boundaryPointIds = searchPointIdsFromBoundaryId(boundaryId);
    boundaryPointIds.splice(insertIndex, 0, pointId);
    return boundaryPointIds;
}

/**
 * 根据pointId转换成一个Flatten Point
 */
function toFlattenPoint(pointId: string): Flatten.Point {
    const { points } = useManagerStore.getState().mapState;
    return new Flatten.Point(points[pointId].position.x, points[pointId].position.y);
}

/**
 * 在lane左侧或者右侧生成一条对称的boundary
 * @param laneId
 * @param inLeft 是否以左边界为轴生成一条对称boundary
 * @return 返回一个THREE的Vector2数组
 */
export function generateCopyedBoundary(laneId: string, inLeft: boolean): THREE.Vector3[] {
    const outputPoints: THREE.Vector3[] = [];
    const { lanes, boundarys } = useManagerStore.getState().mapState;
    const lane = lanes[laneId];
    if (!lane) {
        return outputPoints;
    }
    const leftPoints = boundarys[lane.leftBoundaryId]?.pointIds || [];
    const rightPoints = boundarys[lane.rightBoundaryId]?.pointIds || [];
    // 轴线
    const axisPoints = inLeft ? leftPoints : rightPoints;
    // 参考线
    const refPoints = inLeft ? rightPoints : leftPoints;

    let axisPos = 0;
    for (let refPos = 0; refPos < refPoints.length; refPos += 1) {
        // 获取前后两个点垂直线
        const refPoint = toFlattenPoint(refPoints[refPos]);
        const nextRefPointId = refPos !== refPoints.length - 1 ? refPoints[refPos + 1] : refPoints[refPos - 1];
        const verticalLine = new Flatten.Line(refPoint, new Flatten.Vector(refPoint, toFlattenPoint(nextRefPointId)));
        // 找到轴线上和垂直线最近的segment
        let distancePre = Number.MAX_SAFE_INTEGER;
        let shortestSegmentPre: Flatten.Segment;
        while (true) {
            const segment = new Flatten.Segment(
                toFlattenPoint(axisPoints[axisPos]),
                toFlattenPoint(axisPoints[axisPos + 1]),
            );
            const [distance, shortestSegment] = verticalLine.distanceTo(segment);
            // 找到轴线上最近的segment
            if (distance !== 0 && distance < distancePre && axisPos !== axisPoints.length - 2) {
                distancePre = distance;
                shortestSegmentPre = shortestSegment;
                axisPos += 1;
            } else {
                const intersectPoint = distancePre <= distance ? shortestSegmentPre.start : shortestSegment.start;
                outputPoints.push(
                    new THREE.Vector3(intersectPoint.x * 2 - refPoint.x, intersectPoint.y * 2 - refPoint.y),
                );
                break;
            }
        }
    }

    return outputPoints;
}
/**
 * 获取lane的起始点
 * @return 返回左右起始点ID数组[leftStartPointId, rightStartPointId]
 */
export function getLaneStartPointIds(lane: Lane): [string, string] {
    const { boundarys } = useManagerStore.getState().mapState;
    const leftBoundary = boundarys[lane.leftBoundaryId];
    const rightBoundary = boundarys[lane.rightBoundaryId];
    if (!leftBoundary || !rightBoundary) {
        console.warn(`getLaneStartPointIds中id为${lane.id}的lane的左右boundary没找到`);
        return [null, null];
    }
    const leftPoints = leftBoundary.pointIds;
    const rightPoints = rightBoundary.pointIds;
    const leftStart = lane.leftBoundaryReverse ? leftPoints[leftPoints.length - 1] : leftPoints[0];
    const rightStart = lane.rightBoundaryReverse ? rightPoints[rightPoints.length - 1] : rightPoints[0];
    return [leftStart, rightStart];
}
/**
 * 获取lane的终点
 * @return 返回左右终止点ID数组[leftEndPointId, rightEndPointId]
 */
export function getLaneEndPointIds(lane: Lane): [string, string] {
    const { boundarys } = useManagerStore.getState().mapState;
    const leftBoundary = boundarys[lane.leftBoundaryId];
    const rightBoundary = boundarys[lane.rightBoundaryId];
    if (!leftBoundary || !rightBoundary) {
        console.warn(`getLaneEndPointIds中id为${lane.id}的lane的左右boundary没找到`);
        return [null, null];
    }
    const leftPoints = leftBoundary.pointIds;
    const rightPoints = rightBoundary.pointIds;
    const leftEnd = lane.leftBoundaryReverse ? leftPoints[0] : leftPoints[leftPoints.length - 1];
    const rightEnd = lane.rightBoundaryReverse ? rightPoints[0] : rightPoints[rightPoints.length - 1];
    return [leftEnd, rightEnd];
}
export function generateCopyedCurveBoundary(
    laneId: string,
    inLeft: boolean,
): { positions: THREE.Vector3[]; controlPositions: THREE.Vector3[] } {
    const result: { positions: THREE.Vector3[]; controlPositions: THREE.Vector3[] } = {
        positions: [],
        controlPositions: [],
    };
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return null;
    }
    const { points: leftPoints, controlsPosition: leftControlsPosition } = searchCurvePointsAndControlsFromCurveId(
        lane.leftBoundaryId,
    );
    const { points: rightPoints, controlsPosition: rightControlsPosition } = searchCurvePointsAndControlsFromCurveId(
        lane.rightBoundaryId,
    );
    if (
        leftPoints.length !== 2 ||
        rightPoints.length !== 2 ||
        leftControlsPosition.length !== 2 ||
        rightControlsPosition.length !== 2
    ) {
        return null;
    }
    if (inLeft) {
        result.positions.push(
            getExtendPoint(
                rightPoints[0].position,
                leftPoints[0].position,
                rightPoints[0].position.distanceTo(leftPoints[0].position) * 2,
            ),
        );
        result.controlPositions.push(
            getExtendPoint(
                rightControlsPosition[0],
                leftControlsPosition[0],
                rightControlsPosition[0].distanceTo(leftControlsPosition[0]) * 2,
            ),
        );
        result.positions.push(
            getExtendPoint(
                rightPoints[1].position,
                leftPoints[1].position,
                rightPoints[1].position.distanceTo(leftPoints[1].position) * 2,
            ),
        );
        result.controlPositions.push(
            getExtendPoint(
                rightControlsPosition[1],
                leftControlsPosition[1],
                rightControlsPosition[1].distanceTo(leftControlsPosition[1]) * 2,
            ),
        );
    } else {
        result.positions.push(
            getExtendPoint(
                leftPoints[0].position,
                rightPoints[0].position,
                rightPoints[0].position.distanceTo(leftPoints[0].position) * 2,
            ),
        );
        result.controlPositions.push(
            getExtendPoint(
                leftControlsPosition[0],
                rightControlsPosition[0],
                rightControlsPosition[0].distanceTo(leftControlsPosition[0]) * 2,
            ),
        );
        result.positions.push(
            getExtendPoint(
                leftPoints[1].position,
                rightPoints[1].position,
                rightPoints[1].position.distanceTo(leftPoints[1].position) * 2,
            ),
        );
        result.controlPositions.push(
            getExtendPoint(
                leftControlsPosition[1],
                rightControlsPosition[1],
                rightControlsPosition[1].distanceTo(leftControlsPosition[1]) * 2,
            ),
        );
    }
    return result;
}

/**
 * 获取lane的前驱、后继、左邻、右邻的lane id列表
 * @return 返回前驱后继左邻右邻lane id数组 [precursors, successors, leftNeighbors, rightNeighbors]
 */
export function getLaneRelations(laneId: string): [string[], string[], string[], string[]] {
    const precursors: string[] = [];
    const successors: string[] = [];
    const leftNeighbors: string[] = [];
    const rightNeighbors: string[] = [];

    const { lanes } = useManagerStore.getState().mapState;

    const lane = lanes[laneId];
    if (!lane) {
        console.warn(`getLaneRelations中id为${laneId}的lane没找到`);
        return [[], [], [], []];
    }
    const startPoints = getLaneStartPointIds(lane);
    const endPoints = getLaneEndPointIds(lane);
    const isSamePoints = (a: [string, string], b: [string, string]) => a[0] === b[0] && a[1] === b[1];

    Object.keys(lanes).forEach((iterId) => {
        const iterLane = lanes[iterId];
        if (iterId === laneId) {
            return;
        }
        if (isSamePoints(getLaneStartPointIds(iterLane), endPoints)) {
            successors.push(iterId);
        }
        if (isSamePoints(getLaneEndPointIds(iterLane), startPoints)) {
            precursors.push(iterId);
        }
        if ([iterLane.leftBoundaryId, iterLane.rightBoundaryId].includes(lane.leftBoundaryId)) {
            leftNeighbors.push(iterId);
        }
        if ([iterLane.leftBoundaryId, iterLane.rightBoundaryId].includes(lane.rightBoundaryId)) {
            rightNeighbors.push(iterId);
        }
    });
    return [precursors, successors, leftNeighbors, rightNeighbors];
}
/**
 * 根据stopLine的位置获取相关联的红绿灯的初始位置
 */
export function getTrafficLightInitPositionAndDeg(stopLineId: string) {
    const { stopLines, boundarys, points } = useManagerStore.getState().mapState;
    const stopLine = stopLines[stopLineId];

    const boundary = boundarys[stopLine?.boundaryId];
    if (!boundary) {
        return {};
    }

    const { pointIds } = boundary;
    const firstPoint = points[pointIds[0]];
    const secondPoint = points[pointIds[1]];
    if (!firstPoint || !secondPoint) {
        return {};
    }

    const center = new THREE.Vector3(
        (firstPoint.position.x + secondPoint.position.x) / 2,
        (firstPoint.position.y + secondPoint.position.y) / 2,
        mapElementZ[ThreeElementType.TrafficLight],
    );

    const deg = getRotateAngle(firstPoint.position, secondPoint.position);

    return {
        position: computedLeftBoundaryPointPosition(firstPoint.position, center, 7),
        deg,
    };
}
/**
 * 根据停止线计算道闸的中心点
 */
export function getBarrierGateCenterByStopLinePositions(points: THREE.Vector3[], distance = 6.5) {
    if (!points) {
        return null;
    }
    const firstPoint = points[0];
    const secondPoint = points[1];
    if (!firstPoint || !secondPoint) {
        return null;
    }
    const v1 = new THREE.Vector3().subVectors(firstPoint, secondPoint);
    const v1Center = getMiddlePosition(firstPoint, secondPoint);
    const v2 = new THREE.Vector3(v1.y, -v1.x).normalize().multiplyScalar(distance);
    const groudCenter = new THREE.Vector3(v2.x + v1Center.x, v2.y + v1Center.y, v1Center.z);
    return groudCenter;
}
/**
 * barrierGateCenter: 道闸中心点
 * points: 道闸下边缘的两个点，可以计算道闸的旋转
 * 根据道闸的停止线获取道闸的polygon的首位一致的五个点坐标
 * width: 道闸的width
 * length: 道闸的length
 */
export function getBarrierGatePolygonPointPositions(
    barrierGateCenter: THREE.Vector3,
    width: number,
    length: number,
    rotateZ: number = 0,
) {
    // 绘制一个长方形，放在groudCenter位置处，然后计算四个点的顶点世界坐标
    const planeGeometry = new THREE.PlaneGeometry(width, length);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const plane = new THREE.Mesh(planeGeometry, material);
    plane.position.copy(barrierGateCenter);
    plane.rotateZ(rotateZ);
    plane.updateMatrix();

    const result: THREE.Vector3[] = [];
    const positions = plane.geometry.getAttribute('position').array;
    for (let i = 0; i < positions.length; i += 3) {
        const worldPosition = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(
            plane.matrix,
        );
        result.push(worldPosition);
    }
    return [result[2], result[3], result[1], result[0]];
}

/**
 * 深拷贝group
 */
export function deepCopySprite(sprite: THREE.Sprite) {
    const object = new THREE.Sprite();
    // @ts-ignore
    object.material = sprite.material.clone();
    // @ts-ignore
    object.geometry = sprite.geometry.clone();
    return object;
}
/**
 * 更新因为点的移动而引起的相关联的线、groud、相对方向的更新
 * curPointNeedUpdate: 是否更新当前的点，当回退操作时，curPointNeedUpdate需要设置为true。更新当前点
 */
export function updateObjectsBecausePointsMove(pointIds: string[]) {
    if (!pointIds) {
        return;
    }
    let boundarys: Boundary[] = [];
    let grouds: Groud[] = [];
    pointIds.forEach((pId) => {
        const linkBoundarys = searchBoundarysFromPointId(pId);
        const point = searchPointByPointId(pId);
        if (!point) {
            return;
        }
        if (point.type === ThreeElementType.StopLinePoint) {
            const linkSign = searchSignByPointId(pId);
            if (linkSign) {
                updateSignIcon(linkSign.id);
            }
        }

        boundarys = unionBy([...boundarys, ...linkBoundarys], 'id');
    });
    boundarys.forEach((item) => {
        const linkGrouds = searchGroudFromBoundaryId(item.id);
        const linkSign = searchSignByBoundaryId(item.id);
        if (linkSign) {
            updateSignIcon(linkSign.id);
        }
        grouds = unionBy([...grouds, ...linkGrouds], 'id');
    });
    boundarys.forEach((item) => {
        updateBoundary(item.id);
    });
    grouds.forEach((item) => {
        if (item.type === ThreeElementType.LaneGroud || item.type === ThreeElementType.LaneCurveGroud) {
            const lane = searchLaneFromGroudId(item.id);
            updateArrow(lane.arrowId);
        }
        if (item.type === ThreeElementType.ParkingSpaceGroud) {
            const parkingSpace = searchParkingSpaceByGroudId(item.id);
            updateArrow(parkingSpace.arrowId);
        }
        updateGroud(item.id);
    });
}

export function deepCloneLineOrMesh(
    object: THREE.Mesh | THREE.Line,
    info: { position?: THREE.Vector3; rotation?: THREE.Euler; scale?: number; opacity?: number } = {},
) {
    const cloneGeomerty = object.geometry.clone();
    const cloneMaterial = (object.material as THREE.Material).clone();

    if (info.opacity) {
        cloneMaterial.opacity = info.opacity;
        cloneMaterial.transparent = true;
    }
    let newObject: THREE.Mesh | THREE.Line;
    if (object instanceof THREE.Mesh) {
        newObject = new THREE.Mesh(cloneGeomerty, cloneMaterial);
    } else {
        newObject = new THREE.Line(cloneGeomerty, cloneMaterial);
    }
    if (info.scale) {
        newObject.scale.set(info.scale, info.scale, info.scale);
    }
    if (info.position) {
        newObject.position.copy(info.position);
    } else {
        newObject.position.copy(object.position);
    }
    if (info.rotation) {
        newObject.rotation.copy(info.rotation);
    } else {
        newObject.rotation.copy(object.rotation);
    }
    return newObject;
}
export function getObjectCenter(object: THREE.Object3D) {
    const box3 = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    return box3.getCenter(center);
}
export function getPolygonCenter(positions: THREE.Vector3[]) {
    const box3 = new THREE.Box3().setFromPoints(positions);
    const center = new THREE.Vector3();
    return box3.getCenter(center);
}
