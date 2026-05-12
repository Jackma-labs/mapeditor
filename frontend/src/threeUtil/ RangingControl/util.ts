import { laneBoundaryColor } from 'src/constant/color';
import { InterActiveType } from 'src/interface/commonInterFace';
import { drawArc, drawCircle } from 'src/object/basicObject';
import { generatePointCanvasTexture, generateRangeRemoveTexture } from 'src/utils/textureUtil';
import { getAngleFromV1ToV2, getRotateAngle } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { getPointPositionAfterRotation } from '../RotateControl/util';

export enum RangingPointStatus {
    Click = 1,
    Mouse,
}
export function drawRanginPoint(position: THREE.Vector3, status: RangingPointStatus) {
    const material = new THREE.MeshBasicMaterial({
        map: generatePointCanvasTexture({
            fillColor: new THREE.Color(0xffffff),
            lineWidth: 50,
            strokeColor: new THREE.Color(0xff8d26),
            fillOpacity: status === RangingPointStatus.Click ? 1 : 0,
        }),
        blending: THREE.NormalBlending,
    });
    const mesh = drawCircle(material);
    mesh.position.copy(position);
    return mesh;
}
export function getArcRadian(positions: THREE.Vector3[]) {
    const v1 = new THREE.Vector3().subVectors(positions[0], positions[1]);
    const v2 = new THREE.Vector3().subVectors(positions[2], positions[1]);
    const radian = getAngleFromV1ToV2(v1, v2);
    return radian;
}
export function drawRangeArc(positions: THREE.Vector3[], rangingPointStatus: RangingPointStatus) {
    if (positions.length !== 3) {
        return null;
    }

    const radian = getArcRadian(positions);
    const thetaStart =
        radian > 0 ? getRotateAngle(positions[1], positions[0]) : getRotateAngle(positions[1], positions[2]);
    const group = new THREE.Group();
    group.position.copy(positions[1]);

    let radius = 2;
    const minLength = Math.min(positions[0].distanceTo(positions[1]), positions[2].distanceTo(positions[1]));
    if (minLength < radius) {
        radius = minLength;
    }

    const arcMesh = drawArc(radius, thetaStart, Math.abs(radian));
    const edges = new THREE.EdgesGeometry(arcMesh.geometry);
    const edgesMaterial =
        rangingPointStatus === RangingPointStatus.Click
            ? new THREE.LineBasicMaterial({ color: laneBoundaryColor[InterActiveType.Default] })
            : new THREE.LineDashedMaterial({ color: laneBoundaryColor[InterActiveType.Default] });
    group.add(arcMesh);
    group.add(new THREE.LineSegments(edges, edgesMaterial));
    return group;
}
export function drawRangeRemoveIcon(position: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({
        map: generateRangeRemoveTexture(),
    });
    material.map.colorSpace = 'srgb';
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.4), material);
    mesh.position.copy(position);
    return mesh;
}
export function showLabel(
    object: THREE.Object3D,
    text: string,
    parentId: string,
    position: THREE.Vector3,
    center: THREE.Vector2,
) {
    const labelDiv = document.createElement('div');
    labelDiv.className = `label-container label-container-${parentId}`;
    labelDiv.textContent = text;

    const label = new CSS2DObject(labelDiv);
    label.position.copy(position);
    label.center.copy(center);
    object.add(label);
}
/**
 * 获取扇形的标签，相对扇形原点的偏移单位向量
 * @param position 扇形中心点
 */
export function getArcLabelPosition(positions: THREE.Vector3[], angle: number) {
    const position = getPointPositionAfterRotation(positions[0], angle / 2, positions[1]);
    const normalizeVec = new THREE.Vector3(position.x - positions[1].x, position.y - positions[1].y, 0).normalize();
    return new THREE.Vector3(normalizeVec.x * 2, normalizeVec.y * 2, 0);
}
