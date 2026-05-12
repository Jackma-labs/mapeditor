import { TrafficSignal } from 'src/interface/trafficSignal';
import { useManagerStore } from 'src/store';

export const searchTrafficLightFromStopLintId = (stopLineId: string) => {
    const { trafficSignals } = useManagerStore.getState().mapState;
    let result: TrafficSignal = null;
    Object.keys(trafficSignals).forEach((id) => {
        const trafficSignal = trafficSignals[id];
        if (trafficSignal.stopLineId === stopLineId) {
            result = trafficSignal;
        }
    });
    return result;
};
export function searchTrafficLightByTrafficLightId(id: string) {
    if (!id) {
        console.warn('searchTrafficLightByTrafficLightId id is null');
        return null;
    }
    const { trafficSignals } = useManagerStore.getState().mapState;
    if (!trafficSignals[id]) {
        console.warn('traffic light not found');
    }
    return trafficSignals[id];
}
