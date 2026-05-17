import React, { useEffect, useMemo, useState } from 'react';
import PubSub from 'pubsub-js';
import FileService from 'src/service/index';

interface AssistCandidate {
    id: string;
    type: string;
    confidence: number;
}

interface AssistCandidatePayload {
    mapName: string;
    layer: string;
    level: number;
    candidates: AssistCandidate[];
    stats: {
        lineCandidateCount?: number;
        centerlineCandidateCount?: number;
        areaCandidateCount?: number;
        occupiedCellCount?: number;
        tileCount?: number;
    };
}

interface AssistDrawingPanelProps {
    baseMapDir: string;
    layers: Array<{ id: string; name?: string }>;
}

const assistLayerOptions = [
    { id: 'edge', name: '边界' },
    { id: 'marking', name: '标线' },
    { id: 'enhanced', name: '增强' },
    { id: 'ground', name: '地面' },
];

function countByType(candidates: AssistCandidate[], type: string) {
    return candidates.filter((candidate) => candidate.type === type).length;
}

export default function AssistDrawingPanel({ baseMapDir, layers }: AssistDrawingPanelProps) {
    const [layerId, setLayerId] = useState('edge');
    const [loading, setLoading] = useState(false);
    const [visible, setVisible] = useState(true);
    const [payload, setPayload] = useState<AssistCandidatePayload | null>(null);
    const [error, setError] = useState('');

    const availableLayerIds = useMemo(() => new Set(layers.map((layer) => layer.id)), [layers]);
    const layerOptions = useMemo(
        () =>
            assistLayerOptions.filter(
                (layer) => layer.id === 'enhanced' || availableLayerIds.size === 0 || availableLayerIds.has(layer.id),
            ),
        [availableLayerIds],
    );

    useEffect(() => {
        setPayload(null);
        setError('');
        PubSub.publish('assistCandidatesClear');
    }, [baseMapDir]);

    useEffect(() => {
        PubSub.publish('assistCandidatesVisible', visible);
    }, [visible]);

    const handleGenerate = async () => {
        if (!baseMapDir || loading) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const response = await FileService.getAssistDrawingCandidates(baseMapDir, {
                layer: layerId,
                maxTiles: 72,
                cellPixels: 16,
            });
            if (response?.code !== 0) {
                throw new Error(response?.message || '候选生成失败');
            }
            const nextPayload = response.data as AssistCandidatePayload;
            setPayload(nextPayload);
            setVisible(true);
            PubSub.publish('assistCandidatesRender', nextPayload);
        } catch (nextError: any) {
            setError(nextError?.message || '候选生成失败');
            PubSub.publish('assistCandidatesClear');
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setPayload(null);
        setError('');
        PubSub.publish('assistCandidatesClear');
    };

    if (!baseMapDir) {
        return null;
    }

    const candidates = payload?.candidates || [];
    const lineCount = payload?.stats?.lineCandidateCount ?? countByType(candidates, 'road_boundary');
    const centerlineCount = payload?.stats?.centerlineCandidateCount ?? countByType(candidates, 'centerline');
    const areaCount = payload?.stats?.areaCandidateCount ?? countByType(candidates, 'drivable_area');

    return (
        <div
            className="assist-drawing-panel"
            onClick={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
        >
            <div className="assist-drawing-header">
                <div>
                    <div className="assist-drawing-title">辅助候选</div>
                    <div className="assist-drawing-meta">
                        {payload ? `${candidates.length} 个候选 · ${payload.layer} L${payload.level}` : '候选预览层'}
                    </div>
                </div>
                <button type="button" onClick={() => setVisible((value) => !value)} disabled={!payload}>
                    {visible ? '隐藏' : '显示'}
                </button>
            </div>
            <div className="assist-drawing-layers">
                {layerOptions.map((layer) => (
                    <button
                        key={layer.id}
                        type="button"
                        className={layer.id === layerId ? 'active' : ''}
                        onClick={() => setLayerId(layer.id)}
                    >
                        {layer.name}
                    </button>
                ))}
            </div>
            <div className="assist-drawing-actions">
                <button type="button" className="primary" onClick={handleGenerate} disabled={loading}>
                    {loading ? '生成中' : '生成候选'}
                </button>
                <button type="button" onClick={handleClear} disabled={!payload && !error}>
                    清空
                </button>
            </div>
            {payload && (
                <div className="assist-drawing-stats">
                    <span>{`边界 ${lineCount}`}</span>
                    <span>{`中心线 ${centerlineCount}`}</span>
                    <span>{`区域 ${areaCount}`}</span>
                </div>
            )}
            {error && <div className="assist-drawing-error">{error}</div>}
        </div>
    );
}
