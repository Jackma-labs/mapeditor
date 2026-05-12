import { Crosswalk } from 'src/interface/crosswalkInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundarysFromPointId } from './boundarySearch';
import { searchPointsFromBoundaryId } from './pointSearch';

export const searchCrosswalkByGroudId = (groudId: string): Crosswalk => {
    const state = useManagerStore.getState().mapState;
    const { crosswalks } = state;
    let result: Crosswalk = null;
    Object.keys(crosswalks).forEach((id) => {
        const crosswalk = crosswalks[id];
        if (crosswalk.groudId === groudId) {
            result = crosswalk;
        }
    });
    if (!result) {
        console.warn(`can not find crosswalk by groudId: ${groudId}`);
    }
    return result;
};

export const searchCrosswalkByPointId = (pointId: string): Crosswalk => {
    const linkBoundary = searchBoundarysFromPointId(pointId);
    let result: Crosswalk = null;

    const state = useManagerStore.getState().mapState;
    const { crosswalks } = state;
    for (let i = 0; i < Object.keys(crosswalks).length; i += 1) {
        const crosswalk = crosswalks[Object.keys(crosswalks)[i]];
        if (crosswalk.boundaryId === linkBoundary[0].id) {
            result = crosswalk;
            break;
        }
    }
    return result;
};
export function searchCrosswalkPoints(corsswalk: Crosswalk) {
    if (!corsswalk) {
        return [];
    }
    return searchPointsFromBoundaryId(corsswalk.boundaryId);
}
