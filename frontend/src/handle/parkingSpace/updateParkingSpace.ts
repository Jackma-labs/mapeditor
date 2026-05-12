import { UpdateArrowCommand } from 'src/command/ArrowCommand';
import { UpdateBoundaryCommand } from 'src/command/BoundaryCommand';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { UpdateParkingSpaceLengthCommand, UpdateParkingSpaceWidthCommand } from 'src/command/ParkingSpaceCommand';
import { DragPointCommand } from 'src/command/PointCommand';
import { ThreeObject } from 'src/interface/commonInterFace';
import { MapState } from 'src/interface/mapStateInterface';
import { useManagerStore } from 'src/store';
import { objectSearch } from 'src/utils/search/objectSearch';
import { getRotateAngle } from 'src/utils/vectorUtil';
/**
 * 更新停车位的点的位置
 * @param  newNum 新的数据
 * @param isUpdateWidth 是否更新宽度,否则为更新长度
 * return 更新位置的点的Id
 */
export function updateParkingSpacePointMeshPosition(
    state: MapState,
    parkingSpaceId: string,
    newNum: number,
    isUpdateWidth: boolean = true,
): string[] {
    const { boundarys, points, parkingSpaces } = state;
    const parkingSpace = parkingSpaces[parkingSpaceId];
    if (!parkingSpace) {
        return [];
    }
    const originWidth = parkingSpace.width;
    const originLength = parkingSpace.length;
    // 如果宽度没有变化，则不处理
    if ((originWidth === newNum && isUpdateWidth) || (originLength === newNum && !isUpdateWidth)) {
        return [];
    }

    const pointIds = boundarys[parkingSpace.boundaryId]?.pointIds || [];
    // 如果还没有绘制第二个点时就去修改宽度，则不处理
    if (pointIds.length < 2) {
        return [];
    }

    // 之前没有width，说明是第一次更改，则直接修改width即可，没必要更新点的坐标
    if (!parkingSpace.width) {
        return [];
    }

    const firstPoint = points[pointIds[0]];
    const secondPoint = points[pointIds[1]];
    const threePoint = points[pointIds[2]];
    const fourPoint = points[pointIds[3]];

    const secondPointMesh = objectSearch(ThreeObject.Point, secondPoint.id);
    const threePointMesh = objectSearch(ThreeObject.Point, threePoint.id);
    const fourPointMesh = objectSearch(ThreeObject.Point, fourPoint.id);
    if (isUpdateWidth) {
        const transNum = Number(`${(newNum - originWidth).toFixed(2)}`);
        const deg = getRotateAngle(firstPoint.position, secondPoint.position);

        secondPointMesh.position.x += transNum * Math.cos(deg);
        secondPointMesh.position.y += transNum * Math.sin(deg);
        threePointMesh.position.x += transNum * Math.cos(deg);
        threePointMesh.position.y += transNum * Math.sin(deg);
        return [secondPoint.id, threePoint.id];
    }
    const deg = getRotateAngle(firstPoint.position, fourPoint.position);
    const transNum = Number(`${(newNum - originLength).toFixed(2)}`);

    threePointMesh.position.x += transNum * Math.cos(deg);
    threePointMesh.position.y += transNum * Math.sin(deg);
    fourPointMesh.position.x += transNum * Math.cos(deg);
    fourPointMesh.position.y += transNum * Math.sin(deg);
    return [threePoint.id, fourPoint.id];
}

export function updateParkingSpaceWidth(id: string, updateWidth: number) {
    const { mapState, addCommand } = useManagerStore.getState();
    if (!mapState.parkingSpaces[id]) {
        return;
    }
    const action = [];
    const updatedPointIds = updateParkingSpacePointMeshPosition(mapState, id, updateWidth, true);
    updatedPointIds.forEach((pointId) => {
        action.push(new DragPointCommand(pointId));
    });
    action.push(new UpdateParkingSpaceWidthCommand(id, updateWidth));
    action.push(new UpdateGroudCommand(mapState.parkingSpaces[id].groudId));
    action.push(new UpdateBoundaryCommand(mapState.parkingSpaces[id].boundaryId));
    action.push(new UpdateArrowCommand(mapState.parkingSpaces[id].arrowId));
    addCommand(action);
}

export function updateParkingSpaceLength(id: string, updateHeight: number) {
    const { mapState, addCommand } = useManagerStore.getState();
    if (!mapState.parkingSpaces[id]) {
        return;
    }
    const action = [];
    const updatedPointIds = updateParkingSpacePointMeshPosition(mapState, id, updateHeight, false);
    updatedPointIds.forEach((pointId) => {
        action.push(new DragPointCommand(pointId));
    });
    action.push(new UpdateParkingSpaceLengthCommand(id, updateHeight));
    action.push(new UpdateGroudCommand(mapState.parkingSpaces[id].groudId));
    action.push(new UpdateBoundaryCommand(mapState.parkingSpaces[id].boundaryId));
    action.push(new UpdateArrowCommand(mapState.parkingSpaces[id].arrowId));
    addCommand(action);
}
