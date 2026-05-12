import { AddArrowCommand } from 'src/command/ArrowCommand';
import { AddBoundaryCommand, AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddGroudCommand } from 'src/command/GroudCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import {
    AddParkingSpaceCommand,
    UpdateParkingSpaceLengthCommand,
    UpdateParkingSpaceWidthCommand,
} from 'src/command/ParkingSpaceCommand';
import { AddPointCommand } from 'src/command/PointCommand';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchParkingSpaceByParkingSpaceId } from 'src/utils/search/parkingSpaceSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import * as THREE from 'three';
/**
 * @param parkingSpaceId 停车区Id
 * @param num 按第几条边去复制的
 * return 4个点
 */
export function getCopyParkingSpacePoints(parkingSpaceId: string, num: number) {
    const parkingSpace = searchParkingSpaceByParkingSpaceId(parkingSpaceId);
    const { boundaryId, width, length } = parkingSpace;
    const points = searchPointsFromBoundaryId(boundaryId);
    if (!points || points.length === 0) {
        return [];
    }
    const result: THREE.Vector3[] = [];
    let axis: THREE.Vector3 = null;
    let distance = 0;
    const firstPointMeshWorldPosition = objectSearch(ThreeObject.Point, points[0].id)?.position;
    const secondPointMeshWorldPosition = objectSearch(ThreeObject.Point, points[1].id)?.position;
    const thirdPointMeshWorldPosition = objectSearch(ThreeObject.Point, points[2].id)?.position;
    if (!firstPointMeshWorldPosition || !secondPointMeshWorldPosition || !thirdPointMeshWorldPosition) {
        return [];
    }
    switch (num) {
        case 1:
            axis = new THREE.Vector3()
                .subVectors(secondPointMeshWorldPosition, thirdPointMeshWorldPosition)
                .normalize();
            distance = length;
            break;
        case 2:
            axis = new THREE.Vector3()
                .subVectors(secondPointMeshWorldPosition, firstPointMeshWorldPosition)
                .normalize();
            distance = width;
            break;
        case 3:
            axis = new THREE.Vector3()
                .subVectors(thirdPointMeshWorldPosition, secondPointMeshWorldPosition)
                .normalize();
            distance = length;
            break;
        case 4:
            axis = new THREE.Vector3()
                .subVectors(firstPointMeshWorldPosition, secondPointMeshWorldPosition)
                .normalize();
            distance = width;
            break;
        default:
            break;
    }
    if (!axis || !distance) {
        return [];
    }
    points.forEach((item) => {
        const pointMesh = objectSearch(ThreeObject.Point, item.id);
        if (pointMesh) {
            result.push(pointMesh.clone().translateOnAxis(axis, distance).position);
        }
    });
    return result;
}

/**
 * @param parkingSpaceId 停车区Id
 * @param num 按第几条边去复制的
 */
export function copyParkingSpaceHandle(parkingSpaceId: string, num: number) {
    if (!parkingSpaceId) {
        return;
    }
    const pointPositions = getCopyParkingSpacePoints(parkingSpaceId, num);
    if (!pointPositions || pointPositions.length === 0) {
        return;
    }

    const { mapState, addCommand } = useManagerStore.getState();
    const parkingSpace = searchParkingSpaceByParkingSpaceId(parkingSpaceId);
    const { parkingSpaces, points, boundarys, grouds, prossibleDrivingDirections } = mapState;
    const newParkingSpaceId = `${getElementMaxIndex(parkingSpaces) + 1}`;
    const newBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const newGroudId = `${getElementMaxIndex(grouds) + 1}`;
    const newArrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const actions = [];
    actions.push(new AddParkingSpaceCommand(newParkingSpaceId, newBoundaryId, newGroudId, newArrowId));
    actions.push(
        new AddBoundaryCommand(
            newBoundaryId,
            ThreeElementType.ParkingSpaceBoundary,
            BoundaryOriginType.ParkingSpace,
            [],
            [],
        ),
    );
    actions.push(new AddGroudCommand(newGroudId, ThreeElementType.ParkingSpaceGroud));
    pointPositions.forEach((item, index) => {
        if (index !== pointPositions.length - 1) {
            const newPointId = `${getElementMaxIndex(points) + index + 1}`;
            actions.push(new AddPointCommand(newPointId, item, ThreeElementType.ParkingSpacePoint));
            actions.push(new AddPointToBoundaryCommand(newPointId, newBoundaryId, true, false));
        } else {
            actions.push(
                new AddPointToBoundaryCommand(`${getElementMaxIndex(points) + 1}`, newBoundaryId, true, false),
            );
        }
    });
    actions.push(new UpdateParkingSpaceWidthCommand(newParkingSpaceId, parkingSpace.width));
    actions.push(new UpdateParkingSpaceLengthCommand(newParkingSpaceId, parkingSpace.length));
    actions.push(new AddArrowCommand(newArrowId, ThreeElementType.ParkingSpaceHeading));
    actions.push(new SetOperationTypeCommand(null));
    addCommand(actions);
}
