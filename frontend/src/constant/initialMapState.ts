import { SignType } from 'src/interface/SignInterFace';
import { AreaType } from 'src/interface/areaInterFace';
import { initBarrierGateAttr } from 'src/components/Attr/constData';
import { PermissionStatus, ThreeObject } from 'src/interface/commonInterFace';
import { JunctionType } from 'src/interface/junctionInterFace';
import { LaneBoundaryType, LaneDireaciotn, LaneType, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { MapState } from 'src/interface/mapStateInterface';
import { TrafficSubSignalType, Type } from 'src/interface/trafficSignal';
import { createDefaultEditorLayers } from 'src/constant/editorLayers';
import * as THREE from 'three';

export const initialMapState: MapState = {
    points: {},
    lanes: {},
    prossibleDrivingDirections: {},
    junctions: {},
    speedBumps: {},
    crosswalks: {},
    grouds: {},
    boundarys: {},
    areas: {},
    stopLines: {},
    parkingSpaces: {},
    trafficSignals: {},
    barrierGates: {},
    signs: {},
    currentDrawData: {
        baseLaneIsRightBoundary: true,
        laneAttr: {
            speed: 40,
            speedKph: 40,
            direction: LaneDireaciotn.STRAIGHT,
            prossibleDrivingDirection: ProssibleDrivingDirection.FORWARD,
            laneType: LaneType.CityDriving,
        },
        leftBoundaryAttr: { type: LaneBoundaryType.WHITESOLId },
        rightBoundaryAttr: { type: LaneBoundaryType.WHITESOLId },
        junctionAttr: {
            type: JunctionType.CROSS,
        },
        areaAttr: {
            id: null,
            type: AreaType.Driveable,
            name: 'custom',
        },

        barrierGateAttr: {
            ...initBarrierGateAttr,
        },
        laneWidth: 4,
        drawElementType: null,
        currentDrawingElementId: null,
        trafficLightAttr: {
            height: 5,
            type: Type.MIX_3_HORIZONTAL,
            subSignals: [
                { id: 'sub_1', type: TrafficSubSignalType.CIRCLE },
                { id: 'sub_2', type: TrafficSubSignalType.CIRCLE },
                { id: 'sub_3', type: TrafficSubSignalType.CIRCLE },
            ],
        },
        signType: SignType.StopSign,
    },
    currentPickElement: [],
    editorLayers: createDefaultEditorLayers(),
    baseMapDir: '',
    hdMapFile: '',
    scene: new THREE.Scene(),
    camera: null,
    operationType: null,
    hdBasemapCenter: null,
    imageBasemapCenter: null,
    coordinateFrame: 'LOCAL_ENU_METERS',
    targetCrs: null,
    apolloOrigin: null,
    coordinateAnchor: null,
    onsave: false,
    holdCtrl: false,
    holdShift: false,
    dom: null,
    renderer: null,
    needRender: false,
    ranging: false,
    needRenderElements: {
        [ThreeObject.Point]: {},
        [ThreeObject.Boundary]: {},
        [ThreeObject.Groud]: {},
        [ThreeObject.Arrow]: {},
        [ThreeObject.TrafficLight]: {},
        [ThreeObject.ControlPoint]: {},
        [ThreeObject.Sign]: {},
    },
    permissionStatus: PermissionStatus.HasPermission,
};
