import { mapElementZ } from 'src/constant/mapElementZ';
import { Sign, SignType } from 'src/interface/SignInterFace';
import { Area } from 'src/interface/areaInterFace';
import { BarrierGate } from 'src/interface/barrierGateInterFace';
import { Arrow, Boundary, Groud, PointElement } from 'src/interface/basicElementInterFace';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { Crosswalk } from 'src/interface/crosswalkInterFace';
import { Junction } from 'src/interface/junctionInterFace';
import { Lane, LaneTrend } from 'src/interface/laneInterFace';
import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { SpeedBump } from 'src/interface/speedBumpInterFace';
import { StopLine } from 'src/interface/stopLineInterFace';
import { TrafficSignal } from 'src/interface/trafficSignal';
import * as THREE from 'three';

export function loadHdmp(data: any) {
    if (!data) {
        return {};
    }
    const point = data.point || [];
    const boundary = data.boundary || [];
    const roadBoundary = data.roadBoundary || data.road_boundary || [];
    const lane = data.lane || [];
    const junction = data.junction || [];
    const crosswalk = data.crosswalk || [];
    const speedBump = data.speedBump || data.speed_bump || [];
    const basemapCenter = data.basemapCenter || data.basemap_center || new THREE.Vector2(0, 0);
    const trafficSignal = data.trafficSignal || [];
    const stopLine = data.stopLine || data.stop_line || [];
    const parkingSpace = data.parkingSpace || data.parking_space || [];
    const stopSign = data.stopSign || data.stop_sign || [];
    const yieldSign = data.yieldSign || data.yield_sign || [];
    const area = data.area || [];
    const barrierGate = data.barrierGate || data.barrier_gate || [];
    const points: { [id: string]: PointElement } = {};
    const boundarys: { [id: string]: Boundary } = {};
    const lanes: { [id: string]: Lane } = {};
    const junctions: { [id: string]: Junction } = {};
    const crosswalks: { [id: string]: Crosswalk } = {};
    const speedBumps: { [id: string]: SpeedBump } = {};
    const stopLines: { [id: string]: StopLine } = {};
    const trafficSignals: { [id: string]: TrafficSignal } = {};
    const parkingSpaces: { [id: string]: ParkingSpace } = {};
    const signs: { [id: string]: Sign } = {};
    const areas: { [id: string]: Area } = {};
    const barrierGates: { [id: string]: BarrierGate } = {};

    point?.forEach((item: any) => {
        const position = new THREE.Vector3(
            Number(item.position.x.toFixed(4)),
            Number(item.position.y.toFixed(4)),
            mapElementZ[item.type as ThreeElementType],
        );
        points[item.id] = {
            id: item.id,
            position,
            type: item.type,
        };
    });
    boundary?.forEach((item: any) => {
        const pointIds = item.pointId || item.point_id || item.pointIds || [];
        boundarys[item.id] = {
            id: item.id,
            pointIds,
            type: item.type,
            origin: null,
            controlsPosition:
                item.controlsPosition?.map(
                    (cItem: any) =>
                        new THREE.Vector3(cItem.x, cItem.y, cItem.z || mapElementZ[ThreeElementType.CurveControlPoint]),
                ) || [],
            relativeRoadBoundaryIds: item.roadBoundaryId || item.road_boundary_id || [],
            relativeLaneBoundaryIds: [],
        };
        if (item.attr) {
            boundarys[item.id].attr = item.attr;
        }
    });
    roadBoundary?.forEach((item: any) => {
        const pointIds = item.pointId || item.point_id || item.pointIds || [];
        boundarys[item.id] = {
            id: item.id,
            pointIds,
            type: ThreeElementType.RoadBoundary,
            origin: null,
            controlsPosition:
                item.controlsPosition?.map(
                    (cItem: any) =>
                        new THREE.Vector3(cItem.x, cItem.y, cItem.z || mapElementZ[ThreeElementType.CurveControlPoint]),
                ) || [],
            relativeLaneBoundaryIds: item.laneBoundaryId || item.lane_boundary_id || [],
            relativeRoadBoundaryIds: [],
        };
    });

    lane?.forEach((item: Lane) => {
        lanes[item.id] = {
            ...item,
            leftBoundaryId: (item as any).leftBoundaryId || (item as any).left_boundary_id,
            rightBoundaryId: (item as any).rightBoundaryId || (item as any).right_boundary_id,
            leftBoundaryReverse: (item as any).leftBoundaryReverse ?? (item as any).left_boundary_reverse ?? false,
            rightBoundaryReverse: (item as any).rightBoundaryReverse ?? (item as any).right_boundary_reverse ?? false,
        };
    });
    junction?.forEach((item: Junction) => {
        junctions[item.id] = {
            ...item,
        };
    });
    crosswalk?.forEach((item: Junction) => {
        crosswalks[item.id] = {
            ...item,
        };
    });
    speedBump?.forEach((item: Junction) => {
        speedBumps[item.id] = {
            ...item,
        };
    });
    stopLine?.forEach((item: StopLine) => {
        stopLines[item.id] = item;
    });
    trafficSignal?.forEach((item: any) => {
        const center = new THREE.Vector3(
            Number(item.center.x.toFixed(4)),
            Number(item.center.y.toFixed(4)),
            mapElementZ[ThreeElementType.TrafficLight],
        );
        trafficSignals[item.id] = {
            ...item,
            subSignals: item.subSignal,
            center,
        };
    });
    parkingSpace?.forEach((item: ParkingSpace) => {
        parkingSpaces[item.id] = {
            ...item,
        };
    });
    stopSign?.forEach((item: any) => {
        signs[item.id] = {
            ...item,
            type: SignType.StopSign,
        };
    });
    yieldSign?.forEach((item: any) => {
        signs[item.id] = {
            ...item,
            type: SignType.YieldSign,
        };
    });
    area?.forEach((item: any) => {
        areas[item.id] = {
            ...item,
        };
    });
    barrierGate?.forEach((item: any) => {
        barrierGates[item.id] = {
            ...item,
        };
    });
    return {
        boundarys,
        lanes,
        junctions,
        crosswalks,
        speedBumps,
        points,
        hdBasemapCenter: new THREE.Vector2(basemapCenter.x, basemapCenter.y),
        stopLines,
        parkingSpaces,
        trafficSignals,
        signs,
        areas,
        barrierGates,
    };
}
export function getGrouds(data: any) {
    const { lanes, junctions, crosswalks, speedBumps, parkingSpaces, areas, barrierGates } = data;
    const grouds: { [id: string]: Groud } = {};
    // 去创建groud
    Object.keys(lanes).forEach((id) => {
        const lane: Lane = lanes[id];
        const type = lane.type === LaneTrend.Straight ? ThreeElementType.LaneGroud : ThreeElementType.LaneCurveGroud;
        grouds[lane.groudId] = {
            id: lane.groudId,
            type,
        };
    });

    Object.keys(junctions).forEach((id) => {
        const junction: Junction = junctions[id];
        grouds[junction.groudId] = {
            id: junction.groudId,
            type: ThreeElementType.JunctionGroud,
        };
    });
    Object.keys(areas).forEach((id) => {
        const area: Area = areas[id];
        grouds[area.groudId] = {
            id: area.groudId,
            type: ThreeElementType.AreaGroud,
        };
    });
    Object.keys(barrierGates).forEach((id) => {
        const barrierGate: BarrierGate = barrierGates[id];
        grouds[barrierGate.groudId] = {
            id: barrierGate.groudId,
            type: ThreeElementType.BarrierGateGroud,
        };
    });

    Object.keys(crosswalks).forEach((id) => {
        const crosswalk: Crosswalk = crosswalks[id];
        grouds[crosswalk.groudId] = {
            id: crosswalk.groudId,
            type: ThreeElementType.CrosswalkGroud,
        };
    });

    Object.keys(speedBumps).forEach((id) => {
        const speedBump: SpeedBump = speedBumps[id];
        grouds[speedBump.groudId] = {
            id: speedBump.groudId,
            type: ThreeElementType.SpeedBumpGroud,
        };
    });
    Object.keys(parkingSpaces).forEach((id) => {
        const parkingSpace: ParkingSpace = parkingSpaces[id];
        grouds[parkingSpace.groudId] = {
            id: parkingSpace.groudId,
            type: ThreeElementType.ParkingSpaceGroud,
        };
    });
    return grouds;
}
export function getArrows(data: any) {
    const { lanes, parkingSpaces } = data;
    const prossibleDrivingDirections: { [id: string]: Arrow } = {};
    // 去创建groud
    Object.keys(lanes).forEach((id) => {
        const lane: Lane = lanes[id];
        prossibleDrivingDirections[lane.arrowId] = {
            id: lane.arrowId,
            type: ThreeElementType.LaneRelativeDirection,
        };
    });

    Object.keys(parkingSpaces).forEach((id) => {
        const parkingSpace: ParkingSpace = parkingSpaces[id];
        prossibleDrivingDirections[parkingSpace.arrowId] = {
            id: parkingSpace.arrowId,
            type: ThreeElementType.ParkingSpaceHeading,
        };
    });
    return prossibleDrivingDirections;
}
export function isMac() {
    return /macintosh|mac os x/i.test(navigator.userAgent);
}
export function isWindows() {
    return /windows|win32/i.test(navigator.userAgent);
}
export function clone(object: object) {
    return JSON.parse(JSON.stringify(object));
}

export function colorTraslateRgba(color: THREE.Color, opacity: number = 1) {
    const colorString = color.getStyle();
    const reg = /^rgb(.*)\)/;
    if (colorString.match(reg)?.[1]) {
        return `rgba${colorString.match(reg)?.[1]},${opacity})`;
    }
    return colorString;
}
