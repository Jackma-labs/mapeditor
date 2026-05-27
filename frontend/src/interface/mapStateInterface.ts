import { Sign, SignType } from './SignInterFace';
import { Area, AreaAttr } from './areaInterFace';
import { BarrierGate, BarrierGateAttr } from './barrierGateInterFace';
import { PointElement, Groud, Boundary, Arrow } from './basicElementInterFace';
import { MapElementType, OperationType, PermissionStatus, ThreeElementType, ThreeObject } from './commonInterFace';
import { Crosswalk } from './crosswalkInterFace';
import { Junction, JunctionAttr } from './junctionInterFace';
import { Lane, LaneAttr, LaneBoundaryAttr } from './laneInterFace';
import { ParkingSpace } from './parkingSpaceInterFace';
import { SpeedBump } from './speedBumpInterFace';
import { StopLine } from './stopLineInterFace';
import { TrafficSignal, TrafficSubSignal, Type as TrafficLightType } from './trafficSignal';
import { EditorLayerMap } from './layerInterface';

export interface MapState {
    points: {
        [id: string]: PointElement;
    };
    prossibleDrivingDirections: {
        [id: string]: Arrow;
    };
    lanes: {
        [id: string]: Lane;
    };
    grouds: {
        [id: string]: Groud;
    };
    boundarys: {
        [id: string]: Boundary;
    };
    operationType: OperationType;
    currentDrawData: {
        laneAttr: LaneAttr;
        leftBoundaryAttr: LaneBoundaryAttr;
        rightBoundaryAttr: LaneBoundaryAttr;
        junctionAttr: JunctionAttr;
        areaAttr: AreaAttr;
        barrierGateAttr: BarrierGateAttr;
        laneWidth: number;
        baseLaneIsRightBoundary: boolean;
        // 绘制元素
        drawElementType: MapElementType | null;
        currentDrawingElementId: string | null;
        trafficLightAttr: {
            height: number;
            type: TrafficLightType;
            subSignals: TrafficSubSignal[];
        };
        signType: SignType;
    };
    currentPickElement: { id: string; type: ThreeElementType; threeObject: ThreeObject }[];
    editorLayers: EditorLayerMap;
    junctions: {
        [id: string]: Junction;
    };
    barrierGates: {
        [id: string]: BarrierGate;
    };
    areas: {
        [id: string]: Area;
    };
    speedBumps: {
        [id: string]: SpeedBump;
    };
    crosswalks: {
        [id: string]: Crosswalk;
    };
    stopLines: {
        [id: string]: StopLine;
    };
    trafficSignals: {
        [id: string]: TrafficSignal;
    };
    parkingSpaces: {
        [id: string]: ParkingSpace;
    };
    signs: {
        [id: string]: Sign;
    };
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    baseMapDir: string;
    hdMapFile: string;
    hdBasemapCenter: THREE.Vector2;
    imageBasemapCenter: THREE.Vector2;
    coordinateFrame: string;
    targetCrs: any;
    apolloOrigin: { x: number; y: number; z?: number } | null;
    coordinateAnchor: any;
    onsave: boolean;
    holdCtrl: boolean;
    holdShift: boolean;
    dom: HTMLElement;
    needRender: boolean;
    ranging: boolean;
    // 第一个id:ThreeObject, 第二个id:元素id  第三个number ThreeElementType
    needRenderElements: { [id: number]: { [id: string]: number } };
    permissionStatus: PermissionStatus;
}
