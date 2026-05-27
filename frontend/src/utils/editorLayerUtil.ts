import * as THREE from 'three';
import { editorLayerConfigs, mergeEditorLayers } from 'src/constant/editorLayers';
import { EditorLayerId, EditorLayerMap } from 'src/interface/layerInterface';
import { MapElementType, PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import type { MapState } from 'src/interface/mapStateInterface';

export const QUALITY_OVERLAY_GROUP_NAME = '__map_quality_overlay__';

const layerLabelMap = {} as Record<EditorLayerId, string>;
editorLayerConfigs.forEach((item) => {
    layerLabelMap[item.id] = item.label;
});

export function getEditorLayerLabel(layerId: EditorLayerId | null) {
    return layerId ? layerLabelMap[layerId] || layerId : '';
}

export function getEditorLayerForMapElementType(type?: MapElementType | null): EditorLayerId | null {
    switch (type) {
        case MapElementType.Lane:
        case MapElementType.StraightLine:
        case MapElementType.CurveLine:
            return 'lane';
        case MapElementType.RoadBoundary:
            return 'boundary';
        case MapElementType.Junction:
        case MapElementType.Crosswalk:
        case MapElementType.SpeedBump:
        case MapElementType.BarrierGate:
            return 'junction';
        case MapElementType.StopLine:
        case MapElementType.TrafficSignal:
        case MapElementType.Sign:
            return 'traffic';
        case MapElementType.ParkingSpace:
        case MapElementType.Area:
            return 'area';
        default:
            return null;
    }
}

export function getEditorLayerForThreeElementType(type?: ThreeElementType | null): EditorLayerId | null {
    switch (type) {
        case ThreeElementType.Tile:
            return 'reference';
        case ThreeElementType.LanePoint:
        case ThreeElementType.LaneBoundary:
        case ThreeElementType.LaneCurveBoundary:
        case ThreeElementType.LaneGroud:
        case ThreeElementType.LaneCurveGroud:
        case ThreeElementType.LaneRelativeDirection:
        case ThreeElementType.AddLaneSvg:
        case ThreeElementType.ExtendLaneSvg:
        case ThreeElementType.SplitLaneInVerticalPoint:
            return 'lane';
        case ThreeElementType.RoadBoundary:
        case ThreeElementType.RoadBoundaryPoint:
        case ThreeElementType.ExtendBoundarySvg:
            return 'boundary';
        case ThreeElementType.JunctionPoint:
        case ThreeElementType.JunctionBoundary:
        case ThreeElementType.JunctionGroud:
        case ThreeElementType.CrosswalkPoint:
        case ThreeElementType.CrosswalkBoundary:
        case ThreeElementType.CrosswalkGroud:
        case ThreeElementType.SpeedBumpPoint:
        case ThreeElementType.SpeedBumpBoundary:
        case ThreeElementType.SpeedBumpGroud:
        case ThreeElementType.BarrierGatePoint:
        case ThreeElementType.BarrierGateBoundary:
        case ThreeElementType.BarrierGateGroud:
            return 'junction';
        case ThreeElementType.StopLinePoint:
        case ThreeElementType.StopLineBoundary:
        case ThreeElementType.TrafficLight:
        case ThreeElementType.SignIcon:
            return 'traffic';
        case ThreeElementType.AreaPoint:
        case ThreeElementType.AreaBoundary:
        case ThreeElementType.AreaGroud:
        case ThreeElementType.ParkingSpacePoint:
        case ThreeElementType.ParkingSpaceBoundary:
        case ThreeElementType.ParkingSpaceGroud:
        case ThreeElementType.ParkingSpaceHeading:
        case ThreeElementType.CopyParkingSpaceSvg:
            return 'area';
        default:
            return null;
    }
}

export function isEditorLayerVisible(layers: EditorLayerMap | undefined, layerId: EditorLayerId | null) {
    if (!layerId) {
        return true;
    }
    return mergeEditorLayers(layers)[layerId].visible;
}

export function isEditorLayerEditable(layers: EditorLayerMap | undefined, layerId: EditorLayerId | null) {
    if (!layerId) {
        return true;
    }
    const layer = mergeEditorLayers(layers)[layerId];
    return layer.visible && !layer.locked;
}

export function canEditMapElementType(layers: EditorLayerMap | undefined, type?: MapElementType | null) {
    return isEditorLayerEditable(layers, getEditorLayerForMapElementType(type));
}

export function canPickThreeElementType(layers: EditorLayerMap | undefined, type?: ThreeElementType | null) {
    return isEditorLayerEditable(layers, getEditorLayerForThreeElementType(type));
}

export function filterPickElementsByEditorLayers(mapState: MapState, picks: PickElementInfo[] = []) {
    return picks.filter((pick) => canPickThreeElementType(mapState.editorLayers, pick.type));
}

function getBoundaryLayer(mapState: MapState, id?: string): EditorLayerId | null {
    if (!id) {
        return null;
    }
    return getEditorLayerForThreeElementType(mapState.boundarys[id]?.type);
}

export function getEditorLayerForObject(mapState: MapState, object: THREE.Object3D): EditorLayerId | null {
    if (!object) {
        return null;
    }
    if (object.name === QUALITY_OVERLAY_GROUP_NAME || object.parent?.name === QUALITY_OVERLAY_GROUP_NAME) {
        return 'quality';
    }
    if (object.name === 'tile' || object.userData?.type === ThreeElementType.Tile) {
        return 'reference';
    }
    if (object.name === `${ThreeObject.Line2}`) {
        return getBoundaryLayer(mapState, object.userData?.id);
    }
    if (object.name === `${ThreeObject.ControlPoint}`) {
        return getBoundaryLayer(mapState, object.userData?.curveId);
    }
    return getEditorLayerForThreeElementType(object.userData?.type);
}

export function applyEditorLayerVisibility(mapState: MapState) {
    const { scene } = mapState;
    if (!scene) {
        return;
    }
    const layers = mergeEditorLayers(mapState.editorLayers);
    scene.traverse((object: THREE.Object3D) => {
        if (object.name === 'dragControlGroup' || object.name === 'rotateGroup') {
            return;
        }
        const sceneObject = object;
        const layerId = getEditorLayerForObject(mapState, object);
        if (!layerId) {
            return;
        }
        sceneObject.visible = layers[layerId].visible;
    });
}
