import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddCrosswalkCommand, DeleteCrosswalkCommand } from 'src/command/CrosswalkCommand';
import { AddGroudCommand, DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { AddPointCommand, DeletePointCommand, DragPointCommand } from 'src/command/PointCommand';
import { crosswalkBoundaryColor, laneGroudOpacity } from 'src/constant/color';
import {
    InterActiveType,
    MapElementType,
    OperationType,
    ThreeElementType,
    ThreeObject,
} from 'src/interface/commonInterFace';
import { computedLeftBoundaryPointPosition, getUpdatedFirstPointPosition } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { useManagerStore } from 'src/store';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { drawLine, drawShape } from 'src/object/basicObject';
import { objectSearch } from 'src/utils/search/objectSearch';
import { updateBoundary } from 'src/object/boundary';
import { GroudInteraction, getShapeUvs } from 'src/object/groud';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function getRemoveIrregularCrosswalkCommand(crosswalkId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { crosswalks, boundarys } = newState;
    const crosswalk = crosswalks[crosswalkId];
    if (!crosswalk) {
        console.warn('getRemoveIrregularCrosswalkCommand时当前绘制的crosswalk找不到');
        return [];
    }
    const { boundaryId } = crosswalk;
    if (!boundarys[boundaryId]) {
        console.warn('getRemoveIrregularCrosswalkCommand时当前绘制的crosswalk的boundary找不到');
        return [];
    }
    const pointIds = boundarys[boundaryId].pointIds;

    const action = [];
    action.push(new DeleteBoundaryCommand(crosswalk.boundaryId));
    pointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteGroudCommand(crosswalk.groudId));
    action.push(new DeleteCrosswalkCommand(crosswalk.id));
    action.push(new SetOperationTypeCommand(null));
    action.push(new SetCurrentDrawDataCommand(null, null));
    return action;
}
export function addCrosswalkClickHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, points, crosswalks, boundarys, grouds } = newState;
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const pointId = `${getElementMaxIndex(points) + 1}`;
    const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const crosswalkId = `${getElementMaxIndex(crosswalks) + 1}`;

    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.CrosswalkPoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        const cm2 = new SetCurrentDrawDataCommand(crosswalkId, MapElementType.Crosswalk);
        const cm3 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.CrosswalkBoundary,
            BoundaryOriginType.Crosswalk,
            [],
            [],
        );
        const cm4 = new AddGroudCommand(groudId, ThreeElementType.CrosswalkGroud);
        const cm5 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm6 = new AddCrosswalkCommand(crosswalkId, boundaryId, groudId);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6]);
    } else {
        const crosswalk = crosswalks[currentDrawData.currentDrawingElementId];
        if (!crosswalk) {
            console.warn('addCrosswalkClickHandle时当前绘制的crosswalk找不到');
            return;
        }
        const boundary = boundarys[crosswalk.boundaryId];
        if (!boundary) {
            console.warn('addCrosswalkClickHandle时当前绘制的crosswalk的boundary找不到');
            return;
        }
        const pointIds = boundary.pointIds;
        // 绘制的是第二个点时
        if (pointIds.length === 1) {
            const cm2 = new AddPointToBoundaryCommand(pointId, crosswalk.boundaryId, true, false);
            useManagerStore.getState().addCommand([cm1, cm2]);
        } else if (pointIds.length === 2) {
            // 绘制的是第三个点时,绘制结束
            if (!points[pointIds[0]]?.position || !points[pointIds[1]]?.position) {
                console.warn('addCrosswalkClickHandle时当前绘制的crosswalk的boundary的第一个点和第二个点找不到');
                return;
            }
            const width = points[pointIds[0]].position.distanceTo(points[pointIds[1]].position);
            // 人行横道的第一个点和第二个点组成的向量1和  第四个点和第三个点组成的向量2的夹角应小于90度，这样才能是一个闭合的区域
            const firstPointMesh = objectSearch(ThreeObject.Point, points[pointIds[0]].id);
            const secondPointMesh = objectSearch(ThreeObject.Point, points[pointIds[1]].id);
            let resetPosition = computedLeftBoundaryPointPosition(secondPointMesh.position, position, width);
            const v1 = new THREE.Vector2(resetPosition.x - position.x, resetPosition.y - position.y);
            const v2 = new THREE.Vector2(
                firstPointMesh.position.x - secondPointMesh.position.x,
                firstPointMesh.position.y - secondPointMesh.position.y,
            );
            if (v1.angleTo(v2) > Math.PI / 2) {
                resetPosition = computedLeftBoundaryPointPosition(secondPointMesh.position, position, -width);
            }
            const pointId1 = `${getElementMaxIndex(points) + 2}`;
            const cm2 = new AddPointCommand(pointId1, resetPosition, ThreeElementType.CrosswalkPoint);
            const cm3 = new DragPointCommand(boundary.pointIds[0]);
            const cm4 = new AddPointToBoundaryCommand(pointId, crosswalk.boundaryId, true, false);
            const cm5 = new AddPointToBoundaryCommand(pointId1, crosswalk.boundaryId, true, false);
            const cm6 = new AddPointToBoundaryCommand(pointIds[0], crosswalk.boundaryId, true, false);
            const cm7 = new UpdateGroudCommand(crosswalk.groudId);
            const cm8 = new SetOperationTypeCommand(null);
            const cm9 = new SetCurrentDrawDataCommand(null, null);
            useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6, cm7, cm8, cm9]);
        }
    }
}

