import { UpdateBarrierSizeCommand } from 'src/command/BarrierGateCommand';
import { UpdateBoundaryCommand } from 'src/command/BoundaryCommand';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { DragPointCommand } from 'src/command/PointCommand';
import { ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { getBarrierGatePolygonPointPositions, getPolygonCenter } from 'src/utils/geometryUtil';
import { searchBarrierGateFromPointId } from 'src/utils/search/barrierGateSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getExtendPoint, getRotateAngle } from 'src/utils/vectorUtil';
import * as THREE from 'three';

export function updateBarrierGateSize(id: string, width: number, length: number) {
    const { mapState, addCommand } = useManagerStore.getState();
    const barrierGate = mapState.barrierGates[id];
    if (!barrierGate) {
        return;
    }
    const { boundaryId, groudId } = barrierGate;
    const points = searchPointsFromBoundaryId(boundaryId);
    if (points.length < 3) {
        return;
    }
    const barrierGateCenter = getPolygonCenter(points.map((item) => item.position));
    const rotateZ = getRotateAngle(points[0].position, points[1].position);
    const newPolygonPositions = getBarrierGatePolygonPointPositions(barrierGateCenter, width, length, rotateZ);

    // 去更新点、polygon所在的boundary、还有groud
    const action = [];
    newPolygonPositions.forEach((item, index) => {
        const pointMesh = objectSearch(ThreeObject.Point, points[index].id);
        if (pointMesh) {
            pointMesh.position.set(item.x, item.y, item.z);
            action.push(new DragPointCommand(points[index].id));
        }
    });
    action.push(new UpdateBoundaryCommand(boundaryId));
    action.push(new UpdateGroudCommand(groudId));
    action.push(new UpdateBarrierSizeCommand(barrierGate.id, width, length));
    addCommand(action);
}
/**
 * 穿object主要是为了更新除了拖动点，剩下需要更新的点Id
 */
export function dragResizeBarrierGateSize(pointId: string, object: any) {
    if (!pointId) {
        return;
    }
    const barrierGate = searchBarrierGateFromPointId(pointId);
    if (!barrierGate) {
        return;
    }
    const points = searchPointsFromBoundaryId(barrierGate.boundaryId);
    if (!points.length) {
        return;
    }
    // 去获取拖动点的index
    const pointIndex = points.slice(0, points.length - 1).findIndex((item) => item.id === pointId);
    const dragPointMesh = objectSearch(ThreeObject.Point, points[pointIndex].id);
    if (!dragPointMesh) {
        return;
    }
    // 确定拖动的点的对角线的id
    const diagonalPointIndex = (pointIndex + 2) % 4;
    const resetNeedUpdatePointIndexs = [(pointIndex + 4 - 1) % 4, (pointIndex + 4 + 1) % 4];
    const dragPointPosition = dragPointMesh.position;
    const diagonalLength = dragPointMesh.position.distanceTo(points[diagonalPointIndex].position);

    resetNeedUpdatePointIndexs.forEach((pIndex) => {
        const v1 = new THREE.Vector3().subVectors(points[diagonalPointIndex].position, points[pIndex].position);
        const v2 = new THREE.Vector3().subVectors(points[diagonalPointIndex].position, dragPointPosition);
        const angle = v1.angleTo(v2);
        const length = diagonalLength * Math.cos(angle);
        const newPosition = getExtendPoint(points[diagonalPointIndex].position, points[pIndex].position, length);
        const pointMesh = objectSearch(ThreeObject.Point, points[pIndex].id);
        pointMesh?.position?.copy(newPosition);
    });
    object.userData.pointIds = [
        pointId,
        points[resetNeedUpdatePointIndexs[0]].id,
        points[resetNeedUpdatePointIndexs[1]].id,
    ];
}
/**
 * 根据拖动点的Id,拖动点的新的坐标，去获取width和length
 */
export function getBarrierGateCurrentWidthAndLength(pointId: string, newPosition: THREE.Vector3) {
    const barrierGate = searchBarrierGateFromPointId(pointId);
    if (!barrierGate) {
        return { width: 0, length: 0 };
    }
    const points = searchPointsFromBoundaryId(barrierGate.boundaryId);
    const dragPointIndex = points.findIndex((item) => item.id === pointId);
    const beforePointIndex = (dragPointIndex + 4 - 1) % 4;
    const nextPointIndex = (dragPointIndex + 4 + 1) % 4;

    const beforePointMesh = objectSearch(ThreeObject.Point, points[beforePointIndex].id);
    const nextPointMesh = objectSearch(ThreeObject.Point, points[nextPointIndex].id);
    if (!beforePointMesh || !nextPointMesh) {
        return { width: 0, length: 0 };
    }
    return {
        width: newPosition.distanceTo(beforePointMesh.position),
        length: newPosition.distanceTo(nextPointMesh.position),
    };
}
