import { Sign } from 'src/interface/SignInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundaryByBoundaryId, searchBoundarysFromPointId } from './boundarySearch';
import { searchStopLineByStopLineId, searchStopLineFromBoundaryId } from './stopLineSearch';
import { searchPointIdsFromBoundaryId } from './pointSearch';

export const searchSignFromStopLintId = (stopLineId: string) => {
    const { signs } = useManagerStore.getState().mapState;
    let result: Sign = null;
    Object.keys(signs).forEach((id) => {
        const sign = signs[id];
        if (sign.stopLineId === stopLineId) {
            result = sign;
        }
    });
    return result;
};
export function searchSignBySignId(id: string) {
    if (!id) {
        console.warn('searchSignBySignId id is null');
        return null;
    }
    const { signs } = useManagerStore.getState().mapState;
    if (!signs[id]) {
        console.warn('sign not found');
    }
    return signs[id];
}
/**
 * 根据stopLine中的点，获取sign
 */
export function searchSignByPointId(pointId: string) {
    const boundary = searchBoundarysFromPointId(pointId);
    if (!boundary || boundary.length === 0) {
        return null;
    }
    const stopLine = searchStopLineFromBoundaryId(boundary[0].id);
    if (!stopLine) {
        return null;
    }
    return searchSignFromStopLintId(stopLine.id);
}
/**
 * 根据boundaryId 获取sign
 */
export function searchSignByBoundaryId(boundaryId: string) {
    const stopLine = searchStopLineFromBoundaryId(boundaryId);
    if (!stopLine) {
        return null;
    }
    return searchSignFromStopLintId(stopLine.id);
}
/**
 * 查找当前sign涉及到的点位
 */
export function searchSignPoints(signId: string) {
    const sign = searchSignBySignId(signId);
    if (!sign) {
        return [];
    }
    const stopLine = searchStopLineByStopLineId(sign.stopLineId);
    if (!stopLine) {
        return [];
    }
    const boundary = searchBoundaryByBoundaryId(stopLine.boundaryId);
    if (!boundary) {
        return [];
    }
    return searchPointIdsFromBoundaryId(boundary.id);
}
