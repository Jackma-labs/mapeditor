import { getElementColorAndOpacity } from 'src/constant/color';
import PubSub from 'pubsub-js';
import { mapElementZ } from 'src/constant/mapElementZ';
import { Groud } from 'src/interface/basicElementInterFace';
import { InterActiveType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { searchGroudFromGroudId, searchGroudShapePositions } from 'src/utils/search/groudSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { getAreaByVertexs, getRotateAngle } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import {
    generateParkingSpaceCanvasTexture,
    updateParkingSpaceCanvasTexture,
    updateTexture,
} from 'src/utils/textureUtil';
import { loadImage } from 'src/object/basicObject';
import { searchParkingSpaceByGroudId } from 'src/utils/search/parkingSpaceSearch';
import { searchAreaFromGroudId } from 'src/utils/search/areaSearch';
import { AreaType } from 'src/interface/areaInterFace';
import { useManagerStore } from 'src/store';
import { BarrierGateType } from 'src/interface/barrierGateInterFace';
import { searchBarrierGateFromGroudId } from 'src/utils/search/barrierGateSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getPolygonCenter } from 'src/utils/geometryUtil';
import crosswalkDefault from '../assets/images/image_sidewalk_normal@3x.png';
import crosswalkHover from '../assets/images/image_sidewalk_hover@3x.png';
import crosswalkActive from '../assets/images/image_sidewalk_pitch_on@3x.png';
import speedBumpDefault from '../assets/images/image_speed_bump_normal@2x.png';
import speedBumpHover from '../assets/images/image_speed_bump_hover@3x.png';
import speedBumpActive from '../assets/images/image_speed_bump_pitch_on@3x.png';
import undrivableHover from '../assets/images/undrivable_hover.png';
import undrivableActive from '../assets/images/undrivable_active.png';
import undrivableDefault from '../assets/images/undrivable_default.png';
import barrierGateFence from '../assets/images/ic_barrier_gate_fence_type@3x.png';
import barrierGateAdvertising from '../assets/images/ic_barrier_gate_advertisement_style@3x.png';
import barrierGateRod from '../assets/images/ic_barrier_gate_straight_rod_type@3x.png';
import barrierGateTelescopic from '../assets/images/ic_barrier_gate_telescopic@3x.png';
import barrierGateOther from '../assets/images/ic_barrier_gate_else@3x.png';

const barrierGateImageUrl = {
    [BarrierGateType.Fence]: barrierGateFence,
    [BarrierGateType.Advertising]: barrierGateAdvertising,
    [BarrierGateType.Rod]: barrierGateRod,
    [BarrierGateType.Telescopic]: barrierGateTelescopic,
    [BarrierGateType.Other]: barrierGateOther,
};

// groud的交互
let crosswalkDefaultTexture: THREE.Texture = null;
let crosswalkHoverTexture: THREE.Texture = null;
let crosswalkActiveTexture: THREE.Texture = null;
let speedBumpDefaultTexture: THREE.Texture = null;
let speedBumpHoverTexture: THREE.Texture = null;
let speedBumpActiveTexture: THREE.Texture = null;
let undrivableHoverTexture: THREE.Texture = null;
let undrivableActiveTexture: THREE.Texture = null;
let undrivableDefaultTexture: THREE.Texture = null;

const barrierGateTextures: { [id: number]: THREE.Texture } = {
    [BarrierGateType.Fence]: null,
    [BarrierGateType.Advertising]: null,
    [BarrierGateType.Rod]: null,
    [BarrierGateType.Telescopic]: null,
    [BarrierGateType.Other]: null,
};

