import React, { useMemo, useState } from 'react';
import PubSub from 'pubsub-js';
import { Eye, EyeOff, Layers, LocateFixed, Lock, MousePointer2, PanelLeftClose, Unlock } from 'lucide-react';
import { editorLayerConfigs, mergeEditorLayers } from 'src/constant/editorLayers';
import { Badge } from 'src/components/ui/badge';
import { Button } from 'src/components/ui/button';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { EditorLayerId, EditorLayerMap } from 'src/interface/layerInterface';
import { MapState } from 'src/interface/mapStateInterface';
import { inspectMapQuality } from 'src/quality/mapQuality';
import { useManagerStore } from 'src/store';
import { filterPickElementsByEditorLayers, getEditorLayerForThreeElementType } from 'src/utils/editorLayerUtil';
import './index.less';

const editLayerIds: EditorLayerId[] = ['lane', 'boundary', 'junction', 'traffic', 'area'];

const layerPresets = [
    {
        id: 'edit',
        label: '编辑全部',
        description: '全部图层可见，标注图层可编辑。',
        build: (): EditorLayerMap => {
            const next = mergeEditorLayers();
            editorLayerConfigs.forEach((config) => {
                next[config.id] = {
                    visible: true,
                    locked: false,
                };
            });
            next.reference.locked = true;
            next.quality.locked = true;
            return next;
        },
    },
    {
        id: 'inspect',
        label: '检查问题',
        description: '显示所有地图内容，并打开质检覆盖层。',
        build: (): EditorLayerMap => {
            const next = mergeEditorLayers();
            editorLayerConfigs.forEach((config) => {
                next[config.id] = {
                    visible: true,
                    locked: editLayerIds.includes(config.id),
                };
            });
            return next;
        },
    },
    {
        id: 'preview',
        label: '发布预览',
        description: '隐藏质检覆盖层，锁定所有编辑图层。',
        build: (): EditorLayerMap => {
            const next = mergeEditorLayers();
            editorLayerConfigs.forEach((config) => {
                next[config.id] = {
                    visible: config.id !== 'quality',
                    locked: true,
                };
            });
            return next;
        },
    },
];

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

    const replaceLayers = (nextLayers: EditorLayerMap) => {
        const currentMapState = useManagerStore.getState().mapState;
        const nextMapState = {
            ...currentMapState,
            editorLayers: nextLayers,
        };
        const nextPickElements = filterPickElementsByEditorLayers(nextMapState, currentMapState.currentPickElement);
        setMapState({
            ...nextMapState,
            currentPickElement: nextPickElements,
            needRender: true,
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
                {collapsed ? (
                    <Button
                        type="button"
                        className="editor-layer-collapsed-button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setCollapsed(false)}
                    >
                        <Layers data-icon="inline-start" />
                        图层
                    </Button>
                ) : (
                    <>
                        <div className="editor-layer-title">
                            <strong>图层控制</strong>
                            <span>先选模式，再按需显示、锁定或定位图层。</span>
                        </div>
                        <Button
                            type="button"
                            className="editor-layer-collapse"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="收起图层控制"
                            onClick={() => setCollapsed(true)}
                        >
                            <PanelLeftClose />
                        </Button>
                    </>
                )}
            </div>
            {!collapsed && (
                <div className="editor-layer-content">
                    <div className="editor-layer-presets" aria-label="图层模式">
                        {layerPresets.map((preset) => (
                            <Button
                                key={preset.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                title={preset.description}
                                onClick={() => replaceLayers(preset.build())}
                            >
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                    <div className="editor-layer-help">
                        <MousePointer2 />
                        锁定后不会被选中，隐藏后从画布消失；定位只移动视角，不修改地图。
                    </div>
                    <div className="editor-layer-list">
                        {editorLayerConfigs.map((config) => {
                            const layer = layers[config.id];
                            const count = counts[config.id] || 0;
                            const visibleLabel = layer.visible ? '隐藏' : '显示';
                            const lockLabel = layer.locked ? '解锁' : '锁定';
                            return (
                                <div
                                    className={`editor-layer-row ${!layer.visible ? 'is-hidden' : ''} ${
                                        layer.locked ? 'is-locked' : ''
                                    }`}
                                    key={config.id}
                                >
                                    <div className="editor-layer-meta">
                                        <div className="editor-layer-mainline">
                                            <span className={`editor-layer-dot layer-${config.id}`} />
                                            <span className="editor-layer-name">{config.label}</span>
                                            <Badge variant={count > 0 ? 'secondary' : 'outline'}>{count}</Badge>
                                        </div>
                                        <span className="editor-layer-description">{config.description}</span>
                                    </div>
                                    <div className="editor-layer-actions">
                                        <Button
                                            type="button"
                                            variant={layer.visible ? 'secondary' : 'outline'}
                                            size="sm"
                                            aria-label={`${visibleLabel}${config.label}`}
                                            title={`${visibleLabel}${config.label}`}
                                            onClick={() => updateLayer(config.id, { visible: !layer.visible })}
                                        >
                                            {layer.visible ? (
                                                <Eye data-icon="inline-start" />
                                            ) : (
                                                <EyeOff data-icon="inline-start" />
                                            )}
                                            {visibleLabel}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={layer.locked ? 'secondary' : 'outline'}
                                            size="sm"
                                            aria-label={`${lockLabel}${config.label}`}
                                            title={`${lockLabel}${config.label}`}
                                            onClick={() => updateLayer(config.id, { locked: !layer.locked })}
                                        >
                                            {layer.locked ? (
                                                <Lock data-icon="inline-start" />
                                            ) : (
                                                <Unlock data-icon="inline-start" />
                                            )}
                                            {lockLabel}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`定位${config.label}`}
                                            title={count === 0 ? '该图层暂无内容' : `定位到${config.label}`}
                                            disabled={count === 0}
                                            onClick={() => handleFitLayer(config.id)}
                                        >
                                            <LocateFixed />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
