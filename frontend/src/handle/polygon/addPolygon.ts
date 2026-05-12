import { junctionBoundaryColor } from 'src/constant/color';
import { mapElementZ } from 'src/constant/mapElementZ';
import { Area } from 'src/interface/areaInterFace';
import { InterActiveType, MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { Junction } from 'src/interface/junctionInterFace';
import { drawLine } from 'src/object/basicObject';
import { useManagerStore } from 'src/store';
import { getPickupObject } from 'src/utils/threeObjectUtil';
import { vector2TransTpVector3 } from 'src/utils/vectorUtil';

/**
 * 添加截点的鼠标移动事件处理器函数。
 *
 * @param position - 截点位置。
 */
export function addPolygonMousemoveHandle(position: THREE.Vector2, mapElementType: MapElementType) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { boundarys, points, junctions, areas } = newState;
    const currentDrawingElementId = newState.currentDrawData.currentDrawingElementId;
    if (!currentDrawingElementId) {
        return;
    }
    let mapElement: Junction | Area = null;
    if (mapElementType === MapElementType.Junction) {
        mapElement = junctions[currentDrawingElementId];
    } else {
        mapElement = areas[currentDrawingElementId];
    }
    if (!mapElement) {
        return;
    }
    const boundaryId = mapElement.boundaryId;
    const pointIds = boundarys[boundaryId]?.pointIds || [];
    const lastBoundaryPointPosition = points[pointIds[pointIds.length - 1]]?.position;
    if (!lastBoundaryPointPosition) {
        return;
    }

    const { line } =
        drawLine(
            [
                lastBoundaryPointPosition,
                vector2TransTpVector3(position, mapElementZ[ThreeElementType.JunctionBoundary]),
            ],
            junctionBoundaryColor[InterActiveType.Default],
        ) || {};
    PubSub.publishSync('addMouseMoveLine', line);
}

/**
 * 获取绘制junction的提示信息
 */

export function getDrawPolygonPromptData(
    e: MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    const rect = dom.getBoundingClientRect();

    const state = useManagerStore.getState().mapState;
    const { currentDrawData, junctions, boundarys, operationType, areas } = state;
    const { currentDrawingElementId, drawElementType } = currentDrawData;
    const isFirst =
        (drawElementType === MapElementType.Junction && Object.keys(junctions).length === 1) ||
        (drawElementType === MapElementType.Area && Object.keys(areas).length === 1);
    let pointIds = [];
    if (drawElementType === MapElementType.Junction) {
        pointIds = boundarys[junctions[currentDrawingElementId]?.boundaryId]?.pointIds || [];
    } else {
        pointIds = boundarys[areas[currentDrawingElementId]?.boundaryId]?.pointIds || [];
    }

    if (
        drawElementType === MapElementType.Junction &&
        operationType === OperationType.Drawing &&
        Object.keys(junctions).length === 0
    ) {
        return {
            text: '单击确定路口形状起点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        drawElementType === MapElementType.Area &&
        operationType === OperationType.Drawing &&
        Object.keys(areas).length === 0
    ) {
        return {
            text: '单击确定区域形状起点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (isFirst && operationType === OperationType.Drawing && (pointIds.length === 1 || pointIds.length === 2)) {
        return {
            text: '至少绘制三个点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (isFirst && operationType === OperationType.Drawing && pointIds.length > 2) {
        const object = getPickupObject(e, camera, dom, scene, [
            ThreeElementType.JunctionPoint,
            ThreeElementType.AreaPoint,
        ]);
        if (object?.userData?.id === pointIds[0]) {
            return {
                text: '点击闭合路径并结束绘制',
                left: e.clientX - rect.left + 10,
                top: e.clientY - rect.top + 10,
            };
        }
        return {
            text: '双击或者esc或者enter键结束绘制',
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
