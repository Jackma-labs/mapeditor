import { InterActiveType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { generatePointCanvasTexture } from 'src/utils/textureUtil';
import { searchPointByPointId } from 'src/utils/search/pointSearch';
import { PointElement } from 'src/interface/basicElementInterFace';
import { mapElementZ } from 'src/constant/mapElementZ';
import * as THREE from 'three';
import { pointColor } from 'src/constant/color';
import { drawCircle } from './basicObject';

export function PointInteraction(point: THREE.Mesh, type: InterActiveType) {
    const texture: THREE.CanvasTexture = generatePointCanvasTexture({
        strokeColor: pointColor[type],
        fillColor: new THREE.Color(0xffffff),
        lineWidth: type === InterActiveType.Default ? 50 : 75,
        fillOpacity: 1,
    });
    const material = new THREE.MeshBasicMaterial({
        map: texture,
    });
    (point.material as THREE.Material).needsUpdate = true;
    material.map.colorSpace = 'srgb';
    point.material = material;
}

/**
 * @description 绘制点
 */
export function drawPoint(pointId: string, interActiveType: InterActiveType = InterActiveType.Default) {
    const point = searchPointByPointId(pointId);
    if (!point) {
        return null;
    }
    const { id, type, position } = point;
    const material = new THREE.MeshBasicMaterial({
        map: generatePointCanvasTexture({
            strokeColor: pointColor[interActiveType],
            fillColor: new THREE.Color(0xffffff),
            lineWidth: interActiveType === InterActiveType.Default ? 50 : 75,
            fillOpacity: 1,
        }),
        blending: THREE.NoBlending,
    });
    const mesh = drawCircle(material);
    mesh.position.copy(position);
    mesh.position.z = mapElementZ[type];
    mesh.userData.id = id;
    mesh.userData.type = type;
    mesh.name = `${ThreeObject.Point}`;
    return mesh;
}
/**
 * 更新点
 */
export function updatePoint(pointObject: THREE.Mesh, point: PointElement) {
    if (!point || !pointObject) {
        return;
    }
    pointObject.position.copy(new THREE.Vector3(point.position.x, point.position.y, mapElementZ[point.type]));
}

/**
 * 绘制控制点
 */
export function drawControlPoint(position: THREE.Vector3, texture: THREE.CanvasTexture) {
    const geometry = new THREE.PlaneGeometry(0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    material.map.colorSpace = 'srgb';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, mapElementZ[ThreeElementType.CurveControlPoint]);
    mesh.name = `${ThreeObject.ControlPoint}`;
    return mesh;
}
