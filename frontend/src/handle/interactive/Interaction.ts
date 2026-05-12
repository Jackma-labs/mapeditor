import * as THREE from 'three';
import { InterActiveType, ObjectType, ThreeElementType } from 'src/interface/commonInterFace';
import { BoundaryInteraction } from 'src/object/boundary';
import { GroudInteraction } from 'src/object/groud';
import { PointInteraction } from 'src/object/point';
import { TrafficLightInteraction } from 'src/object/trafficLight';
import { useManagerStore } from 'src/store';
import { getObjectType } from 'src/utils/threeObjectUtil';
import { updateSignIconTexure } from 'src/object/sign';

export enum HandleObjectType {
    MapElement = 1,
    AddLane,
    ExtendLane,
    ExtendBoundary,
    AddLaneOrExtendLane,
    AddLaneORExtendLaneOrExtendBoundary,
    Rotate,
    Promote,
}
export function findElementIndexInCurrentPickElement(curElement: { id: string; type: ThreeElementType }): number {
    let result = -1;
    if (!curElement) {
        return result;
    }
    const { id, type } = curElement;
    const { currentPickElement } = useManagerStore.getState().mapState;
    if (!currentPickElement || currentPickElement.length === 0) {
        return result;
    }
    for (let i = 0; i < currentPickElement.length; i += 1) {
        const item = currentPickElement[i];
        if (item.type === type && item.id === id) {
            result = i;
            break;
        }
    }
    return result;
}
export function isActiveElement(id: string, type: ThreeElementType) {
    const { currentPickElement } = useManagerStore.getState().mapState;
    let result = false;
    for (let i = 0; i < currentPickElement.length; i += 1) {
        const item = currentPickElement[i];
        if (item.id === id && item.type === type) {
            result = true;
            break;
        }
    }
    return result;
}
/**
 * 判断一个three.object3d对象处于active状态
 */
export function objectIsActive(object: THREE.Object3D) {
    let actualObject: THREE.Object3D = object;
    if (object.parent?.userData.id) {
        actualObject = object.parent;
    }
    const { id, type } = actualObject.userData;
    return isActiveElement(id, type);
}
/**
 * 获取可以active的object类型
 */

export function getCanInteractiveObject(type: HandleObjectType) {
    switch (type) {
        case HandleObjectType.AddLane:
            return [ThreeElementType.AddLaneSvg];
        case HandleObjectType.ExtendLane:
            return [ThreeElementType.ExtendLaneSvg];
        case HandleObjectType.AddLaneOrExtendLane:
            return [ThreeElementType.AddLaneSvg, ThreeElementType.ExtendLaneSvg];
        case HandleObjectType.Rotate:
            return [ThreeElementType.RotateHandle];
        case HandleObjectType.ExtendBoundary:
            return [ThreeElementType.ExtendBoundarySvg];
        case HandleObjectType.AddLaneORExtendLaneOrExtendBoundary:
            return [ThreeElementType.AddLaneSvg, ThreeElementType.ExtendLaneSvg, ThreeElementType.ExtendBoundarySvg];
        case HandleObjectType.MapElement:
            return [
                ThreeElementType.LaneGroud,
                ThreeElementType.JunctionGroud,
                ThreeElementType.CrosswalkGroud,
                ThreeElementType.ParkingSpaceGroud,
                ThreeElementType.LaneCurveGroud,
                ThreeElementType.SpeedBumpGroud,
                ThreeElementType.AreaGroud,
                ThreeElementType.BarrierGateGroud,

                ThreeElementType.RoadBoundary,
                ThreeElementType.LaneBoundary,
                ThreeElementType.LaneCurveBoundary,
                ThreeElementType.JunctionBoundary,
                ThreeElementType.AreaBoundary,
                ThreeElementType.SpeedBumpBoundary,
                ThreeElementType.CrosswalkBoundary,
                ThreeElementType.StopLineBoundary,
                // ThreeElementType.BarrierGateBoundary,

                ThreeElementType.LanePoint,
                ThreeElementType.RoadBoundaryPoint,
                ThreeElementType.JunctionPoint,
                ThreeElementType.AreaPoint,
                ThreeElementType.CrosswalkPoint,
                ThreeElementType.SpeedBumpPoint,
                ThreeElementType.StopLinePoint,
                ThreeElementType.BarrierGatePoint,

                ThreeElementType.TrafficLight,
                ThreeElementType.SignIcon,
            ];
        case HandleObjectType.Promote:
            return [
                ThreeElementType.LaneGroud,
                ThreeElementType.JunctionGroud,
                ThreeElementType.AreaGroud,
                ThreeElementType.CrosswalkGroud,
                ThreeElementType.SpeedBumpGroud,
                ThreeElementType.StopLineBoundary,
                ThreeElementType.TrafficLight,
                ThreeElementType.ParkingSpaceGroud,
                ThreeElementType.LaneCurveGroud,
                ThreeElementType.SignIcon,
                ThreeElementType.LaneBoundary,
                ThreeElementType.LaneCurveBoundary,
                ThreeElementType.RoadBoundary,
                ThreeElementType.BarrierGateGroud,
            ];
        default:
            return null;
    }
}

/**
 * 元素交互
 *
 * @param object 对象实例（THREE.Mesh 或 THREE.Line）
 * @param type 操作类型
 */
export function elementInteraction(object: THREE.Object3D, interActiveType: InterActiveType) {
    const type = getObjectType(object);
    switch (type) {
        case ObjectType.Point:
            PointInteraction(object as THREE.Mesh, interActiveType);
            break;
        case ObjectType.Boundary:
            BoundaryInteraction(object as THREE.Line, interActiveType);
            break;
        case ObjectType.Groud:
            GroudInteraction(object as THREE.Mesh, interActiveType);
            break;
        case ObjectType.TrafficLight:
            TrafficLightInteraction(object, interActiveType);
            break;
        case ObjectType.SignIcon:
            updateSignIconTexure(object, interActiveType);
            break;
        default:
            break;
    }
}
