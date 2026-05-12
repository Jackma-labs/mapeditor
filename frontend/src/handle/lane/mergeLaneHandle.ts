import { DeleteArrowCommand } from 'src/command/ArrowCommand';
import {
    AddPointToBoundaryCommand,
    DeleteBoundaryCommand,
    RemovePointFromBoundaryCommand,
} from 'src/command/BoundaryCommand';
import { DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { DeleteLaneCommand } from 'src/command/LaneCommand';
import { Lane, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { getLaneEndPointIds, getLaneStartPointIds } from 'src/utils/geometryUtil';

export function getMergeInfo(lane1: Lane, lane2: Lane) {
    const result: { start: boolean; pointIds: string[] } = {
        start: false,
        pointIds: [],
    };
    if (!lane1 || !lane2) {
        return result;
    }
    const state = useManagerStore.getState().mapState;
    const { points } = state;
    // 分别获取两个lane的起点和终点,一共8个点
    const [lane1LeftFirst, lane1RightFirst] = getLaneStartPointIds(lane1);
    const [lane1LeftEnd, lane1RightEnd] = getLaneEndPointIds(lane1);
    const [lane2LeftFirst, lane2RightFirst] = getLaneStartPointIds(lane2);
    const [lane2LeftEnd, lane2RightEnd] = getLaneEndPointIds(lane2);
    let combinations: any[] = [];
    let laneDistance = Infinity;
    if (
        lane1.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION
    ) {
        combinations = [
            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst, false],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst, true],
        ];
    } else {
        combinations = [
            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst, false],
            [lane1LeftEnd, lane2RightFirst, lane1RightEnd, lane2LeftFirst, false],
            [lane2LeftEnd, lane1LeftEnd, lane2RightEnd, lane1RightEnd, true],
            [lane2RightEnd, lane1LeftEnd, lane2LeftEnd, lane1RightEnd, true],

            [lane1LeftFirst, lane2LeftFirst, lane1RightFirst, lane2RightFirst, false],
            [lane1LeftFirst, lane2RightFirst, lane1RightFirst, lane2LeftFirst, false],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst, true],
            [lane2RightEnd, lane1LeftFirst, lane2LeftEnd, lane1RightFirst, true],
        ];
    }
    combinations.forEach((item) => {
        const curLaneDistance =
            points[item[0]].position.distanceTo(points[item[1]].position) +
            points[item[2]].position.distanceTo(points[item[3]].position);
        if (curLaneDistance < laneDistance) {
            laneDistance = curLaneDistance;
            result.start = item[4];
            result.pointIds = result.start
                ? [item[1], item[0], item[3], item[2]]
                : [item[0], item[1], item[2], item[3]];
        }
    });
    return result;
}
export function mergeLane(lane1: Lane, lane2: Lane) {
    /**
     * 一共需要如下几步操作
     * 1. 添加lane1对 lane2所有点的引用，左边界依次添加lane2左边界点的引用，右边界同样操作
     * 2. 更新lane1的groud
     * 3. 移除lane2的groud
     * 4. 移除lane2左右boundary对点的引用
     * 5. 删除lane2的左右boundary
     * 6. 删除lane2
     */
    if (!lane1 || !lane2) {
        return;
    }
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;
    const leftBoundaryId1 = lane1.leftBoundaryId;
    const rightBoundaryId1 = lane1.rightBoundaryId;
    const leftBoundaryId2 = lane2.leftBoundaryId;
    const rightBoundaryId2 = lane2.rightBoundaryId;
    const groudId2 = lane2.groudId;
    const leftBoundaryPointIds1 = [...boundarys[leftBoundaryId1].pointIds];
    const rightBoundaryPointIds1 = [...boundarys[rightBoundaryId1].pointIds];
    const leftBoundaryPointIds2 = [...boundarys[leftBoundaryId2].pointIds];
    const rightBoundaryPointIds2 = [...boundarys[rightBoundaryId2].pointIds];

    const { pointIds: mergePointIds, start } = getMergeInfo(lane1, lane2);
    if (mergePointIds.length === 0) {
        return;
    }

    const action = [];
    action.push(new DeleteArrowCommand(lane2.arrowId));
    action.push(new DeleteGroudCommand(groudId2));
    action.push(new DeleteLaneCommand(lane2.id));
    // 1. 添加lane1对 lane2所有点的引用，左边界依次添加lane2左边界点的引用，右边界同样操作
    leftBoundaryPointIds2.forEach((pid) => {
        if (leftBoundaryPointIds1.includes(pid)) {
            return;
        }
        action.push(new AddPointToBoundaryCommand(pid, leftBoundaryId1, !start, start));
    });
    rightBoundaryPointIds2.forEach((pid) => {
        if (rightBoundaryPointIds1.includes(pid)) {
            return;
        }
        action.push(new AddPointToBoundaryCommand(pid, rightBoundaryId1, !start, start));
    });

    // 4. 移除lane2左右boundary对点的引用
    leftBoundaryPointIds2.forEach((id) => {
        action.push(new RemovePointFromBoundaryCommand(id, lane2.leftBoundaryId));
    });
    rightBoundaryPointIds2.forEach((id) => {
        action.push(new RemovePointFromBoundaryCommand(id, lane2.rightBoundaryId));
    });
    // 5. 删除lane2的左右boundary
    action.push(new DeleteBoundaryCommand(leftBoundaryId2));
    action.push(new DeleteBoundaryCommand(rightBoundaryId2));
    action.push(new UpdateGroudCommand(lane1.groudId));
    useManagerStore.getState().addCommand(action);
    PubSub.publish('emptyPickObjects');
}
