import { AddLaneCommand, DeleteLaneCommand, FinishLaneCommand, UpdateLaneWidthCommand } from 'src/command/LaneCommand';
import { AddPointCommand, DeletePointCommand } from 'src/command/PointCommand';
import { laneBoundaryColor, laneGroudColor, laneGroudOpacity } from 'src/constant/color';
import {
    computedLeftBoundaryPointPosition,
    getBooleanClockwise,
    getResetPointPosition,
    vector3TransTpVector2,
} from 'src/utils/vectorUtil';
import * as THREE from 'three';
import PubSub from 'pubsub-js';
import { InterActiveType, MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import {
    AddBoundaryCommand,
    AddPointToBoundaryCommand,
    DeleteBoundaryCommand,
    RemovePointFromBoundaryCommand,
} from 'src/command/BoundaryCommand';
import { AddGroudCommand, DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { searchLaneByLaneId, searchLanesFromPointId } from 'src/utils/search/laneSearch';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { mapElementZ } from 'src/constant/mapElementZ';
import { drawLine, drawShape } from 'src/object/basicObject';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function getRemoveIrregularLaneCommand(laneId: string) {
    if (!laneId) {
        return [];
    }
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { lanes, boundarys } = newState;
    const lane = lanes[laneId];
    if (!lane) {
        console.warn(`getRemoveIrregularLaneCommand时当前绘制的无效的lane为null,id为${laneId}`);
        return [];
    }

    const action = [];
    // 需要清除当前绘制的不成型的lane的数据
    boundarys[lane.leftBoundaryId]?.pointIds?.forEach((id) => {
        const pLinkLanes = searchLanesFromPointId(id);
        if (pLinkLanes.length <= 1) {
            action.push(new DeletePointCommand(id));
        }
    });
    boundarys[lane.rightBoundaryId]?.pointIds?.forEach((id) => {
        const pLinkLanes = searchLanesFromPointId(id);
        if (pLinkLanes.length <= 1) {
            action.push(new DeletePointCommand(id));
        }
    });
    action.push(new DeleteBoundaryCommand(lane.leftBoundaryId));
    action.push(new DeleteBoundaryCommand(lane.rightBoundaryId));
    action.push(new DeleteGroudCommand(lane.groudId));
    action.push(new DeleteLaneCommand(lane.id));
    action.push(new FinishLaneCommand(lane.id));
    action.push(new SetOperationTypeCommand(null));
    action.push(new SetCurrentDrawDataCommand(null, null));
    return action;
}
export function addLaneClickHandle(position: THREE.Vector3) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { boundarys, grouds, currentDrawData, points, lanes, prossibleDrivingDirections } = newState;
    const { currentDrawingElementId } = currentDrawData;

    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');

    const pointId = `${getElementMaxIndex(points) + 1}`;
    const cm1 = new AddPointCommand(pointId, position, ThreeElementType.LanePoint);
    // 如果该lane还没创建，则先创建lane数据
    if (!currentDrawingElementId) {
        const laneId = `${getElementMaxIndex(lanes) + 1}`;
        const leftBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
        const rightBoundaryId = `${getElementMaxIndex(boundarys) + 2}`;
        const groudId = `${getElementMaxIndex(grouds) + 1}`;
        const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;

        const cm2 = new SetCurrentDrawDataCommand(laneId, MapElementType.Lane);
        const cm3 = new AddBoundaryCommand(
            leftBoundaryId,
            ThreeElementType.LaneBoundary,
            BoundaryOriginType.Lane,
            [],
            [],
            {
                ...currentDrawData.leftBoundaryAttr,
            },
        );
        const cm4 = new AddBoundaryCommand(
            rightBoundaryId,
            ThreeElementType.LaneBoundary,
            BoundaryOriginType.Lane,
            [],
            [],
            {
                ...currentDrawData.rightBoundaryAttr,
            },
        );
        const cm5 = new AddGroudCommand(groudId, ThreeElementType.LaneGroud);
        const cm6 = new AddLaneCommand(
            laneId,
            leftBoundaryId,
            rightBoundaryId,
            groudId,
            arrowId,
            {
                ...currentDrawData.laneAttr,
            },
            currentDrawData.laneAttr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD,
            currentDrawData.laneAttr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD,
            LaneTrend.Straight,
        );
        const cm7 = new AddPointToBoundaryCommand(pointId, leftBoundaryId, true, false);
        useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6, cm7]);
    } else {
        const laneId = newState.currentDrawData.currentDrawingElementId;
        const lane = searchLaneByLaneId(laneId);
        if (!lane) {
            return;
        }
        const { leftBoundaryId, rightBoundaryId, width } = lane;
        const leftBoundaryPoints = searchPointsFromBoundaryId(leftBoundaryId);
        const rightBoundaryPoints = searchPointsFromBoundaryId(rightBoundaryId);
        // 如果 rightBoundaryPointIds length为0说明这是第二个点
        if (rightBoundaryPoints.length === 0) {
            const cm2 = new AddPointToBoundaryCommand(pointId, rightBoundaryId, true, false);
            const leftBoundaryFirstPointPosition = leftBoundaryPoints[0]?.position;
            if (!leftBoundaryFirstPointPosition) {
                console.warn('addLaneClickHandle绘制过程中，当前绘制lane的左boundary第一个点找不到了');
                return;
            }
            const laneWidth = leftBoundaryFirstPointPosition.distanceTo(position);
            const cm3 = new UpdateLaneWidthCommand(laneId, laneWidth);
            useManagerStore.getState().addCommand([cm1, cm2, cm3]);
        } else {
            // 如果绘制的是第三个点，则需要判断，描边是左边界还是右边界
            const beforeRightBoundaryPoint = rightBoundaryPoints[rightBoundaryPoints.length - 1]?.position;
            const beforeLeftBoundaryPoint = leftBoundaryPoints[leftBoundaryPoints.length - 1]?.position;
            let isBaseRightBoundary = true;
            let resetPointPosition = null;
            if (!beforeRightBoundaryPoint || !beforeLeftBoundaryPoint) {
                console.warn('addLaneClickHandle绘制过程中，上一个绘制的左boundary和右boundary的点没了');
                return;
            }
            // 如果绘制的是第三个点，则需要判断，描边是左边界还是右边界
            if (rightBoundaryPoints.length === 1 && leftBoundaryPoints.length === 1) {
                isBaseRightBoundary = !getBooleanClockwise([
                    [beforeLeftBoundaryPoint.x, beforeLeftBoundaryPoint.y],
                    [beforeRightBoundaryPoint.x, beforeRightBoundaryPoint.y],
                    [position.x, position.y],
                    [beforeLeftBoundaryPoint.x, beforeLeftBoundaryPoint.y],
                ]);
                newState.currentDrawData.baseLaneIsRightBoundary = isBaseRightBoundary;
                resetPointPosition = getResetPointPosition(
                    rightBoundaryPoints[0].position,
                    position,
                    width,
                    isBaseRightBoundary,
                );
            } else {
                isBaseRightBoundary = currentDrawData.baseLaneIsRightBoundary;
                if (isBaseRightBoundary) {
                    resetPointPosition = computedLeftBoundaryPointPosition(
                        rightBoundaryPoints[rightBoundaryPoints.length - 1].position,
                        position,
                        width,
                    );
                } else {
                    resetPointPosition = computedLeftBoundaryPointPosition(
                        leftBoundaryPoints[leftBoundaryPoints.length - 1].position,
                        position,
                        -width,
                    );
                }
            }

            const pointId1 = `${getElementMaxIndex(points) + 2}`;
            const actions = [];
            actions.push(cm1);
            actions.push(new AddPointCommand(pointId1, resetPointPosition, ThreeElementType.LanePoint));
            if (rightBoundaryPoints.length === 1 && leftBoundaryPoints.length === 1 && !isBaseRightBoundary) {
                actions.push(new RemovePointFromBoundaryCommand(leftBoundaryPoints[0].id, leftBoundaryId));
                actions.push(new RemovePointFromBoundaryCommand(rightBoundaryPoints[0].id, rightBoundaryId));
                actions.push(new AddPointToBoundaryCommand(rightBoundaryPoints[0].id, leftBoundaryId, true, false));
                actions.push(new AddPointToBoundaryCommand(leftBoundaryPoints[0].id, rightBoundaryId, true, false));
            }
            if (!isBaseRightBoundary) {
                actions.push(new AddPointToBoundaryCommand(pointId, leftBoundaryId, true, false));
                actions.push(new AddPointToBoundaryCommand(pointId1, rightBoundaryId, true, false));
            }
            if (isBaseRightBoundary) {
                actions.push(new AddPointToBoundaryCommand(pointId, rightBoundaryId, true, false));
                actions.push(new AddPointToBoundaryCommand(pointId1, leftBoundaryId, true, false));
            }
            actions.push(new UpdateGroudCommand(lane.groudId));
            useManagerStore.getState().setMapState(newState);
            useManagerStore.getState().addCommand(actions);
        }
    }
}

