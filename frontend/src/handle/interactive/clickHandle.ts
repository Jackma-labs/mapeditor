import * as THREE from 'three';
import {
    InterActiveType,
    MapElementType,
    OperationType,
    ThreeElementType,
    PickElementInfo,
    ThreeObject,
} from 'src/interface/commonInterFace';
import { getPickupObject, getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { transScreenPositionToWorld, vector2TransTpVector3 } from 'src/utils/vectorUtil';
import { useManagerStore } from 'src/store';
import PubSub from 'pubsub-js';
import { mapElementZ } from 'src/constant/mapElementZ';
import { searchLanesRelationObjectsByCurrentPick } from 'src/utils/search/common';
import { Boundary, PointElement } from 'src/interface/basicElementInterFace';
import { unionBy } from 'lodash';
import { getPointOnCurveT, getSpliteCurveControls } from 'src/threeUtil/BezierCurve3Control/util';
import { searchCurvePointsAndControlsFromCurveId } from 'src/utils/search/boundarySearch';
import { AddPointCommand } from 'src/command/PointCommand';
import { extendLaneBaseOneLaneHandle } from '../lane/extendLaneBaseOneLaneHandle';
import { addPointHandle } from '../point/appPointHandle';
import { addTrafficLightHandle } from '../trafficLight/addTrafficLightHandle';
import { addLaneBaseOneLaneHandle } from '../lane/addLaneBaseOneLaneHandle';
import { addStraightLineClickHandle } from '../boundary/addBoundaryHandle';
import { extendBoundaryHandle } from '../boundary/extendBoundaryHandle';
import { copyParkingSpaceHandle } from '../parkingSpace/copyParkingSpace';
import { addLaneClickHandle } from '../lane/addLaneHandle';
import { addJunctionClickHandle } from '../junction/addJunctionHandle';
import { addCrosswalkClickHandle } from '../corsswalk/addCrosswalkClickHandle';
import { addSpeedBumpHandle } from '../speedbump/addSpeedBumpHandle';
import { addParkingSpaceClickHandle } from '../parkingSpace/addParkingSpace';
import { splitLaneInVerticalHandle } from '../lane/splitLaneHandle';
import { HandleObjectType, getCanInteractiveObject, isActiveElement } from './Interaction';
import { message as messageFunc } from '../../components/Message/index';
import { addSignHandle } from '../sign/addSignHandle';
import { addAreaClickHandle } from '../area/addAreaHandle';
import { addBarrierGateHandle } from '../barrierGate/addBarrierGateHandle';

export function getIntersectionsOfLineAndBoundary(
    lineStart: THREE.Vector3,
    lineEnd: THREE.Vector3,
    boundarys: Boundary[],
) {
    if (boundarys.length < 2) {
        return null;
    }
    let allIsCross = true;
    const crossInfo: {
        [boundaryId: string]: {
            splitPosition: THREE.Vector3;
            controlsPosition?: THREE.Vector3[];
        };
    } = {};
    const { scene } = useManagerStore.getState().mapState;
    const direction = new THREE.Vector3().subVectors(lineEnd, lineStart).normalize();
    const raycaster = new THREE.Raycaster(lineStart, direction, 0, lineEnd.distanceTo(lineStart));
    raycaster.params.Line.threshold = boundarys[0].type === ThreeElementType.LaneCurveBoundary ? 0.2 : 0.01;
    const objects = scene.children.filter(
        (item) =>
            item.userData.type === ThreeElementType.LaneBoundary ||
            item.userData.type === ThreeElementType.LaneCurveBoundary,
    );
    const intersects = unionBy(raycaster.intersectObjects(objects), 'object.userData.id');
    if (intersects.length < boundarys.length) {
        return null;
    }
    for (let i = 0; i < boundarys.length; i += 1) {
        const boundary = boundarys[i];
        const findIndex = intersects.findIndex((item) => item.object.userData.id === boundarys[i].id);
        if (findIndex === -1) {
            allIsCross = false;
            break;
        }
        const splitPosition = intersects[findIndex].point;
        crossInfo[boundarys[i].id] = {
            splitPosition,
        };
        if (boundary.type === ThreeElementType.LaneCurveBoundary) {
            const { points, controlsPosition } = searchCurvePointsAndControlsFromCurveId(boundary.id);
            const t = getPointOnCurveT(
                splitPosition,
                points[0].position,
                controlsPosition[0],
                controlsPosition[1],
                points[1].position,
            );
            const newControlsPosition = getSpliteCurveControls(
                points[0].position,
                controlsPosition[0],
                controlsPosition[1],
                points[1].position,
                t,
            );
            crossInfo[boundarys[i].id].controlsPosition = newControlsPosition;
        }
    }
    if (!allIsCross) {
        return null;
    }
    return crossInfo;
}
export function getActiveObject(
    e: MouseEvent | React.MouseEvent,
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    scene: THREE.Scene,
    holdShift: boolean,
) {
    const state = useManagerStore.getState().mapState;
    const { currentPickElement } = state;
    const object = getPickupObject(e, camera, dom, scene, getCanInteractiveObject(HandleObjectType.MapElement));
    let newPickResult: PickElementInfo[] = [];

    if (object) {
        const id = object.userData.id || object.parent?.userData.id;
        const type = object.userData.type || object.parent?.userData.type;
        if (!currentPickElement || currentPickElement.length === 0) {
            newPickResult = [{ id, type, threeObject: Number(object.name) }];
        } else if (!holdShift) {
            newPickResult = [{ id, type, threeObject: Number(object.name) }];
        } else if (
            currentPickElement[0].type === type ||
            (currentPickElement[0].type === ThreeElementType.LaneCurveGroud && type === ThreeElementType.LaneGroud) ||
            (currentPickElement[0].type === ThreeElementType.LaneGroud && type === ThreeElementType.LaneCurveGroud) ||
            (currentPickElement[0].type === ThreeElementType.JunctionGroud &&
                (type === ThreeElementType.LaneGroud || type === ThreeElementType.LaneCurveGroud)) ||
            ((currentPickElement[0].type === ThreeElementType.LaneGroud ||
                currentPickElement[0].type === ThreeElementType.LaneCurveGroud) &&
                type === ThreeElementType.JunctionGroud) ||
            (currentPickElement[0].type === ThreeElementType.LaneBoundary && type === ThreeElementType.RoadBoundary) ||
            (currentPickElement[0].type === ThreeElementType.RoadBoundary && type === ThreeElementType.LaneBoundary) ||
            (currentPickElement[0].type === ThreeElementType.RoadBoundary &&
                type === ThreeElementType.LaneCurveBoundary) ||
            (currentPickElement[0].type === ThreeElementType.LaneCurveBoundary &&
                type === ThreeElementType.RoadBoundary)
        ) {
            if (isActiveElement(id, type)) {
                newPickResult = [...currentPickElement];
            } else {
                newPickResult = [...currentPickElement, { id, type, threeObject: Number(object.name) }];
            }
        } else {
            messageFunc(
                {
                    type: 'warning',
                    content: '请选择相同类型的元素',
                },
                100,
            );
            newPickResult = [...currentPickElement];
        }
    } else {
        newPickResult = [];
    }
    return newPickResult;
}

export function mapElementActiveInteraction(
    e: MouseEvent | React.MouseEvent,
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    scene: THREE.Scene,
    holdShift: boolean,
) {
    const state = useManagerStore.getState().mapState;
    // 先将hover元素置为默认态，选中时hover元素就没了，重新hover才会有
    PubSub.publishSync('resetHoverElement');
    // 获取新的选中元素
    const newPickResult = getActiveObject(e, camera, dom, scene, holdShift);
    // 更新选中元素
    state.currentPickElement = [...newPickResult];
    state.needRender = true;
    useManagerStore.getState().setMapState(state);
}

export function clickHandle(
    e: React.MouseEvent,
    dom: HTMLElement,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData, operationType, currentPickElement, holdShift, points } = newState;
    const { drawElementType } = currentDrawData;
    const worldVector = transScreenPositionToWorld(e);
    // 如果点击的是合并或者链接的按钮,则什么都不做，交由按钮的点击事件处理
    // @ts-ignore
    if (e.target.className.indexOf('lane-handle-btn') !== -1) {
        return;
    }
    if (operationType === OperationType.Rotating || operationType === OperationType.Draging) {
        return;
    }
    const curveControlPointObject = getPickupObject(e, camera, dom, scene, [ThreeElementType.CurveControlPoint]);
    if (curveControlPointObject) {
        PubSub.publish('controlPointInteractive', { mesh: curveControlPointObject, type: InterActiveType.Active });
        PubSub.publish('enableObjectDarg', curveControlPointObject);
        return;
    }
    if (operationType === OperationType.CopyLane) {
        PubSub.publishSync('removeMouseMoveElements');
        // 如果点击的是 添加车道的图标，则将图标颜色高亮，且执行添加车道的操作
        const object = getPickupObject(e, camera, dom, scene, getCanInteractiveObject(HandleObjectType.AddLane));
        if (object) {
            PubSub.publishSync('changeAddSvgColor', { sprite: object, type: InterActiveType.Active });
            addLaneBaseOneLaneHandle(object.userData.laneId, object.userData.inLeft);
        }
        return;
    }
    if (operationType === OperationType.SplitLaneInVertical) {
        const { type } = currentPickElement[0];
        if (type && type !== ThreeElementType.LaneGroud && type !== ThreeElementType.LaneCurveGroud) {
            return;
        }
        if (!points.start) {
            const startPoint: PointElement = {
                id: 'start',
                type: ThreeElementType.SplitLaneInVerticalPoint,
                position: vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.LaneBoundary]),
            };
            const pointId = `${getElementMaxIndex(points) + 1}`;
            const actions = [
                new AddPointCommand(pointId, startPoint.position, ThreeElementType.SplitLaneInVerticalPoint),
            ];
            useManagerStore.getState().addCommand(actions);
            state.points.start = startPoint;
            state.needRender = true;
            state.needRenderElements[ThreeObject.Point].start = ThreeElementType.SplitLaneInVerticalPoint;
            useManagerStore.getState().setMapState(state);
            return;
        }
        // 计算当前点和起始点是不是和所有有关的boundary都有交点，如果不是的话，则点击后不能切车道，且给个提示
        if (points.start) {
            const { boundarys, lanes } = searchLanesRelationObjectsByCurrentPick();
            const crossInfo = getIntersectionsOfLineAndBoundary(
                points.start.position,
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.LaneBoundary]),
                boundarys,
            );
            splitLaneInVerticalHandle(crossInfo, lanes);
        }
        return;
    }
    if (operationType === OperationType.CopyParkingSpace) {
        // 如果点击的是复制停车区的图标，则将图标颜色高亮，且执行复制停车区的操作
        const object3 = getPickupObject(e, camera, dom, scene, [ThreeElementType.CopyParkingSpaceSvg]);
        if (object3) {
            PubSub.publishSync('changeAddSvgColor', { sprite: object3, type: InterActiveType.Active });
            copyParkingSpaceHandle(object3.userData.parkingSpaceId, object3.userData.num);
        }
        return;
    }

    // 如果点击的是旋转手柄，则什么都不做
    if (getPickupObject(e, camera, dom, scene, getCanInteractiveObject(HandleObjectType.Rotate))) {
        return;
    }
    // 如果按住了ctrl键，说明是添加点操作，去处理添加点的操作
    if (operationType === OperationType.InsertPointToBoundary) {
        addPointHandle(e, dom, camera, scene);
        return;
    }

    // 如果点击的是 延长车道的图标，则将图标颜色高亮，且执行延长车道的操作
    const object1 = getPickupObject(e, camera, dom, scene, getCanInteractiveObject(HandleObjectType.ExtendLane));
    if (object1) {
        PubSub.publishSync('changeAddSvgColor', { sprite: object1, type: InterActiveType.Active });
        extendLaneBaseOneLaneHandle(object1.userData.laneId);
        return;
    }
    // 如果点击的是延长车道图标
    const object2 = getPickupObject(e, camera, dom, scene, getCanInteractiveObject(HandleObjectType.ExtendBoundary));
    if (object2) {
        PubSub.publishSync('changeAddSvgColor', { sprite: object2, type: InterActiveType.Active });
        extendBoundaryHandle(object2.userData.boundaryId, object2.userData.isStart);
        return;
    }

    // 如果处于绘制阶段，则执行绘制逻辑
    if (drawElementType) {
        if (drawElementType === MapElementType.Lane) {
            addLaneClickHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.LanePoint]));
        }
        if (drawElementType === MapElementType.Junction) {
            addJunctionClickHandle(
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.JunctionPoint]),
                e,
                dom,
                camera,
                scene,
            );
        }
        if (drawElementType === MapElementType.Area) {
            addAreaClickHandle(
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.AreaPoint]),
                e,
                dom,
                camera,
                scene,
            );
        }
        // 如果绘制的是人行横道
        if (drawElementType === MapElementType.Crosswalk) {
            addCrosswalkClickHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.CrosswalkPoint]));
        }
        // 如果绘制的是人行横道
        if (drawElementType === MapElementType.SpeedBump) {
            addSpeedBumpHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.SpeedBumpPoint]));
        }
        if (drawElementType === MapElementType.StopLine) {
            // addStopLineHandle(worldVector);
        }
        if (drawElementType === MapElementType.TrafficSignal) {
            addTrafficLightHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.TrafficLight]));
        }
        if (drawElementType === MapElementType.BarrierGate) {
            addBarrierGateHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.BarrierGatePoint]));
        }
        if (drawElementType === MapElementType.ParkingSpace) {
            addParkingSpaceClickHandle(
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.ParkingSpacePoint]),
            );
        }
        if (drawElementType === MapElementType.StraightLine || drawElementType === MapElementType.RoadBoundary) {
            addStraightLineClickHandle(worldVector, e, dom, camera, scene);
        }
        if (drawElementType === MapElementType.Sign) {
            addSignHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.SignIcon]));
        }
    } else {
        // 否则处理绘制的地图元素的选中状态
        mapElementActiveInteraction(e, camera, dom, scene, holdShift);
    }
}
