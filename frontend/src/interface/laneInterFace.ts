import { ThreeElementType } from './commonInterFace';

// 车道边界线类型
export enum LaneBoundaryType {
    WHITESOLId = 4, // 白实线
    WHITEDOTTED = 2, // 白虚线
}

// 车道方向
export enum LaneDireaciotn {
    STRAIGHT = 1, // 直行
    TURN_LEFT, // 左转
    TURN_RIGHT, // 右转
    TURN_AROUND, // 调头
}

// 车道相对方向
export enum ProssibleDrivingDirection {
    FORWARD = 1, // 同向
    BACKWARD, // 反向
    RELATIVEDIRECTION, // 双向
}

// 车道边界属性
export interface LaneBoundaryAttr {
    type: LaneBoundaryType; // 车道边界类型
}

// 边界
export interface Boundary {
    id: string;
    pointIds: string[];
}
// 车道边界
export interface LaneBoundary extends Boundary {
    attr: LaneBoundaryAttr;
    mesh: THREE.Line;
    type: ThreeElementType.LaneBoundary | ThreeElementType.LaneCurveBoundary;
    controlsPosition?: THREE.Vector3[];
}
// 车道类型
export enum LaneType {
    CityDriving = 1,
    Biking,
    Shared,
}
// 车道属性
export interface LaneAttr {
    speed: number; // 速度
    direction: LaneDireaciotn; // 方向
    prossibleDrivingDirection: ProssibleDrivingDirection; // 相对方向
    laneType: LaneType; // 车道类型
}

export enum LaneTrend {
    Straight = 1,
    Curve,
}

// 车道
export interface Lane {
    id: string;
    attr: LaneAttr;
    leftBoundaryId: string;
    rightBoundaryId: string;
    groudId: string;
    arrowId: string;
    leftBoundaryReverse: boolean;
    rightBoundaryReverse: boolean;
    width: number;
    prossibleDrivingDirectionArrowId: string;
    type: LaneTrend;
    // laneType: LaneType;
}
