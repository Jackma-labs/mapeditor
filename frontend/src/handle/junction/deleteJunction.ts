import { DeleteBoundaryCommand } from 'src/command/BoundaryCommand';
import { DeleteGroudCommand } from 'src/command/GroudCommand';
import { DeleteJunctionCommand } from 'src/command/JunctionCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { useManagerStore } from 'src/store';

export function deleteJunction(junctionId: string) {
    const state = useManagerStore.getState().mapState;
    const newState = { ...state };
    const { junctions, boundarys } = newState;
    const junction = junctions[junctionId];
    if (!junction) {
        console.warn(`deleteJunction删除的junction未找到，junction的id为${junctionId}`);
        return;
    }
    const { boundaryId, groudId, id } = junction;
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
    action.push(new DeleteJunctionCommand(id));
    useManagerStore.getState().addCommand(action);
}
