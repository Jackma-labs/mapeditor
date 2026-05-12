import { PointElement } from 'src/interface/basicElementInterFace';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { Crosswalk } from 'src/interface/crosswalkInterFace';
import { Junction } from 'src/interface/junctionInterFace';
import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { TrafficSignal } from 'src/interface/trafficSignal';
import {
    getBoundaryRotateElementsPositionAndDeg,
    getPolygonRotateElementsPosition,
} from 'src/threeUtil/RotateControl/util';
import { useManagerStore } from 'src/store';
import { searchCrosswalkByGroudId } from 'src/utils/search/crosswalkSearch';
import { searchJunctionFromGroudId } from 'src/utils/search/junctionSearch';
import { searchLaneFromGroudId } from 'src/utils/search/laneSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchParkingSpaceByGroudId } from 'src/utils/search/parkingSpaceSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchTrafficLightByTrafficLightId } from 'src/utils/search/trafficLightSearch';
import * as THREE from 'three';
import { generateRotateBasePointCanvasTexture, generateRotateHandleCanvasTexture } from 'src/utils/textureUtil';
import { mapElementZ } from 'src/constant/mapElementZ';
import { Area } from 'src/interface/areaInterFace';
import { searchAreaFromGroudId } from 'src/utils/search/areaSearch';
import { BarrierGate } from 'src/interface/barrierGateInterFace';
import { searchBarrierGateFromGroudId } from 'src/utils/search/barrierGateSearch';
import { getTrafficLightPolygonPositions } from './trafficLight';

export function getRotateElementsInfo() {
    const state = useManagerStore.getState().mapState;
    if (!state.currentPickElement || state.currentPickElement.length === 0) {
        return [];
    }
    const { currentPickElement } = state;
    const { id, type } = currentPickElement[0];
    let rotateElementsInfo: { position: THREE.Vector3 | THREE.Vector2; deg: number }[] = null;
    if (
        type === ThreeElementType.LaneBoundary ||
        type === ThreeElementType.RoadBoundary ||
        type === ThreeElementType.LaneGroud
    ) {
        if (type === ThreeElementType.LaneGroud) {
            const lane = searchLaneFromGroudId(id);
            const boundaryId = lane.rightBoundaryId;
            rotateElementsInfo = getBoundaryRotateElementsPositionAndDeg(boundaryId);
        } else {
            rotateElementsInfo = getBoundaryRotateElementsPositionAndDeg(id);
        }
        return rotateElementsInfo;
    }
    if (
        type === ThreeElementType.JunctionGroud ||
        type === ThreeElementType.CrosswalkGroud ||
        type === ThreeElementType.ParkingSpaceGroud ||
        type === ThreeElementType.TrafficLight ||
        type === ThreeElementType.AreaGroud ||
        type === ThreeElementType.BarrierGateGroud
    ) {
        let rotateObject: Junction | Crosswalk | ParkingSpace | TrafficSignal | Area | BarrierGate = null;
        let positions = [];
        if (type === ThreeElementType.JunctionGroud) {
            rotateObject = searchJunctionFromGroudId(id);
        }
        if (type === ThreeElementType.AreaGroud) {
            rotateObject = searchAreaFromGroudId(id);
        }
        if (type === ThreeElementType.BarrierGateGroud) {
            rotateObject = searchBarrierGateFromGroudId(id);
        }
        if (type === ThreeElementType.ParkingSpaceGroud) {
            rotateObject = searchParkingSpaceByGroudId(id);
        }
        if (type === ThreeElementType.CrosswalkGroud) {
            rotateObject = searchCrosswalkByGroudId(id);
        }
        if (type === ThreeElementType.TrafficLight) {
            rotateObject = searchTrafficLightByTrafficLightId(id);
        }
        if (type === ThreeElementType.TrafficLight) {
            const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, id);
            if (!trafficLightMesh) {
                return [];
            }
            positions = getTrafficLightPolygonPositions(trafficLightMesh as THREE.Mesh);
        } else {
            if (!rotateObject) {
                return [];
            }
            const points = searchPointsFromBoundaryId((rotateObject as any).boundaryId);
            positions = [...points].map((item) =>
                // 这里我们始终用旋转之前的点坐标，因为，如果不这样做，旋转基点和旋转手柄会随着polygon的点坐标更改而不断改变
                // const pointMesh = objectSearch(ThreeObject.Point, item.id);
                [item.position.x, item.position.y],
            );
        }
        rotateElementsInfo = getPolygonRotateElementsPosition(positions);
        return rotateElementsInfo;
    }
    return rotateElementsInfo;
}
/**
 * 在三维场景中绘制可旋转的基准点。
 * @param position 可选，基准点的位置坐标。
 * @returns 返回绘制后的基准点组成的 THREE.Group 对象。
 */
