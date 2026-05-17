import React, { useEffect, useMemo, useState } from 'react';
import PubSub from 'pubsub-js';
import { Boundary, PointElement } from 'src/interface/basicElementInterFace';
import { PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

type AssistMode = 'straight' | 'left' | 'right';
type EndpointRole = 'start' | 'end';

interface AssistCandidate {
    id: string;
    type: string;
    label: string;
    confidence: number;
    geometry: {
        type: 'LineString';
        coordinates: number[][];
    };
    metrics: {
        sourceBoundaryId: string;
        targetBoundaryId?: string;
        targetPointId?: string;
        endpoint: EndpointRole;
        mode: AssistMode;
        lengthMeters: number;
    };
}

interface AssistCandidatePayload {
    mapName: string;
    layer: string;
    level: number;
    candidates: AssistCandidate[];
    stats: {
        lineCandidateCount: number;
        centerlineCandidateCount: number;
        areaCandidateCount: number;
    };
}

interface AssistDrawingPanelProps {
    baseMapDir: string;
}

const drawableBoundaryTypes = new Set<ThreeElementType>([
    ThreeElementType.LaneBoundary,
    ThreeElementType.LaneCurveBoundary,
    ThreeElementType.RoadBoundary,
    ThreeElementType.StopLineBoundary,
    ThreeElementType.ParkingSpaceBoundary,
    ThreeElementType.AreaBoundary,
]);

const modeLabel: Record<AssistMode, string> = {
    straight: '沿线延长',
    left: '左弯',
    right: '右弯',
};

type PlainPoint = { x: number; y: number };

interface EndpointTarget {
    boundaryId: string;
    pointId: string;
    position: PlainPoint;
    distance: number;
}

function isBoundaryPick(pick?: PickElementInfo) {
    if (!pick) {
        return false;
    }
    return (
        pick.threeObject === ThreeObject.Boundary ||
        pick.threeObject === ThreeObject.Line2 ||
        drawableBoundaryTypes.has(pick.type)
    );
}

function getPosition(point?: PointElement) {
    if (!point?.position) {
        return null;
    }
    return {
        x: Number(point.position.x),
        y: Number(point.position.y),
    };
}

function normalize(dx: number, dy: number) {
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 0.001) {
        return null;
    }
    return {
        x: dx / length,
        y: dy / length,
    };
}

function rotate(vector: PlainPoint, radians: number) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: vector.x * cos - vector.y * sin,
        y: vector.x * sin + vector.y * cos,
    };
}

function toMapCoordinate(point: PlainPoint, center: PlainPoint) {
    return [point.x + Number(center?.x || 0), point.y + Number(center?.y || 0)];
}

function sampleExtension(anchor: PlainPoint, direction: PlainPoint, mode: AssistMode, lengthMeters: number) {
    if (mode === 'straight') {
        return [
            anchor,
            {
                x: anchor.x + direction.x * lengthMeters,
                y: anchor.y + direction.y * lengthMeters,
            },
        ];
    }

    const turnSign = mode === 'left' ? 1 : -1;
    const curveOffset = Math.min(7, lengthMeters * 0.26);
    const sampleCount = 7;
    const perpendicular = { x: -direction.y * turnSign, y: direction.x * turnSign };
    return Array.from({ length: sampleCount }, (_unused, index) => {
        const t = index / (sampleCount - 1);
        const angle = turnSign * (Math.PI / 5) * t;
        const rotatedDirection = rotate(direction, angle);
        return {
            x: anchor.x + rotatedDirection.x * lengthMeters * t + perpendicular.x * curveOffset * t * t,
            y: anchor.y + rotatedDirection.y * lengthMeters * t + perpendicular.y * curveOffset * t * t,
        };
    });
}

function findForwardEndpointTarget(
    sourceBoundary: Boundary,
    allBoundarys: { [id: string]: Boundary },
    allPoints: { [id: string]: PointElement },
    anchor: PlainPoint,
    direction: PlainPoint,
) {
    let bestTarget: (EndpointTarget & { score: number }) | null = null;
    Object.values(allBoundarys).forEach((boundary) => {
        if (!boundary || boundary.id === sourceBoundary.id || !Array.isArray(boundary.pointIds)) {
            return;
        }
        [boundary.pointIds[0], boundary.pointIds[boundary.pointIds.length - 1]].forEach((pointId) => {
            if (!pointId) {
                return;
            }
            const position = getPosition(allPoints[pointId]);
            if (!position) {
                return;
            }
            const dx = position.x - anchor.x;
            const dy = position.y - anchor.y;
            const distance = Math.hypot(dx, dy);
            if (distance < 4 || distance > 45) {
                return;
            }
            const targetDirection = normalize(dx, dy);
            if (!targetDirection) {
                return;
            }
            const dot = direction.x * targetDirection.x + direction.y * targetDirection.y;
            const lateral = Math.abs(direction.x * dy - direction.y * dx);
            if (dot < 0.74 || lateral > 12) {
                return;
            }
            const score = distance + lateral * 1.7 - dot * 8;
            if (!bestTarget || score < bestTarget.score) {
                bestTarget = {
                    boundaryId: boundary.id,
                    pointId,
                    position,
                    distance,
                    score,
                };
            }
        });
    });
    return bestTarget;
}

