import { AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { Junction } from 'src/interface/junctionInterFace';
import { Lane } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { getLaneEndPointIds, getLaneStartPointIds } from 'src/utils/geometryUtil';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import PubSub from 'pubsub-js';
import * as THREE from 'three';

const MAX_ATTACH_DISTANCE = 30;

function distancePointToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3) {
    const segment = new THREE.Vector3().subVectors(end, start);
    const segmentLengthSq = segment.lengthSq();
    if (segmentLengthSq === 0) {
        return point.distanceTo(start);
    }

    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(point, start).dot(segment) / segmentLengthSq));
    const projection = start.clone().add(segment.multiplyScalar(t));
    return point.distanceTo(projection);
}

function getPointDistanceToBoundary(pointId: string, boundaryId: string) {
    const { points } = useManagerStore.getState().mapState;
    const point = points[pointId];
    const boundaryPoints = searchPointsFromBoundaryId(boundaryId);
    if (!point || boundaryPoints.length < 2) {
        return Infinity;
    }

    let minDistance = Infinity;
    for (let i = 0; i < boundaryPoints.length - 1; i += 1) {
        const start = boundaryPoints[i];
        const end = boundaryPoints[i + 1];
        if (start && end) {
            minDistance = Math.min(minDistance, distancePointToSegment(point.position, start.position, end.position));
        }
    }
    return minDistance;
}

function getEndpointPairDistance(pointIds: [string, string], boundaryId: string) {
    const [leftPointId, rightPointId] = pointIds;
    if (!leftPointId || !rightPointId) {
        return Infinity;
    }
    return getPointDistanceToBoundary(leftPointId, boundaryId) + getPointDistanceToBoundary(rightPointId, boundaryId);
}

function getClosestLaneEndpointPair(lane: Lane, junctionBoundaryId: string) {
    const startPointIds = getLaneStartPointIds(lane);
    const endPointIds = getLaneEndPointIds(lane);
    const startDistance = getEndpointPairDistance(startPointIds, junctionBoundaryId);
    const endDistance = getEndpointPairDistance(endPointIds, junctionBoundaryId);

    return startDistance <= endDistance
        ? { pointIds: startPointIds, distance: startDistance }
        : { pointIds: endPointIds, distance: endDistance };
}

export function mergeJunctionLane(junction: Junction, lane: Lane) {
    if (!junction || !lane) {
        return;
    }

    const state = useManagerStore.getState().mapState;
    const boundary = state.boundarys[junction.boundaryId];
    if (!boundary || !junction.groudId) {
        return;
    }

    const { pointIds, distance } = getClosestLaneEndpointPair(lane, junction.boundaryId);
    if (distance > MAX_ATTACH_DISTANCE * pointIds.length) {
        console.warn('mergeJunctionLane: lane endpoint is too far from junction boundary');
        return;
    }

    const existPointIds = new Set(boundary.pointIds);
    const actions = [];
    pointIds.forEach((pointId) => {
        if (!pointId || existPointIds.has(pointId)) {
            return;
        }
        existPointIds.add(pointId);
        actions.push(new AddPointToBoundaryCommand(pointId, junction.boundaryId, false, false));
    });

    if (actions.length === 0) {
        PubSub.publishSync('emptyPickObjects');
        return;
    }

    actions.push(new UpdateGroudCommand(junction.groudId));
    actions.push(new UpdateGroudCommand(lane.groudId));
    useManagerStore.getState().addCommand(actions);
    PubSub.publishSync('emptyPickObjects');
    PubSub.publish('render');
}