export function drawRotateBasePoint(position: THREE.Vector2 | THREE.Vector3) {
    const { dom, camera } = useManagerStore.getState().mapState;

    const texture = generateRotateBasePointCanvasTexture();
    const material = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, transparent: true });

    const sprite = new THREE.Sprite(material);
    let scale = 48 / dom.clientHeight;
    const { fov } = camera;
    scale *= Math.tan((fov / 2 / 180) * Math.PI) / Math.tan((25 / 180) * Math.PI);
    sprite.scale.set(scale, scale, 1);
    sprite.position.set(position.x, position.y, mapElementZ[ThreeElementType.RotateBasePoint]);

    sprite.userData.type = ThreeElementType.RotateBasePoint;
    sprite.userData.position = position;

    return sprite;
}

/**
 * 绘制旋转手柄
 */
export function drawRotateHandle(
    position: THREE.Vector2 | THREE.Vector3,
    rotateBasePosition: THREE.Vector2 | THREE.Vector3,
    start: boolean,
    rotate: number = 0,
) {
    const { dom, camera } = useManagerStore.getState().mapState;

    const texture = generateRotateHandleCanvasTexture(start);
    const material = new THREE.SpriteMaterial({
        map: texture,
        sizeAttenuation: false,
        transparent: true,
    });
    material.map.colorSpace = 'srgb';

    const sprite = new THREE.Sprite(material);
    const { fov } = camera;
    // let scale = 84 / dom.clientHeight;
    // scale *= Math.tan((fov / 2 / 180) * Math.PI) / Math.tan((25 / 180) * Math.PI);
    const scale = (84 * (2 * Math.tan((fov / 2 / 180) * Math.PI))) / dom.clientHeight;
    sprite.scale.set(scale, scale, 1);

    sprite.material.map.center.set(0.5, 0.5);
    sprite.material.rotation = rotate;
    sprite.position.set(position.x, position.y, mapElementZ[ThreeElementType.RotateBasePoint]);

    sprite.userData = {
        type: ThreeElementType.RotateHandle,
        rotateBasePosition,
        start,
    };

    return sprite;
}
export function drawRotateElements() {
    const state = useManagerStore.getState().mapState;
    if (!state.currentPickElement || state.currentPickElement.length === 0) {
        return [];
    }
    const { currentPickElement } = state;
    const { id, type } = currentPickElement[0];
    const rotateElementsInfo = getRotateElementsInfo();
    if (
        type === ThreeElementType.LaneBoundary ||
        type === ThreeElementType.RoadBoundary ||
        type === ThreeElementType.LaneGroud
    ) {
        let points: PointElement[] = [];
        if (type === ThreeElementType.LaneGroud) {
            const lane = searchLaneFromGroudId(id);
            if (!lane) {
                return [];
            }
            points = searchPointsFromBoundaryId(lane.rightBoundaryId);
        } else {
            points = searchPointsFromBoundaryId(id);
        }
        if (
            !rotateElementsInfo[0]?.position ||
            !rotateElementsInfo[1]?.position ||
            !rotateElementsInfo[2]?.position ||
            !rotateElementsInfo[3]?.position
        ) {
            return [];
        }
        const rotateStartBasePointGroup = drawRotateBasePoint(rotateElementsInfo[0].position);
        const rotateEndBasePointGroup = drawRotateBasePoint(rotateElementsInfo[1].position);
        const rotateStartHandleGroup = drawRotateHandle(
            /**
             * params1: 右边界起始点偏移后手柄位置
             * params2: 右边界起始点位置
             * params3:
             * params4: 右边界起始点偏移后手柄旋转角度
             */
            rotateElementsInfo[2].position,
            points[0].position,
            true,
            rotateElementsInfo[2].deg,
        );
        const rotateEndHandleGroup = drawRotateHandle(
            rotateElementsInfo[3].position,
            points[points.length - 1].position,
            false,
            rotateElementsInfo[3].deg,
        );
        return [rotateStartBasePointGroup, rotateEndBasePointGroup, rotateStartHandleGroup, rotateEndHandleGroup];
    }
    if (
        type === ThreeElementType.JunctionGroud ||
        type === ThreeElementType.AreaGroud ||
        type === ThreeElementType.CrosswalkGroud ||
        type === ThreeElementType.ParkingSpaceGroud ||
        type === ThreeElementType.TrafficLight ||
        type === ThreeElementType.BarrierGateGroud
    ) {
        if (!rotateElementsInfo[0]?.position || !rotateElementsInfo[2]?.position || !rotateElementsInfo[3]?.position) {
            return [];
        }
        return [
            drawRotateBasePoint(rotateElementsInfo[0].position),
            null,
            drawRotateHandle(
                rotateElementsInfo[2].position,
                rotateElementsInfo[0].position,
                false,
                rotateElementsInfo[2].deg,
            ),
            drawRotateHandle(
                rotateElementsInfo[3].position,
                rotateElementsInfo[0].position,
                true,
                rotateElementsInfo[3].deg,
            ),
        ];
    }
    return [];
}

export function updateRotateElements(elements: THREE.Sprite[]) {
    if (!elements || elements.length === 0 || !elements[0]) {
        return;
    }
    const rotateElementsInfo = getRotateElementsInfo();
    rotateElementsInfo.forEach((item, index) => {
        if (elements[index] && item) {
            elements[index].position.x = item.position.x;
            elements[index].position.y = item.position.y;
            elements[index].material.rotation = item.deg;
            elements[index].material.needsUpdate = true;
        }
    });
}
