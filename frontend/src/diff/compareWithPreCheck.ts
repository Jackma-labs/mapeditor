import { PointElement } from 'src/interface/basicElementInterFace';

interface MapStatePoints {
    [key: number]: PointElement;
}
export function comparePointsWithPreCheck(
    oldPoints: MapStatePoints,
    newPoints: MapStatePoints,
    preCheckFn?: () => boolean,
): boolean {
    const diffPoints = (): boolean => {
        const oldPointsId: string[] = Object.keys(oldPoints);
        const newPointsId: string[] = Object.keys(newPoints);
        if (oldPointsId.length !== newPointsId.length) {
            return false;
        }
        const epsilon = 0.000001;
        // eslint-disable-next-line no-restricted-syntax
        for (const pointId of newPointsId.reverse()) {
            const oldPoint = oldPoints?.[Number(pointId)];
            const newPoint = newPoints?.[Number(pointId)];
            if (!oldPoint || !newPoint) {
                return false;
            }
            if (oldPoint.id !== newPoint.id || oldPoint.type !== newPoint.type) {
                return false;
            }
            if (
                Math.abs(oldPoint.position.x - newPoint.position.x) > epsilon ||
                Math.abs(oldPoint.position.y - newPoint.position.y) > epsilon ||
                Math.abs(oldPoint.position.z - newPoint.position.z) > epsilon
            ) {
                return false;
            }
        }
        return true;
    };

    if (preCheckFn && preCheckFn instanceof Function && preCheckFn()) {
        return diffPoints();
    }

    return false;
}
