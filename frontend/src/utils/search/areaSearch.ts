import { useManagerStore } from 'src/store';
import { Area } from 'src/interface/areaInterFace';
import { searchBoundarysFromPointId } from './boundarySearch';
import { searchPointsFromBoundaryId } from './pointSearch';

export const searchAreaFromGroudId = (groudId: string) => {
    const state = useManagerStore.getState().mapState;
    const { areas } = state;
    let result: Area = null;
    Object.keys(areas).forEach((id) => {
        const area = areas[id];
        if (area.groudId === groudId) {
            result = area;
        }
    });
    if (!result) {
        console.warn('searchAreaFromGroudId: not found');
    }
    return result;
};
export const searchAreaFromPointId = (pointId: string) => {
    const state = useManagerStore.getState().mapState;
    const { areas } = state;
    let result: Area = null;
    // 首先找到pointId所在的boundary
    const linkboundary = searchBoundarysFromPointId(pointId);
    if (!linkboundary) {
        return result;
    }
    Object.keys(areas).forEach((id) => {
        if (areas[id].boundaryId === linkboundary[0].id) {
            result = areas[id];
        }
    });
    return result;
};

export const searchAreaByBoundaryId = (boundaryId: string) => {
    const state = useManagerStore.getState().mapState;
    const { areas } = state;
    let result: Area = null;
    for (let i = 0; i < Object.keys(areas).length; i += 1) {
        const area = areas[Object.keys(areas)[i]];
        if (area.boundaryId === boundaryId) {
            result = area;
            break;
        }
    }
    return result;
};

export function searchAreaPoints(area: Area) {
    if (!area) {
        return [];
    }
    return searchPointsFromBoundaryId(area.boundaryId);
}