export function addLaneMousemoveHandle(position: THREE.Vector3) {
    // 清除鼠标mouseMove过程中的绘制数据
    PubSub.publishSync('removeMouseMoveElements');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const laneId = newState.currentDrawData.currentDrawingElementId;
    if (!laneId) {
        return;
    }
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return;
    }
    const { leftBoundaryId, rightBoundaryId, width } = lane;
    const leftBoundaryPoints = searchPointsFromBoundaryId(leftBoundaryId);
    const rightBoundaryPoints = searchPointsFromBoundaryId(rightBoundaryId);
    if (leftBoundaryPoints.length === 0) {
        return;
    }
    if (leftBoundaryPoints.length === 1 && rightBoundaryPoints.length === 0) {
        const { line } =
            drawLine([leftBoundaryPoints[0].position, position], laneBoundaryColor[InterActiveType.Default]) || {};
        PubSub.publishSync('addMouseMoveLine', line);
        return;
    }
    const lastLeftBoundaryPointPosition = leftBoundaryPoints[leftBoundaryPoints.length - 1]?.position;
    const lastRightBoundaryPointPosition = rightBoundaryPoints[rightBoundaryPoints.length - 1]?.position;
    let isBaseRightBoundary = true;
    let resetPointPosition = null;
    let leftP1 = null;
    let leftP2 = null;
    let rightP1 = null;
    let rightP2 = null;
    if (leftBoundaryPoints.length === 1 && rightBoundaryPoints.length === 1) {
        isBaseRightBoundary = !getBooleanClockwise([
            [leftBoundaryPoints[0].position.x, leftBoundaryPoints[0].position.y],
            [rightBoundaryPoints[0].position.x, rightBoundaryPoints[0].position.y],
            [position.x, position.y],
            [leftBoundaryPoints[0].position.x, leftBoundaryPoints[0].position.y],
        ]);
        const actualwidth = isBaseRightBoundary ? width : -width;
        resetPointPosition = computedLeftBoundaryPointPosition(rightBoundaryPoints[0].position, position, actualwidth);
        leftP1 = lastLeftBoundaryPointPosition.clone();
        leftP2 = resetPointPosition;
        rightP1 = lastRightBoundaryPointPosition.clone();
        rightP2 = position;
    } else {
        isBaseRightBoundary = newState.currentDrawData.baseLaneIsRightBoundary;
        const actualwidth = isBaseRightBoundary ? width : -width;
        const beforePointPosition = isBaseRightBoundary
            ? lastRightBoundaryPointPosition
            : lastLeftBoundaryPointPosition;

        resetPointPosition = computedLeftBoundaryPointPosition(beforePointPosition, position, actualwidth);
        leftP1 = lastLeftBoundaryPointPosition.clone();
        leftP2 = isBaseRightBoundary ? resetPointPosition : position;
        rightP1 = lastRightBoundaryPointPosition.clone();
        rightP2 = isBaseRightBoundary ? position : resetPointPosition;
    }

    const { line: line1 } = drawLine([leftP1, leftP2], laneBoundaryColor[InterActiveType.Default]) || {};
    const { line: line2 } = drawLine([rightP1, rightP2], laneBoundaryColor[InterActiveType.Default]) || {};
    const groud = drawShape(
        [
            vector3TransTpVector2(leftP1),
            vector3TransTpVector2(leftP2),
            vector3TransTpVector2(rightP2),
            vector3TransTpVector2(rightP1),
            vector3TransTpVector2(leftP1),
        ],
        laneGroudColor[InterActiveType.Default],
        laneGroudOpacity,
    );
    groud.position.z = mapElementZ[ThreeElementType.LaneGroud];
    PubSub.publishSync('addMouseMoveGroud', groud);
    PubSub.publishSync('addMouseMoveLine', line1);
    PubSub.publishSync('addMouseMoveLine', line2);
}

