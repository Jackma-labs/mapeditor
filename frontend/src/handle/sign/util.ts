import { ThreeObject } from 'src/interface/commonInterFace';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchSignBySignId } from 'src/utils/search/signSearch';
import { searchStopLineByStopLineId } from 'src/utils/search/stopLineSearch';
import { getExtendPoint, getRotateAngle } from 'src/utils/vectorUtil';

export function getSignIconPositionAndDeg(signId: string) {
    const sign = searchSignBySignId(signId);
    if (!sign) {
        return null;
    }
    const stopLine = searchStopLineByStopLineId(sign.stopLineId);
    if (!stopLine) {
        return null;
    }
    const points = searchPointsFromBoundaryId(stopLine.boundaryId);
    if (points.length < 2) {
        return null;
    }
    const point1Mesh = objectSearch(ThreeObject.Point, points[0].id);
    const point2Mesh = objectSearch(ThreeObject.Point, points[1].id);
    const position1 = point1Mesh?.position || points[0].position;
    const position2 = point2Mesh?.position || points[1].position;

    const deg = getRotateAngle(position1, position2);
    const position = getExtendPoint(position1, position2, position1.distanceTo(position2) + 1.5);
    return {
        position,
        deg,
    };
}
