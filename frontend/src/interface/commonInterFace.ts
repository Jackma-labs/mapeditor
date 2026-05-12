// 绘制的元素
export enum MapElementType {
    Lane = 1,
    Junction,
    Crosswalk,
    SpeedBump,
    StraightLine,
    CurveLine,
    StopLine,
    TrafficSignal,
    ParkingSpace,
    Sign,
    RoadBoundary,
    Area,
    BarrierGate,
}
// 交互状态
export enum InterActiveType {
    Default = 1,
    Hover,
    Active,
}
// 所有的3d元素类型的具体类型精确到是属于哪种地图元素的 点、线、面区分是什么类型的点、线、面，
// 还有箭头元素、添加车道的svg、旋转图标、手柄等
export enum ThreeElementType {
    LanePoint = 1,
    JunctionPoint,
    CrosswalkPoint,
    SpeedBumpPoint,
    StopLinePoint,
    ParkingSpacePoint,

    LaneBoundary,
    JunctionBoundary,
    CrosswalkBoundary,
    SpeedBumpBoundary,
    StopLineBoundary,
    ParkingSpaceBoundary,
    LaneCurveBoundary,

    LaneGroud,
    JunctionGroud,
    CrosswalkGroud,
    SpeedBumpGroud,
    LaneCurveGroud,
    ParkingSpaceGroud,

    LaneRelativeDirection,
    ParkingSpaceHeading,

    AddLaneSvg,
    ExtendLaneSvg,
    ExtendBoundarySvg,
    CopyParkingSpaceSvg,
    RotateBasePoint,
    RotateHandle,
    CurveControlPoint,
    CurveControlLine,

    MousePoint,
    LaneWidthLine,

    TrafficLight,

    Tile,
    RangeRemoveIcon,
    SplitLaneInVerticalPoint,

    SignIcon,
    Line2,
    RangePoint,
    RangeLine,
    RangeArc,
    RoadBoundary,
    RoadBoundaryPoint,

    AreaGroud,
    AreaPoint,
    AreaBoundary,
    BarrierGateGroud,
    BarrierGateBoundary,
    BarrierGatePoint,
}
// 当前操作类型
export enum OperationType {
    Drawing = 1, // 绘制中
    Draging, // 拖动中
    Rotating, // 旋转中
    SplitLaneInVertical, // 垂直拆分车道
    CopyLane, // 复制车道
    CopyParkingSpace, // 复制车位
    InsertPointToBoundary, // 插入点到边界中
}
// 元素的大的类型 点、线、面、信号灯、标志牌
export enum ObjectType {
    Point,
    Boundary,
    Groud,
    TrafficLight,
    SignIcon,
}
// 3d元素类型
export enum ThreeObject {
    Point = 1,
    Boundary,
    Line2,
    Groud,
    Arrow,
    TrafficLight,
    ControlPoint,
    Sign,
    BarrierGate,
}
// 选中元素
export interface PickElementInfo {
    id: string;
    type: ThreeElementType;
    threeObject: ThreeObject;
}
// 权限
export enum PermissionStatus {
    HasPermission,
    NoPermission,
    OnTrial,
    Expired,
}
