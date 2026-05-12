import { useManagerStore } from 'src/store';

export function searchPointByPointId(pointId: string) {
    const { points } = useManagerStore.getState().mapState;
    if (!points[pointId]) {
        console.warn(`searchPointByPointId时id为${pointId}的点不存在`);
        return null;
    }
    return points[pointId];
}
export const searchPointsFromBoundaryId = (boundaryId: string) => {
    if (!boundaryId) {
        return [];
    }
    const state = useManagerStore.getState().mapState;
    const { points, boundarys } = state;
    const boundary = boundarys[boundaryId];
    if (!boundary) {
        return [];
    }
    const { pointIds } = boundary;
    if (!Array.isArray(pointIds)) {
        console.warn(`searchPointsFromBoundaryId时id为${boundaryId}的boundary没有pointIds`);
        return [];
    }
    return [...pointIds].map((id) => points[id]);
};
export const searchPointIdsFromBoundaryId = (boundaryId: string) => {
    if (!boundaryId) {
        return [];
    }
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;
    const boundary = boundarys[boundaryId];
    if (!boundary) {
        console.warn(`searchPointIdsFromBoundaryId时id为${boundaryId}的boundary不存在`);
        return [];
    }
    if (!Array.isArray(boundary.pointIds)) {
        console.warn(`searchPointIdsFromBoundaryId时id为${boundaryId}的boundary没有pointIds`);
        return [];
    }
    return boundary.pointIds;
};

export const searchControlPointPositionFromBoundaryId = (boundaryId: string, isFirst: boolean) => {
    if (!boundaryId) {
        return null;
    }
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;
    const boundary = boundarys[boundaryId];
    if (!boundary) {
        return null;
    }
    if (isFirst) {
        return boundary.controlsPosition?.[0];
    }
    return boundary.controlsPosition?.[1];
};