export function getDrawLanePromptData(e: MouseEvent, dom: HTMLElement) {
    const rect = dom.getBoundingClientRect();

    const state = useManagerStore.getState().mapState;
    const { currentDrawData, lanes, boundarys, operationType } = state;
    const { currentDrawingElementId } = currentDrawData;

    if (operationType === OperationType.Drawing && Object.keys(lanes).length === 0) {
        return {
            text: '单击确定⻋道宽度起点',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(lanes).length === 1 &&
        boundarys[lanes[currentDrawingElementId]?.leftBoundaryId]?.pointIds?.length === 1 &&
        boundarys[lanes[currentDrawingElementId]?.rightBoundaryId]?.pointIds?.length === 0
    ) {
        return {
            text: '单击确定⻋道宽度',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(lanes).length === 1 &&
        boundarys[lanes[currentDrawingElementId]?.leftBoundaryId]?.pointIds?.length === 1 &&
        boundarys[lanes[currentDrawingElementId]?.rightBoundaryId]?.pointIds?.length === 1
    ) {
        return {
            text: '单击确定⻋道⻓度和方向',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    if (
        operationType === OperationType.Drawing &&
        Object.keys(lanes).length === 1 &&
        boundarys[lanes[currentDrawingElementId]?.leftBoundaryId]?.pointIds?.length === 2 &&
        boundarys[lanes[currentDrawingElementId]?.rightBoundaryId]?.pointIds?.length === 2
    ) {
        return {
            text: '单击确定下一节车道，双击或esc或enter键结束绘制',
            left: e.clientX - rect.left + 10,
            top: e.clientY - rect.top + 10,
        };
    }
    return {
        text: '',
        left: -10,
        top: -10,
    };
}
export function swapLaneBoundaryHandle(laneId: string) {
    const state = useManagerStore.getState().mapState;
    const lane = searchLaneByLaneId(laneId);
    if (!lane) {
        return state;
    }

    const temp = lane.leftBoundaryId;
    lane.leftBoundaryId = lane.rightBoundaryId;
    lane.rightBoundaryId = temp;
    state.lanes[laneId] = lane;

    return state;
}
