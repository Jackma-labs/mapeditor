import { AddBoundaryCommand } from 'src/command/BoundaryCommand';
import { BoundaryOriginType, PointElement } from 'src/interface/basicElementInterFace';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId, searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { getCurveControlPointPositions } from '../lane/LaneConnectHandle';

// 起点-起点 起点-终点 终点-起点 终点-终点的距离，最短两个点就是新的roadBoundary的两个点
export function connectRoadBoundaryByStraightLineHandle() {
    const { mapState } = useManagerStore.getState();
    const { currentPickElement, points, boundarys } = mapState;
    if (
        currentPickElement.length !== 2 ||
        currentPickElement[0].type !== ThreeElementType.RoadBoundary ||
        currentPickElement[1].type !== ThreeElementType.RoadBoundary
    ) {
        return;
    }
    // 思路，判断起点-起点，终点-终点，起点-终点，终点-起点的距离，取距离最小的连接方式
    const roadBoundary1Id = mapState.currentPickElement[0].id;
    const roadBoundary2Id = mapState.currentPickElement[1].id;
    const pointIds1 = searchPointIdsFromBoundaryId(roadBoundary1Id);
    const pointIds2 = searchPointIdsFromBoundaryId(roadBoundary2Id);

    const conditions: any = [
        [pointIds1[0], pointIds2[0]],
        [pointIds1[0], pointIds2[pointIds2.length - 1]],
        [pointIds1[pointIds1.length - 1], pointIds2[0]],
        [pointIds1[pointIds1.length - 1], pointIds2[pointIds2.length - 1]],
    ];

    let distance = Infinity;
    let mergedPointIds: string[] = [];
    conditions.forEach((item: any) => {
        const curDistance = points[item[0]].position.distanceTo(points[item[1]].position);
        if (curDistance < distance) {
            distance = curDistance;
            mergedPointIds = [...item];
        }
    });
    const newRoadBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const cm1 = new AddBoundaryCommand(
        newRoadBoundaryId,
        ThreeElementType.RoadBoundary,
        BoundaryOriginType.RoadBoundary,
        mergedPointIds,
        [],
    );
    useManagerStore.getState().addCommand([cm1]);
    PubSub.publish('emptyPickObjects');
}

// 曲线连接
export function connectRoadBoundaryByCurveHandle() {
    const { mapState } = useManagerStore.getState();
    const { currentPickElement, boundarys } = mapState;
    if (
        currentPickElement.length !== 2 ||
        currentPickElement[0].type !== ThreeElementType.RoadBoundary ||
        currentPickElement[1].type !== ThreeElementType.RoadBoundary
    ) {
        return;
    }
    // 思路，判断起点-起点，终点-终点，起点-终点，终点-起点的距离，取距离最小的连接方式
    const roadBoundary1Id = mapState.currentPickElement[0].id;
    const roadBoundary2Id = mapState.currentPickElement[1].id;
    const points1 = searchPointsFromBoundaryId(roadBoundary1Id);
    const points2 = searchPointsFromBoundaryId(roadBoundary2Id);

    const conditions: any = [
        [points1[0], points2[0], points1[1], points1[0], points2[0], points2[1]],
        [
            points1[0],
            points2[points2.length - 1],
            points1[1],
            points1[0],
            points2[points2.length - 1],
            points2[points2.length - 2],
        ],
        [
            points1[points1.length - 1],
            points2[0],
            points1[points1.length - 2],
            points1[points1.length - 1],
            points2[0],
            points2[1],
        ],
        [
            points1[points1.length - 1],
            points2[points2.length - 1],
            points1[points1.length - 2],
            points1[points1.length - 1],
            points2[points2.length - 1],
            points2[points2.length - 2],
        ],
    ];
    let distance = Infinity;
    let curvePoints: PointElement[] = [];
    let connectInfoIndex: number = 0;
    conditions.forEach((item: any, index: number) => {
        const curDistance = item[0].position.distanceTo(item[1].position);
        if (curDistance < distance) {
            distance = curDistance;
            curvePoints = [item[2], item[3], item[4], item[5]];
            connectInfoIndex = index;
        }
    });
    const controlPointPositions = getCurveControlPointPositions(curvePoints);
    if (!controlPointPositions) {
        return;
    }
    const [firstControlPointPosition, secondControlPointPosition] = controlPointPositions;
    const newRoadBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const cm1 = new AddBoundaryCommand(
        newRoadBoundaryId,
        ThreeElementType.RoadBoundary,
        BoundaryOriginType.RoadBoundary,
        [conditions[connectInfoIndex][0].id, conditions[connectInfoIndex][1].id],
        [firstControlPointPosition, secondControlPointPosition],
    );
    useManagerStore.getState().addCommand([cm1]);
    PubSub.publish('emptyPickObjects');
}
