import { useManagerStore } from 'src/store';
import { BarrierGate } from 'src/interface/barrierGateInterFace';
import { searchBoundarysFromPointId } from './boundarySearch';
import { searchPointsFromBoundaryId } from './pointSearch';

export const searchBarrierGateFromGroudId = (groudId: string) => {
    const state = useManagerStore.getState().mapState;
    const { barrierGates } = state;
    let result: BarrierGate = null;
    Object.keys(barrierGates).forEach((id) => {
        const barrierGate = barrierGates[id];
        if (barrierGate.groudId === groudId) {
            result = barrierGate;
        }
    });
    if (!result) {
        console.warn('searchBarrierGateFromGroudId: not found');
    }
    return result;
};
export const searchBarrierGateFromPointId = (pointId: string) => {
    const state = useManagerStore.getState().mapState;
    const { barrierGates } = state;
    let result: BarrierGate = null;
    // 首先找到pointId所在的boundary
    const linkboundary = searchBoundarysFromPointId(pointId);
    if (!linkboundary) {
        return result;
    }
    Object.keys(barrierGates).forEach((id) => {
        if (barrierGates[id].boundaryId === linkboundary[0].id) {
            result = barrierGates[id];
        }
    });
    return result;
};

export const searchBarrierGateByBoundaryId = (boundaryId: string) => {
    const state = useManagerStore.getState().mapState;
    const { barrierGates } = state;
    let result: BarrierGate = null;
    for (let i = 0; i < Object.keys(barrierGates).length; i += 1) {
        const barrierGate = barrierGates[Object.keys(barrierGates)[i]];
        if (barrierGate.boundaryId === boundaryId) {
            result = barrierGate;
            break;
        }
    }
    return result;
};

export function searchBarrierGatePoints(barrierGate: BarrierGate) {
    if (!barrierGate) {
        return [];
    }
    return searchPointsFromBoundaryId(barrierGate.boundaryId);
}

export function searchBarrierGateFromStopLintId(stopLineId: string) {
    const { barrierGates } = useManagerStore.getState().mapState;
    let result: BarrierGate = null;
    Object.keys(barrierGates).forEach((id) => {
        const barrierGate = barrierGates[id];
        if (barrierGate.stopLineId === stopLineId) {
            result = barrierGate;
        }
    });
    return result;
}
