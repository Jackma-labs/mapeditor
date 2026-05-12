import { useManagerStore } from 'src/store';
import * as THREE from 'three';
import { AddPointCommand, DeletePointCommand, DragPointCommand } from 'src/command/PointCommand';
import {
    InterActiveType,
    MapElementType,
    OperationType,
    ThreeElementType,
    ThreeObject,
} from 'src/interface/commonInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import {
    AddParkingSpaceCommand,
    DeleteParkingSpaceCommand,
    UpdateParkingSpaceLengthCommand,
    UpdateParkingSpaceWidthCommand,
} from 'src/command/ParkingSpaceCommand';
import { computedLeftBoundaryPointPosition, getUpdatedFirstPointPosition } from 'src/utils/vectorUtil';
import { parkingSpaceBoundaryColor, parkingSpaceGroudColor, parkingSpaceGroudOpacity } from 'src/constant/color';
import { AddGroudCommand, DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { drawLine, drawShape } from 'src/object/basicObject';
import { objectSearch } from 'src/utils/search/objectSearch';
import { getShapeUvs } from 'src/object/groud';
import { updateBoundary } from 'src/object/boundary';
import { AddArrowCommand } from 'src/command/ArrowCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function getRemoveIrregularParkingSpaceCommand(crosswalkId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { parkingSpaces, boundarys } = newState;
    const parkingSpace = parkingSpaces[crosswalkId];
    const boundaryId = parkingSpace?.boundaryId;
    if (!boundaryId) {
        console.warn('getRemoveIrregularParkingSpaceCommand时当前绘制的parkingspace的boundary找不到');
        return [];
    }
    const pointIds = boundarys[boundaryId]?.pointIds || [];

    const action = [];
    action.push(new DeleteBoundaryCommand(boundaryId));
    pointIds?.forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteGroudCommand(parkingSpace.groudId));
    action.push(new DeleteParkingSpaceCommand(parkingSpace.id));
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}

