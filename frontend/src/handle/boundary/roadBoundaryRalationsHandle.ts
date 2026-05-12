import {
    UpdateBoundaryRelativeLaneBoundaryIdsCommand,
    UpdateBoundaryRelativeRoadBoundaryIdsCommand,
} from 'src/command/BoundaryCommand';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';

// binding 为true为绑定，false为解绑
export function roadBoundaryRalationsHandle(binding: boolean) {
    const { mapState } = useManagerStore.getState();
    const { currentPickElement } = mapState;

    const boundary1 = searchBoundaryByBoundaryId(currentPickElement[0].id);
    const boundary2 = searchBoundaryByBoundaryId(currentPickElement[1].id);
    if (!boundary1 || !boundary2) {
        return;
    }
    if (
        (boundary1.type === ThreeElementType.LaneBoundary || boundary1.type === ThreeElementType.LaneCurveBoundary) &&
        boundary2.type === ThreeElementType.RoadBoundary
    ) {
        if (binding) {
            const cm1 = new UpdateBoundaryRelativeRoadBoundaryIdsCommand(boundary1.id, [boundary2.id]);
            const cm2 = new UpdateBoundaryRelativeLaneBoundaryIdsCommand(boundary2.id, [
                ...boundary2.relativeLaneBoundaryIds,
                boundary1.id,
            ]);
            useManagerStore.getState().addCommand([cm1, cm2]);
        } else {
            const cm1 = new UpdateBoundaryRelativeRoadBoundaryIdsCommand(boundary1.id, []);
            const cm2 = new UpdateBoundaryRelativeLaneBoundaryIdsCommand(
                boundary2.id,
                boundary2.relativeLaneBoundaryIds.filter((item) => item !== boundary1.id),
            );
            useManagerStore.getState().addCommand([cm1, cm2]);
        }
    } else if (
        boundary1.type === ThreeElementType.RoadBoundary &&
        (boundary2.type === ThreeElementType.LaneBoundary || boundary2.type === ThreeElementType.LaneCurveBoundary)
    ) {
        if (!binding) {
            const cm1 = new UpdateBoundaryRelativeLaneBoundaryIdsCommand(
                boundary1.id,
                boundary1.relativeLaneBoundaryIds.filter((item) => item !== boundary2.id),
            );
            const cm2 = new UpdateBoundaryRelativeRoadBoundaryIdsCommand(boundary2.id, []);
            useManagerStore.getState().addCommand([cm1, cm2]);
        } else {
            const cm1 = new UpdateBoundaryRelativeLaneBoundaryIdsCommand(boundary1.id, [
                ...boundary1.relativeLaneBoundaryIds,
                boundary2.id,
            ]);
            const cm2 = new UpdateBoundaryRelativeRoadBoundaryIdsCommand(boundary2.id, [boundary1.id]);
            useManagerStore.getState().addCommand([cm1, cm2]);
        }
    }

    PubSub.publish('emptyPickObjects');
    // PubSub.publish('')
}
