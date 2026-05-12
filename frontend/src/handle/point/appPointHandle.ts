import { UpdateArrowCommand } from 'src/command/ArrowCommand';
import { AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { AddPointCommand } from 'src/command/PointCommand';
import { mapElementZ } from 'src/constant/mapElementZ';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { drawCircle } from 'src/object/basicObject';
import { useManagerStore } from 'src/store';
import { searchLanesFromBoundaryId } from 'src/utils/search/laneSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getElementMaxIndex, getPickupObject } from 'src/utils/threeObjectUtil';
import { getNearPointAndSegmentInLine, transScreenPositionToWorld, vector2TransTpVector3 } from 'src/utils/vectorUtil';
import * as THREE from 'three';

export function addPointHandle(
    e: React.MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    /**
     * 当按住了ctrl键，且鼠标拾取的是laneBoundary或者junctionBoundary时，则增加点
     */
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { points, currentPickElement } = newState;

    const object = getPickupObject(e, camera, dom, scene, [
        ThreeElementType.LaneBoundary,
        ThreeElementType.JunctionBoundary,
        ThreeElementType.RoadBoundary,
    ]);
    if (!object) {
        return;
    }
    const { type, id } = object.userData;
    if (!id) {
        console.warn('addPointHandle时选中boundary上没有存储id');
        return;
    }
    if (
        id !== currentPickElement[0]?.id ||
        (type !== ThreeElementType.LaneBoundary && type !== ThreeElementType.RoadBoundary)
    ) {
        return;
    }
    const worldVector = transScreenPositionToWorld(e);

    const boundaryPoints = searchPointsFromBoundaryId(id);
    if (boundaryPoints.length < 2) {
        return;
    }
    // 算点击的点到线的垂点，去增加点
    const closestPt = getNearPointAndSegmentInLine(
        [worldVector.x, worldVector.y],
        [...boundaryPoints.map((point) => [point.position.x, point.position.y])],
    );
    const insertedPointPosition = new THREE.Vector3(closestPt.x, closestPt.y, mapElementZ[ThreeElementType.LanePoint]);
    if (!closestPt) {
        return;
    }
    // 如果是在laneBoundary上增加点
    const pointId = `${getElementMaxIndex(points) + 1}`;
    const actions = [];
    const pointType =
        type === ThreeElementType.LaneBoundary ? ThreeElementType.LanePoint : ThreeElementType.RoadBoundaryPoint;
    actions.push(new AddPointCommand(pointId, insertedPointPosition, pointType));
    actions.push(new AddPointToBoundaryCommand(pointId, id, false, false));
    actions.push(new SetOperationTypeCommand(null));

    const linkLanes = searchLanesFromBoundaryId(id);
    linkLanes.forEach((lane) => {
        actions.push(new UpdateGroudCommand(lane.groudId));
        actions.push(new UpdateArrowCommand(lane.arrowId));
    });
    useManagerStore.getState().addCommand(actions);
    PubSub.publish('emptyPickObjects');
    PubSub.publishSync('removeMouseMoveElements');
}

export function addPointHoverHandle(e: MouseEvent, dom: HTMLElement) {
    PubSub.publishSync('removeMouseMoveElements');
    // TODO 这里鼠标样式不生效 @haoxiaojie
    dom.getElementsByTagName('canvas')[0].style.cursor = 'crosshair !important';
    const worldVector = transScreenPositionToWorld(e);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const point = drawCircle(material);
    if (!point) {
        return;
    }
    point.position.copy(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.JunctionPoint]));
    PubSub.publishSync('addMouseMovePoint', point);
}
