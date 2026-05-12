// import React from 'react';
import { TrafficSignal, TrafficSubSignal, TrafficSubSignalType, Type } from 'src/interface/trafficSignal';
import { JunctionType } from 'src/interface/junctionInterFace';
import { LaneBoundaryType, LaneDireaciotn, LaneType, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { AreaType } from 'src/interface/areaInterFace';
import { BarrierGateAttr, BarrierGateType } from 'src/interface/barrierGateInterFace';
import arrowRight from '../../assets/images/ic_turn_right.svg';
import arrowLeft from '../../assets/images/ic_turn_left.svg';
import unknown from '../../assets/images/ic_unknown.svg';
import goStraight from '../../assets/images/ic_go_straight.svg';
import circle from '../../assets/images/ic_circle.svg';
import turnRound from '../../assets/images/ic_turn_round.svg';

export const trafficSignalTypes: { type: Type; size: number; subSignals: TrafficSubSignal[] }[] = [
    {
        type: Type.MIX_3_HORIZONTAL,
        size: 3,
        subSignals: [
            { id: 'sub_1', type: TrafficSubSignalType.CIRCLE },
            { id: 'sub_2', type: TrafficSubSignalType.CIRCLE },
            { id: 'sub_3', type: TrafficSubSignalType.CIRCLE },
        ],
    },
    {
        type: Type.MIX_2_HORIZONTAL,
        size: 2,
        subSignals: [
            { id: 'sub_1', type: TrafficSubSignalType.CIRCLE },
            { id: 'sub_2', type: TrafficSubSignalType.CIRCLE },
        ],
    },
    {
        type: Type.MIX_3_VERTICAL,
        size: 3,
        subSignals: [
            { id: 'sub_1', type: TrafficSubSignalType.CIRCLE },
            { id: 'sub_2', type: TrafficSubSignalType.CIRCLE },
            { id: 'sub_3', type: TrafficSubSignalType.CIRCLE },
        ],
    },
    {
        type: Type.MIX_2_VERTICAL,
        size: 2,
        subSignals: [
            { id: 'sub_1', type: TrafficSubSignalType.CIRCLE },
            { id: 'sub_2', type: TrafficSubSignalType.CIRCLE },
        ],
    },
    {
        type: Type.SINGLE,
        size: 1,
        subSignals: [{ id: 'sub_1', type: TrafficSubSignalType.CIRCLE }],
    },
];

export const trafficSubSignalTypes: { label: string; value: TrafficSubSignalType; iconUrl: string }[] = [
    {
        label: '圆灯',
        value: TrafficSubSignalType.CIRCLE,
        iconUrl: circle,
    },
    {
        label: '直行',
        value: TrafficSubSignalType.ARROW_FORWARD,
        iconUrl: goStraight,
    },
    {
        label: '左转',
        value: TrafficSubSignalType.ARROW_LEFT,
        iconUrl: arrowLeft,
    },
    {
        label: '右转',
        value: TrafficSubSignalType.ARROW_RIGHT,
        iconUrl: arrowRight,
    },
    {
        label: '掉头',
        value: TrafficSubSignalType.ARROW_U_TURN,
        iconUrl: turnRound,
    },
    {
        label: '未知',
        value: TrafficSubSignalType.UNKNOWN,
        iconUrl: unknown,
    },
];

export const initTrafficLightAttr: TrafficSignal = {
    id: '',
    height: 5,
    stopLineId: '',
    center: null,
    heading: 0,
    type: Type.MIX_3_HORIZONTAL,
    subSignals: [
        {
            id: 'sub_1',
            type: TrafficSubSignalType.CIRCLE,
        },
        {
            id: 'sub_2',
            type: TrafficSubSignalType.CIRCLE,
        },
        {
            id: 'sub_3',
            type: TrafficSubSignalType.CIRCLE,
        },
    ],
};
export const initJunctionType = JunctionType.CROSS;
export const initAreaAttr = {
    id: null as string,
    type: AreaType.Driveable,
    name: 'custom',
};
export const initAreaName = 'custom';
export const initLaneAttrData = {
    id: null as string,
    speed: 10,
    direction: LaneDireaciotn.STRAIGHT,
    prossibleDrivingDirection: ProssibleDrivingDirection.FORWARD,
    leftBoundaryType: LaneBoundaryType.WHITESOLId,
    rightBoundaryType: LaneBoundaryType.WHITESOLId,
    preLaneIds: [] as string[],
    sucLaneIds: [] as string[],
    laneType: LaneType.CityDriving,
};
export const initBarrierGateAttr: BarrierGateAttr = {
    id: null as string,
    type: BarrierGateType.Fence,
    width: 5,
    length: 8,
    height: 3,
};

export const barrierGateSize = {
    minSize: 0.2,
    maxSize: 20,
};
