import { useManagerStore } from 'src/store';
import { Lane } from 'src/interface/laneInterFace';
import { Boundary } from 'src/interface/basicElementInterFace';
import { uniqBy } from 'lodash';
import {
    searchBoundaryByBoundaryId,
    searchBoundaryPointsByBoundaryId,
    searchBoundarysFromPointId,
} from './boundarySearch';
import { searchPointsFromBoundaryId } from './pointSearch';

export function searchLaneByLaneId(laneId: string) {
    const { lanes } = useManagerStore.getState().mapState;
    if (!lanes[laneId]) {
        console.warn(`searchLaneByLaneId时，没有找到id为${laneId}的lane`);
        return null;
    }
    return lanes[laneId];
}
/**
 * 获取lane的最后一节车道的所有点,一共返回四个点，分别是左边界的倒数第二个和最后一个点，以及右边界的倒数第二个和最后一个点
 */
export function searchLaneLastPeriodPoints(laneId: string) {
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return [];
    }
    const { leftBoundaryReverse, rightBoundaryReverse, leftBoundaryId, rightBoundaryId } = lane;
    const leftBoundaryPoints = searchBoundaryPointsByBoundaryId(leftBoundaryId);
    const rightBoundaryPoints = searchBoundaryPointsByBoundaryId(rightBoundaryId);
    if (leftBoundaryPoints.length < 2 || rightBoundaryPoints.length < 2) {
        return [];
    }
    const leftPoints = leftBoundaryReverse
        ? [leftBoundaryPoints[1], leftBoundaryPoints[0]]
        : [leftBoundaryPoints[leftBoundaryPoints.length - 2], leftBoundaryPoints[leftBoundaryPoints.length - 1]];
    const rightPoints = rightBoundaryReverse
        ? [rightBoundaryPoints[1], rightBoundaryPoints[0]]
        : [rightBoundaryPoints[rightBoundaryPoints.length - 2], rightBoundaryPoints[rightBoundaryPoints.length - 1]];
    return [...leftPoints, ...rightPoints];
}
/**
 * 获取lane的左边界的第一节车道的所有点,一共返回四个点，分别是左边界第一个和第二个点，以及右边界第一个和第二个点
 */
export function searchLaneFirstPeriodPoints(laneId: string) {
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        console.warn(`searchLaneFirstPeriodPoints时，没有找到id为${laneId}的lane`);
        return [];
    }
    const { leftBoundaryReverse, rightBoundaryReverse, leftBoundaryId, rightBoundaryId } = lane;
    const leftBoundaryPoints = searchBoundaryPointsByBoundaryId(leftBoundaryId);
    const rightBoundaryPoints = searchBoundaryPointsByBoundaryId(rightBoundaryId);
    if (leftBoundaryPoints.length < 2 || rightBoundaryPoints.length < 2) {
        console.warn(`searchLaneFirstPeriodPoints时，id为${laneId}的lane左右boundary的点数不够`);
        return [];
    }
    const leftPoints = !leftBoundaryReverse
        ? [leftBoundaryPoints[0], leftBoundaryPoints[1]]
        : [leftBoundaryPoints[leftBoundaryPoints.length - 1], leftBoundaryPoints[leftBoundaryPoints.length - 2]];
    const rightPoints = !rightBoundaryReverse
        ? [rightBoundaryPoints[0], rightBoundaryPoints[1]]
        : [rightBoundaryPoints[rightBoundaryPoints.length - 1], rightBoundaryPoints[rightBoundaryPoints.length - 2]];
    return [...leftPoints, ...rightPoints];
}

/**
 * 查询lane的boundary
 */
export function searchLaneBoundaries(laneId: string) {
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return [];
    }
    const { leftBoundaryId, rightBoundaryId } = lane;
    return [searchBoundaryByBoundaryId(leftBoundaryId), searchBoundaryByBoundaryId(rightBoundaryId)];
}

export const searchLaneFromGroudId = (groudId: string) => {
    const state = useManagerStore.getState().mapState;
    const { lanes } = state;
    let result: Lane = null;
    Object.keys(lanes).forEach((id) => {
        const lane = lanes[id];
        if (lane.groudId === groudId) {
            result = lane;
        }
    });
    return result;
};
/**
 * 查找boundary关联的lane
 */
export const searchLanesFromBoundaryId = (boundaryId: string) => {
    const result: Lane[] = [];
    const state = useManagerStore.getState().mapState;
    const { lanes } = state;
    Object.keys(lanes).forEach((id) => {
        const lane = lanes[id];
        if (lane.leftBoundaryId === boundaryId || lane.rightBoundaryId === boundaryId) {
            result.push(lane);
        }
    });
    return result;
};

export const searchLaneIdsFromBoundaryId = (boundaryId: string) => {
    const result: string[] = [];
    const state = useManagerStore.getState().mapState;
    const { lanes } = state;
    Object.keys(lanes).forEach((id) => {
        const lane = lanes[id];
        if (lane.leftBoundaryId === boundaryId || lane.rightBoundaryId === boundaryId) {
            result.push(lane.id);
        }
    });
    return result;
};
export const searchLaneIdsFromPointId = (pointId: string) => {
    let result: string[] = [];
    // 首先找到点关联的boundary
    const linkBoundarys = searchBoundarysFromPointId(pointId);
    // 通过boundary找到关联的lane
    linkBoundarys?.forEach((item) => {
        const linkLaneIds = searchLaneIdsFromBoundaryId(item.id);
        result = result.concat(linkLaneIds);
    });
    return result;
};
export const searchLanesFromPointId = (pointId: string) => {
    let result: Lane[] = [];
    // 首先找到点关联的boundary
    const linkBoundarys = searchBoundarysFromPointId(pointId);
    // 通过boundary找到关联的lane
    linkBoundarys?.forEach((item) => {
        const linkLanes = searchLanesFromBoundaryId(item.id);
        result = result.concat(linkLanes);
    });
    return result;
};
/**
 * 找到一组点相关联的boundary和lanes
 */
export const searchLanePointsLinkObjects = (pointIds: string[]) => {
    if (!pointIds || pointIds.length === 0) {
        return {
            linkBoundarys: [],
            linkLanes: [],
        };
    }
    let linkBoundarys: Boundary[] = [];
    let linkLanes: Lane[] = [];

    pointIds.forEach((id: string) => {
        const pLinkBoundarys = searchBoundarysFromPointId(id);
        const pLinkLanes = searchLanesFromPointId(id);
        linkBoundarys = uniqBy([...pLinkBoundarys, ...linkBoundarys], 'id');
        linkLanes = uniqBy([...pLinkLanes, ...linkLanes], 'id');
    });

    return {
        linkBoundarys,
        linkLanes,
    };
};
/**
 * 获取lane的所有点
 */
export function searchLanePointsByLaneId(lane: Lane) {
    if (!lane) return [];
    const { leftBoundaryId, rightBoundaryId } = lane;
    return [...searchPointsFromBoundaryId(leftBoundaryId), ...searchPointsFromBoundaryId(rightBoundaryId)];
}
export function searchLaneByArrowId(arrowId: string) {
    let result: Lane = null;
    const { prossibleDrivingDirections, lanes } = useManagerStore.getState().mapState;
    const arrow = prossibleDrivingDirections[arrowId];
    if (!arrow) {
        return null;
    }
    Object.keys(lanes).forEach((id) => {
        const lane = lanes[id];
        if (lane.arrowId === arrowId) {
            result = lane;
        }
    });
    return result;
}
