import { AddArrowCommand } from 'src/command/ArrowCommand';
import {
    AddBoundaryCommand,
    AddPointToBoundaryCommand,
    RemovePointFromBoundaryCommand,
} from 'src/command/BoundaryCommand';
import { AddGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { AddLaneCommand } from 'src/command/LaneCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { BoundaryOriginType, PointElement } from 'src/interface/basicElementInterFace';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { Lane, LaneBoundaryType, LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { getLaneEndPointIds, getLaneStartPointIds } from 'src/utils/geometryUtil';
import { searchBoundaryPointIdsByBoundaryId } from 'src/utils/search/boundarySearch';
import { searchPointsRelationObjects } from 'src/utils/search/common';
import { searchLaneFirstPeriodPoints, searchLaneLastPeriodPoints } from 'src/utils/search/laneSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import * as THREE from 'three';
/**
 * 根据四个点，计算曲线的控制点，一共返回两个控制点
 */
export function getCurveControlPointPositions(points: PointElement[]) {
    const [p1, p2, p3, p4] = points;
    if (!p1 || !p2 || !p3 || !p4) {
        return null;
    }
    const p1Mesh = objectSearch(ThreeObject.Point, p1.id);
    const p2Mesh = objectSearch(ThreeObject.Point, p2.id);
    const p3Mesh = objectSearch(ThreeObject.Point, p3.id);
    const p4Mesh = objectSearch(ThreeObject.Point, p4.id);
    const controlLength = p2.position.distanceTo(p3.position);
    const angle1 = new THREE.Vector2(
        p2Mesh.position.x - p1Mesh.position.x,
        p2Mesh.position.y - p1Mesh.position.y,
    ).angleTo(new THREE.Vector2(p3Mesh.position.x - p2Mesh.position.x, p3Mesh.position.y - p2Mesh.position.y));
    const angle2 = new THREE.Vector2(
        p3Mesh.position.x - p2Mesh.position.x,
        p3Mesh.position.y - p2Mesh.position.y,
    ).angleTo(new THREE.Vector2(p4Mesh.position.x - p3Mesh.position.x, p4Mesh.position.y - p3Mesh.position.y));
    const axis1 = new THREE.Vector3(
        p2Mesh.position.x - p1Mesh.position.x,
        p2Mesh.position.y - p1Mesh.position.y,
        p2Mesh.position.z - p1Mesh.position.z,
    ).normalize();
    // 第一个控制点的位置为，p2沿着p1-p2方向延长长度为controlLength的点

    const firstControlPointPosition = p2Mesh
        .clone()
        .translateOnAxis(axis1, (controlLength * angle2) / (angle1 + angle2)).position;
    // 第二个控制点位置为，p3沿着p4-p3方向延长长度为controlLength的点
    const axis2 = new THREE.Vector3(
        p3Mesh.position.x - p4Mesh.position.x,
        p3Mesh.position.y - p4Mesh.position.y,
        p3Mesh.position.z - p4Mesh.position.z,
    ).normalize();
    const secondControlPointPosition = p3Mesh
        .clone()
        .translateOnAxis(axis2, (controlLength * angle1) / (angle1 + angle2)).position;
    return [firstControlPointPosition, secondControlPointPosition];
}
/**
 * 获取弯道连接两个车道的曲线的手柄位置
 * 一共返回四个手柄位置，分别为左车道的曲线的两个手柄，以及右车道曲线的两个手柄
 */
export function getCurveConnectLaneControlPointPositions(
    lane1LastPeriodPoints: PointElement[],
    lane2FirstPeriodPoints: PointElement[],
) {
    const [p1, p2, p3, p4] = lane1LastPeriodPoints;
    const [p5, p6, p7, p8] = lane2FirstPeriodPoints;
    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6 || !p7 || !p8) {
        return null;
    }
    const leftCurveControlPointPositions = getCurveControlPointPositions([p1, p2, p5, p6]);
    const rightCurveControlPointPositions = getCurveControlPointPositions([p3, p4, p7, p8]);
    return [...leftCurveControlPointPositions, ...rightCurveControlPointPositions];
}

