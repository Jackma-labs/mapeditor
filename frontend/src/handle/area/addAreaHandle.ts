import { AddPointCommand } from 'src/command/PointCommand';
import { getElementMaxIndex, getPickupObject } from 'src/utils/threeObjectUtil';
import * as THREE from 'three';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddGroudCommand } from 'src/command/GroudCommand';
import { useManagerStore } from 'src/store';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { AddAreaCommand } from 'src/command/AreaCommand';
/**
 * 添加连接点击事件处理函数
 *
 * @param position 位置坐标
 * @param dbclick 是否为双击操作，默认false
 */
export function addAreaClickHandle(
    position: THREE.Vector3,
    e: React.MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { boundarys, points, grouds, areas, currentDrawData } = newState;

    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');

    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.AreaPoint);
    if (!newState.currentDrawData.currentDrawingElementId) {
        const areaId = `${getElementMaxIndex(areas) + 1}`;
        const boundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const groudId = `${getElementMaxIndex(grouds) + 1}`;

        const cm2 = new SetCurrentDrawDataCommand(areaId, MapElementType.Area);
        const cm3 = new AddAreaCommand(areaId, boundaryId, groudId, currentDrawData.areaAttr.type);
        const cm4 = new AddBoundaryCommand(boundaryId, ThreeElementType.AreaBoundary, BoundaryOriginType.Area, [], []);
        const cm5 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5]);
    } else {
        const areaId = newState.currentDrawData.currentDrawingElementId;
        const area = areas[areaId];
        if (!area) {
            console.warn('addAreaClickHandle时当前绘制的area找不到了');
            return;
        }

        const boundaryId = area.boundaryId;
        const boundary = boundarys[boundaryId];
        if (!boundary) {
            console.warn('addAreaClickHandle时当前绘制的area的boundary找不到了');
            return;
        }

        if (boundary.pointIds.length > 2) {
            const pointPick = getPickupObject(e, camera, dom, scene, [ThreeElementType.AreaPoint]);
            if (pointPick?.userData?.id === boundary.pointIds[0]) {
                const cm2 = new AddPointToBoundaryCommand(boundary.pointIds[0], boundaryId, true, false);
                const cm4 = new SetCurrentDrawDataCommand(null, null);
                const cm5 = new SetOperationTypeCommand(null);
                const cm6 = new AddGroudCommand(area.groudId, ThreeElementType.AreaGroud);
                useManagerStore.getState().addCommand([cm2, cm4, cm5, cm6]);
            } else {
                const cm2 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
                useManagerStore.getState().addCommand([cm1, cm2]);
            }
        } else {
            const cm2 = new AddPointToBoundaryCommand(pointId, boundaryId, true, false);
            useManagerStore.getState().addCommand([cm1, cm2]);
        }
    }
}
