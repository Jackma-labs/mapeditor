import { StopLine, StopLineOrigin } from 'src/interface/stopLineInterFace';
import { useManagerStore } from 'src/store';

export const searchStopLineFromBoundaryId = (boundaryId: string) => {
    if (!boundaryId) {
        console.warn('searchStopLineFromBoundaryId boundaryId is null');
        return null;
    }
    const state = useManagerStore.getState().mapState;
    const { stopLines } = state;
    let result: StopLine = null;
    Object.keys(stopLines).forEach((id) => {
        const stopLine = stopLines[id];
        if (stopLine.boundaryId === boundaryId) {
            result = stopLine;
        }
    });
    return result;
};
export function searchStopLinesByOrigin(origin: StopLineOrigin) {
    const { stopLines } = useManagerStore.getState().mapState;
    const result: StopLine[] = [];
    Object.keys(stopLines).forEach((id) => {
        if (stopLines[id].origin === origin) {
            result.push(stopLines[id]);
        }
    });
    return result;
}
export function searchStopLineByStopLineId(stopLineId: string) {
    let result: StopLine = null;
    const state = useManagerStore.getState().mapState;
    const { stopLines } = state;
    Object.keys(stopLines).forEach((id) => {
        const stopLine = stopLines[id];
        if (stopLine.id === stopLineId) {
            result = stopLine;
        }
    });
    if (!result) {
        console.warn(`searchStopLineByStopLineId-${stopLineId} stopLine is null`);
    }
    return result;
}
