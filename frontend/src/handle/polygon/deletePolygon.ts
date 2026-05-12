import { DeleteAreaCommand } from 'src/command/AreaCommand';
import { DeleteBoundaryCommand, RemovePointFromBoundaryCommand } from 'src/command/BoundaryCommand';
import { SetCurrentDrawDataCommand } from 'src/command/CurrentDrawDataCommand';
import { DeleteGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { DeleteJunctionCommand } from 'src/command/JunctionCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { Area } from 'src/interface/areaInterFace';
import { MapElementType } from 'src/interface/commonInterFace';
import { Junction } from 'src/interface/junctionInterFace';
import { useManagerStore } from 'src/store';
import { searchAreaByBoundaryId } from 'src/utils/search/areaSearch';
import { searchBoundarysFromPointId } from 'src/utils/search/boundarySearch';
import { searchJunctionByBoundaryId } from 'src/utils/search/junctionSearch';
import { searchPointIdsFromBoundaryId } from 'src/utils/search/pointSearch';

export function getRemoveIrregularPolygonCommand() {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { junctions, boundarys, currentDrawData, areas } = newState;
    const { drawElementType, currentDrawingElementId } = currentDrawData;
    let currentDrawingElement: Junction | Area = null;
    if (drawElementType === MapElementType.Junction) {
        currentDrawingElement = junctions[currentDrawingElementId];
    } else if (drawElementType === MapElementType.Area) {
        currentDrawingElement = areas[currentDrawingElementId];
    }

    if (!currentDrawingElement) {
        console.warn(`getRemoveIrregularJunctionCommand时，没有找到id为${currentDrawingElementId}的无效绘制元素`);
        return [];
    }
    const { boundaryId, groudId } = currentDrawingElement;
    const pointIds = boundarys[boundaryId]?.pointIds;

    const action = [];
    action.push(new DeleteBoundaryCommand(boundaryId));
    pointIds?.forEach((id) => {
        action.push(new DeletePointCommand(id));
    });
    action.push(new DeleteGroudCommand(groudId));
    if (drawElementType === MapElementType.Junction) {
        action.push(new DeleteJunctionCommand(currentDrawingElementId));
    } else if (drawElementType === MapElementType.Area) {
        action.push(new DeleteAreaCommand(currentDrawingElementId));
    }
    action.push(new SetOperationTypeCommand(null));
    action.push(new SetCurrentDrawDataCommand(null, null));
    return action;
}

export function deletePolygonLastDrawPoint(mapElement: Junction | Area) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { currentDrawData } = newState;
    const { drawElementType } = currentDrawData;
    const boundaryId = mapElement.boundaryId;
    const boundaryPointIds = searchPointIdsFromBoundaryId(mapElement.boundaryId);

    const groudId = mapElement.groudId;
    let actions: any = [];
    // 如果删除的是第一个点
    if (boundaryPointIds.length === 1) {
        const deletePointId = boundaryPointIds[0];
        actions = [
            new DeleteGroudCommand(groudId),
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeleteBoundaryCommand(boundaryId),
        ];
        if (drawElementType === MapElementType.Junction) {
            actions.push(new DeleteJunctionCommand(mapElement.id));
        } else if (drawElementType === MapElementType.Area) {
            actions.push(new DeleteAreaCommand(mapElement.id));
        }
        actions.push(new DeletePointCommand(deletePointId), new SetCurrentDrawDataCommand(null, drawElementType));
    } else {
        const deletePointId = boundaryPointIds[boundaryPointIds.length - 1];
        actions = [
            new RemovePointFromBoundaryCommand(deletePointId, boundaryId),
            new DeletePointCommand(deletePointId),
        ];
    }
    return actions;
}

export function deletePolygonPoint(pointId: string, mapElementType: MapElementType) {
    const linkBoundary = searchBoundarysFromPointId(pointId);

    if (!linkBoundary) {
        console.warn(`删除点关联的boundary未找到，点id为${pointId}`);
        return;
    }
    let linkMapElement: Junction | Area = null;
    if (mapElementType === MapElementType.Junction) {
        linkMapElement = searchJunctionByBoundaryId(linkBoundary[0].id);
    } else if (mapElementType === MapElementType.Area) {
        linkMapElement = searchAreaByBoundaryId(linkBoundary[0].id);
    }
    // junction 一个点仅关联一个boundary
    if (linkBoundary[0].pointIds.length <= 4) {
        console.warn('junction至少需要3个点，不能再删除点了');
        return;
    }
    const action = [];
    action.push(new RemovePointFromBoundaryCommand(pointId, linkBoundary[0].id));
    action.push(new DeletePointCommand(pointId));
    action.push(new UpdateGroudCommand(linkMapElement.groudId));
    useManagerStore.getState().addCommand(action);
}
