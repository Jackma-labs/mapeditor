import { Junction } from 'src/interface/junctionInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundarysFromPointId } from './boundarySearch';
import { searchPointsFromBoundaryId } from './pointSearch';

export const searchJunctionFromGroudId = (groudId: string) => {
    const state = useManagerStore.getState().mapState;
    const { junctions } = state;
    let result: Junction = null;
    Object.keys(junctions).forEach((id) => {
        const junction = junctions[id];
        if (junction.groudId === groudId) {
            result = junction;
        }
    });
    if (!result) {
        console.warn('searchJunctionFromGroudId: not found');
    }
    return result;
};
export const searchJunctionFromPointId = (pointId: string) => {
    const state = useManagerStore.getState().mapState;
    const { junctions } = state;
    let result: Junction = null;
    // 首先找到pointId所在的boundary
    const linkboundary = searchBoundarysFromPointId(pointId);
    if (!linkboundary) {
        return result;
    }
    Object.keys(junctions).forEach((id) => {
        if (junctions[id].boundaryId === linkboundary[0].id) {
            result = junctions[id];
        }
    });
    return result;
};

export const searchJunctionByBoundaryId = (boundaryId: string) => {
    const state = useManagerStore.getState().mapState;
    const { junctions } = state;
    let result: Junction = null;
    for (let i = 0; i < Object.keys(junctions).length; i += 1) {
        const junction = junctions[Object.keys(junctions)[i]];
        if (junction.boundaryId === boundaryId) {
            result = junction;
            break;
        }
    }
    return result;
};

export function searchJunctionPoints(junction: Junction) {
    if (!junction) {
        return [];
    }
    return searchPointsFromBoundaryId(junction.boundaryId);
}