/**
 * 获取连接lane的四个点以及，lane连接的顺序，即谁的终点连接谁的起点
 * 返回{
 *  connectLanes: [lane2,lane1]
 * }
 */
export function getStraightConnectInfo(lane1: Lane, lane2: Lane) {
    if (!lane1 || !lane2) {
        return [];
    }
    let pointIds: string[] = [];
    const state = useManagerStore.getState().mapState;
    const { points } = state;

    // 分别获取两个lane的起点和终点,一共8个点
    const [lane1LeftFirst, lane1RightFirst] = getLaneStartPointIds(lane1);
    const [lane1LeftEnd, lane1RightEnd] = getLaneEndPointIds(lane1);
    const [lane2LeftFirst, lane2RightFirst] = getLaneStartPointIds(lane2);
    const [lane2LeftEnd, lane2RightEnd] = getLaneEndPointIds(lane2);
    // 需要获取到新的lane的四个点
    /**
     * 如果是单向车道，则计算lane1终点到lane2起点的距离，和lane2终点到lane1起点的距离,哪个短取哪个
     */
    let combinations: any[] = [];
    let laneDistance = Infinity;
    // 如果都不为双向，则判断第一个车道的头连第二个车道的尾，或者第一个车道的尾连第二个车道的头，去判断距离，左车道连左车道，右连右
    if (
        lane1.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION
    ) {
        combinations = [
            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst],
        ];
    } else if (lane2.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION) {
        // 如果第二个车道的方向是双向，则选取第一个车道的左右车道信息去获取连接点位
        combinations = [
            [lane2LeftFirst, lane1LeftFirst, lane2RightFirst, lane1RightFirst],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst],
            [lane2RightFirst, lane1LeftFirst, lane2LeftFirst, lane1RightFirst],
            [lane2RightEnd, lane1LeftFirst, lane2LeftEnd, lane1RightFirst],

            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst],
            [lane1LeftEnd, lane2LeftEnd, lane1RightEnd, lane2RightEnd],
            [lane1LeftEnd, lane2RightFirst, lane1RightEnd, lane2LeftFirst],
            [lane1LeftEnd, lane2RightEnd, lane1RightEnd, lane2LeftEnd],
        ];
    } else {
        // 否则都用第二个车道的左右车道信息去获取连接点位
        combinations = [
            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst],
            [lane2LeftEnd, lane1LeftEnd, lane2RightEnd, lane1RightEnd],
            [lane1RightEnd, lane2LeftFirst, lane1LeftEnd, lane2RightFirst],
            [lane2LeftEnd, lane1RightEnd, lane2RightEnd, lane1LeftEnd],

            [lane1LeftFirst, lane2LeftFirst, lane1RightFirst, lane2RightFirst],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst],
            [lane1RightFirst, lane2LeftFirst, lane1LeftFirst, lane2RightFirst],
            [lane2LeftEnd, lane1RightFirst, lane2RightEnd, lane1LeftFirst],
        ];
    }
    combinations.forEach((item) => {
        const curLaneDistance =
            points[item[0]].position.distanceTo(points[item[1]].position) +
            points[item[2]].position.distanceTo(points[item[3]].position);
        if (curLaneDistance < laneDistance) {
            laneDistance = curLaneDistance;
            pointIds = item;
        }
    });
    return pointIds;
}

