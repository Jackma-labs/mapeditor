import { uniq } from 'lodash';
import { ChangeBoundaryPointIdsCommand, DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';

export function mergeRoadBoundaryHandle() {
    const { mapState } = useManagerStore.getState();
    const { currentPickElement, points } = mapState;
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
        [pointIds1[0], pointIds2[0], uniq([...pointIds1].reverse().concat(pointIds2))],
        [
            pointIds1[0],
            pointIds2[pointIds2.length - 1],
            uniq([...pointIds1].reverse().concat([...pointIds2].reverse())),
        ],
        [pointIds1[pointIds1.length - 1], pointIds2[0], uniq([...pointIds1, ...pointIds2])],
        [
            pointIds1[pointIds1.length - 1],
            pointIds2[pointIds2.length - 1],
            uniq([...pointIds1].concat([...pointIds2].reverse())),
        ],
    ];
    let distance = Infinity;
    let mergedPointIds: string[] = [];
    conditions.forEach((item: any) => {
        const curDistance = points[item[0]].position.distanceTo(points[item[1]].position);
        if (curDistance < distance) {
            distance = curDistance;
            mergedPointIds = item[2];
        }
    });
    // 数据准备好了，开始去merge了
    const cm1 = new ChangeBoundaryPointIdsCommand(roadBoundary1Id, mergedPointIds);
    const cm2 = new DeleteBoundaryCommand(roadBoundary2Id);
    useManagerStore.getState().addCommand([cm1, cm2]);
    PubSub.publish('emptyPickObjects');
}
