import { SpeedBump } from 'src/interface/speedBumpInterFace';
import { useManagerStore } from 'src/store';

export const searchSpeedBumpByBoundaryId = (boundrayId: string) => {
    const state = useManagerStore.getState().mapState;
    const { speedBumps } = state;
    let result: SpeedBump = null;
    for (let i = 0; i < Object.keys(speedBumps).length; i += 1) {
        const speedBump = speedBumps[Object.keys(speedBumps)[i]];
        if (speedBump.boundaryId === boundrayId) {
            result = speedBump;
            break;
        }
    }
    return result;
};
export const searchSpeedBumpFromGroudId = (groudId: string) => {
    const state = useManagerStore.getState().mapState;
    const { speedBumps } = state;
    let result: SpeedBump | null = null;
    Object.keys(speedBumps).forEach((id) => {
        const speedBump = speedBumps[id];
        if (speedBump.groudId === groudId) {
            result = speedBump;
        }
    });
    return result;
};
