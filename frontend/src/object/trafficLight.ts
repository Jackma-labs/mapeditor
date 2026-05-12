import * as THREE from 'three';
import { Type } from 'src/interface/trafficSignal';
import {
    generateTrafficLight1CanvasTexture,
    generateTrafficLight2CanvasTexture,
    generateTrafficLight3CanvasTexture,
} from 'src/utils/textureUtil';
import { InterActiveType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { mapElementZ } from 'src/constant/mapElementZ';
import { searchTrafficLightByTrafficLightId } from 'src/utils/search/trafficLightSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
/**
 * 获取红绿灯的texture
 */
export function getDrawTrafficLightInfo(type: Type, interActiveType: InterActiveType = InterActiveType.Default) {
    let texture = null;
    let width = null;
    let height = null;
    switch (type) {
        case Type.MIX_3_HORIZONTAL:
            texture = generateTrafficLight3CanvasTexture(interActiveType);
            width = 2.7;
            height = 1.1;
            break;
        case Type.MIX_3_VERTICAL:
            texture = generateTrafficLight3CanvasTexture(interActiveType);
            texture.rotation = Math.PI / 2;
            width = 1.1;
            height = 2.7;
            break;
        case Type.MIX_2_HORIZONTAL:
            texture = generateTrafficLight2CanvasTexture(interActiveType);
            width = 2;
            height = 1.1;
            break;
        case Type.MIX_2_VERTICAL:
            texture = generateTrafficLight2CanvasTexture(interActiveType);
            texture.rotation = Math.PI / 2;
            width = 1.1;
            height = 2;
            break;
        case Type.SINGLE:
            texture = generateTrafficLight1CanvasTexture(interActiveType);
            width = 1.1;
            height = 1.1;
            break;
        default:
            texture = generateTrafficLight3CanvasTexture(interActiveType);
    }
    return { texture, width, height };
}
export function TrafficLightInteraction(object: THREE.Object3D, type: InterActiveType) {
    if (!object) {
        return;
    }
    const trafficLightType: Type = object.userData.trafficLightType;
    const { texture } = getDrawTrafficLightInfo(trafficLightType, type);
    // @ts-ignore
    object.material.map = texture;
    // @ts-ignore
    object.material.map.colorSpace = 'srgb';
    object.userData.interActiveType = type;
    // @ts-ignore
    object.material.needsUpdate = true;
}

/**
 * 获取红绿灯的box3
 * @returns
 */
export function getTrafficLightPolygonPositions(mesh: THREE.Mesh) {
    const positions = mesh.geometry.getAttribute('position')?.array;
    const result = [];
    for (let i = 0; i < positions.length; i += 3) {
        const vertexPosition = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(
            mesh.matrix,
        );
        result.push([vertexPosition.x, vertexPosition.y]);
    }
    return result;
}
/**
 * 绘制红绿灯
 */
export function drawTrafficLight(id: string, interActiveType: InterActiveType = InterActiveType.Default) {
    const trafficLight = searchTrafficLightByTrafficLightId(id);
    if (!trafficLight) {
        return null;
    }
    const { type, center, heading } = trafficLight;
    if (!center) {
        return null;
    }
    const { width, height, texture } = getDrawTrafficLightInfo(type, interActiveType);

    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
        }),
    );
    mesh.position.set(center.x, center.y, mapElementZ[ThreeElementType.TrafficLight]);
    mesh.material.map.colorSpace = 'srgb';
    mesh.rotateZ(heading);
    mesh.userData.type = ThreeElementType.TrafficLight;
    mesh.userData.id = id;
    mesh.userData.trafficLightType = type;
    mesh.userData.interActiveType = interActiveType;
    mesh.name = `${ThreeObject.TrafficLight}`;

    return mesh;
}
export function updateTrafficLight(trafficLightId: string) {
    if (!trafficLightId) {
        return;
    }
    const trafficLight = searchTrafficLightByTrafficLightId(trafficLightId);
    const trafficLightObject = objectSearch(ThreeObject.TrafficLight, trafficLightId) as THREE.Mesh;
    if (!trafficLightObject || !trafficLight) {
        return;
    }
    const { center, heading, type } = trafficLight;
    if (trafficLightObject.userData.trafficLightType !== type) {
        const trafficLightMesh = drawTrafficLight(trafficLight.id, trafficLightObject.userData.interActiveType);
        if (trafficLightMesh) {
            trafficLightObject.geometry = trafficLightMesh.geometry;
            trafficLightObject.material = trafficLightMesh.material;
            trafficLightObject.userData.trafficLightType = type;
        }
        return;
    }

    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), heading);
    trafficLightObject.position.copy(center);
    trafficLightObject.quaternion.copy(quaternion);
}
