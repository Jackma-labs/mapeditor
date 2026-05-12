import { InterActiveType, ThreeElementType } from 'src/interface/commonInterFace';
import * as THREE from 'three';

export const laneBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0x44d7b6),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const junctionBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0xa0d911),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const roadBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0xf7b500),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};

export const pointColor = {
    [InterActiveType.Default]: new THREE.Color(0x8f8f8f),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const controlLineColor = new THREE.Color(0xf3d631);
export const laneGroudColor = {
    [InterActiveType.Default]: new THREE.Color(0x1fcc4d),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const laneGroudOpacity = 0.45;
export const junctionGroudColor = {
    [InterActiveType.Default]: new THREE.Color(0xa0d911),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const junctionGroudOpacity = 0.45;

export const crosswalkBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0xa0d911),
    [InterActiveType.Hover]: new THREE.Color(0xa0d911),
    [InterActiveType.Active]: new THREE.Color(0xa0d911),
};
export const speedBumpBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0xa0d911),
    [InterActiveType.Hover]: new THREE.Color(0xa0d911),
    [InterActiveType.Active]: new THREE.Color(0xa0d911),
};

export const stopLineBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0xf75660),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};

export const addSvgColor = {
    [InterActiveType.Default]: new THREE.Color(0xffffff),
    [InterActiveType.Hover]: new THREE.Color(0x3288fa),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const rotateHandleSvgColor = {
    [InterActiveType.Default]: new THREE.Color(0xa6b5cc),
    [InterActiveType.Hover]: new THREE.Color(0x3288fa),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const trafficLightSvgColor = {
    [InterActiveType.Default]: new THREE.Color(0xffffff),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const trafficLightSvgOpacity = {
    [InterActiveType.Default]: 0,
    [InterActiveType.Hover]: 0.65,
    [InterActiveType.Active]: 0.65,
};
export const parkingSpaceGroudColor = {
    [InterActiveType.Default]: new THREE.Color(0xa0d911),
    [InterActiveType.Hover]: new THREE.Color(0xff8d26),
    [InterActiveType.Active]: new THREE.Color(0x3288fa),
};
export const parkingSpaceBoundaryColor = {
    [InterActiveType.Default]: new THREE.Color(0xa0d911),
    [InterActiveType.Hover]: new THREE.Color(0xf3d631),
    [InterActiveType.Active]: new THREE.Color(0xf3d631),
};
export const parkingSpaceGroudOpacity = 0.65;
export function getElementColorAndOpacity(elementType: ThreeElementType, interactiveType: InterActiveType) {
    switch (elementType) {
        case ThreeElementType.LanePoint ||
            ThreeElementType.RoadBoundaryPoint ||
            ThreeElementType.JunctionPoint ||
            ThreeElementType.AreaPoint ||
            ThreeElementType.CrosswalkPoint ||
            ThreeElementType.SpeedBumpPoint ||
            ThreeElementType.StopLinePoint ||
            ThreeElementType.BarrierGatePoint:
            return {
                color: pointColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.LaneBoundary:
        case ThreeElementType.LaneCurveBoundary:
            return {
                color: laneBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.RoadBoundary:
            return {
                color: roadBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.JunctionBoundary:
            return {
                color: junctionBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.AreaBoundary:
            return {
                color: junctionBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.BarrierGateBoundary:
            return {
                color: junctionBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.CrosswalkBoundary:
            return {
                color: crosswalkBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.SpeedBumpBoundary:
            return {
                color: speedBumpBoundaryColor[interactiveType],
                opacity: 0.1,
            };
        case ThreeElementType.StopLineBoundary:
            return {
                color: stopLineBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.LaneGroud:
        case ThreeElementType.LaneCurveGroud:
            return {
                color: laneGroudColor[interactiveType],
                opacity: laneGroudOpacity,
            };
        case ThreeElementType.JunctionGroud:
            return {
                color: junctionGroudColor[interactiveType],
                opacity: junctionGroudOpacity,
            };
        case ThreeElementType.AreaGroud:
            return {
                color: junctionGroudColor[interactiveType],
                opacity: junctionGroudOpacity,
            };
        case ThreeElementType.BarrierGateGroud:
            return {
                color: junctionGroudColor[interactiveType],
                opacity: junctionGroudOpacity,
            };
        case ThreeElementType.CrosswalkGroud:
            return {
                color: new THREE.Color(0xffffff),
                opacity: 0.1,
            };
        case ThreeElementType.SpeedBumpGroud:
            return {
                color: new THREE.Color(0xffffff),
                opacity: 0.1,
            };
        case ThreeElementType.TrafficLight:
            return {
                color: trafficLightSvgColor[interactiveType],
                opacity: trafficLightSvgOpacity[interactiveType],
            };
        case ThreeElementType.ParkingSpaceBoundary:
            return {
                color: parkingSpaceBoundaryColor[interactiveType],
                opacity: 1,
            };
        case ThreeElementType.ParkingSpaceGroud:
            return {
                color: parkingSpaceGroudColor[interactiveType],
                opacity: parkingSpaceGroudOpacity,
            };
        default:
            return {
                color: new THREE.Color(0xffffff),
                opacity: 1,
            };
    }
}
