import { AddBoundaryCommand, AddPointToBoundaryCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddPointCommand, DeletePointCommand } from 'src/command/PointCommand';
import { InterActiveType, MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { LaneBoundaryType } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { laneBoundaryColor, roadBoundaryColor } from 'src/constant/color';
import { getElementMaxIndex, getPickupObject } from 'src/utils/threeObjectUtil';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { searchBoundarysByOrigin, searchBoundarysFromPointId } from 'src/utils/search/boundarySearch';
import PubSub from 'pubsub-js';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { drawLine } from 'src/object/basicObject';
import { mapElementZ } from 'src/constant/mapElementZ';
import { vector2TransTpVector3 } from 'src/utils/vectorUtil';

export function addStraightLineMousemoveHandle(position: THREE.Vector2) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const { boundarys, points, currentDrawData } = state;
    const boundaryId = currentDrawData.currentDrawingElementId;
    if (!boundaryId) {
        return;
    }
    const pointIds = boundarys[boundaryId]?.pointIds;
    if (!pointIds || pointIds.length === 0) {
        return;
    }

    const lastPointPosition = points[pointIds[pointIds.length - 1]]?.position;
    if (!lastPointPosition) {
        return;
    }
    const lineColor =
        currentDrawData.drawElementType === MapElementType.StraightLine
            ? laneBoundaryColor[InterActiveType.Default]
            : roadBoundaryColor[InterActiveType.Default];
    const { line } = drawLine([lastPointPosition, vector2TransTpVector3(position)], lineColor) || {};
    line.position.z = mapElementZ[ThreeElementType.LaneBoundary];
    PubSub.publishSync('addMouseMoveLine', line);
}

export function getRemoveIrregularStraightLineCommand(boundaryId: string) {
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;
    const boundary = boundarys[boundaryId];
    if (!boundary) {
        console.warn('getRemoveIrregularStraightLineCommand时当前绘制的boundary找不到');
        return [];
    }
    const pointIds = boundary.pointIds;

    const action = [];
    action.push(new DeleteBoundaryCommand(boundaryId));
    pointIds?.forEach((pId) => {
        const linkBoundarys = searchBoundarysFromPointId(pId);
        if (linkBoundarys.length > 1) {
            return;
        }
        action.push(new DeletePointCommand(pId));
    });
    action.push(new SetCurrentDrawDataCommand(null, null));
    action.push(new SetOperationTypeCommand(null));
    return action;
}

export function addStraightLineClickHandle(
    position: THREE.Vector2,
    e: React.MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    const { mapState, addCommand } = useManagerStore.getState();
    const { boundarys, currentDrawData, points } = mapState;
    const { currentDrawingElementId, drawElementType } = currentDrawData;

    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    if (!drawElementType) {
        return;
    }
    const pointType =
        drawElementType === MapElementType.StraightLine
            ? ThreeElementType.LanePoint
            : ThreeElementType.RoadBoundaryPoint;
    const boundaryType =
        drawElementType === MapElementType.StraightLine ? ThreeElementType.LaneBoundary : ThreeElementType.RoadBoundary;
    const boundaryOriginType = MapElementType.StraightLine
        ? BoundaryOriginType.StraightLine
        : BoundaryOriginType.RoadBoundary;
    const pointId = `${getElementMaxIndex(points) + 1}`;
    const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const cm1 = new AddPointCommand(pointId, vector2TransTpVector3(position, mapElementZ[pointType]), pointType);
    // 如果该lane还没创建，则先创建lane数据
    if (!currentDrawingElementId) {
        const cm2 = new SetCurrentDrawDataCommand(boundaryId, drawElementType);
        const cm3 = new AddBoundaryCommand(boundaryId, boundaryType, boundaryOriginType, [], [], {
            type: LaneBoundaryType.WHITESOLId,
        });
        const cm4 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        addCommand([cm1, cm2, cm3, cm4]);
    } else {
        const pointIds = boundarys[currentDrawingElementId]?.pointIds || [];
        if (pointIds.length >= 1) {
            // 线的连接
            const pointPick = getPickupObject(e, camera, dom, scene, [
                drawElementType === MapElementType.StraightLine
                    ? ThreeElementType.LanePoint
                    : ThreeElementType.RoadBoundaryPoint,
            ]);
            if (pointPick && !pointIds.includes(pointPick.userData.id)) {
                const cm2 = new AddPointToBoundaryCommand(pointPick.userData.id, currentDrawingElementId, true, false);
                const cm3 = new SetOperationTypeCommand(null);
                const cm4 = new SetCurrentDrawDataCommand(null, null);
                addCommand([cm2, cm3, cm4]);
            } else {
                const cm2 = new AddPointToBoundaryCommand(pointId, currentDrawingElementId, true, false);
                addCommand([cm1, cm2]);
            }
        }
    }
}

/**
 * 获取绘制junction的提示信息
 */

export function getDrawStraightLinePromptData(
    e: MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    const rect = dom.getBoundingClientRect();

    const state = useManagerStore.getState().mapState;
    const { currentDrawData, boundarys, operationType } = state;
    const { currentDrawingElementId, drawElementType } = currentDrawData;
    const pointIds = boundarys[currentDrawingElementId]?.pointIds || [];
    const straightLines = searchBoundarysByOrigin(BoundaryOriginType.StraightLine);
    const roadBoundarys = searchBoundarysByOrigin(BoundaryOriginType.RoadBoundary);

    if (
        ((Object.keys(straightLines).length === 0 && drawElementType === MapElementType.StraightLine) ||
            (Object.keys(roadBoundarys).length === 0 && drawElementType === MapElementType.RoadBoundary)) &&
        pointIds.length === 0
    ) {
        return {
            text: '单击确定起始点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (operationType === OperationType.Drawing && pointIds.length >= 1) {
        let object = null;
        if (drawElementType === MapElementType.StraightLine) {
            object = getPickupObject(e, camera, dom, scene, [ThreeElementType.LanePoint]);
        } else {
            object = getPickupObject(e, camera, dom, scene, [ThreeElementType.RoadBoundaryPoint]);
        }
        if (object && !pointIds.includes(object.userData.id)) {
            return {
                text: '链接线',
                left: e.clientX - rect.left + 10,
                top: e.clientY - rect.top + 10,
            };
        }
        if (
            (Object.keys(straightLines).length === 1 && pointIds.length === 1) ||
            (Object.keys(roadBoundarys).length === 1 && pointIds.length === 1)
        ) {
            return {
                text: '至少绘制两个点',
                left: e.clientX - rect.left + 10,
                top: e.clientY - rect.top + 10,
            };
        }
    }
    if (
        operationType === OperationType.Drawing &&
        pointIds.length >= 2 &&
        (Object.keys(straightLines).length === 1 || Object.keys(roadBoundarys).length === 1)
    ) {
        return {
            text: '双击或enter键或esc结束绘制',
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
