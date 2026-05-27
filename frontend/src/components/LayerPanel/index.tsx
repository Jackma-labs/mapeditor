import React, { useMemo, useState } from 'react';
import PubSub from 'pubsub-js';
import { EyeInvisibleOutlined, EyeOutlined, LockOutlined, PushpinOutlined, UnlockOutlined } from '@ant-design/icons';
import { editorLayerConfigs, mergeEditorLayers } from 'src/constant/editorLayers';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { EditorLayerId } from 'src/interface/layerInterface';
import { MapState } from 'src/interface/mapStateInterface';
import { inspectMapQuality } from 'src/quality/mapQuality';
import { useManagerStore } from 'src/store';
import { filterPickElementsByEditorLayers, getEditorLayerForThreeElementType } from 'src/utils/editorLayerUtil';
import './index.less';

function getLayerCounts(mapState: MapState, issueCount: number): Record<EditorLayerId, number> {
    const pointCounts = {} as Partial<Record<EditorLayerId, number>>;
    Object.values(mapState.points).forEach((point) => {
        const layerId = getEditorLayerForThreeElementType(point.type);
        if (layerId) {
            pointCounts[layerId] = (pointCounts[layerId] || 0) + 1;
        }
    });
    const roadBoundaryCount = Object.values(mapState.boundarys).filter(
        (boundary) => boundary.type === ThreeElementType.RoadBoundary,
    ).length;

    return {
        reference: mapState.baseMapDir ? 1 : 0,
        lane: Object.keys(mapState.lanes).length || pointCounts.lane || 0,
        boundary: roadBoundaryCount || pointCounts.boundary || 0,
        junction:
            Object.keys(mapState.junctions).length +
            Object.keys(mapState.crosswalks).length +
            Object.keys(mapState.speedBumps).length +
            Object.keys(mapState.barrierGates).length,
        traffic:
            Object.keys(mapState.trafficSignals).length +
            Object.keys(mapState.stopLines).length +
            Object.keys(mapState.signs).length,
        area: Object.keys(mapState.areas).length + Object.keys(mapState.parkingSpaces).length,
        quality: issueCount,
    };
}

function addPointCoordinate(mapState: MapState, pointId: string | undefined, coordinates: number[][]) {
    if (!pointId) {
        return;
    }
    const point = mapState.points[pointId];
    if (point) {
        coordinates.push([point.position.x, point.position.y]);
    }
}

function getLayerCoordinates(mapState: MapState, layerId: EditorLayerId) {
    const coordinates: number[][] = [];
    if (layerId === 'reference') {
        return coordinates;
    }
    Object.values(mapState.points).forEach((point) => {
        if (getEditorLayerForThreeElementType(point.type) === layerId) {
            coordinates.push([point.position.x, point.position.y]);
        }
    });
    if (layerId === 'lane') {
        Object.values(mapState.lanes).forEach((lane) => {
            addPointCoordinate(mapState, mapState.boundarys[lane.leftBoundaryId]?.pointIds?.[0], coordinates);
            addPointCoordinate(mapState, mapState.boundarys[lane.rightBoundaryId]?.pointIds?.[0], coordinates);
        });
    }
    if (layerId === 'traffic') {
        Object.values(mapState.trafficSignals).forEach((signal) => {
            if (signal.center) {
                coordinates.push([signal.center.x, signal.center.y]);
            }
        });
    }
    return coordinates;
}

function fitCoordinates(coordinates: number[][]) {
    if (coordinates.length === 0) {
        return;
    }
    const xs = coordinates.map((item) => item[0]);
    const ys = coordinates.map((item) => item[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, 20);
    const half = Math.max(extent * 0.65, 12);
    PubSub.publishSync('cameraMove', {
        coordinates: [
            [centerX - half, centerY - half],
            [centerX + half, centerY - half],
            [centerX + half, centerY + half],
            [centerX - half, centerY + half],
        ],
        minExtent: 30,
        padding: {
            top: 92,
            right: 430,
            bottom: 44,
            left: 340,
        },
    });
    PubSub.publish('render');
}

export default function LayerPanel() {
    const [collapsed, setCollapsed] = useState(false);
    const [mapState, setMapState] = useManagerStore((state) => [state.mapState, state.setMapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const layers = mergeEditorLayers(mapState.editorLayers);
    const counts = getLayerCounts(mapState, report.issues.length);

    const updateLayer = (layerId: EditorLayerId, patch: Partial<(typeof layers)[EditorLayerId]>) => {
        const currentMapState = useManagerStore.getState().mapState;
        const nextLayers = mergeEditorLayers(currentMapState.editorLayers);
        nextLayers[layerId] = {
            ...nextLayers[layerId],
            ...patch,
        };
        const nextMapState = {
            ...currentMapState,
            editorLayers: nextLayers,
        };
        const nextPickElements = filterPickElementsByEditorLayers(nextMapState, currentMapState.currentPickElement);
        setMapState({
            ...nextMapState,
            currentPickElement: nextPickElements,
            needRender: nextPickElements.length !== currentMapState.currentPickElement.length,
        });
    };

    const handleFitLayer = (layerId: EditorLayerId) => {
        if (layerId === 'reference') {
            PubSub.publish('fitBaseMap');
            return;
        }
        fitCoordinates(getLayerCoordinates(mapState, layerId));
    };

    return (
        <div
            className={`editor-layer-panel ${collapsed ? 'is-collapsed' : ''}`}
            onClick={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
        >
            <div className="editor-layer-panel-header">
                <button type="button" className="editor-layer-collapse" onClick={() => setCollapsed(!collapsed)}>
                    {collapsed ? '图层' : '收起'}
                </button>
                {!collapsed && <strong>编辑图层</strong>}
            </div>
            {!collapsed && (
                <div className="editor-layer-list">
                    {editorLayerConfigs.map((config) => {
                        const layer = layers[config.id];
                        return (
                            <div className="editor-layer-row" key={config.id} title={config.description}>
                                <span className="editor-layer-name">{config.label}</span>
                                <span className="editor-layer-count">{counts[config.id] || 0}</span>
                                <button
                                    type="button"
                                    aria-label={`${config.label}${layer.visible ? '隐藏' : '显示'}`}
                                    title={layer.visible ? '隐藏' : '显示'}
                                    className={layer.visible ? 'active' : ''}
                                    onClick={() => updateLayer(config.id, { visible: !layer.visible })}
                                >
                                    {layer.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                                </button>
                                <button
                                    type="button"
                                    aria-label={`${config.label}${layer.locked ? '解锁' : '锁定'}`}
                                    title={layer.locked ? '解锁' : '锁定'}
                                    className={layer.locked ? 'locked' : ''}
                                    onClick={() => updateLayer(config.id, { locked: !layer.locked })}
                                >
                                    {layer.locked ? <LockOutlined /> : <UnlockOutlined />}
                                </button>
                                <button
                                    type="button"
                                    aria-label={`定位${config.label}`}
                                    title="定位"
                                    disabled={counts[config.id] === 0}
                                    onClick={() => handleFitLayer(config.id)}
                                >
                                    <PushpinOutlined />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
