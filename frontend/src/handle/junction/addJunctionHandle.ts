import { AddJunctionCommand } from 'src/command/JunctionCommand';
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
/**
 * 添加连接点击事件处理函数
 *
 * @param position 位置坐标
 * @param dbclick 是否为双击操作，默认false
 */
export function addJunctionClickHandle(
    position: THREE.Vector3,
    e: React.MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { boundarys, currentDrawData, points, grouds, junctions } = newState;

    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');

    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.JunctionPoint);
    if (!newState.currentDrawData.currentDrawingElementId) {
        const junctionId = `${getElementMaxIndex(junctions) + 1}`;
        const junctionBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const groudId = `${getElementMaxIndex(grouds) + 1}`;

        const cm2 = new SetCurrentDrawDataCommand(junctionId, MapElementType.Junction);
        const cm3 = new AddJunctionCommand(junctionId, junctionBoundaryId, groudId, {
            ...currentDrawData.junctionAttr,
        });
        const cm4 = new AddBoundaryCommand(
            junctionBoundaryId,
            ThreeElementType.JunctionBoundary,
            BoundaryOriginType.Junction,
            [],
            [],
        );
        const cm5 = new AddPointToBoundaryCommand(pointId, junctionBoundaryId, true, false);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5]);
    } else {
        const junctionId = newState.currentDrawData.currentDrawingElementId;
        const junction = junctions[junctionId];
        if (!junction) {
            console.warn('addJunctionClickHandle时当前绘制的junction找不到了');
            return;
        }

        const junctionBoundaryId = junction.boundaryId;
        const boundary = boundarys[junctionBoundaryId];
        if (!boundary) {
            console.warn('addJunctionClickHandle时当前绘制的junction的boundary找不到了');
            return;
        }

        if (boundary.pointIds.length > 2) {
            const pointPick = getPickupObject(e, camera, dom, scene, [ThreeElementType.JunctionPoint]);
            if (pointPick?.userData?.id === boundary.pointIds[0]) {
                const cm2 = new AddPointToBoundaryCommand(boundary.pointIds[0], junctionBoundaryId, true, false);
                const cm4 = new SetCurrentDrawDataCommand(null, null);
                const cm5 = new SetOperationTypeCommand(null);
                const cm6 = new AddGroudCommand(junction.groudId, ThreeElementType.JunctionGroud);
                useManagerStore.getState().addCommand([cm2, cm4, cm5, cm6]);
            } else {
                const cm2 = new AddPointToBoundaryCommand(pointId, junctionBoundaryId, true, false);
                useManagerStore.getState().addCommand([cm1, cm2]);
            }
        } else {
            const cm2 = new AddPointToBoundaryCommand(pointId, junctionBoundaryId, true, false);
            useManagerStore.getState().addCommand([cm1, cm2]);
        }
    }
}
