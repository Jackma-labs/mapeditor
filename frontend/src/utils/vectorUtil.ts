import React from 'react';
import * as THREE from 'three';
import * as turf from '@turf/turf';
import { useManagerStore } from 'src/store';

export function getMiddlePosition(p1: THREE.Vector2 | THREE.Vector3, p2: THREE.Vector2 | THREE.Vector3) {
    return new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0);
}
export function transScreenPositionToWorld(event: React.MouseEvent | MouseEvent | THREE.Vector2): THREE.Vector2 {
    const { dom, camera } = useManagerStore.getState().mapState;
    // 鼠标移动位置 和 3D位置转换
    const pos = new THREE.Vector3();
    const domRect = dom.getBoundingClientRect();
    let clientX = null;
    let clientY = null;
    if (event instanceof THREE.Vector2) {
        clientX = event.x;
        clientY = event.y;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    // 屏幕坐标转归一化坐标
    const vecX = ((clientX - domRect.left) / dom.clientWidth) * 2 - 1;
    const vecY = -((clientY - domRect.top) / dom.clientHeight) * 2 + 1;
    const vec = new THREE.Vector3(vecX, vecY, 0);

    vec.unproject(camera);
    vec.sub(camera.position).normalize();

    const distance = camera.position.z / -vec.z;
    pos.copy(camera.position).add(vec.multiplyScalar(distance));

    return new THREE.Vector2(pos.x, pos.y);
}

export function computedLeftBoundaryPointPosition(p1: THREE.Vector3, p2: THREE.Vector3, width: number) {
    // 求法向量
    const x = p1.y - p2.y;
    const y = p2.x - p1.x;
    // 法向量axis
    const axis = new THREE.Vector2(x, y).normalize();
    // 计算左边界上的点坐标
    const x1 = axis.x * width + p2.x;
    const y1 = axis.y * width + p2.y;
    return new THREE.Vector3(x1, y1, p1.z);
}

// 计算多边形面积公示：S = 求和i->n∑(yi+yi+1)(xi-xi+1)/2等同于i->n∑(xi*yi+1 - xi+1*yi) / 2
export function getAreaByVertexs(vertexs: THREE.Vector2[]) {
    const n = vertexs.length;
    let a = 0.0;

    // eslint-disable-next-line no-plusplus
    for (let p = n - 1, q = 0; q < n; p = q++) {
        a += vertexs[p].x * vertexs[q].y - vertexs[q].x * vertexs[p].y;
    }
    return a * 0.5;
}

export function getShapeVertexsByTwoPoint(firstPoint: THREE.Vector3, endPoint: THREE.Vector3, width: number) {
    const p1 = computedLeftBoundaryPointPosition(firstPoint, endPoint, width);
    const p2 = computedLeftBoundaryPointPosition(firstPoint, endPoint, -width);
    const p3 = computedLeftBoundaryPointPosition(endPoint, firstPoint, width);
    const p4 = computedLeftBoundaryPointPosition(endPoint, firstPoint, -width);
    return [p1, p2, p3, p4, p1];
}

export function getResetPointPosition(
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    width: number,
    laneBaseLineIsRight: boolean,
): THREE.Vector3 {
    if (laneBaseLineIsRight) {
        return computedLeftBoundaryPointPosition(p1, p2, width);
    }
    return computedLeftBoundaryPointPosition(p1, p2, -width);
}

export function threeTransformUtm(vector: THREE.Vector2, basePoint: THREE.Vector2 = new THREE.Vector2(0, 0)) {
    const x = Number((vector.x + basePoint.x).toFixed(4));
    const y = Number((vector.y + basePoint.y).toFixed(4));
    return new THREE.Vector3(x, y, 0);
}
export function utmTransformThree(point: THREE.Vector2, basePoint: THREE.Vector2 = new THREE.Vector2(0, 0)) {
    const x = Number(point.x);
    const y = Number(point.y);
    const pointX = x - basePoint.x;
    const pointY = y - basePoint.y;
    return new THREE.Vector2(pointX, pointY);
}
export function getUpdatedFirstPointPosition(
    firstPoint: THREE.Vector3,
    secondPoint: THREE.Vector3,
    threePoint: THREE.Vector3,
    width: number,
) {
    let v1 = null;
    let v2 = null;
    v1 = new THREE.Vector2(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
    v2 = new THREE.Vector2(secondPoint.x - threePoint.x, secondPoint.y - threePoint.y);
    if (v1.angleTo(v2) === Math.PI / 2) {
        return firstPoint;
    }

    let resetPosition = computedLeftBoundaryPointPosition(threePoint, secondPoint, width);

    v1 = new THREE.Vector3(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y, 0);
    v2 = new THREE.Vector3(secondPoint.x - resetPosition.x, secondPoint.y - resetPosition.y, 0);
    let deg = v1.angleTo(v2);
    v1.cross(v2);
    if (v1.z < 0) {
        deg = -deg;
    }
    if (Math.abs(deg) > Math.PI / 2) {
        resetPosition = computedLeftBoundaryPointPosition(threePoint, secondPoint, -width);
    }
    return resetPosition;
}
export function getRotateAngle(firstPoint: THREE.Vector3 | THREE.Vector2, secondPoint: THREE.Vector3 | THREE.Vector2) {
    const v1 = new THREE.Vector3(1, 0, 0);
    const v2 = new THREE.Vector3(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y, 0);
    let deg = v1.angleTo(v2);
    v1.cross(v2);
    if (v1.z < 0) {
        deg = -deg;
    }
    return deg;
}
export function getAngleFromV1ToV2(v1: THREE.Vector3, v2: THREE.Vector3) {
    let deg = v1.angleTo(v2);
    v1.cross(v2);
    if (v1.z < 0) {
        deg = -deg;
    }
    return deg;
}

/**
 * 获取点到多线段的最短的点，以及线段
 */
export function getNearPointAndSegmentInLine(point: number[], segments: number[][]) {
    if (!point || !segments || point.length < 2 || segments.length === 0) {
        return null;
    }
    const ptVec = new THREE.Vector2(point[0], point[1]);
    let minDistance = Infinity;
    let closestPt = null;
    for (let i = 0; i < segments.length - 1; i += 1) {
        // start
        const start = new THREE.Vector2(segments[i][0], segments[i][1]);
        // 起点到 pt 点的距离
        const ptToStartDistance = ptVec.distanceTo(start);
        // 终点到 pt 的距离
        const stop = new THREE.Vector2(segments[i + 1][0], segments[i + 1][1]);
        // 终点到 pt 点的距离
        const ptToStopDistance = ptVec.distanceTo(stop);
        // perpendicular，pt到端点距离较长的那条
        const maxDistance = Math.max(ptToStartDistance, ptToStopDistance);

        // 当前线段的方向向量
        const direction = new THREE.Vector2(stop.x - start.x, stop.y - start.y).normalize();
        const normalVec1 = new THREE.Vector3(direction.y, -direction.x, 0);
        const normalVec2 = new THREE.Vector3(-direction.y, direction.x, 0);

        const pointTemp = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
        );
        pointTemp.position.set(ptVec.x, ptVec.y, 0);
        const perpendicularPt2 = pointTemp.clone().translateOnAxis(normalVec1, maxDistance).position;
        // 同上，反方向延伸
        const perpendicularPt1 = pointTemp.clone().translateOnAxis(normalVec2, maxDistance).position;

        // 将上述取到的两个点，与当前线段取交点
        const intersect = turf.lineIntersect(
            turf.lineString([
                [perpendicularPt1.x, perpendicularPt1.y],
                [perpendicularPt2.x, perpendicularPt2.y],
            ]),
            turf.lineString([
                [start.x, start.y],
                [stop.x, stop.y],
            ]),
        );

        let intersectPt = null;
        // 交点个数大于1，取第一个交点
        if (intersect.features.length > 0) {
            intersectPt = new THREE.Vector2(
                intersect.features[0].geometry.coordinates[0],
                intersect.features[0].geometry.coordinates[1],
            );
        }
        // 分别用起点、终点、垂直交点，与之前最短的距离进行对比，取最小的值
        if (ptToStartDistance < minDistance) {
            closestPt = start;
            minDistance = ptToStartDistance;
        }
        if (ptToStopDistance < minDistance) {
            closestPt = stop;
            minDistance = ptToStopDistance;
        }
        if (intersectPt && intersectPt.distanceTo(ptVec) < minDistance) {
            closestPt = intersectPt;
            minDistance = intersectPt.distanceTo(ptVec);
        }
    }
    return closestPt;
}
/**
 * 计算一个多线段的中心点
 */
export function getMiddlePoint(segments: number[][]) {
    if (segments.length < 2) {
        return null;
    }
    if (segments.length === 2) {
        return [(segments[0][0] + segments[1][0]) / 2, (segments[0][1] + segments[1][1]) / 2];
    }
    return segments[Math.floor(segments.length / 2)];
}

/**
 * 判断三个点的方向是否是顺时针
 */
export function getBooleanClockwise(points: number[][]) {
    const clockwiseRing = turf.lineString([...points, points[0]]);
    return turf.booleanClockwise(clockwiseRing);
}
/**
 * 获取世界坐标
 */
export function getPointWorldCoordinate(object: THREE.Object3D) {
    object.updateMatrixWorld();
    return object.position.clone().setFromMatrixPosition(object.matrixWorld);
}
/**
 * 获取垂足,且垂足在线段上，不能在延长线
 */
export function getHangingFeet(firstPoint: THREE.Vector3, endPoint: THREE.Vector3, point: THREE.Vector3) {
    const x1 = firstPoint.x;
    const y1 = firstPoint.y;
    const x2 = endPoint.x;
    const y2 = endPoint.y;
    const x0 = point.x;
    const y0 = point.y;

    const k = x1 === x2 ? 10000 : (y2 - y1) / (x2 - x1); // 当x1=x2时，给斜率设一个较大值10000
    const a = k;
    const b = -1;
    const c = y1 - k * x1;

    const px = (b * b * x0 - a * b * y0 - a * c) / (a * a + b * b);
    const py = (a * a * y0 - a * b * x0 - b * c) / (a * a + b * b);

    if (Math.min(x1, x2) < px && Math.max(x1, x2) > px && Math.min(y1, y2) < py && Math.max(y1, y2) > py) {
        return new THREE.Vector3(px, py, firstPoint.z);
    }
    return null;
}
/**
 * 获取一个点距离多个线段的最短垂足,不包括端点
 */
export function getNearPointToLine(lineSegmentPoints: THREE.Vector3[], point: THREE.Vector3) {
    let nearDistance = Infinity;
    let result = null;
    for (let i = 0; i < lineSegmentPoints.length - 1; i += 1) {
        const firstPoint = lineSegmentPoints[i];
        const endPoint = lineSegmentPoints[i + 1];
        const hangingFeet = getHangingFeet(firstPoint, endPoint, point);
        if (hangingFeet) {
            const curDistance = hangingFeet.distanceTo(point);
            if (curDistance < nearDistance) {
                nearDistance = Math.min(nearDistance, hangingFeet.distanceTo(point));
                result = hangingFeet;
            }
        }
    }
    return result;
}
/**
 * 沿着点一到点二的方向，延生具体distance,计算延生点
 */
export function getExtendPoint(point1: THREE.Vector3, point2: THREE.Vector3, distance: number) {
    if (distance === 0) {
        return point1;
    }
    const dir = new THREE.Vector3().subVectors(point2, point1);
    dir.normalize();
    return new THREE.Vector3().addVectors(point1, dir.multiplyScalar(distance));
}
/**
 * 获取mesh的世界坐标
 */
export function getMeshWorldCoordinate(mesh: THREE.Object3D) {
    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    return position;
}
/**
 * 世界坐标转屏幕坐标
 */
export function worldPositionToScreen(threePosition: THREE.Vector3) {
    const { camera, dom } = useManagerStore.getState().mapState;
    const clientPosition = threePosition.clone().project(camera);

    return new THREE.Vector2(
        ((clientPosition.x + 1) / 2) * dom.clientWidth + dom.getBoundingClientRect().left,
        ((-clientPosition.y + 1) / 2) * dom.clientHeight + dom.getBoundingClientRect().top,
    );
}
/**
 * 通过两个点坐标，以及width，计算出一个长方形的四个顶点，主要用于speedGroud
 */
export function getRectanglePoints(firstPoint: THREE.Vector3, secondPoint: THREE.Vector3, width: number) {
    const positions: THREE.Vector2[] = [];
    const deg = getRotateAngle(firstPoint, secondPoint);
    positions.push(new THREE.Vector2(firstPoint.x - width * Math.sin(deg), firstPoint.y + width * Math.cos(deg)));
    positions.push(new THREE.Vector2(secondPoint.x - width * Math.sin(deg), secondPoint.y + width * Math.cos(deg)));
    positions.push(new THREE.Vector2(secondPoint.x + width * Math.sin(deg), secondPoint.y - width * Math.cos(deg)));
    positions.push(new THREE.Vector2(firstPoint.x + width * Math.sin(deg), firstPoint.y - width * Math.cos(deg)));
    positions.push(new THREE.Vector2(firstPoint.x - width * Math.sin(deg), firstPoint.y + width * Math.cos(deg)));
    return positions;
}
export function vector2TransTpVector3(vector2: THREE.Vector2, z = 0) {
    return new THREE.Vector3(vector2.x, vector2.y, z);
}
export function vector3TransTpVector2(vector3: THREE.Vector3) {
    if (!vector3) {
        return new THREE.Vector2(0, 0);
    }
    return new THREE.Vector2(vector3.x, vector3.y);
}
