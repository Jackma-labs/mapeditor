import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchParkingSpaceByArrowId } from 'src/utils/search/parkingSpaceSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getMiddlePosition, getRotateAngle } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import * as turf from '@turf/turf';
import { mapElementZ } from 'src/constant/mapElementZ';
import { searchLaneByArrowId, searchLaneByLaneId, searchLaneFirstPeriodPoints } from 'src/utils/search/laneSearch';
import { LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { searchGroudFromGroudId } from 'src/utils/search/groudSearch';
import { generateArrowCanvasTexture } from 'src/utils/textureUtil';
import { getBezierHalfLengthPosition } from 'src/threeUtil/BezierCurve3Control/util';

/**
 * 获取lane的相对方向的位置和deg
 */
export function getLaneRelativePositionAndDeg(laneId: string) {
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return {};
    }
    const groud = searchGroudFromGroudId(lane.groudId);
    const [leftPoint1, leftPoint2, rightPoint1, rightPoint2] = searchLaneFirstPeriodPoints(laneId);
    if (!leftPoint1 || !leftPoint2 || !rightPoint1 || !rightPoint2 || !lane || !groud) {
        return {};
    }
    const rightPointMesh1 = objectSearch(ThreeObject.Point, rightPoint1.id);
    const rightPointMesh2 = objectSearch(ThreeObject.Point, rightPoint2.id);
    const polygonPoints: number[][] = [];
    const deg = getRotateAngle(rightPointMesh1.position, rightPointMesh2.position);

    if (lane.type === LaneTrend.Straight) {
        if (!leftPoint1 || !leftPoint2 || !rightPoint1 || !rightPoint2) {
            return {};
        }
        [leftPoint1, leftPoint2, rightPoint2, rightPoint1, leftPoint1].forEach((point) => {
            const pointMesh = objectSearch(ThreeObject.Point, point.id);
            if (pointMesh) {
                polygonPoints.push([pointMesh.position.x, pointMesh.position.y]);
            }
        });
        const polygon = turf.polygon([polygonPoints]);
        const [x, y] = turf.centerOfMass(polygon).geometry.coordinates;
        return {
            position: new THREE.Vector3(x, y, mapElementZ[ThreeElementType.LaneRelativeDirection]),
            deg,
        };
    }
    // 获取左边界线的中点，然后右边界线的中点，两个点连线的中间位置就是箭头的位置
    const center1 = getBezierHalfLengthPosition(lane.leftBoundaryId);
    const center2 = getBezierHalfLengthPosition(lane.rightBoundaryId);
    const middle = getMiddlePosition(center1, center2);
    return {
        position: middle,
        deg,
    };
}
/**
 * 获取绘制箭头的info，包括position、deg、imgurl
 */
export function getDrawLaneArrowInfo(arrowId: string) {
    const lane = searchLaneByArrowId(arrowId);
    if (!lane) {
        return { position: null, deg: null, prossibleDrivingDirection: ProssibleDrivingDirection.FORWARD };
    }
    const { position, deg } = getLaneRelativePositionAndDeg(lane.id);
    const { prossibleDrivingDirection } = lane.attr;
    return { position, deg, prossibleDrivingDirection };
}

export function getParkingSpaceHeadingPosition(arrowId: string) {
    const parkingSpace = searchParkingSpaceByArrowId(arrowId);
    if (!parkingSpace) {
        return {};
    }
    const points = searchPointsFromBoundaryId(parkingSpace.boundaryId);
    if (!points || points.length !== 5) {
        return {};
    }
    // 确定中心点
    const polygon: any = [[]];
    points.forEach((point) => {
        const pointMesh = objectSearch(ThreeObject.Point, point.id);
        if (pointMesh) {
            polygon[0].push([pointMesh.position.x, pointMesh.position.y]);
        }
    });
    const [x, y] = turf.centerOfMass(turf.polygon(polygon)).geometry.coordinates;
    return {
        position: new THREE.Vector3(x, y, mapElementZ[ThreeElementType.ParkingSpaceHeading]),
        deg: getRotateAngle(points[1].position, points[2].position),
    };
}
export function getDrawParkingSpaceHeadingInfo(arrowId: string) {
    const { position, deg } = getParkingSpaceHeadingPosition(arrowId);
    return { position, deg, prossibleDrivingDirection: ProssibleDrivingDirection.FORWARD };
}
export function getArrowInfo(arrowId: string) {
    const { prossibleDrivingDirections } = useManagerStore.getState().mapState;
    const arrow = prossibleDrivingDirections[arrowId];
    if (!arrow) {
        return null;
    }
    if (arrow.type === ThreeElementType.LaneRelativeDirection) {
        return getDrawLaneArrowInfo(arrowId);
    }
    return getDrawParkingSpaceHeadingInfo(arrowId);
}
export function drawArrow(arrowId: string) {
    const { prossibleDrivingDirections } = useManagerStore.getState().mapState;
    const arrow = prossibleDrivingDirections[arrowId];
    if (!arrow) {
        return null;
    }
    const { position, deg, prossibleDrivingDirection } = getArrowInfo(arrowId);
    if (!position) {
        return null;
    }

    const material = new THREE.MeshBasicMaterial({
        map: generateArrowCanvasTexture(prossibleDrivingDirection),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: 0.01,
    });
    material.map.colorSpace = 'srgb';
    const length = prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION ? 1.8 : 1.2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, length), material);
    mesh.position.copy(position);
    mesh.rotateZ(deg);

    mesh.userData = { id: arrowId, type: arrow.type, prossibleDrivingDirection };
    mesh.name = `${ThreeObject.Arrow}`;

    return mesh;
}

export function updateArrow(arrowId: string) {
    const arrow = useManagerStore.getState().mapState.prossibleDrivingDirections[arrowId];
    const arrowMesh = objectSearch(ThreeObject.Arrow, arrowId);
    if (!arrowMesh || !arrow) {
        return;
    }

    const { type } = arrow;
    let arrowInfo: { position?: THREE.Vector3; deg?: number; prossibleDrivingDirection?: ProssibleDrivingDirection } =
        {} as any;
    if (type === ThreeElementType.LaneRelativeDirection) {
        arrowInfo = getDrawLaneArrowInfo(arrowId);
    } else {
        arrowInfo = getParkingSpaceHeadingPosition(arrowId);
    }
    if (!arrowInfo.position) {
        return;
    }
    if (
        type === ThreeElementType.LaneRelativeDirection &&
        arrowInfo.prossibleDrivingDirection !== arrowMesh.userData.prossibleDrivingDirection
    ) {
        PubSub.publishSync('removeObject', arrowMesh);
        const mesh = drawArrow(arrowId);
        PubSub.publishSync('addObject', mesh);
        PubSub.publishSync('render');
    } else {
        const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), arrowInfo.deg);
        arrowMesh.quaternion.copy(quaternion);
        arrowMesh.position.x = arrowInfo.position.x;
        arrowMesh.position.y = arrowInfo.position.y;
    }
}
