import { Lane, LaneTrend } from 'src/interface/laneInterFace';
import {
    searchLaneBoundaries,
    searchLaneByLaneId,
    searchLaneFirstPeriodPoints,
    searchLanesFromBoundaryId,
} from 'src/utils/search/laneSearch';
import { searchPointIdsFromBoundaryId, searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getExtendPoint, getRotateAngle } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { AddPointCommand } from 'src/command/PointCommand';
import {
    AddBoundaryCommand,
    ChangeBoundaryPointIdsCommand,
    ChangeControlsPositionCommand,
} from 'src/command/BoundaryCommand';
import { AddGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { AddLaneCommand, ChangeLaneBoundary } from 'src/command/LaneCommand';
import { searchBoundaryByBoundaryId, searchCurvePointsAndControlsFromCurveId } from 'src/utils/search/boundarySearch';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { mapElementZ } from 'src/constant/mapElementZ';
import { AddArrowCommand, UpdateArrowCommand } from 'src/command/ArrowCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { message as messageFunc } from 'src/components/Message';
import { getInsertIndex } from 'src/utils/geometryUtil';

export function splitLaneInVerticalHandle(
    crossInfo: {
        [boundaryId: string]: {
            splitPosition: THREE.Vector3;
            controlsPosition?: THREE.Vector3[];
        };
    },
    splitLanes: Lane[],
) {
    const { mapState, addCommand, setMapState } = useManagerStore.getState();
    const { points, lanes, boundarys, grouds, prossibleDrivingDirections } = mapState;
    // boundaryId: 分割点ID
    const splitInfo: {
        [boundaryId: string]: {
            firstPeriodPointIds: string[];
            lastPeriodPointIds: string[];
            newBoundaryId: string;
            newBoundaryCreated: boolean;
            controlsPosition: THREE.Vector3[];
            newControlsPosition: THREE.Vector3[];
        };
    } = {};
    // 第一步，绘制点，插入点到对应的boundary中
    if (!crossInfo) {
        messageFunc(
            {
                type: 'warning',
                content: '拆分线未覆盖全部相邻车道',
            },
            100,
        );
        return;
    }
    // 这里需要移除切割线相关数据，这些数据不需要回退或者重做
    PubSub.publish('removeMouseMoveElements');
    PubSub.publish('render');
    delete points.start;
    mapState.needRenderElements[ThreeObject.Point].start = ThreeElementType.SplitLaneInVerticalPoint;
    setMapState(mapState);

    const actions: any = [];
    const maxBoundaryId = getElementMaxIndex(boundarys);
    Object.keys(crossInfo).forEach((boundaryId, index) => {
        const pointId = `${getElementMaxIndex(points) + index + 1}`;
        actions.push(new AddPointCommand(pointId, crossInfo[boundaryId].splitPosition, ThreeElementType.LanePoint));

        const splitIndex = getInsertIndex(crossInfo[boundaryId].splitPosition, boundaryId, false, false);
        const originPintIds = searchPointIdsFromBoundaryId(boundaryId);
        if (originPintIds.length < 2) {
            return;
        }
        if (splitIndex === -1) {
            return;
        }
        splitInfo[boundaryId] = {
            firstPeriodPointIds: originPintIds.slice(0, splitIndex).concat(pointId),
            lastPeriodPointIds: [pointId].concat(originPintIds.slice(splitIndex)),
            newBoundaryId: `${maxBoundaryId + index + 1}`,
            newBoundaryCreated: false,
            controlsPosition: crossInfo[boundaryId].controlsPosition?.slice(0, 2) || [],
            newControlsPosition: crossInfo[boundaryId].controlsPosition?.slice(2) || [],
        };
    });
    splitLanes.forEach((laneItem, index) => {
        const newLaneId = `${getElementMaxIndex(lanes) + 1 + index}`;
        const newLeftBoundaryId = splitInfo[laneItem.leftBoundaryId].newBoundaryId;
        const newRightBoundaryId = splitInfo[laneItem.rightBoundaryId].newBoundaryId;
        const newGroudId = `${getElementMaxIndex(grouds) + 1 + index}`;
        const newArrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1 + index}`;
        const newBoundaryType =
            laneItem.type === LaneTrend.Straight ? ThreeElementType.LaneBoundary : ThreeElementType.LaneCurveBoundary;
        const newGroudType =
            laneItem.type === LaneTrend.Straight ? ThreeElementType.LaneGroud : ThreeElementType.LaneCurveGroud;

        // 更新旧的lane
        const { leftBoundaryId, rightBoundaryId } = laneItem;
        const leftBoundary = searchBoundaryByBoundaryId(leftBoundaryId);
        const rightBoundary = searchBoundaryByBoundaryId(rightBoundaryId);
        if (!leftBoundary || !rightBoundary) {
            return;
        }

        actions.push(new ChangeBoundaryPointIdsCommand(leftBoundaryId, splitInfo[leftBoundaryId].firstPeriodPointIds));
        actions.push(
            new ChangeBoundaryPointIdsCommand(rightBoundaryId, splitInfo[rightBoundaryId].firstPeriodPointIds),
        );
        if (laneItem.type === LaneTrend.Curve) {
            actions.push(new ChangeControlsPositionCommand(leftBoundaryId, splitInfo[leftBoundaryId].controlsPosition));
            actions.push(
                new ChangeControlsPositionCommand(rightBoundaryId, splitInfo[rightBoundaryId].controlsPosition),
            );
        }
        actions.push(new UpdateGroudCommand(laneItem.groudId));
        actions.push(new UpdateArrowCommand(laneItem.arrowId));
        // 创建新的lane
        actions.push(
            new AddLaneCommand(
                newLaneId,
                newLeftBoundaryId,
                newRightBoundaryId,
                newGroudId,
                newArrowId,
                { ...laneItem.attr },
                laneItem.leftBoundaryReverse,
                laneItem.rightBoundaryReverse,
                laneItem.type,
            ),
        );
        if (!splitInfo[laneItem.leftBoundaryId].newBoundaryCreated) {
            actions.push(
                new AddBoundaryCommand(
                    newLeftBoundaryId,
                    newBoundaryType,
                    BoundaryOriginType.Lane,
                    splitInfo[leftBoundaryId].lastPeriodPointIds,
                    splitInfo[leftBoundaryId].newControlsPosition,
                    { ...leftBoundary.attr },
                ),
            );
            splitInfo[laneItem.leftBoundaryId].newBoundaryCreated = true;
        }
        if (!splitInfo[laneItem.rightBoundaryId].newBoundaryCreated) {
            actions.push(
                new AddBoundaryCommand(
                    newRightBoundaryId,
                    newBoundaryType,
                    BoundaryOriginType.Lane,
                    splitInfo[rightBoundaryId].lastPeriodPointIds,
                    splitInfo[rightBoundaryId].newControlsPosition,
                    { ...rightBoundary.attr },
                ),
            );
            splitInfo[laneItem.rightBoundaryId].newBoundaryCreated = true;
        }
        actions.push(new AddGroudCommand(newGroudId, newGroudType));
        actions.push(new AddArrowCommand(newArrowId, ThreeElementType.LaneRelativeDirection));
        actions.push(new SetOperationTypeCommand(null));
    });
    addCommand(actions);
    PubSub.publish('emptyPickObjects');
}
/**
 * 判断沿车道方向拆分时，获取复制的boundary的id以及是否是左边界，默认是左边界，只有当右边界被两个lane共用时才会复制右边界
 */
export function getSpliteInCenterReferenceBoundaryInfo(lane: Lane) {
    let result = {
        referenceLineIsLeftBoundary: true,
        boundaryId: lane.leftBoundaryId,
        points: searchPointsFromBoundaryId(lane.leftBoundaryId),
    };
    const leftBoundaryLinkLanes = searchLanesFromBoundaryId(lane.leftBoundaryId);
    const rightBoundaryLinkLanes = searchLanesFromBoundaryId(lane.rightBoundaryId);
    if (rightBoundaryLinkLanes.length >= 2 && leftBoundaryLinkLanes.length === 1) {
        result = {
            referenceLineIsLeftBoundary: false,
            boundaryId: lane.rightBoundaryId,
            points: searchPointsFromBoundaryId(lane.rightBoundaryId),
        };
    }
    return result;
}
/**
 * 获取中心线的所有点
 */
export function getCenterLineInfo(laneId: string) {
    const result: {
        positions: THREE.Vector3[];
        referenceLineIsLeftBoundary: boolean;
        controlsPosition: THREE.Vector3[];
    } = {
        positions: [],
        referenceLineIsLeftBoundary: true,
        controlsPosition: [],
    };
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return result;
    }

    if (lane.type === LaneTrend.Curve) {
        const { points: leftPoints, controlsPosition: leftControlPositions } = searchCurvePointsAndControlsFromCurveId(
            lane.leftBoundaryId,
        );
        const { points: rightPoints, controlsPosition: rightControlPositions } =
            searchCurvePointsAndControlsFromCurveId(lane.rightBoundaryId);
        if (
            leftPoints.length !== 2 ||
            rightPoints.length !== 2 ||
            leftControlPositions.length !== 2 ||
            rightControlPositions.length !== 2
        ) {
            return result;
        }
        result.positions.push(
            getExtendPoint(
                leftPoints[0].position,
                rightPoints[0].position,
                leftPoints[0].position.distanceTo(rightPoints[0].position) / 2,
            ),
        );
        result.positions.push(
            getExtendPoint(
                leftPoints[1].position,
                rightPoints[1].position,
                leftPoints[1].position.distanceTo(rightPoints[1].position) / 2,
            ),
        );
        result.controlsPosition.push(
            getExtendPoint(
                leftControlPositions[0],
                rightControlPositions[0],
                leftControlPositions[0].distanceTo(rightControlPositions[0]) / 2,
            ),
        );
        result.controlsPosition.push(
            getExtendPoint(
                leftControlPositions[1],
                rightControlPositions[1],
                leftControlPositions[1].distanceTo(rightControlPositions[1]) / 2,
            ),
        );
        return result;
    }

    const { points: referenceBoundaryPoints, referenceLineIsLeftBoundary } =
        getSpliteInCenterReferenceBoundaryInfo(lane);
    const [leftBoundary, rightBoundary] = searchLaneBoundaries(laneId);
    if (!leftBoundary || !rightBoundary) {
        return result;
    }
    const [leftFirstPoint, , rightFirstPoint] = searchLaneFirstPeriodPoints(laneId);
    if (!leftFirstPoint || !rightFirstPoint) {
        return result;
    }

    // 让参考线的点沿着车道垂直方向平移一半距离
    const distance =
        (referenceLineIsLeftBoundary && !lane.leftBoundaryReverse) ||
        (!referenceLineIsLeftBoundary && lane.rightBoundaryReverse)
            ? rightFirstPoint.position.distanceTo(leftFirstPoint.position) / 2
            : -rightFirstPoint.position.distanceTo(leftFirstPoint.position) / 2;
    for (let i = 0; i < referenceBoundaryPoints.length - 1; i += 1) {
        const p1 = referenceBoundaryPoints[i];
        const p2 = referenceBoundaryPoints[i + 1];
        const p1WorldPosition = p1.position;
        const p2WorldPosition = p2.position;
        const deg = getRotateAngle(p1WorldPosition, p2WorldPosition);
        result.positions.push(
            new THREE.Vector3(
                p1WorldPosition.x + Math.sin(deg) * distance,
                p1WorldPosition.y - Math.cos(deg) * distance,
                mapElementZ[ThreeElementType.LanePoint],
            ),
        );
        if (i === referenceBoundaryPoints.length - 2) {
            result.positions.push(
                new THREE.Vector3(
                    p2WorldPosition.x + Math.sin(deg) * distance,
                    p2WorldPosition.y - Math.cos(deg) * distance,
                    mapElementZ[ThreeElementType.LanePoint],
                ),
            );
        }
    }
    return result;
}
/**
 * 沿车道方向切分
 */
export function splitLaneInCenterHandle(laneId: string) {
    const { positions, referenceLineIsLeftBoundary, controlsPosition } = getCenterLineInfo(laneId);
    if (!positions || positions.length === 0) {
        return;
    }
    const lane = searchLaneByLaneId(laneId);
    const [leftBoundary, rightBoundary] = searchLaneBoundaries(laneId);
    const { mapState } = useManagerStore.getState();
    const { boundarys, lanes, grouds, prossibleDrivingDirections } = mapState;
    const newBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const newLaneId = `${getElementMaxIndex(lanes) + 1}`;
    const newGroudId = `${getElementMaxIndex(grouds) + 1}`;
    const newArrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const boundaryAttr = referenceLineIsLeftBoundary ? { ...leftBoundary.attr } : { ...rightBoundary.attr };
    const newPointIds: string[] = [];
    const newGroudType = lane.type === LaneTrend.Curve ? ThreeElementType.LaneCurveGroud : ThreeElementType.LaneGroud;

    const actions = [];
    positions.forEach((position, index) => {
        const pointId = `${getElementMaxIndex(mapState.points) + index + 1}`;
        newPointIds.push(pointId);
        actions.push(new AddPointCommand(pointId, position, ThreeElementType.LanePoint));
    });
    actions.push(
        new AddBoundaryCommand(
            newBoundaryId,
            controlsPosition.length !== 0 ? ThreeElementType.LaneCurveBoundary : ThreeElementType.LaneBoundary,
            BoundaryOriginType.Lane,
            newPointIds,
            controlsPosition,
            boundaryAttr,
        ),
    );

    if (referenceLineIsLeftBoundary) {
        actions.push(new ChangeLaneBoundary(laneId, leftBoundary.id, newBoundaryId));
        actions.push(
            new AddLaneCommand(
                newLaneId,
                newBoundaryId,
                rightBoundary.id,
                newGroudId,
                newArrowId,
                { ...lane.attr },
                lane.leftBoundaryReverse,
                lane.rightBoundaryReverse,
                lane.type,
            ),
        );
    } else {
        actions.push(new ChangeLaneBoundary(laneId, newBoundaryId, rightBoundary.id));
        actions.push(
            new AddLaneCommand(
                newLaneId,
                leftBoundary.id,
                newBoundaryId,
                newGroudId,
                newArrowId,
                { ...lane.attr },
                lane.leftBoundaryReverse,
                lane.rightBoundaryReverse,
                lane.type,
            ),
        );
    }
    actions.push(new UpdateGroudCommand(lane.groudId));
    actions.push(new UpdateArrowCommand(lane.arrowId));
    actions.push(new AddGroudCommand(newGroudId, newGroudType));
    actions.push(new AddArrowCommand(newArrowId, ThreeElementType.LaneRelativeDirection));
    actions.push(new SetCurrentDrawDataCommand(null, null));
    actions.push(new SetOperationTypeCommand(null));
    useManagerStore.getState().addCommand(actions);
    PubSub.publish('emptyPickObjects');
}
