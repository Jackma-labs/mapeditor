// 根据比例t获取，在线段上的具体坐标
import { ThreeObject } from 'src/interface/commonInterFace';
import { objectSearch } from 'src/utils/search/objectSearch';
import { getExtendPoint } from 'src/utils/vectorUtil';
import * as THREE from 'three';

export function getPointPositionOnLineSegement(start: THREE.Vector3, end: THREE.Vector3, t: number) {
    const distance = start.distanceTo(end) * t;
    return getExtendPoint(start, end, distance);
}
export function getPointPositionOnCurve(
    start: THREE.Vector3,
    c1: THREE.Vector3,
    c2: THREE.Vector3,
    end: THREE.Vector3,
    t: number,
) {
    const p1 = getPointPositionOnLineSegement(start, c1, t);
    const p2 = getPointPositionOnLineSegement(c1, c2, t);
    const p3 = getPointPositionOnLineSegement(c2, end, t);

    const p4 = getPointPositionOnLineSegement(p1, p2, t);
    const p5 = getPointPositionOnLineSegement(p2, p3, t);

    const p6 = getPointPositionOnLineSegement(p4, p5, t);
    return p6;
}
/**
 * 根据点坐标，反算出t值
 */
export function getPointOnCurveT(
    position: THREE.Vector3,
    start: THREE.Vector3,
    c1: THREE.Vector3,
    c2: THREE.Vector3,
    end: THREE.Vector3,
) {
    let t: number = 0;
    for (let i = 0; i < 1000; i += 1) {
        const curTPosition = getPointPositionOnCurve(start, c1, c2, end, t); // 根据二次贝塞尔曲线公式求B(t)，其中point = B(t)
        if (curTPosition.distanceTo(position) < 0.5) {
            // 判断point和p点的距离是否在特定误差之内
            return t;
        }
        t += 0.001;
    }
    return null;
}
/**
 * 获取curve分割后的四个控制点
 */
export function getSpliteCurveControls(
    start: THREE.Vector3,
    c1: THREE.Vector3,
    c2: THREE.Vector3,
    end: THREE.Vector3,
    t: number,
) {
    const f = getPointPositionOnLineSegement(start, c1, t);
    const g = getPointPositionOnLineSegement(c1, c2, t);
    const h = getPointPositionOnLineSegement(c2, end, t);
    const i = getPointPositionOnLineSegement(f, g, t);
    const j = getPointPositionOnLineSegement(g, h, t);
    return [f, i, j, h];
}
export function getBezierVertexs(curveId: string) {
    const bezierMesh = objectSearch(ThreeObject.Boundary, curveId) as THREE.Line;
    if (!bezierMesh) {
        return null;
    }
    return bezierMesh.geometry.getAttribute('position').array;
}
/**
 * 获取beizier曲线的长度
 */
export function getBezierLength(curveId: string) {
    const vertexs = getBezierVertexs(curveId);
    if (!vertexs) {
        return 0;
    }
    let length = 0;
    for (let i = 0; i < vertexs.length - 3; i += 3) {
        const start = new THREE.Vector3(vertexs[i], vertexs[i + 1], vertexs[i + 2]);
        const end = new THREE.Vector3(vertexs[i + 3], vertexs[i + 4], vertexs[i + 5]);
        length += start.distanceTo(end);
    }
    return length;
}
/**
 * 获取曲线长度一半的位置
 */

export function getBezierHalfLengthPosition(curveId: string) {
    const vertexs = getBezierVertexs(curveId);
    const length = getBezierLength(curveId);
    if (!vertexs || length === 0) {
        return null;
    }
    let curLength = 0;
    let result: THREE.Vector3 = null;
    for (let i = 0; i < vertexs.length - 3; i += 3) {
        const start = new THREE.Vector3(vertexs[i], vertexs[i + 1], vertexs[i + 2]);
        const end = new THREE.Vector3(vertexs[i + 3], vertexs[i + 4], vertexs[i + 5]);
        curLength += start.distanceTo(end);
        if (curLength > length / 2) {
            result = start.clone();
            break;
        }
    }
    return result;
}
