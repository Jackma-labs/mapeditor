import { Boundary, BoundaryOriginType, PointElement } from 'src/interface/basicElementInterFace';
import { useManagerStore } from 'src/store';
import { searchPointByPointId } from './pointSearch';

/**
 * 通过boundaryId获取到boundary
 */
export function searchBoundaryByBoundaryId(boundaryId: string) {
    const { boundarys } = useManagerStore.getState().mapState;
    if (!boundarys[boundaryId]) {
        console.warn(`searchBoundaryByBoundaryId时id为${boundaryId}的boundary没找到`);
        return null;
    }

    return boundarys[boundaryId];
}
/**
 * 通过boundaryId获取到boundary的所有点Id
 */
export function searchBoundaryPointIdsByBoundaryId(boundaryId: string) {
    const boundary = searchBoundaryByBoundaryId(boundaryId);
    if (!boundary) return [];
    return boundary.pointIds || [];
}
/**
 * 通过boundaryId获取到boundary的所有点
 */
export function searchBoundaryPointsByBoundaryId(boundaryId: string) {
    const boundary = searchBoundaryByBoundaryId(boundaryId);
    const result: PointElement[] = [];
    if (!boundary) return [];
    const pointIds = boundary.pointIds || [];
    pointIds.forEach((id) => {
        const point = searchPointByPointId(id);
        if (point) {
            result.push(point);
        }
    });
    return result;
}

/**
 * 查找控制点
 */
export function searchCurveControlsFromBoundaryId(boundaryId: string) {
    const boundary = searchBoundaryByBoundaryId(boundaryId);
    if (!boundary) {
        return [];
    }
    if (!boundary.controlsPosition) {
        return [];
    }
    return boundary.controlsPosition;
}
/**
 * 查找点以及控制点
 */
export function searchCurvePointsAndControlsFromCurveId(boundaryId: string) {
    return {
        points: searchBoundaryPointsByBoundaryId(boundaryId),
        controlsPosition: searchCurveControlsFromBoundaryId(boundaryId),
    };
}
/**
 * 查找线最后一段的点
 */
export function searchBoundaryLastPeriodPoints(boundaryId: string) {
    const points = searchBoundaryPointsByBoundaryId(boundaryId);
    if (points.length < 2) {
        return [];
    }
    return [points[points.length - 2], points[points.length - 1]];
}
/**
 * 查找线第一段的点
 */
export function searchBoundaryFirstPeriodPoints(boundaryId: string) {
    const points = searchBoundaryPointsByBoundaryId(boundaryId);
    if (points.length < 2) {
        return [];
    }
    return [points[0], points[1]];
}

export const searchBoundarysFromPointId = (pointId: string) => {
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;

    const result: Boundary[] = [];

    Object.keys(boundarys).forEach((boundaryId) => {
        const boundary = boundarys[boundaryId];
        const pointIds = boundary.pointIds;
        if (pointIds?.includes(pointId)) {
            result.push(boundary);
        }
    });
    return result;
};
export function searchBoundarysByOrigin(origin: BoundaryOriginType) {
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;

    const result: Boundary[] = [];

    Object.keys(boundarys).forEach((boundaryId) => {
        const boundary = boundarys[boundaryId];
        if (boundary.origin === origin) {
            result.push(boundary);
        }
    });
    return result;
}
