import { DeleteAreaCommand } from 'src/command/AreaCommand';
import { DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { useManagerStore } from 'src/store';

export function deleteArea(areaId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { areas, boundarys } = newState;
    const area = areas[areaId];
    if (!area) {
        console.warn(`deleteArea删除的area未找到，area的id为${areaId}`);
        return;
    }
    const { boundaryId, groudId, id } = area;
    const pointIds = boundarys[boundaryId]?.pointIds;
    /**
     * 1. 清除groud
     * 2. 清除boundary
     * 3. 清除点
     * 4. 清除junction
     */
    const action = [];
    action.push(new DeleteGroudCommand(groudId));
    action.push(new DeleteBoundaryCommand(boundaryId));
    pointIds?.slice(0, pointIds.length - 1).forEach((pId) => {
        action.push(new DeletePointCommand(pId));
    });
    action.push(new DeleteAreaCommand(id));
    useManagerStore.getState().addCommand(action);
}
