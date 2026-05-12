import { AddBoundaryCommand, AddPointToBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';

export function extendBoundaryHandle(boundaryId: string, isStart: boolean) {
    PubSub.publish('emptyPickObjects');
    const state = useManagerStore.getState().mapState;
    const { boundarys } = state;
    const baseBoundary = boundarys[boundaryId];
    const points = searchPointsFromBoundaryId(boundaryId);

    let firstPointId: string = null;
    if (isStart) {
        firstPointId = points[0].id;
    } else {
        firstPointId = points[points.length - 1].id;
    }

    const newBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const newMapElementType =
        baseBoundary.type === ThreeElementType.LaneBoundary ? MapElementType.StraightLine : MapElementType.RoadBoundary;
    const cm1 = new SetCurrentDrawDataCommand(newBoundaryId, newMapElementType);
    const cm2 = new SetOperationTypeCommand(OperationType.Drawing);
    const cm3 = new AddBoundaryCommand(newBoundaryId, baseBoundary.type, baseBoundary.origin, [], [], {
        type: baseBoundary.attr?.type,
    });
    const cm4 = new AddPointToBoundaryCommand(firstPointId, newBoundaryId, true, false);
    useManagerStore.getState().addCommand([cm1, cm2, cm3, cm4]);
}