export function getDrawCrosswalkPromptData(e: MouseEvent, dom: HTMLElement) {
    const rect = dom.getBoundingClientRect();
    const state = useManagerStore.getState().mapState;
    const { currentDrawData, crosswalks, boundarys, operationType } = state;
    const { currentDrawingElementId } = currentDrawData;
    if (operationType === OperationType.Drawing && Object.keys(crosswalks).length === 0) {
        return {
            text: '单击确定人行道宽度起点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(crosswalks).length === 1 &&
        boundarys[crosswalks[currentDrawingElementId]?.boundaryId]?.pointIds?.length === 1
    ) {
        return {
            text: '单击确定人行道宽度终点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(crosswalks).length === 1 &&
        boundarys[crosswalks[currentDrawingElementId]?.boundaryId]?.pointIds?.length === 2
    ) {
        return {
            text: '单击确定人行道长度和方向',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    return {
        text: '',
        left: -10,
        top: -10,
    };
}

export function addCrosswalkMousemoveHandle(position: THREE.Vector3) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { crosswalks, points, boundarys } = newState;
    const crosswalkId = newState.currentDrawData.currentDrawingElementId;
    if (!crosswalkId) {
        return;
    }
    const crosswalk = crosswalks[crosswalkId];
    if (!crosswalk) {
        return;
    }
    const { boundaryId } = crosswalk;
    const boundaryPointIds = boundarys[boundaryId]?.pointIds || [];
    if (boundaryPointIds.length === 0) {
        return;
    }
    const lastPointPosition = points[boundaryPointIds[boundaryPointIds.length - 1]]?.position;
    if (!lastPointPosition) {
        return;
    }
    // 如果绘制的是第三个点，则绘制的时候需要动态更新第一个点的坐标
    if (boundaryPointIds.length === 2) {
        const firstPoint = points[boundaryPointIds[0]];
        const secondPoint = points[boundaryPointIds[1]];
        if (!firstPoint || !secondPoint) {
            console.warn('绘制crosswalk第三个点时，第一个点和第二个点找不到了');
            return;
        }
        const firstPointMesh = objectSearch(ThreeObject.Point, firstPoint.id);
        const secondPointMesh = objectSearch(ThreeObject.Point, secondPoint.id);
        const width = firstPointMesh.position.distanceTo(secondPointMesh.position);
        // 鼠标移动过程中，要不断更新第一个点的位置，让拉出来的人行横道是个矩形，记得只更新mesh.position，不更新PointElement的position，
        // 只有真的点击了才能更改PointElement的position，方便后续回退
        const actualFirstPointPosition = getUpdatedFirstPointPosition(
            firstPointMesh.position,
            secondPointMesh.position,
            position,
            width,
        );

        firstPointMesh.position.x = actualFirstPointPosition.x;
        firstPointMesh.position.y = actualFirstPointPosition.y;
        updateBoundary(boundaryId);

        let resetPosition = computedLeftBoundaryPointPosition(secondPointMesh.position, position, width);
        const v1 = new THREE.Vector2(resetPosition.x - position.x, resetPosition.y - position.y);
        const v2 = new THREE.Vector2(
            firstPointMesh.position.x - secondPointMesh.position.x,
            firstPointMesh.position.y - secondPointMesh.position.y,
        );
        if (v1.angleTo(v2) > Math.PI / 2) {
            resetPosition = computedLeftBoundaryPointPosition(secondPointMesh.position, position, -width);
        }
        const shapePositions = [
            new THREE.Vector2(firstPointMesh.position.x, firstPointMesh.position.y),
            new THREE.Vector2(secondPointMesh.position.x, secondPointMesh.position.y),
            new THREE.Vector2(position.x, position.y),
            new THREE.Vector2(resetPosition.x, resetPosition.y),
            new THREE.Vector2(firstPointMesh.position.x, firstPointMesh.position.y),
        ];
        const groud = drawShape(shapePositions, new THREE.Color(0xffffff), laneGroudOpacity);
        const uvs = getShapeUvs(shapePositions, ThreeElementType.CrosswalkGroud);
        groud.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
        groud.userData.type = ThreeElementType.CrosswalkGroud;
        GroudInteraction(groud, InterActiveType.Default);
        PubSub.publishSync('addMouseMoveGroud', groud);
    }
    const { line } = drawLine([lastPointPosition, position], crosswalkBoundaryColor[InterActiveType.Default]) || {};
    PubSub.publishSync('addMouseMoveLine', line);
}
