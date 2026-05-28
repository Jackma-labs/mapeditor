import { MapElementType } from 'src/interface/commonInterFace';

export const mapElements = [
    {
        name: '直线',
        mapElementType: MapElementType.StraightLine,
    },
    {
        name: '车道',
        mapElementType: MapElementType.Lane,
    },
    {
        name: '路口',
        mapElementType: MapElementType.Junction,
    },
    {
        name: '人行横道',
        mapElementType: MapElementType.Crosswalk,
    },
    {
        name: '减速带',
        mapElementType: MapElementType.SpeedBump,
    },
    {
        name: '红绿灯',
        mapElementType: MapElementType.TrafficSignal,
    },
    {
        name: '停车位',
        mapElementType: MapElementType.ParkingSpace,
    },
    {
        name: '标志牌',
        mapElementType: MapElementType.Sign,
    },
    {
        name: '路沿',
        mapElementType: MapElementType.RoadBoundary,
    },
    {
        name: '区域',
        mapElementType: MapElementType.Area,
    },
    {
        name: '道闸',
        mapElementType: MapElementType.BarrierGate,
    },
];
