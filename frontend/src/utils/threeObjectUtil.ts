import React from 'react';
import { ObjectType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import * as THREE from 'three';

export const disposeMesh = (mesh: THREE.Mesh | THREE.Line, scene: THREE.Scene) => {
    if (!mesh) {
        return;
    }
    mesh.geometry?.dispose();
    (mesh.material as THREE.Material)?.dispose();
    if (mesh.parent?.name === 'dragControlGroup' || mesh.parent?.name === 'rotateGroup') {
        mesh.parent.remove(mesh);
    } else {
        scene.remove(mesh);
    }
};
export const disposeGroup = (group: THREE.Group | THREE.Object3D, scene: THREE.Scene) => {
    if (!group) {
        return;
    }
    group.traverse((child) => {
        disposeMesh(child as any, scene);
    });
    scene.remove(group);
};
/**
 * 选取绘制地图的元素
 */
export const getPickupObject = (
    e: React.MouseEvent | MouseEvent,
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    scene: THREE.Scene,
    objectType: ThreeElementType[],
) => {
    const cameraZ = camera.position.z;
    let threshold = 0.1;
    if (cameraZ < 30) {
        threshold = 0.1;
    } else if (cameraZ < 50) {
        threshold = 0.5;
    } else {
        threshold = 1;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = threshold;
    raycaster.params.Points.threshold = threshold;
    const pointer = new THREE.Vector2();

    const domRect = dom.getBoundingClientRect();
    pointer.x = ((e.clientX - domRect.left) / dom.clientWidth) * 2 - 1;
    pointer.y = -((e.clientY - domRect.top) / dom.clientHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const objects = scene.children.filter(
        (item) => objectType.includes(item.userData?.type) && item.name !== 'dragControlGroup',
    );
    if (objects.length === 0) {
        return null;
    }
    const intersects = raycaster.intersectObjects(objects);
    if (intersects.length > 0) {
        if (
            intersects[0].object?.parent &&
            intersects[0].object.parent.userData.type === ThreeElementType.BarrierGateGroud
        ) {
            return intersects[0].object.parent;
        }
        return intersects[0].object;
    }
    return null;
};
/**
 * 清除资源的时候记得不要把图片资源清除了
 */
export function removeAllElement() {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    newState.scene.traverse((child: any) => {
        if ((child.type === 'Mesh' || child.type === 'Line2' || child.type === 'Sprite') && child.name !== 'tile') {
            child.geometry?.dispose();
            (child.material as THREE.Material)?.dispose();
        }
    });
    for (let i = 0; i < newState.scene.children.length; i += 1) {
        if (newState.scene.children[i].name !== 'tile') {
            if (
                newState.scene.children[i].type === 'Mesh' ||
                newState.scene.children[i].type === 'Line' ||
                newState.scene.children[i].type === 'Group' ||
                newState.scene.children[i].type === 'Line2' ||
                newState.scene.children[i].type === 'Sprite'
            ) {
                if (
                    newState.scene.children[i].name !== 'rotateGroup' &&
                    newState.scene.children[i].name !== 'dragControlGroup'
                ) {
                    newState.scene.remove(newState.scene.children[i]);
                    i -= 1;
                } else {
                    while (newState.scene.children[i]?.children?.length) {
                        newState.scene.remove(newState.scene.children[i].children[0]);
                        newState.scene.children[i].children.length -= 1;
                    }
                }
            }
        }
    }
}
/**
 * 清空场景
 */
export function clearScene() {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    newState.scene?.traverse((child: any) => {
        if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            (child.material as THREE.Material)?.dispose();
            if (child.material?.map) {
                child.material.map.dispose();
            }
        }
    });
    newState.scene?.clear();
    newState.renderer?.dispose();
    newState.renderer?.forceContextLoss();
}
export function getElementMaxIndex(objects: object) {
    const objectIdsArr = Object.keys(objects);
    if (objectIdsArr.length === 0) {
        return 0;
    }
    return Math.max(...[...objectIdsArr].map((id) => Number(id) || 0));
}
export function getObjectType(object: THREE.Object3D) {
    if (!object || !object.userData.type) {
        return null;
    }
    switch (object.userData.type) {
        case ThreeElementType.LanePoint:
        case ThreeElementType.RoadBoundaryPoint:
        case ThreeElementType.JunctionPoint:
        case ThreeElementType.AreaPoint:
        case ThreeElementType.BarrierGatePoint:
        case ThreeElementType.CrosswalkPoint:
        case ThreeElementType.SpeedBumpPoint:
        case ThreeElementType.StopLinePoint:
        case ThreeElementType.ParkingSpacePoint:
            return ObjectType.Point;
        case ThreeElementType.LaneBoundary:
        case ThreeElementType.RoadBoundary:
        case ThreeElementType.JunctionBoundary:
        case ThreeElementType.AreaBoundary:
        case ThreeElementType.CrosswalkBoundary:
        case ThreeElementType.StopLineBoundary:
        case ThreeElementType.ParkingSpaceBoundary:
        case ThreeElementType.LaneCurveBoundary:
            // case ThreeElementType.BarrierGateBoundary:
            return ObjectType.Boundary;
        case ThreeElementType.LaneGroud:
        case ThreeElementType.JunctionGroud:
        case ThreeElementType.AreaGroud:
        case ThreeElementType.BarrierGateGroud:
        case ThreeElementType.CrosswalkGroud:
        case ThreeElementType.SpeedBumpGroud:
        case ThreeElementType.ParkingSpaceGroud:
        case ThreeElementType.LaneCurveGroud:
            return ObjectType.Groud;
        case ThreeElementType.TrafficLight:
            return ObjectType.TrafficLight;
        case ThreeElementType.SignIcon:
            return ObjectType.SignIcon;
        default:
            return null;
    }
}
export function isSameObject(object1: THREE.Object3D, object2: THREE.Object3D) {
    if (!object1 || !object2) {
        return false;
    }
    let compareObj1: THREE.Object3D = object1;
    if (object1.parent?.userData.id) {
        compareObj1 = object1.parent;
    }

    let compareObj2: THREE.Object3D = object2;
    if (object2.parent?.userData.id) {
        compareObj2 = object2.parent;
    }
    return (
        compareObj1.userData.id === compareObj2.userData.id && compareObj1.userData.type === compareObj2.userData.type
    );
}

export function isPoint(type: ThreeElementType) {
    return (
        type === ThreeElementType.LanePoint ||
        type === ThreeElementType.RoadBoundaryPoint ||
        type === ThreeElementType.JunctionPoint ||
        type === ThreeElementType.AreaPoint ||
        type === ThreeElementType.BarrierGatePoint ||
        type === ThreeElementType.CrosswalkPoint ||
        type === ThreeElementType.SpeedBumpPoint ||
        type === ThreeElementType.StopLinePoint ||
        type === ThreeElementType.ParkingSpacePoint
    );
}
export function isGroud(type: ThreeElementType) {
    return (
        type === ThreeElementType.LaneGroud ||
        type === ThreeElementType.LaneCurveGroud ||
        type === ThreeElementType.JunctionGroud ||
        type === ThreeElementType.AreaGroud ||
        type === ThreeElementType.BarrierGateGroud ||
        type === ThreeElementType.CrosswalkGroud ||
        type === ThreeElementType.SpeedBumpGroud ||
        type === ThreeElementType.ParkingSpaceGroud
    );
}
export function isBoundary(type: ThreeElementType) {
    return (
        type === ThreeElementType.LaneBoundary ||
        type === ThreeElementType.RoadBoundary ||
        type === ThreeElementType.LaneCurveBoundary ||
        type === ThreeElementType.JunctionBoundary ||
        type === ThreeElementType.AreaBoundary ||
        type === ThreeElementType.CrosswalkBoundary ||
        // type === ThreeElementType.SpeedBumpBoundary ||
        type === ThreeElementType.StopLineBoundary ||
        type === ThreeElementType.ParkingSpaceBoundary
    );
}