export function connectLane(lane1: Lane, lane2: Lane) {
    const state = useManagerStore.getState().mapState;
    const { boundarys, lanes, grouds, prossibleDrivingDirections } = state;
    const connectPointIds = getStraightConnectInfo(lane1, lane2);
    if (connectPointIds?.length === 0) {
        return;
    }
    if (connectPointIds[0] === connectPointIds[1]) {
        const { boundarys: linkBoundarys, grouds: linkGrouds } = searchPointsRelationObjects([connectPointIds[2]]);
        const actions: any = [];
        linkBoundarys.forEach((item) => {
            actions.push(new AddPointToBoundaryCommand(connectPointIds[3], item.id, false, false));
            actions.push(new RemovePointFromBoundaryCommand(connectPointIds[2], item.id));
        });
        linkGrouds.forEach((item) => {
            actions.push(new UpdateGroudCommand(item.id));
        });
        actions.push(new DeletePointCommand(connectPointIds[2]));
        useManagerStore.getState().addCommand(actions);
        PubSub.publishSync('emptyPickObjects');
        return;
    }
    if (connectPointIds[2] === connectPointIds[3]) {
        const { boundarys: linkBoundarys, grouds: linkGrouds } = searchPointsRelationObjects([connectPointIds[0]]);
        const actions: any = [];
        linkBoundarys.forEach((item) => {
            actions.push(new AddPointToBoundaryCommand(connectPointIds[1], item.id, false, false));
            actions.push(new RemovePointFromBoundaryCommand(connectPointIds[0], item.id));
        });
        linkGrouds.forEach((item) => {
            actions.push(new UpdateGroudCommand(item.id));
        });
        actions.push(new DeletePointCommand(connectPointIds[0]));
        useManagerStore.getState().addCommand(actions);
        PubSub.publishSync('emptyPickObjects');
        return;
    }
    const newLaneId = `${getElementMaxIndex(lanes) + 1}`;
    const newLeftBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const newRighBoundaryId = `${getElementMaxIndex(boundarys) + 2}`;
    const newGroudId = `${getElementMaxIndex(grouds) + 1}`;
    const newArrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const actions = [];
    const newprossibleDrivingDirection =
        lane1.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION
            ? ProssibleDrivingDirection.RELATIVEDIRECTION
            : ProssibleDrivingDirection.FORWARD;
    actions.push(
        new AddLaneCommand(
            newLaneId,
            newLeftBoundaryId,
            newRighBoundaryId,
            newGroudId,
            newArrowId,
            { ...lane1.attr, prossibleDrivingDirection: newprossibleDrivingDirection },
            false,
            false,
            LaneTrend.Straight,
        ),
    );
    actions.push(
        new AddBoundaryCommand(newLeftBoundaryId, ThreeElementType.LaneBoundary, BoundaryOriginType.Lane, [], [], {
            ...boundarys[lane1.leftBoundaryId].attr,
        }),
    );
    actions.push(
        new AddBoundaryCommand(newRighBoundaryId, ThreeElementType.LaneBoundary, BoundaryOriginType.Lane, [], [], {
            ...boundarys[lane1.rightBoundaryId].attr,
        }),
    );
    actions.push(new AddGroudCommand(newGroudId, ThreeElementType.LaneGroud));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[0], newLeftBoundaryId, true, false));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[1], newLeftBoundaryId, true, false));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[2], newRighBoundaryId, true, false));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[3], newRighBoundaryId, true, false));
    actions.push(new AddArrowCommand(newArrowId, ThreeElementType.LaneRelativeDirection));
    useManagerStore.getState().addCommand(actions);
    PubSub.publishSync('emptyPickObjects');
}
export function getCurveConnectInfo(lane1: Lane, lane2: Lane) {
    const result: { pointIds: string[]; controlsPosition: THREE.Vector3[] } = {
        pointIds: [],
        controlsPosition: [],
    };
    if (!lane1 || !lane2) {
        return result;
    }

    // 分别获取两个lane的起点和终点,一共8个点
    const [lane1LeftFirst1, lane1LeftFirst2, lane1RightFirst1, lane1RightFirst2] = searchLaneFirstPeriodPoints(
        lane1.id,
    );
    const [lane1LeftEnd1, lane1LeftEnd2, lane1RightEnd1, lane1RightEnd2] = searchLaneLastPeriodPoints(lane1.id);
    const [lane2LeftFirst1, lane2LeftFirst2, lane2RightFirst1, lane2RightFirst2] = searchLaneFirstPeriodPoints(
        lane2.id,
    );
    const [lane2LeftEnd1, lane2LeftEnd2, lane2RightEnd1, lane2RightEnd2] = searchLaneFirstPeriodPoints(lane2.id);
    // 需要获取到新的lane的四个点
    /**
     * 如果都是单向车道，则计算lane1的起点和lane2的终点的距离，和lane2的起点和lane1的终点的距离,哪个短取哪个
     */
    /**
     * combinations 每一条数据一共8个数据，分别是
     * 连接车道的左边界点1、点2、连接车道的右边界点1、点2点，新车道由车道1发起、连接到车道2、车道1连接点是否是起点、车道2连接点是否是起点,是否是左连右这种交叉组合
     */
    let combinations: any[] = [];
    let laneDistance = Infinity;
    let findCombinationIndex = -1;
    // 如果都不为双向，则判断第一个车道的头连第二个车道的尾，或者第一个车道的尾连第二个车道的头，去判断距离，左车道连左车道，右连右
    if (
        lane1.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION
    ) {
        combinations = [
            // 第二个车道的最后一节去连接第一个车道的第一节
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第一个车道的最后一节去连接第二个车道的第一节
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
        ];
    } else if (lane1.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION) {
        // 如果第一个是双向的，第二个随意的时候
        combinations = [
            // 第二个车道的最后一节去连接第一个车道的第一节,且左连左，右连右
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第二个车道的最后一节去连接第一个车道的第一节,且左连右，右连左
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
            ],
            // 第二个车道的最后一节去连接第一个车道的最后一节,且左连左，右连右
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftEnd2,
                lane1LeftEnd1,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightEnd2,
                lane1RightEnd1,
            ],
            // 第二个车道的最后一节去连接第一个车道的最后一节,且左连右，右连左
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1RightEnd2,
                lane1RightEnd1,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1LeftEnd2,
                lane1LeftEnd1,
            ],
            // 第二个车道的第一节去连接第一个车道的第一节,且左连左，右连右,头连接头则将双向车道的点位反过来
            [
                lane1LeftFirst2,
                lane1LeftFirst1,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightFirst2,
                lane1RightFirst1,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
            // 第二个车道的第一节去连接第一个车道的第一节,且左连右，右连左,头连接头则将双向车道的点位反过来
            [
                lane1LeftFirst2,
                lane1LeftFirst1,
                lane2RightFirst1,
                lane2RightFirst2,
                lane1RightFirst2,
                lane1RightFirst1,
                lane2LeftFirst1,
                lane2LeftFirst2,
            ],
            // 第二个车道的第一节去连接第一个车道的最后一节,且左连左，右连右
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
            // 第二个车道的第一节去连接第一个车道的最后一节,且左连右，右连左
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
            ],
        ];
    } else {
        // 如果第二个是双向的，第一个随意的时候
        combinations = [
            // 第一个车道的最后一节去连接第二个车道的第一节,且左连左，右连右
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
            // 第一个车道的最后一节去连接第二个车道的第一节,且左连右，右连左
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
            ],
            // 第一个车道的最后一节去连接第二个车道的最后一节,且左连左，右连右
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftEnd2,
                lane2LeftEnd1,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightEnd2,
                lane2RightEnd1,
            ],
            // 第一个车道的最后一节去连接第二个车道的最后一节,且左连右，右连左
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2RightEnd2,
                lane2RightEnd1,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2LeftEnd2,
                lane2LeftEnd1,
            ],
            // 第一个车道的第一节去连接第二个车道的第一节,且左连左，右连右,头连接头则将双向车道的点位反过来
            [
                lane2LeftFirst2,
                lane2LeftFirst1,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightFirst2,
                lane2RightFirst1,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第一个车道的第一节去连接第二个车道的第一节,且左连右，右连左,头连接头则将双向车道的点位反过来
            [
                lane2LeftFirst2,
                lane2LeftFirst1,
                lane1RightFirst1,
                lane1RightFirst2,
                lane2RightFirst2,
                lane2RightFirst1,
                lane1LeftFirst1,
                lane1LeftFirst2,
            ],
            // 第一个车道的第一节去连接第二个车道的最后一节,且左连左，右连右
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第一个车道的第一节去连接第二个车道的最后一节,且左连右，右连左
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
            ],
        ];
    }
    combinations.forEach((item, index) => {
        const curLaneDistance =
            item[1].position.distanceTo(item[2].position) + item[5].position.distanceTo(item[6].position);
        if (curLaneDistance < laneDistance) {
            laneDistance = curLaneDistance;
            findCombinationIndex = index;
        }
    });
    const findItem = combinations[findCombinationIndex];
    result.pointIds = [findItem[1].id, findItem[2].id, findItem[5].id, findItem[6].id];
    // 去获取控制点
    result.controlsPosition.push(
        ...getCurveConnectLaneControlPointPositions(
            findItem.slice(0, 2).concat(findItem.slice(4, 6)),
            findItem.slice(2, 4).concat(findItem.slice(6)),
        ),
    );
    return result;
}
export function curveConnectLane(lane1: Lane, lane2: Lane) {
    const state = useManagerStore.getState().mapState;
    const { lanes, grouds, boundarys, prossibleDrivingDirections } = state;
    if (!lane1 || !lane2) {
        return;
    }
    const leftBoundaryPointIds2 = searchBoundaryPointIdsByBoundaryId(lane2.leftBoundaryId);
    const rightBoundaryPointIds2 = searchBoundaryPointIdsByBoundaryId(lane2.rightBoundaryId);
    if (leftBoundaryPointIds2.length === 0 && rightBoundaryPointIds2.length === 0) {
        return;
    }

    const { pointIds: connectPointIds, controlsPosition } = getCurveConnectInfo(lane1, lane2);
    if (connectPointIds.length !== 4 || controlsPosition.length !== 4) {
        return;
    }

    const [leftCurveControl1, leftCurveControl2, rightCurveControl1, rightCurveControl2] = controlsPosition;
    const actions = [];
    const leftCurveId = `${getElementMaxIndex(boundarys) + 1}`;
    const rightCurveId = `${getElementMaxIndex(boundarys) + 2}`;
    const laneId = `${getElementMaxIndex(lanes) + 1}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const newprossibleDrivingDirection =
        lane1.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION
            ? ProssibleDrivingDirection.RELATIVEDIRECTION
            : ProssibleDrivingDirection.FORWARD;
    actions.push(
        new AddBoundaryCommand(
            leftCurveId,
            ThreeElementType.LaneCurveBoundary,
            BoundaryOriginType.Lane,
            [connectPointIds[0], connectPointIds[1]],
            [leftCurveControl1, leftCurveControl2],
            { type: LaneBoundaryType.WHITESOLId },
        ),
    );
    actions.push(
        new AddBoundaryCommand(
            rightCurveId,
            ThreeElementType.LaneCurveBoundary,
            BoundaryOriginType.Lane,
            [connectPointIds[2], connectPointIds[3]],
            [rightCurveControl1, rightCurveControl2],
            { type: LaneBoundaryType.WHITESOLId },
        ),
    );
    actions.push(
        new AddLaneCommand(
            laneId,
            leftCurveId,
            rightCurveId,
            groudId,
            arrowId,
            { ...lane1.attr, prossibleDrivingDirection: newprossibleDrivingDirection },
            false,
            false,
            LaneTrend.Curve,
        ),
    );
    actions.push(new AddGroudCommand(groudId, ThreeElementType.LaneCurveGroud));
    actions.push(new AddArrowCommand(arrowId, ThreeElementType.LaneRelativeDirection));
    useManagerStore.getState().addCommand(actions);
    PubSub.publishSync('emptyPickObjects');
}