export function addParkingSpaceMousemoveHandle(position: THREE.Vector3) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { parkingSpaces, points, boundarys } = newState;
    const parkingSpaceId = newState.currentDrawData.currentDrawingElementId;
    if (!parkingSpaceId) {
        return;
    }
    const parkingSpace = parkingSpaces[parkingSpaceId];
    if (!parkingSpace) {
        return;
    }
    const { boundaryId } = parkingSpace;
    const boundaryPointIds = boundarys[boundaryId]?.pointIds || [];
    if (boundaryPointIds.length === 0) {
        return;
    }
    const lastPointMesh = objectSearch(ThreeObject.Point, points[boundaryPointIds[boundaryPointIds.length - 1]]?.id);
    if (!lastPointMesh) {
        return;
    }
    // 如果绘制的是第三个点，则绘制的时候需要动态更新第一个点的坐标
    if (boundaryPointIds.length === 2) {
        const firstPointMesh = objectSearch(ThreeObject.Point, points[boundaryPointIds[0]]?.id);
        const secondPointMesh = objectSearch(ThreeObject.Point, points[boundaryPointIds[1]]?.id);
        if (!firstPointMesh || !secondPointMesh) {
            console.warn('绘制parkingSpace第三个点时，第一个点和第二个点找不到了');
            return;
        }
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
        const groud = drawShape(
            shapePositions,
            parkingSpaceGroudColor[InterActiveType.Default],
            parkingSpaceGroudOpacity,
        );
        const uvs = getShapeUvs(shapePositions, ThreeElementType.ParkingSpaceGroud);
        groud.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        groud.userData.type = ThreeElementType.ParkingSpaceGroud;
        PubSub.publishSync('addMouseMoveGroud', groud);
    }
    const { line } =
        drawLine([lastPointMesh.position, position], parkingSpaceBoundaryColor[InterActiveType.Default]) || {};
    PubSub.publishSync('addMouseMoveLine', line);
}
export function addParkingSpaceClickHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, points, parkingSpaces, boundarys, grouds, prossibleDrivingDirections } = newState;
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const pointId = `${getElementMaxIndex(points) + 1}`;
    const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const parkingSpaceId = `${getElementMaxIndex(parkingSpaces) + 1}`;
    const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;

    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.ParkingSpacePoint);
    // 如果currentDrawData.currentDrawingElementId说明绘制的第一个点
    if (!currentDrawData.currentDrawingElementId) {
        const cm2 = new SetCurrentDrawDataCommand(parkingSpaceId, MapElementType.ParkingSpace);
        const cm3 = new AddBoundaryCommand(
            boundaryId,
            ThreeElementType.ParkingSpaceBoundary,
            BoundaryOriginType.ParkingSpace,
            [],
            [],
        );
        const cm4 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        const cm5 = new AddGroudCommand(groudId, ThreeElementType.ParkingSpaceGroud);
        const cm6 = new AddParkingSpaceCommand(parkingSpaceId, boundaryId, groudId, arrowId);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6]);
    } else {
        const parkingSpace = parkingSpaces[currentDrawData.currentDrawingElementId];
        const boundary = boundarys[parkingSpace?.boundaryId];
        if (!boundary) {
            console.warn('addParkingSpaceClickHandle时当前绘制的parkingSpace的boundary找不到');
            return;
        }
        const pointIds = boundary.pointIds || [];
        // 绘制的是第二个点时
        if (pointIds.length === 1) {
            const firstPoint = points[pointIds[0]];
            const firstPointMesh = objectSearch(ThreeObject.Point, firstPoint.id);
            if (!firstPointMesh) {
                console.warn('addParkingSpaceClickHandle时当前绘制的parkingSpace的boundary的第一个点的mesg找不到');
                return;
            }
            const cm2 = new AddPointToBoundaryCommand(pointId, parkingSpace.boundaryId, true, false);
            const cm3 = new UpdateParkingSpaceWidthCommand(
                parkingSpace.id,
                Number(`${position.distanceTo(firstPointMesh.position).toFixed(2)}`),
            );
            useManagerStore.getState().addCommand([cm1, cm2, cm3]);
        } else if (pointIds.length === 2) {
            // 绘制的是第三个点时,绘制结束
            const firstPointMesh = objectSearch(ThreeObject.Point, points[pointIds[0]].id);
            const secondPointMesh = objectSearch(ThreeObject.Point, points[pointIds[1]].id);
            if (!firstPointMesh || !secondPointMesh) {
                console.warn('addParkingSpaceClickHandle时当前绘制的parkingSpace的boundary的第一个点和第二个点找不到');
                return;
            }
            const width = parkingSpace.width;
            // 人行横道的第一个点和第二个点组成的向量1和  第四个点和第三个点组成的向量2的夹角应小于90度，这样才能是一个闭合的区域
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
            const cm2 = new AddPointCommand(pointId1, resetPosition, ThreeElementType.ParkingSpacePoint);
            const cm3 = new DragPointCommand(boundary.pointIds[0]);
            const cm4 = new AddPointToBoundaryCommand(pointId, parkingSpace.boundaryId, true, false);
            const cm5 = new AddPointToBoundaryCommand(pointId1, parkingSpace.boundaryId, true, false);
            const cm6 = new AddPointToBoundaryCommand(pointIds[0], parkingSpace.boundaryId, true, false);
            const cm7 = new UpdateParkingSpaceLengthCommand(
                parkingSpace.id,
                Number(`${position.distanceTo(secondPointMesh.position).toFixed(2)}`),
            );
            const cm8 = new AddArrowCommand(arrowId, ThreeElementType.ParkingSpaceHeading);
            const cm9 = new UpdateGroudCommand(parkingSpace.groudId);
            const cm10 = new SetCurrentDrawDataCommand(null, null);
            const cm11 = new SetOperationTypeCommand(null);
            useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6, cm7, cm8, cm9, cm10, cm11]);
        }
    }
}
export function getDrawParkingSpacePromptData(e: MouseEvent, dom: HTMLElement) {
    const rect = dom.getBoundingClientRect();
    const state = useManagerStore.getState().mapState;
    const { currentDrawData, parkingSpaces, boundarys, operationType } = state;
    const { currentDrawingElementId } = currentDrawData;
    if (operationType === OperationType.Drawing && Object.keys(parkingSpaces).length === 0) {
        return {
            text: '单击确定起始点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(parkingSpaces).length === 1 &&
        boundarys[parkingSpaces[currentDrawingElementId]?.boundaryId]?.pointIds?.length === 1
    ) {
        return {
            text: '单击确定停车位宽度',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(parkingSpaces).length === 1 &&
        boundarys[parkingSpaces[currentDrawingElementId]?.boundaryId]?.pointIds?.length === 2
    ) {
        return {
            text: '单击确定长度和宽度',
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