export function updateGroudTexture(type: ThreeElementType, interActiveType: InterActiveType, obj: THREE.Mesh) {
    if (type === ThreeElementType.CrosswalkGroud && interActiveType === InterActiveType.Default) {
        if (crosswalkDefaultTexture) {
            updateTexture(obj, crosswalkDefaultTexture);
        } else {
            loadImage(crosswalkDefault).then((texture) => {
                crosswalkDefaultTexture = texture as THREE.Texture;
                updateTexture(obj, crosswalkDefaultTexture);
            });
        }
    } else if (type === ThreeElementType.CrosswalkGroud && interActiveType === InterActiveType.Hover) {
        if (crosswalkHoverTexture) {
            updateTexture(obj, crosswalkHoverTexture);
        } else {
            loadImage(crosswalkHover).then((texture) => {
                crosswalkHoverTexture = texture as THREE.Texture;
                updateTexture(obj, crosswalkHoverTexture);
            });
        }
    } else if (type === ThreeElementType.CrosswalkGroud && interActiveType === InterActiveType.Active) {
        if (crosswalkActiveTexture) {
            updateTexture(obj, crosswalkActiveTexture);
        } else {
            loadImage(crosswalkActive).then((texture) => {
                crosswalkActiveTexture = texture as THREE.Texture;
                updateTexture(obj, crosswalkActiveTexture);
            });
        }
    } else if (type === ThreeElementType.SpeedBumpGroud && interActiveType === InterActiveType.Active) {
        if (speedBumpActiveTexture) {
            updateTexture(obj, speedBumpActiveTexture);
        } else {
            loadImage(speedBumpActive).then((texture) => {
                speedBumpActiveTexture = texture as THREE.Texture;
                updateTexture(obj, speedBumpActiveTexture);
            });
        }
    } else if (type === ThreeElementType.SpeedBumpGroud && interActiveType === InterActiveType.Hover) {
        if (speedBumpHoverTexture) {
            updateTexture(obj, speedBumpHoverTexture);
        } else {
            loadImage(speedBumpHover).then((texture) => {
                speedBumpHoverTexture = texture as THREE.Texture;
                updateTexture(obj, speedBumpHoverTexture);
            });
        }
    } else if (type === ThreeElementType.SpeedBumpGroud && interActiveType === InterActiveType.Default) {
        if (speedBumpDefaultTexture) {
            updateTexture(obj, speedBumpDefaultTexture);
        } else {
            loadImage(speedBumpDefault).then((texture) => {
                speedBumpDefaultTexture = texture as THREE.Texture;
                updateTexture(obj, speedBumpDefaultTexture);
            });
        }
    } else if (type === ThreeElementType.AreaGroud && interActiveType === InterActiveType.Default) {
        if (undrivableDefaultTexture) {
            updateTexture(obj, undrivableDefaultTexture);
        } else {
            loadImage(undrivableDefault).then((texture) => {
                undrivableDefaultTexture = texture as THREE.Texture;
                updateTexture(obj, undrivableDefaultTexture);
            });
        }
    } else if (type === ThreeElementType.AreaGroud && interActiveType === InterActiveType.Hover) {
        if (undrivableHoverTexture) {
            updateTexture(obj, undrivableHoverTexture);
        } else {
            loadImage(undrivableHover).then((texture) => {
                undrivableHoverTexture = texture as THREE.Texture;
                updateTexture(obj, undrivableHoverTexture);
            });
        }
    } else if (type === ThreeElementType.AreaGroud && interActiveType === InterActiveType.Active) {
        if (undrivableActiveTexture) {
            updateTexture(obj, undrivableActiveTexture);
        } else {
            loadImage(undrivableActive).then((texture) => {
                undrivableActiveTexture = texture as THREE.Texture;
                updateTexture(obj, undrivableActiveTexture);
            });
        }
    } else if (type === ThreeElementType.ParkingSpaceGroud) {
        updateParkingSpaceCanvasTexture(obj, interActiveType);
    }
}
export function GroudInteraction(groud: THREE.Mesh, type: InterActiveType) {
    if (!groud || !type) {
        return;
    }
    const elementType: ThreeElementType = groud.userData.type;
    const { color, opacity } = getElementColorAndOpacity(elementType, type);

    if (
        elementType === ThreeElementType.CrosswalkGroud ||
        elementType === ThreeElementType.SpeedBumpGroud ||
        elementType === ThreeElementType.ParkingSpaceGroud
    ) {
        updateGroudTexture(elementType, type, groud);
    } else if (elementType === ThreeElementType.AreaGroud) {
        const id = groud.userData.id;
        const area = searchAreaFromGroudId(id);
        if (area && area.type === AreaType.UnDriveable) {
            updateGroudTexture(elementType, type, groud);
        } else if (area && area.type !== AreaType.UnDriveable) {
            // @ts-ignore
            groud.material?.dispose();
            groud.material = new THREE.MeshBasicMaterial({
                color,
                opacity,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: 0,
                polygonOffsetUnits: 0.01,
            });
        }
    } else {
        // @ts-ignore
        groud.material.color.set(color);
    }
    (groud.material as THREE.Material).needsUpdate = true;
}
export function getShapeUvs(shapePositions: THREE.Vector2[], type: ThreeElementType) {
    const uvs = [];
    if (type === ThreeElementType.CrosswalkGroud) {
        if (getAreaByVertexs(shapePositions) < 0) {
            uvs.push(1, 1);
            uvs.push(0, 1);
            uvs.push(0, 0);
            uvs.push(1, 0);
        } else {
            uvs.push(1, 1);
            uvs.push(1, 0);
            uvs.push(0, 0);
            uvs.push(0, 1);
        }
    } else if (type === ThreeElementType.SpeedBumpGroud) {
        if (getAreaByVertexs(shapePositions) < 0) {
            uvs.push(1, 1);
            uvs.push(1, 0);
            uvs.push(0, 0);
            uvs.push(0, 1);
        } else {
            uvs.push(1, 1);
            uvs.push(0, 1);
            uvs.push(0, 0);
            uvs.push(1, 0);
        }
    } else if (type === ThreeElementType.ParkingSpaceGroud) {
        if (getAreaByVertexs(shapePositions) < 0) {
            uvs.push(0, 1);
            uvs.push(0, 0);
            uvs.push(1, 0);
            uvs.push(1, 1);
        } else {
            uvs.push(0, 1);
            uvs.push(1, 1);
            uvs.push(1, 0);
            uvs.push(0, 0);
        }
    } else if (type === ThreeElementType.AreaGroud) {
        // 先求box2包围盒
        const box2 = new THREE.Box2().setFromPoints(shapePositions);
        const { min, max } = box2;
        const width = max.x - min.x;
        const height = max.y - min.y;
        const leftBottom = new THREE.Vector2(min.x, min.y);
        const rightBottom = new THREE.Vector2(max.x, min.y);
        const positions = getAreaByVertexs(shapePositions) < 0 ? [...shapePositions] : shapePositions.reverse();
        // 左下角是texture的(0,0)，所以基于此点计算
        positions.slice(0, shapePositions.length - 1).forEach((item) => {
            const v1 = new THREE.Vector2().subVectors(rightBottom, leftBottom);
            const v2 = new THREE.Vector2().subVectors(item, leftBottom);
            const distance = leftBottom.distanceTo(item);
            const angle = v1.angleTo(v2);
            const uvx = (Math.cos(angle) * distance) / width;
            const uvy = (Math.sin(angle) * distance) / height;
            uvs.push(Math.max(0, Math.min(uvx, 1)), Math.max(0, Math.min(uvy, 1)));
        });
    }
    return uvs;
}
export function createShapeGeometry(groud: Groud) {
    let geometry: THREE.BufferGeometry = null;
    const shapePositions = searchGroudShapePositions(groud.id);
    if (!shapePositions || shapePositions.length < 3) {
        return null;
    }
    if (groud.type === ThreeElementType.LaneCurveGroud) {
        if (shapePositions.length < 8) {
            return null;
        }
        const shape = new THREE.Shape();
        shape.moveTo(shapePositions[0].x, shapePositions[0].y);
        shape.bezierCurveTo(
            shapePositions[1].x,
            shapePositions[1].y,
            shapePositions[2].x,
            shapePositions[2].y,
            shapePositions[3].x,
            shapePositions[3].y,
        );
        shape.lineTo(shapePositions[4].x, shapePositions[4].y);
        shape.bezierCurveTo(
            shapePositions[5].x,
            shapePositions[5].y,
            shapePositions[6].x,
            shapePositions[6].y,
            shapePositions[7].x,
            shapePositions[7].y,
        );
        shape.closePath();
        geometry = new THREE.ShapeGeometry(shape);
    } else {
        const shape = new THREE.Shape(shapePositions.map((p) => new THREE.Vector2(p.x, p.y)));
        geometry = new THREE.ShapeGeometry(shape);
    }

    const uvs = getShapeUvs(shapePositions, groud.type);
    if (uvs.length) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
        geometry.getAttribute('uv').needsUpdate = true;
    }
    return geometry;
}
export function getGroudMaterial(groud: Groud, interActiveType: InterActiveType = InterActiveType.Default) {
    if (!groud) {
        return null;
    }
    const { color, opacity } = getElementColorAndOpacity(groud.type, interActiveType);
    let material = null;
    if (groud.type !== ThreeElementType.ParkingSpaceGroud) {
        material = new THREE.MeshBasicMaterial({
            color,
            opacity,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: 0.01,
        });
    } else {
        const parkingSpace = searchParkingSpaceByGroudId(groud.id);
        if (!parkingSpace) {
            return null;
        }
        const texture = generateParkingSpaceCanvasTexture(
            interActiveType,
            parkingSpace.length * 100,
            parkingSpace.width * 100,
        );
        material = new THREE.MeshBasicMaterial({
            map: texture,
            opacity,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: 0.01,
        });
    }
    return material;
}
export function updateBarrierGateGroudIcon(mesh: THREE.Object3D, groudId: string) {
    if (!mesh || !groudId) {
        return;
    }
    const barrierGate = searchBarrierGateFromGroudId(groudId);
    if (!barrierGate) {
        return;
    }
    const { type } = barrierGate;
    const points = searchPointsFromBoundaryId(barrierGate.boundaryId);
    const pointPositions: THREE.Vector3[] = [];
    points.forEach((item) => {
        const pmesh = objectSearch(ThreeObject.Point, item.id);
        pointPositions.push(pmesh.position.clone());
    });
    const width = pointPositions[0].distanceTo(pointPositions[1]);
    const length = pointPositions[1].distanceTo(pointPositions[2]);
    const rotateZ = getRotateAngle(pointPositions[0], pointPositions[1]);
    const center = getPolygonCenter(pointPositions);
    const barrierGateIconWidth = width / 2 >= length ? length * 0.8 : width / 2;
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(barrierGateIconWidth, barrierGateIconWidth),
        new THREE.MeshBasicMaterial({
            map: barrierGateTextures[type],
            transparent: true,
        }),
    );
    plane.position.set(center.x, center.y, mapElementZ[ThreeElementType.BarrierGateGroud] + 0.01);
    plane.rotateZ(rotateZ);
    // 需要绘制一个图标
    if (barrierGateTextures[type]) {
        if (mesh.children[0]) {
            (mesh.children[0] as THREE.Mesh).geometry = plane.geometry;
            (mesh.children[0] as THREE.Mesh).position.copy(plane.position);
            (mesh.children[0] as THREE.Mesh).quaternion.copy(plane.quaternion);
        } else {
            mesh.add(plane);
        }
        // @ts-ignore
        (mesh.children[0] as THREE.Mesh).material.map = barrierGateTextures[type];
        PubSub.publishSync('render');
    } else {
        loadImage(barrierGateImageUrl[type]).then((texture) => {
            barrierGateTextures[type] = texture as THREE.Texture;
            if (mesh.children[0]) {
                (mesh.children[0] as THREE.Mesh).geometry = plane.geometry;
                (mesh.children[0] as THREE.Mesh).position.copy(plane.position);
                (mesh.children[0] as THREE.Mesh).quaternion.copy(plane.quaternion);
            } else {
                mesh.add(plane);
            }
            // @ts-ignore
            (mesh.children[0] as THREE.Mesh).material.map = texture;
            PubSub.publishSync('render');
        });
    }
}
export function drawGroud(groudId: string, interActiveType: InterActiveType = InterActiveType.Default) {
    const groud = searchGroudFromGroudId(groudId);
    if (!groud) {
        return null;
    }
    const geometry = createShapeGeometry(groud);
    if (!geometry) {
        return null;
    }
    const material = getGroudMaterial(groud, interActiveType);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${ThreeObject.Groud}`;
    mesh.userData = {
        id: groudId,
        type: groud.type,
    };
    mesh.position.z = mapElementZ[groud.type];
    GroudInteraction(mesh, InterActiveType.Default);
    if (groud.type === ThreeElementType.BarrierGateGroud) {
        updateBarrierGateGroudIcon(mesh, groudId);
    }
    return mesh;
}
export function updateGroud(groudId: string) {
    if (!groudId) {
        return;
    }
    const { currentPickElement } = useManagerStore.getState().mapState;
    const groud = searchGroudFromGroudId(groudId);
    const groudMesh = objectSearch(ThreeObject.Groud, groudId);
    if (!groud || !groudMesh) {
        return;
    }
    const newGroud = drawGroud(groudId);
    if (!newGroud) {
        PubSub.publishSync('removeObject', groudMesh);
    } else {
        (groudMesh as THREE.Mesh).geometry = newGroud.geometry;
        (groudMesh as THREE.Mesh).userData = newGroud.userData;
        (groudMesh as THREE.Mesh).position.copy(newGroud.position);
        (groudMesh as THREE.Mesh).quaternion.copy(newGroud.quaternion);
        (groudMesh as THREE.Mesh).geometry.computeBoundingSphere();
    }
    const interActiveType =
        currentPickElement[0]?.type === groud.type && currentPickElement[0]?.id === groudId
            ? InterActiveType.Active
            : InterActiveType.Default;
    // 如果groud为道闸，记得要清除道闸的icon，因为后面会更新道闸的icon
    if (groud.type === ThreeElementType.BarrierGateGroud && groudMesh) {
        updateBarrierGateGroudIcon(groudMesh, groudId);
    }
    GroudInteraction(groudMesh as THREE.Mesh, interActiveType);
}
