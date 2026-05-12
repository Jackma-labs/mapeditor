import { AddLaneCommand, UpdateLaneWidthCommand } from 'src/command/LaneCommand';
import { AddPointCommand } from 'src/command/PointCommand';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { LaneBoundaryAttr, LaneTrend } from 'src/interface/laneInterFace';
import { generateCopyedBoundary, generateCopyedCurveBoundary } from 'src/utils/geometryUtil';
import { AddBoundaryCommand } from 'src/command/BoundaryCommand';
import { AddGroudCommand } from 'src/command/GroudCommand';
import { useManagerStore } from 'src/store';
import { BoundaryOriginType, BoundaryType } from 'src/interface/basicElementInterFace';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { AddArrowCommand } from 'src/command/ArrowCommand';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import { searchLaneByLaneId } from 'src/utils/search/laneSearch';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';

// 基于一个lane生成一个lane
export function addLaneBaseOneLaneHandle(baseLaneId: string, inLeft: boolean) {
    if (!baseLaneId) {
        return;
    }
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { lanes, boundarys, grouds, points, prossibleDrivingDirections } = newState;

    const baseLane = searchLaneByLaneId(baseLaneId);
    const leftBoundary = searchBoundaryByBoundaryId(baseLane?.leftBoundaryId);
    const rightBoundary = searchBoundaryByBoundaryId(baseLane?.rightBoundaryId);
    if (!baseLane || !leftBoundary || !rightBoundary) {
        return;
    }
    let copyedBoundaryPoints: THREE.Vector3[] = [];
    let copyedControlPositions: THREE.Vector3[] = [];

    if (baseLane.type === LaneTrend.Straight) {
        copyedBoundaryPoints = generateCopyedBoundary(baseLaneId, inLeft);
    } else {
        const info = generateCopyedCurveBoundary(baseLaneId, inLeft);
        if (!info) {
            return;
        }
        copyedBoundaryPoints = info.positions;
        copyedControlPositions = info.controlPositions;
    }
    if (copyedBoundaryPoints.length < 2) {
        console.warn('addLaneBaseOneLaneHandle时，generateCopyedBoundary生成的boundary点不对');
        return;
    }
    // 开始创建新的lane
    const laneId = `${getElementMaxIndex(lanes) + 1}`;
    const resBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const newPointIds: string[] = [];

    // 如果inLeft，则生成的新的车道线的属性同baseLane的左车道线，否则同baseLane的右车道线
    let boundaryAttr: LaneBoundaryAttr = null;
    let boundaryType: BoundaryType = null;
    const groudType =
        baseLane.type === LaneTrend.Straight ? ThreeElementType.LaneGroud : ThreeElementType.LaneCurveGroud;
    if (inLeft) {
        boundaryAttr = { ...boundarys[baseLane.leftBoundaryId].attr };
        boundaryType = leftBoundary.type;
    } else {
        boundaryAttr = { ...boundarys[baseLane.rightBoundaryId].attr };
        boundaryType = rightBoundary.type;
    }

    const action = [];
    copyedBoundaryPoints.forEach((item, index) => {
        const pointId = `${getElementMaxIndex(points) + index + 1}`;
        newPointIds.push(pointId);
        action.push(new AddPointCommand(pointId, item, ThreeElementType.LanePoint));
    });
    action.push(
        new AddBoundaryCommand(
            resBoundaryId,
            boundaryType,
            BoundaryOriginType.Lane,
            newPointIds,
            copyedControlPositions,
            boundaryAttr,
        ),
    );
    action.push(new AddGroudCommand(groudId, groudType));
    if (inLeft) {
        const cm3 = new AddLaneCommand(
            laneId,
            resBoundaryId,
            baseLane.leftBoundaryId,
            groudId,
            arrowId,
            {
                ...baseLane.attr,
            },
            baseLane.leftBoundaryReverse,
            baseLane.rightBoundaryReverse,
            baseLane.type,
        );
        action.push(cm3);
    } else {
        const cm3 = new AddLaneCommand(
            laneId,
            baseLane.rightBoundaryId,
            resBoundaryId,
            groudId,
            arrowId,
            {
                ...baseLane.attr,
            },
            baseLane.leftBoundaryReverse,
            baseLane.rightBoundaryReverse,
            baseLane.type,
        );
        action.push(cm3);
    }
    action.push(new UpdateLaneWidthCommand(laneId, baseLane.width));
    action.push(new AddArrowCommand(arrowId, ThreeElementType.LaneRelativeDirection));
    action.push(new SetOperationTypeCommand(null));
    useManagerStore.getState().addCommand(action);
    PubSub.publish('emptyPickObjects');
}
