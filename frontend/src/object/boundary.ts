import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { searchPointByPointId, searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getElementColorAndOpacity, laneBoundaryColor } from 'src/constant/color';
import { InterActiveType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { contrlPointSearch, objectSearch } from 'src/utils/search/objectSearch';
import * as THREE from 'three';
import { mapElementZ } from 'src/constant/mapElementZ';
import { Line2 } from 'three/examples/jsm/lines/Line2';
import { drawBezierCurve3, drawLine } from './basicObject';

/**
 * 绘制各种boundary
 */
export function drawBoundary(boundaryId: string, interActiveType: InterActiveType = InterActiveType.Default) {
    const boundary = searchBoundaryByBoundaryId(boundaryId);
    if (!boundary) {
        return null;
    }
    const { type, attr } = boundary;
    const pointIds = searchPointIdsFromBoundaryId(boundaryId);
    const positions: THREE.Vector3[] = [];
    pointIds.forEach((id) => {
        const pointMesh = objectSearch(ThreeObject.Point, id);
        const pointPosition = pointMesh?.position || searchPointByPointId(id)?.position;
        if (pointPosition) {
            positions.push(new THREE.Vector3(pointPosition.x, pointPosition.y, mapElementZ[boundary.type]));
        }
    });
    if (positions.length < 2) {
        if (pointIds.length >= 2) {
            console.warn(`Boundary ${boundaryId} has ${positions.length} drawable points`);
        }
        return null;
    }

    let lineMesh: { line: THREE.Line; line2: Line2 } = null;
    if (
        type === ThreeElementType.LaneCurveBoundary ||
        (type === ThreeElementType.RoadBoundary && boundary.controlsPosition?.length === 2)
    ) {
        const { controlsPosition } = boundary;
        const firstControlPointMesh = contrlPointSearch(ThreeObject.ControlPoint, boundaryId, true);
        const secondControlPointMesh = contrlPointSearch(ThreeObject.ControlPoint, boundaryId, false);
        if (!controlsPosition || controlsPosition.length < 2) {
            console.warn(`CurveBoundary ${boundaryId} has less than 2 controls`);
            return null;
        }
        lineMesh = drawBezierCurve3(
            positions[0],
            firstControlPointMesh?.position?.clone() || controlsPosition[0],
            secondControlPointMesh?.position?.clone() || controlsPosition[1],
            positions[1],
            laneBoundaryColor[interActiveType],
            attr?.type,
        );
    } else {
        const { color } = getElementColorAndOpacity(boundary.type, interActiveType);
        lineMesh = drawLine(positions, color, attr?.type);
    }

    if (lineMesh?.line) {
        lineMesh.line.userData = {
            id: boundaryId,
            type,
            interActiveType,
        };
        lineMesh.line.position.z = mapElementZ[boundary.type];
        lineMesh.line.name = `${ThreeObject.Boundary}`;
    }
    if (lineMesh?.line2) {
        lineMesh.line2.userData = {
            id: boundaryId,
            type: ThreeElementType.Line2,
            interActiveType,
        };
        lineMesh.line2.position.z = mapElementZ[boundary.type];
        lineMesh.line2.name = `${ThreeObject.Line2}`;
    }

    return lineMesh;
}

/**
 * 更新boundary,需要去diff点的世界坐标和线的顶点坐标，都一致，则不更新
 */
export function updateBoundary(boundaryId: string) {
    const boundary = searchBoundaryByBoundaryId(boundaryId);
    const boundaryMesh = objectSearch(ThreeObject.Boundary, boundaryId);
    const line2Mesh = objectSearch(ThreeObject.Line2, boundaryId);
    if (!boundary || !boundaryMesh || !line2Mesh) {
        return;
    }
    const { line, line2 } = drawBoundary(boundary.id, boundaryMesh.userData.interActiveType) || {};
    if (!line || !line2) {
        console.warn('updateBoundary newline has no mesh');
        return;
    }
    (boundaryMesh as THREE.Line).geometry = line.geometry;
    (boundaryMesh as THREE.Line).geometry.getAttribute('position').needsUpdate = true;
    (boundaryMesh as THREE.Line).material = line.material;
    (boundaryMesh as THREE.Line).computeLineDistances();
    (line2Mesh as Line2).geometry = line2.geometry;
    (line2Mesh as Line2).geometry.getAttribute('position').needsUpdate = true;
    (line2Mesh as Line2).material = line2.material;
    (line2Mesh as Line2).computeLineDistances();
}

// 线的交互
export function BoundaryInteraction(boundary: THREE.Line, type: InterActiveType) {
    const elementType = boundary.userData.type;
    if (!elementType) {
        return;
    }

    const { color } = getElementColorAndOpacity(elementType, type);
    const material = boundary.material;
    if (!material) {
        return;
    }
    // @ts-ignore
    material.color.set(color);
    (material as THREE.Material).needsUpdate = true;
    boundary.userData.interActiveType = type;

    const line2 = objectSearch(ThreeObject.Line2, boundary.userData.id);
    if (!line2) {
        return;
    }
    const material2 = (line2 as Line2).material;
    material2.color.set(color);
    (material2 as THREE.Material).needsUpdate = true;
    line2.userData.interActiveType = type;
    const boundaryObject = searchBoundaryByBoundaryId(boundary.userData.id);
    if (
        boundaryObject?.type === ThreeElementType.LaneCurveBoundary ||
        (boundaryObject?.type === ThreeElementType.RoadBoundary && boundaryObject?.controlsPosition?.length === 2)
    ) {
        PubSub.publish('disableModify', boundaryObject.id);
    }
}
