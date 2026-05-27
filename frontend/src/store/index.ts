import { initialMapState } from 'src/constant/initialMapState';
import { SignType } from 'src/interface/SignInterFace';
import { ThreeElementType, ThreeObject, PermissionStatus } from 'src/interface/commonInterFace';
import { MapState } from 'src/interface/mapStateInterface';
import { getArrows, getGrouds, loadHdmp } from 'src/utils/common';
import { removeAllElement } from 'src/utils/threeObjectUtil';
import { create } from 'zustand';
import { cloneDeep } from 'lodash';

const APOLLO_TARGET_CRS = {
    datum: 'WGS84',
    projection: 'UTM',
    zone: 50,
    hemisphere: 'north',
    epsg: 'EPSG:32650',
    proj4: '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs',
    unit: 'meter',
};

interface ManagerStore {
    mapState: MapState;
    commands: any[];
    undoCommands: any[];
    canUndo: boolean;
    canRedo: boolean;
    addCommand: (commandArr: any[]) => void;
    undo: () => void;
    redo: () => void;
    setMapState: (mapState: MapState) => void;
    import: (data: any) => void;
    export: () => void;
    clear: () => void;
    resetCommand: () => void;
    needRender: boolean;
}
export const useManagerStore = create<ManagerStore>((set, get) => ({
    mapState: cloneDeep(initialMapState),
    commands: [],
    undoCommands: [],
    canUndo: false,
    canRedo: false,
    needRender: false,
    resetCommand() {
        set((state: any) => ({
            ...state,
            commands: [],
            undoCommands: [],
            canUndo: false,
            canRedo: false,
        }));
    },
    addCommand(commandArr: any[]) {
        const action: any[] = [];
        set((state: any) => ({ ...state, mapState: { ...state.mapState, needRender: false } }));
        for (let i = 0; i < commandArr.length; i += 1) {
            const command = commandArr[i];
            command.execute();
            action.unshift(command);
        }
        set((state: any) => ({
            ...state,
            mapState: { ...state.mapState, needRender: true },
            undoCommands: [...state.undoCommands, action],
            commands: [],
            canUndo: true,
            canRedo: false,
        }));
    },
    // 回撤
    undo() {
        if (get().undoCommands.length === 0) {
            return;
        }
        const action: any[] = [];
        const commandArr = get().undoCommands.pop();
        set((state: any) => ({ ...state, mapState: { ...state.mapState, needRender: false } }));
        for (let i = 0; i < commandArr.length; i += 1) {
            const command = commandArr[i];
            command.undo();
            action.unshift(command);
        }
        set((state) => ({
            ...state,
            mapState: { ...state.mapState, needRender: true },
            commands: [...state.commands, action],
            canUndo: state.undoCommands.length !== 0,
            canRedo: true,
            needRender: true,
        }));
    },
    // 重做
    redo() {
        if (get().commands.length === 0) {
            return;
        }
        const action: any[] = [];
        const commandArr = get().commands.pop();
        set((state: any) => ({ ...state, mapState: { ...state.mapState, needRender: false } }));
        for (let i = 0; i < commandArr.length; i += 1) {
            const command = commandArr[i];
            command.execute();
            action.unshift(command);
        }
        set((state: any) => ({
            ...state,
            mapState: { ...state.mapState, needRender: true },
            undoCommands: [...state.undoCommands, action],
            canUndo: true,
            canRedo: state.commands.length !== 0,
            needRender: true,
        }));
    },
    setMapState(newMapState: MapState) {
        set((state) => ({ ...state, mapState: { ...newMapState } }));
    },
    /**
     * 将数据导入到指定函数中
     */
    import(data: any) {
        if (!data) {
            return;
        }
        const { file, json } = data;
        if (!json) {
            return;
        }
        PubSub.publishSync('removeAllRange');
        removeAllElement();

        const {
            boundarys,
            lanes,
            junctions,
            crosswalks,
            speedBumps,
            points,
            hdBasemapCenter,
            stopLines,
            trafficSignals,
            parkingSpaces,
            signs,
            areas,
            barrierGates,
            coordinateFrame,
            targetCrs,
            apolloOrigin,
            coordinateAnchor,
        } = loadHdmp(json);
        let newState = get().mapState;

        newState = {
            ...cloneDeep(initialMapState),
            needRender: true,
            hdMapFile: file,
            scene: newState.scene,
            camera: newState.camera,
            dom: newState.dom,
            permissionStatus: PermissionStatus.HasPermission,
            imageBasemapCenter: newState.imageBasemapCenter?.clone() || null,
            hdBasemapCenter,
            boundarys,
            lanes,
            junctions,
            crosswalks,
            speedBumps,
            stopLines,
            trafficSignals,
            parkingSpaces,
            points,
            signs,
            areas,
            barrierGates,
            coordinateFrame: coordinateFrame || 'LOCAL_ENU_METERS',
            targetCrs: targetCrs || APOLLO_TARGET_CRS,
            apolloOrigin: apolloOrigin || null,
            coordinateAnchor: coordinateAnchor || null,
        };
        if (
            hdBasemapCenter &&
            newState.imageBasemapCenter &&
            (hdBasemapCenter.x !== newState.imageBasemapCenter?.x ||
                hdBasemapCenter.y !== newState.imageBasemapCenter?.y)
        ) {
            const offsetX = hdBasemapCenter.x - (newState.imageBasemapCenter?.x || 0);
            const offsetY = hdBasemapCenter.y - (newState.imageBasemapCenter?.y || 0);
            Object.keys(newState.points).forEach((key) => {
                const point = newState.points[key];
                point.position.x += offsetX;
                point.position.y += offsetY;
            });
            Object.keys(newState.boundarys).forEach((key) => {
                const controlPositions = newState.boundarys[key].controlsPosition || [];
                for (let index = 0; index < controlPositions.length; index += 1) {
                    const controlPosition = controlPositions[index];
                    controlPosition.x += offsetX;
                    controlPosition.y += offsetY;
                }
            });
            Object.keys(newState.trafficSignals).forEach((key) => {
                const signal = newState.trafficSignals[key];
                if (signal.center) {
                    signal.center.x += offsetX;
                    signal.center.y += offsetY;
                }
            });
            hdBasemapCenter.x = newState.imageBasemapCenter.x;
            hdBasemapCenter.y = newState.imageBasemapCenter.y;
        }
        const grouds = getGrouds({ lanes, junctions, crosswalks, speedBumps, parkingSpaces, areas, barrierGates });
        const prossibleDrivingDirections = getArrows({ lanes, parkingSpaces });
        newState.grouds = grouds;
        newState.prossibleDrivingDirections = prossibleDrivingDirections;
        Object.keys(newState.boundarys).forEach((bId) => {
            newState.needRenderElements[ThreeObject.Boundary][bId] = newState.boundarys[bId].type;
        });
        Object.keys(newState.points).forEach((pId) => {
            newState.needRenderElements[ThreeObject.Point][pId] = newState.points[pId].type;
        });
        Object.keys(newState.grouds).forEach((gId) => {
            newState.needRenderElements[ThreeObject.Groud][gId] = newState.grouds[gId].type;
        });
        Object.keys(newState.trafficSignals).forEach((tId) => {
            newState.needRenderElements[ThreeObject.TrafficLight][tId] = ThreeElementType.TrafficLight;
        });
        Object.keys(newState.prossibleDrivingDirections).forEach((aId) => {
            newState.needRenderElements[ThreeObject.Arrow][aId] = newState.prossibleDrivingDirections[aId].type;
        });
        Object.keys(newState.signs).forEach((sId) => {
            newState.needRenderElements[ThreeObject.Sign][sId] = ThreeElementType.SignIcon;
        });

        set((state) => ({
            ...state,
            mapState: newState,
        }));
        const coordinates = Object.values(newState.points).map((item) => [item.position.x, item.position.y]);
        PubSub.publishSync('cameraMove', coordinates);
    },

    export() {
        const {
            points,
            boundarys,
            lanes,
            crosswalks,
            speedBumps,
            junctions,
            stopLines,
            trafficSignals,
            parkingSpaces,
            signs,
            areas,
            barrierGates,
            coordinateFrame,
            targetCrs,
            apolloOrigin,
            coordinateAnchor,
        } = get().mapState;
        const publishCoordinateFrame = coordinateFrame || 'LOCAL_ENU_METERS';
        const publishTargetCrs = targetCrs || APOLLO_TARGET_CRS;
        const publishAnchor = coordinateAnchor || (apolloOrigin ? { source: 'apolloOrigin', utm: apolloOrigin } : null);
        const data = {
            header: {
                version: '1.0',
                date: `${new Date().getTime()}`,
                origin: apolloOrigin || undefined,
                projection: { proj: publishTargetCrs.proj4 },
            },
            sourceCrs: publishCoordinateFrame,
            targetCrs: publishTargetCrs,
            apolloOrigin: apolloOrigin || undefined,
            anchor: publishAnchor || undefined,
            point: Object.keys(points).map((item: string) => {
                const { id, type, position } = points[item];
                const handlePosition = { x: Number(position.x.toFixed(4)), y: Number(position.y.toFixed(4)) };
                return { id, position: handlePosition, type };
            }),
            boundary: Object.keys(boundarys)
                .filter((item) => boundarys[item].type !== ThreeElementType.RoadBoundary)
                .map((bId) => {
                    const { id, attr, pointIds, type, controlsPosition, relativeRoadBoundaryIds } = boundarys[bId];
                    const handleControlsPosition = controlsPosition?.map((controlItem) => ({
                        x: controlItem.x,
                        y: controlItem.y,
                    }));
                    return {
                        id,
                        attr,
                        point_id: pointIds,
                        type,
                        controlsPosition: handleControlsPosition,
                        roadBoundaryId: relativeRoadBoundaryIds,
                    };
                }),
            roadBoundary: Object.keys(boundarys)
                .filter((item) => boundarys[item].type === ThreeElementType.RoadBoundary)
                .map((rId) => {
                    const { id, pointIds, controlsPosition, relativeLaneBoundaryIds } = boundarys[rId];
                    const handleControlsPosition = controlsPosition?.map((controlItem) => ({
                        x: controlItem.x,
                        y: controlItem.y,
                    }));
                    return {
                        id,
                        point_id: pointIds,
                        controlsPosition: handleControlsPosition,
                        laneBoundaryId: relativeLaneBoundaryIds,
                    };
                }),
            lane: Object.keys(lanes).map((item: string) => {
                const {
                    id,
                    attr,
                    leftBoundaryId,
                    rightBoundaryId,
                    groudId,
                    leftBoundaryReverse,
                    rightBoundaryReverse,
                    width,
                    type,
                    arrowId,
                } = lanes[item];
                return {
                    id,
                    attr,
                    left_boundary_id: leftBoundaryId,
                    right_boundary_id: rightBoundaryId,
                    groudId,
                    left_boundary_reverse: leftBoundaryReverse,
                    right_boundary_reverse: rightBoundaryReverse,
                    width,
                    type,
                    arrowId,
                };
            }),
            crosswalk: Object.keys(crosswalks).map((item: string) => {
                const { id, boundaryId, groudId } = crosswalks[item];
                return { id, boundaryId, groudId };
            }),
            speed_bump: Object.keys(speedBumps).map((item: string) => {
                const { id, boundaryId, groudId } = speedBumps[item];
                return { id, boundaryId, groudId };
            }),
            junction: Object.keys(junctions).map((item: string) => {
                const { id, attr, boundaryId, groudId } = junctions[item];
                return { id, attr, boundaryId, groudId };
            }),
            stopLine: Object.keys(stopLines).map((id: string) => ({
                id: stopLines[id].id,
                boundaryId: stopLines[id].boundaryId,
                origin: stopLines[id].origin,
            })),
            trafficSignal: Object.keys(trafficSignals).map((tId) => {
                const { id, stopLineId, heading, height, type, center, subSignals } = trafficSignals[tId];
                const stopLineBoundaryId = stopLines[stopLineId]?.boundaryId;
                return {
                    id,
                    stopLineId,
                    boundaryId: stopLineBoundaryId,
                    heading,
                    height,
                    type,
                    center: {
                        x: Number((center?.x || 0).toFixed(4)),
                        y: Number((center?.y || 0).toFixed(4)),
                    },
                    subSignal: subSignals,
                };
            }),
            parkingSpace: Object.keys(parkingSpaces).map((pid) => {
                const { id, length, width, boundaryId, heading, groudId, arrowId } = parkingSpaces[pid];
                return {
                    id,
                    length,
                    width,
                    boundaryId,
                    heading,
                    groudId,
                    arrowId,
                };
            }),
            stopSign: Object.keys(signs)
                .filter((sid) => signs[sid].type === SignType.StopSign)
                .map((id) => ({
                    id,
                    stopLineId: signs[id].stopLineId,
                    boundaryId: stopLines[signs[id].stopLineId]?.boundaryId,
                })),
            yieldSign: Object.keys(signs)
                .filter((sid) => signs[sid].type === SignType.YieldSign)
                .map((id) => ({
                    id,
                    stopLineId: signs[id].stopLineId,
                    boundaryId: stopLines[signs[id].stopLineId]?.boundaryId,
                })),
            basemapCenter: get().mapState.imageBasemapCenter || get().mapState.hdBasemapCenter || { x: 0, y: 0 },
            area: Object.keys(areas).map((item: string) => {
                const { id, type, boundaryId, groudId, name } = areas[item];
                return { id, type, boundaryId, groudId, name };
            }),
            barrierGate: Object.keys(barrierGates).map((id) => barrierGates[id]),
        };
        return data;
    },
    clear() {
        set((state) => ({
            ...state,
            mapState: cloneDeep(initialMapState),
            commands: [],
            undoCommands: [],
            canUndo: false,
            canRedo: false,
            needRender: false,
        }));
    },
}));
