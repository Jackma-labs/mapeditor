import { mapElementZ } from 'src/constant/mapElementZ';
import { Sign, SignType } from 'src/interface/SignInterFace';
import { Area } from 'src/interface/areaInterFace';
import { BarrierGate } from 'src/interface/barrierGateInterFace';
import { Arrow, Boundary, Groud, PointElement } from 'src/interface/basicElementInterFace';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { Crosswalk } from 'src/interface/crosswalkInterFace';
import { Junction } from 'src/interface/junctionInterFace';
import {
    Lane,
    LaneBoundaryType,
    LaneDireaciotn,
    LaneTrend,
    LaneType,
    ProssibleDrivingDirection,
} from 'src/interface/laneInterFace';
import { ParkingSpace } from 'src/interface/parkingSpaceInterFace';
import { SpeedBump } from 'src/interface/speedBumpInterFace';
import { StopLine } from 'src/interface/stopLineInterFace';
import { TrafficSignal } from 'src/interface/trafficSignal';
import * as THREE from 'three';

const DEFAULT_IMPORTED_LANE_WIDTH = 4;

function isCenterlineLaneMap(data: any) {
    const lanes = data?.lane || [];
    const boundary = data?.boundary || [];
    const roadBoundary = data?.roadBoundary || data?.road_boundary || [];
    return (
        Array.isArray(data?.point) &&
        Array.isArray(lanes) &&
        lanes.some((lane: any) => Array.isArray(lane.points)) &&
        boundary.length === 0 &&
        roadBoundary.length === 0
    );
}

function getOffsetPolyline(points: THREE.Vector2[], offset: number) {
    return points.map((point, index) => {
        const direction = new THREE.Vector2();
        if (index === 0) {
            direction.subVectors(points[1], point);
        } else if (index === points.length - 1) {
            direction.subVectors(point, points[index - 1]);
        } else {
            const prev = new THREE.Vector2().subVectors(point, points[index - 1]).normalize();
            const next = new THREE.Vector2().subVectors(points[index + 1], point).normalize();
            direction.addVectors(prev, next);
            if (direction.lengthSq() < 0.000001) {
                direction.copy(next);
            }
        }
        if (direction.lengthSq() < 0.000001) {
            return point.clone();
        }
        direction.normalize();
        const normal = new THREE.Vector2(-direction.y, direction.x).multiplyScalar(offset);
        return point.clone().add(normal);
    });
}

function loadCenterlineLaneMap(data: any) {
    const sourcePoints: { [id: string]: THREE.Vector2 } = {};
    const points: { [id: string]: PointElement } = {};
    const boundarys: { [id: string]: Boundary } = {};
    const lanes: { [id: string]: Lane } = {};
    const basemapCenter = data.basemapCenter || data.basemap_center || new THREE.Vector2(0, 0);

    (data.point || []).forEach((item: any) => {
        if (!item?.id || !item?.position) {
            return;
        }
        sourcePoints[item.id] = new THREE.Vector2(
            Number(item.position.x.toFixed(4)),
            Number(item.position.y.toFixed(4)),
        );
    });

    (data.lane || []).forEach((item: any) => {
        const lanePointIds = item.points || [];
        const centerline = lanePointIds.map((id: string) => sourcePoints[id]).filter(Boolean);
        if (!item.id || centerline.length < 2) {
            return;
        }
        const width = Number(item.width || item.lane_width || DEFAULT_IMPORTED_LANE_WIDTH);
        const leftPositions = getOffsetPolyline(centerline, width / 2);
        const rightPositions = getOffsetPolyline(centerline, -width / 2);
        const leftBoundaryId = `${item.id}-left-boundary`;
        const rightBoundaryId = `${item.id}-right-boundary`;
        const leftPointIds = leftPositions.map((position, index) => `${item.id}-left-point-${index}`);
        const rightPointIds = rightPositions.map((position, index) => `${item.id}-right-point-${index}`);

        leftPositions.forEach((position, index) => {
            points[leftPointIds[index]] = {
                id: leftPointIds[index],
                position: new THREE.Vector3(position.x, position.y, mapElementZ[ThreeElementType.LanePoint]),
                type: ThreeElementType.LanePoint,
            };
        });
        rightPositions.forEach((position, index) => {
            points[rightPointIds[index]] = {
                id: rightPointIds[index],
                position: new THREE.Vector3(position.x, position.y, mapElementZ[ThreeElementType.LanePoint]),
                type: ThreeElementType.LanePoint,
            };
        });

        boundarys[leftBoundaryId] = {
            id: leftBoundaryId,
            pointIds: leftPointIds,
            type: ThreeElementType.LaneBoundary,
            attr: { type: LaneBoundaryType.WHITESOLId },
            origin: null,
            controlsPosition: [],
            relativeRoadBoundaryIds: [],
            relativeLaneBoundaryIds: [],
        };
        boundarys[rightBoundaryId] = {
            id: rightBoundaryId,
            pointIds: rightPointIds,
            type: ThreeElementType.LaneBoundary,
            attr: { type: LaneBoundaryType.WHITESOLId },
            origin: null,
            controlsPosition: [],
            relativeRoadBoundaryIds: [],
            relativeLaneBoundaryIds: [],
        };

        lanes[item.id] = {
            id: item.id,
            attr: {
                speed: Number(item.speed_limit || item.speed || 40),
                direction: LaneDireaciotn.STRAIGHT,
                prossibleDrivingDirection: ProssibleDrivingDirection.FORWARD,
                laneType: LaneType.CityDriving,
            },
            leftBoundaryId,
            rightBoundaryId,
            groudId: `${item.id}-groud`,
            arrowId: `${item.id}-arrow`,
            leftBoundaryReverse: false,
            rightBoundaryReverse: false,
            width,
            prossibleDrivingDirectionArrowId: `${item.id}-arrow`,
            type: LaneTrend.Straight,
        };
    });

    return {
        boundarys,
        lanes,
        junctions: {},
        crosswalks: {},
        speedBumps: {},
        points,
        hdBasemapCenter: new THREE.Vector2(basemapCenter.x, basemapCenter.y),
        stopLines: {},
        parkingSpaces: {},
        trafficSignals: {},
        signs: {},
        areas: {},
        barrierGates: {},
    };
}

export function loadHdmp(data: any): any {
    if (!data) {
        return {};
    }
    if (isCenterlineLaneMap(data)) {
        return loadCenterlineLaneMap(data);
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
