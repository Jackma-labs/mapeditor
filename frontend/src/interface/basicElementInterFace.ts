import { ThreeElementType } from './commonInterFace';
import { LaneBoundaryAttr } from './laneInterFace';

export type BoundaryType =
    | ThreeElementType.LaneBoundary
    | ThreeElementType.LaneCurveBoundary
    | ThreeElementType.JunctionBoundary
    | ThreeElementType.CrosswalkBoundary
    | ThreeElementType.SpeedBumpBoundary
    | ThreeElementType.StopLineBoundary
    | ThreeElementType.ParkingSpaceBoundary
    | ThreeElementType.RoadBoundary
    | ThreeElementType.AreaBoundary
    | ThreeElementType.BarrierGateBoundary;
export type GroudType =
    | ThreeElementType.LaneGroud
    | ThreeElementType.JunctionGroud
    | ThreeElementType.CrosswalkGroud
    | ThreeElementType.SpeedBumpGroud
    | ThreeElementType.ParkingSpaceGroud
    | ThreeElementType.LaneCurveGroud
    | ThreeElementType.AreaGroud
    | ThreeElementType.BarrierGateGroud;
export type PointType =
    | ThreeElementType.LanePoint
    | ThreeElementType.RoadBoundaryPoint
    | ThreeElementType.JunctionPoint
    | ThreeElementType.AreaPoint
    | ThreeElementType.CrosswalkPoint
    | ThreeElementType.SpeedBumpPoint
    | ThreeElementType.StopLinePoint
    | ThreeElementType.ParkingSpacePoint
    | ThreeElementType.BarrierGatePoint;
export interface CurveBoundary {
    id: string;
    attr?: LaneBoundaryAttr;
    pointIds: string[];
    controlsPosition: THREE.Vector3[];
}
export interface PointElement {
    id: string;
    position: THREE.Vector3;
    type: ThreeElementType;
}
export interface Groud {
    id: string;
    type: GroudType;
}
export enum BoundaryOriginType {
    Lane,
    StraightLine,
    Junction,
    Crosswalk,
    ParkingSpace,
    SpeedBump,
    StopLine,
    RoadBoundary,
    Area,
    BarrierGate,
}
export interface Boundary {
    id: string;
    pointIds: string[];
    attr?: LaneBoundaryAttr;
    type: BoundaryType;
    controlsPosition: THREE.Vector3[];
    relativeLaneBoundaryIds?: string[]; // 只有这个是个roadBoundary的时候才有
    relativeRoadBoundaryIds?: string[]; // 只有这个是个laneBoundary的时候才有
    origin: BoundaryOriginType;
}

export interface Arrow {
    id: string;
    type: ThreeElementType;
}
