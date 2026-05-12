import { AddPointCommand, DeletePointCommand } from 'src/command/PointCommand';
import { InterActiveType, MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddSpeedBumpCommand, DeleteSpeedBumpCommand } from 'src/command/SpeedBumpCommand';
import { getElementColorAndOpacity, speedBumpBoundaryColor } from 'src/constant/color';
import { AddGroudCommand, DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { useManagerStore } from 'src/store';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { getRectanglePoints } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { drawLine, drawShape } from 'src/object/basicObject';
import { GroudInteraction, getShapeUvs } from 'src/object/groud';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function getRemoveIrregularSpeedbumpCommand(speedbumpId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { speedBumps, boundarys } = newState;
    const speedBump = speedBumps[speedbumpId];
    const pointIds = boundarys[speedBump.boundaryId].pointIds;

    const action = [];
    action.push(new DeleteBoundaryCommand(speedBump.boundaryId));
    pointIds.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteGroudCommand(speedBump.groudId));
    action.push(new DeleteSpeedBumpCommand(speedBump.id));
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}
export function addSpeedBumpHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const { currentDrawData, points, speedBumps, boundarys, grouds } = state;
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.SpeedBumpPoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const speedBumpId = `${getElementMaxIndex(speedBumps) + 1}`;
        const groudId = `${getElementMaxIndex(grouds) + 1}`;
        const cm2 = new SetCurrentDrawDataCommand(speedBumpId, MapElementType.SpeedBump);
        const cm3 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.SpeedBumpBoundary,
            BoundaryOriginType.SpeedBump,
            [],
            [],
        );
        const cm4 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm5 = new AddGroudCommand(groudId, ThreeElementType.SpeedBumpGroud);
        const cm6 = new AddSpeedBumpCommand(speedBumpId, boundaryId, groudId);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6]);
    } else {
        // 绘制的是第二个点时，需要结束绘制
        const speedBump = speedBumps[state.currentDrawData.currentDrawingElementId];
        if (!speedBump) {
            console.warn('addSpeedBumpHandle时当前绘制的speedbump找不到了');
            return;
        }
        const cm2 = new AddPointToBoundaryCommand(pointId, speedBump.boundaryId, true, false);
        const cm3 = new UpdateGroudCommand(speedBump.groudId);
        const cm4 = new SetCurrentDrawDataCommand(null, null);
        const cm5 = new SetOperationTypeCommand(null);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5]);
    }
}

export function getDrawSpeedBumpPromptData(e: MouseEvent, dom: HTMLElement) {
    const rect = dom.getBoundingClientRect();
    const state = useManagerStore.getState().mapState;
    const { currentDrawData, speedBumps, boundarys, operationType } = state;
    const { currentDrawingElementId } = currentDrawData;
    if (operationType === OperationType.Drawing && Object.keys(speedBumps).length === 0) {
        return {
            text: '单击确定减速带起点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(speedBumps).length === 1 &&
        boundarys[speedBumps[currentDrawingElementId]?.boundaryId]?.pointIds?.length === 1
    ) {
        return {
            text: '单击确定减速带终点',
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

export function addSpeedBumpMousemoveHandle(position: THREE.Vector3) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { speedBumps, points, boundarys } = newState;
    const speedBumpId = newState.currentDrawData.currentDrawingElementId;
    if (!speedBumpId) {
        return;
    }
    const speedBump = speedBumps[speedBumpId];
    if (!speedBump) {
        return;
    }
    const { boundaryId } = speedBump;
    const boundaryPointIds = boundarys[boundaryId]?.pointIds || [];
    if (boundaryPointIds.length === 0) {
        return;
    }
    const lastPointPosition = points[boundaryPointIds[0]]?.position;
    if (!lastPointPosition) {
        return;
    }
    const { line } = drawLine([lastPointPosition, position], speedBumpBoundaryColor[InterActiveType.Default]) || {};
    PubSub.publishSync('addMouseMoveLine', line);
    const firstPoint = lastPointPosition;
    const secondPoint = position;
    const shapePositions = getRectanglePoints(firstPoint, secondPoint, 0.4);
    const { color, opacity } = getElementColorAndOpacity(ThreeElementType.SpeedBumpGroud, InterActiveType.Default);
    const groud = drawShape(shapePositions, color, opacity);
    const uvs = getShapeUvs(shapePositions, ThreeElementType.SpeedBumpGroud);
    groud.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
    groud.userData.type = ThreeElementType.SpeedBumpGroud;
    GroudInteraction(groud, InterActiveType.Default);

    PubSub.publishSync('addMouseMoveGroud', groud);
}
