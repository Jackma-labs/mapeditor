import { AddLaneCommand, UpdateLaneWidthCommand } from 'src/command/LaneCommand';
import { MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { AddBoundaryCommand, AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddGroudCommand } from 'src/command/GroudCommand';
import { useManagerStore } from 'src/store';
import { BoundaryOriginType } from 'src/interface/basicElementInterFace';
import { searchLaneByLaneId } from 'src/utils/search/laneSearch';
import { getLaneEndPointIds } from 'src/utils/geometryUtil';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function extendLaneBaseOneLaneHandle(baseLaneId: string) {
    PubSub.publish('emptyPickObjects');
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { lanes, boundarys, grouds, points, prossibleDrivingDirections } = newState;

    const baseLane = searchLaneByLaneId(baseLaneId);
    if (!baseLane) {
        return;
    }
    // 开始创建新的lane
    const laneId = `${getElementMaxIndex(lanes) + 1}`;
    const leftBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const rightBoundaryId = `${getElementMaxIndex(boundarys) + 2}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;

    // 找到延长lane的左右boundary的终点，并分别加入到新的lane的左右boundary
    const [lastLeftBoundaryPointId, lastRightBoundaryPointId] = getLaneEndPointIds(baseLane);
    if (!lastLeftBoundaryPointId || !lastRightBoundaryPointId) {
        return;
    }
    const width = points[lastLeftBoundaryPointId].position.distanceTo(points[lastRightBoundaryPointId].position);
    const cm1 = new SetCurrentDrawDataCommand(laneId, MapElementType.Lane);
    const cm2 = new SetOperationTypeCommand(OperationType.Drawing);
    const cm3 = new AddBoundaryCommand(leftBoundaryId, ThreeElementType.LaneBoundary, BoundaryOriginType.Lane, [], [], {
        ...boundarys[baseLane.leftBoundaryId].attr,
    });
    const cm4 = new AddBoundaryCommand(
        rightBoundaryId,
        ThreeElementType.LaneBoundary,
        BoundaryOriginType.Lane,
        [],
        [],
        {
            ...boundarys[baseLane.rightBoundaryId].attr,
        },
    );
    const cm5 = new AddGroudCommand(groudId, ThreeElementType.LaneGroud);
    const newLaneAttr = {
        ...baseLane.attr,
    };
    if (baseLane.attr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD) {
        newLaneAttr.prossibleDrivingDirection = ProssibleDrivingDirection.FORWARD;
    }
    const cm6 = new AddLaneCommand(
        laneId,
        leftBoundaryId,
        rightBoundaryId,
        groudId,
        arrowId,
        newLaneAttr,
        newLaneAttr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD,
        newLaneAttr.prossibleDrivingDirection === ProssibleDrivingDirection.BACKWARD,
        LaneTrend.Straight,
    );
    const cm7 = new AddPointToBoundaryCommand(lastLeftBoundaryPointId, leftBoundaryId, true, false);
    const cm8 = new AddPointToBoundaryCommand(lastRightBoundaryPointId, rightBoundaryId, true, false);
    const cm9 = new UpdateLaneWidthCommand(laneId, width);
    useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4, cm5, cm6, cm7, cm8, cm9]);
}
