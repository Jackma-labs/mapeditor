import { ThreeElementType } from 'src/interface/commonInterFace';

// 点层级最高 0.07-0.09，其次是线 0.04-0.06，最后是地面 0.01-0.03 其他操作类的元素在最上方 0.1
export const mapElementZ = {
    [ThreeElementType.LanePoint]: 0.07,
    [ThreeElementType.JunctionPoint]: 0.08,
    [ThreeElementType.CrosswalkPoint]: 0.08,
    [ThreeElementType.SpeedBumpPoint]: 0.08,
    [ThreeElementType.StopLinePoint]: 0.08,
    [ThreeElementType.ParkingSpacePoint]: 0.08,
    [ThreeElementType.SplitLaneInVerticalPoint]: 0.08,
    [ThreeElementType.RoadBoundaryPoint]: 0.08,
    [ThreeElementType.AreaPoint]: 0.08,
    [ThreeElementType.BarrierGatePoint]: 0.08,

    [ThreeElementType.LaneBoundary]: 0.04,
    [ThreeElementType.RoadBoundary]: 0.04,
    [ThreeElementType.JunctionBoundary]: 0.05,
    [ThreeElementType.CrosswalkBoundary]: 0.05,
    [ThreeElementType.SpeedBumpBoundary]: 0.01, // 这个特殊点，因为我们不需要操作SpeedBumpBoundary，要操作SpeedBumpGroud或者个SpeedBumpPoints
    [ThreeElementType.StopLineBoundary]: 0.05,
    [ThreeElementType.ParkingSpaceBoundary]: 0.01, // 这个特殊点，因为我们不需要操作ParkingSpaceBoundary
    [ThreeElementType.LaneCurveBoundary]: 0.05,
    [ThreeElementType.AreaBoundary]: 0.05,
    [ThreeElementType.BarrierGateBoundary]: 0.02,

    [ThreeElementType.LaneGroud]: 0.01,
    [ThreeElementType.JunctionGroud]: 0.02,
    [ThreeElementType.CrosswalkGroud]: 0.03,
    [ThreeElementType.SpeedBumpGroud]: 0.03,
    [ThreeElementType.ParkingSpaceGroud]: 0.03,
    [ThreeElementType.LaneCurveGroud]: 0.01,
    [ThreeElementType.AreaGroud]: 0.02,
    [ThreeElementType.BarrierGateGroud]: 0.03,

    [ThreeElementType.RotateBasePoint]: 0.3,
    [ThreeElementType.RotateHandle]: 0.3,

    [ThreeElementType.LaneRelativeDirection]: 0.04,
    [ThreeElementType.ParkingSpaceHeading]: 0.04,

    [ThreeElementType.AddLaneSvg]: 0.1,
    [ThreeElementType.ExtendLaneSvg]: 0.1,
    [ThreeElementType.ExtendBoundarySvg]: 0.1,
    [ThreeElementType.CopyParkingSpaceSvg]: 0.1,

    [ThreeElementType.MousePoint]: 0.1,
    [ThreeElementType.LaneWidthLine]: 0.04,
    [ThreeElementType.TrafficLight]: 0.06,

    [ThreeElementType.Tile]: 0,
    [ThreeElementType.CurveControlPoint]: 0.11,
    [ThreeElementType.CurveControlLine]: 0.06,

    [ThreeElementType.RangeRemoveIcon]: 0.1,
    [ThreeElementType.SignIcon]: 0.06,
    [ThreeElementType.Line2]: 0.04,
    [ThreeElementType.RangePoint]: 0.09,
    [ThreeElementType.RangeArc]: 0.06,
    [ThreeElementType.RangeLine]: 0.06,
};