function buildEndpointCandidate(
    boundary: Boundary,
    points: PointElement[],
    center: PlainPoint,
    allBoundarys: { [id: string]: Boundary },
    allPoints: { [id: string]: PointElement },
    mode: AssistMode,
    endpoint: EndpointRole,
) {
    const atStart = endpoint === 'start';
    const anchor = getPosition(points[atStart ? 0 : points.length - 1]);
    const neighbor = getPosition(points[atStart ? 1 : points.length - 2]);
    if (!anchor || !neighbor) {
        return null;
    }

    const direction = normalize(anchor.x - neighbor.x, anchor.y - neighbor.y);
    if (!direction) {
        return null;
    }

    const target =
        mode === 'straight' ? findForwardEndpointTarget(boundary, allBoundarys, allPoints, anchor, direction) : null;
    const lengthMeters = target?.distance || (mode === 'straight' ? 24 : 28);
    const sampledPoints = target ? [anchor, target.position] : sampleExtension(anchor, direction, mode, lengthMeters);
    const labelAction = target ? '连接' : modeLabel[mode];
    let confidence = 0.72;
    if (target) {
        confidence = 0.88;
    } else if (mode === 'straight') {
        confidence = 0.82;
    }
    return {
        id: `seed-${boundary.id}-${endpoint}-${mode}`,
        type: 'road_boundary',
        label: `${endpoint === 'start' ? '首端' : '末端'}${labelAction}`,
        confidence,
        geometry: {
            type: 'LineString' as const,
            coordinates: sampledPoints.map((point) => toMapCoordinate(point, center)),
        },
        metrics: {
            sourceBoundaryId: boundary.id,
            targetBoundaryId: target?.boundaryId,
            targetPointId: target?.pointId,
            endpoint,
            mode,
            lengthMeters: Number(lengthMeters.toFixed(2)),
        },
    };
}

export default function AssistDrawingPanel({ baseMapDir }: AssistDrawingPanelProps) {
    const [visible, setVisible] = useState(true);
    const [payload, setPayload] = useState<AssistCandidatePayload | null>(null);
    const [error, setError] = useState('');
    const [currentPickElement, boundarys, points, imageBasemapCenter] = useManagerStore((state) => [
        state.mapState.currentPickElement,
        state.mapState.boundarys,
        state.mapState.points,
        state.mapState.imageBasemapCenter,
    ]);

    const selectedBoundary = useMemo(() => {
        const pick = currentPickElement.find((item) => isBoundaryPick(item));
        const boundary = pick ? boundarys[pick.id] : null;
        const boundaryPoints = boundary?.pointIds?.map((pointId) => points[pointId]).filter(Boolean) || [];
        return {
            pick,
            boundary,
            points: boundaryPoints,
        };
    }, [boundarys, currentPickElement, points]);

    useEffect(() => {
        setPayload(null);
        setError('');
        PubSub.publish('assistCandidatesClear');
    }, [baseMapDir]);

    useEffect(() => {
        PubSub.publish('assistCandidatesVisible', visible);
    }, [visible]);

    const handleGenerate = (mode: AssistMode) => {
        if (!baseMapDir) {
            return;
        }
        const boundary = selectedBoundary.boundary;
        const boundaryPoints = selectedBoundary.points;
        if (!boundary || boundaryPoints.length < 2) {
            setError('请先选中一条已经画好的线段');
            setPayload(null);
            PubSub.publish('assistCandidatesClear');
            return;
        }

        const center = imageBasemapCenter
            ? { x: Number(imageBasemapCenter.x || 0), y: Number(imageBasemapCenter.y || 0) }
            : { x: 0, y: 0 };
        const candidates = (['start', 'end'] as EndpointRole[])
            .map((endpoint) =>
                buildEndpointCandidate(boundary, boundaryPoints, center, boundarys, points, mode, endpoint),
            )
            .filter(Boolean) as AssistCandidate[];
        if (!candidates.length) {
            setError('这条线段端点过近，暂时不能生成延长预览');
            setPayload(null);
            PubSub.publish('assistCandidatesClear');
            return;
        }

        const nextPayload: AssistCandidatePayload = {
            mapName: baseMapDir,
            layer: `seed-${mode}`,
            level: 0,
            candidates,
            stats: {
                lineCandidateCount: candidates.length,
                centerlineCandidateCount: 0,
                areaCandidateCount: 0,
            },
        };
        setError('');
        setPayload(nextPayload);
        setVisible(true);
        PubSub.publish('assistCandidatesRender', nextPayload);
    };

    const handleClear = () => {
        setPayload(null);
        setError('');
        PubSub.publish('assistCandidatesClear');
    };

    if (!baseMapDir) {
        return null;
    }

    const candidateCount = payload?.candidates.length || 0;
    const pointCount = selectedBoundary.points.length;
    const titleMeta = selectedBoundary.boundary
        ? `已选线 ${selectedBoundary.boundary.id} · ${pointCount} 点`
        : '先选中一条线';

    return (
        <div
            className="assist-drawing-panel"
            onClick={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
        >
            <div className="assist-drawing-header">
                <div>
                    <div className="assist-drawing-title">半自动延长</div>
                    <div className="assist-drawing-meta">{payload ? `${candidateCount} 条预览候选` : titleMeta}</div>
                </div>
                <button type="button" onClick={() => setVisible((value) => !value)} disabled={!payload}>
                    {visible ? '隐藏' : '显示'}
                </button>
            </div>
            <div className="assist-drawing-actions">
                <button type="button" className="primary" onClick={() => handleGenerate('straight')}>
                    沿线延长
                </button>
                <button type="button" onClick={() => handleGenerate('left')}>
                    左弯
                </button>
                <button type="button" onClick={() => handleGenerate('right')}>
                    右弯
                </button>
                <button type="button" onClick={handleClear} disabled={!payload && !error}>
                    清空
                </button>
            </div>
            {payload && (
                <div className="assist-drawing-stats">
                    <span>{`预览 ${candidateCount}`}</span>
                    <span>不写入地图</span>
                </div>
            )}
            {error && <div className="assist-drawing-error">{error}</div>}
        </div>
    );
}
