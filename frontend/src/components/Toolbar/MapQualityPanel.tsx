import React, { useEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
import PubSub from 'pubsub-js';
import * as THREE from 'three';
import { mapElementZ } from 'src/constant/mapElementZ';
import { MapState } from 'src/interface/mapStateInterface';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { inspectMapQuality, MapQualityIssue, pickElementFromIssue } from 'src/quality/mapQuality';

const OVERLAY_GROUP_NAME = '__map_quality_overlay__';

function getPointPosition(mapState: MapState, pointId: string) {
    return mapState.points[pointId]?.position;
}

function getBoundaryPositions(mapState: MapState, boundaryId: string) {
    const boundary = mapState.boundarys[boundaryId];
    if (!boundary) {
        return [];
    }
    return (boundary.pointIds || [])
        .map((pointId) => getPointPosition(mapState, pointId))
        .filter(Boolean)
        .map((point) => new THREE.Vector3(point.x, point.y, (mapElementZ[boundary.type] || 0) + 0.08));
}

function getIssuePositions(mapState: MapState, issue: MapQualityIssue) {
    const positions: THREE.Vector3[] = [];
    const { target } = issue;
    if (target.type === 'lane') {
        (target.boundaryIds || []).forEach((boundaryId) => {
            positions.push(...getBoundaryPositions(mapState, boundaryId));
        });
    } else if (target.type === 'boundary' && target.id) {
        positions.push(...getBoundaryPositions(mapState, target.id));
    } else if (target.type === 'stopLine' && target.boundaryIds?.[0]) {
        positions.push(...getBoundaryPositions(mapState, target.boundaryIds[0]));
    } else if (target.type === 'point' && target.id) {
        const point = getPointPosition(mapState, target.id);
        if (point) {
            positions.push(new THREE.Vector3(point.x, point.y, point.z + 0.2));
        }
    } else if (target.type === 'trafficSignal' && target.id) {
        const signal = mapState.trafficSignals[target.id];
        if (signal?.center) {
            positions.push(
                new THREE.Vector3(signal.center.x, signal.center.y, mapElementZ[ThreeElementType.TrafficLight] + 0.2),
            );
        }
    }
    return positions;
}

function getFocusCoordinates(mapState: MapState, issue: MapQualityIssue) {
    const positions = getIssuePositions(mapState, issue);
    if (positions.length === 0) {
        const allPoints = Object.values(mapState.points).map((point) => point.position);
        return allPoints.map((point) => [point.x, point.y]);
    }
    const box = new THREE.Box2().setFromPoints(positions.map((position) => new THREE.Vector2(position.x, position.y)));
    const padding = Math.max(8, Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.35);
    return [
        [box.min.x - padding, box.min.y - padding],
        [box.max.x + padding, box.min.y - padding],
        [box.max.x + padding, box.max.y + padding],
        [box.min.x - padding, box.max.y + padding],
    ];
}

function addLine(group: THREE.Group, positions: THREE.Vector3[], color: number) {
    if (positions.length < 2) {
        return;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(positions);
    const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 900;
    group.add(line);
}

function addMarker(group: THREE.Group, positions: THREE.Vector3[], color: number) {
    if (positions.length === 0) {
        return;
    }
    const center = new THREE.Box3().setFromPoints(positions).getCenter(new THREE.Vector3());
    const geometry = new THREE.RingGeometry(1.3, 2.2, 32);
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(center.x, center.y, center.z + 0.25);
    marker.renderOrder = 901;
    group.add(marker);
}

function getIssueColor(issue: MapQualityIssue, selectedIssueId: string) {
    if (issue.id === selectedIssueId) {
        return 0xff2d2d;
    }
    if (issue.severity === 'error') {
        return 0xff4d58;
    }
    return 0xffb020;
}

function renderQualityOverlay(mapState: MapState, issues: MapQualityIssue[], selectedIssueId: string) {
    const { scene } = mapState;
    if (!scene) {
        return;
    }
    const oldGroup = scene.getObjectByName(OVERLAY_GROUP_NAME);
    if (oldGroup) {
        scene.remove(oldGroup);
        oldGroup.traverse((object: any) => {
            object.geometry?.dispose?.();
            object.material?.dispose?.();
        });
    }
    if (issues.length === 0) {
        PubSub.publish('render');
        return;
    }
    const group = new THREE.Group();
    group.name = OVERLAY_GROUP_NAME;
    issues.slice(0, 120).forEach((issue) => {
        const color = getIssueColor(issue, selectedIssueId);
        const { target } = issue;
        const positions = getIssuePositions(mapState, issue);
        if (target.type === 'lane') {
            (target.boundaryIds || []).forEach((boundaryId) =>
                addLine(group, getBoundaryPositions(mapState, boundaryId), color),
            );
            addMarker(group, positions, color);
        } else if (target.type === 'boundary' && target.id) {
            addLine(group, positions, color);
            addMarker(group, positions, color);
        } else if (target.type === 'stopLine' && target.boundaryIds?.[0]) {
            addLine(group, positions, color);
            addMarker(group, positions, color);
        } else if (target.type === 'trafficSignal') {
            addMarker(group, positions, color);
        }
    });
    scene.add(group);
    PubSub.publish('render');
}

function getStatusClass(errors: number, warnings: number) {
    if (errors > 0) {
        return 'is-error';
    }
    if (warnings > 0) {
        return 'is-warning';
    }
    return 'is-pass';
}

export default function MapQualityPanel() {
    const [collapsed, setCollapsed] = useState(false);
    const [selectedIssueId, setSelectedIssueId] = useState('');
    const [mapState, setMapState] = useManagerStore((state) => [state.mapState, state.setMapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const hasMapData = Object.keys(mapState.lanes).length > 0 || Object.keys(mapState.boundarys).length > 0;
    const issues = report.issues;

    useEffect(() => {
        renderQualityOverlay(mapState, issues, selectedIssueId);
        return () => {
            if (!mapState.scene) {
                return;
            }
            const oldGroup = mapState.scene.getObjectByName(OVERLAY_GROUP_NAME);
            if (oldGroup) {
                mapState.scene.remove(oldGroup);
            }
        };
    }, [mapState, issues, selectedIssueId]);

    if (!hasMapData) {
        return null;
    }

    const handleIssueClick = (issue: MapQualityIssue) => {
        setSelectedIssueId(issue.id);
        const pickElement = pickElementFromIssue(mapState, issue);
        if (pickElement) {
            setMapState({
                ...mapState,
                currentPickElement: [pickElement],
            });
        }
        const coordinates = getFocusCoordinates(mapState, issue);
        if (coordinates.length >= 3) {
            PubSub.publishSync('cameraMove', coordinates);
            PubSub.publish('render');
        }
    };

    const topIssues = issues.slice(0, 18);
    const statusClass = getStatusClass(report.summary.errors, report.summary.warnings);

    return (
        <div className={`quality-panel ${statusClass} ${collapsed ? 'is-collapsed' : ''}`}>
            <div className="quality-panel-header">
                <div>
                    <div className="quality-panel-title">地图质量检查</div>
                    <div className="quality-panel-summary">
                        {`车道 ${report.summary.lanes} / 连接 ${report.summary.laneEdges} / 错误 ${report.summary.errors} / 警告 ${report.summary.warnings}`}
                    </div>
                </div>
                <Button size="small" onClick={() => setCollapsed(!collapsed)}>
                    {collapsed ? '展开' : '收起'}
                </Button>
            </div>
            {!collapsed && (
                <div className="quality-panel-body">
                    {issues.length === 0 && <div className="quality-panel-empty">当前未发现阻塞发布的问题。</div>}
                    {topIssues.map((issue) => (
                        <button
                            type="button"
                            key={issue.id}
                            className={`quality-issue ${issue.severity} ${
                                selectedIssueId === issue.id ? 'active' : ''
                            }`}
                            onClick={() => handleIssueClick(issue)}
                        >
                            <span className="quality-issue-level">{issue.severity === 'error' ? '错误' : '警告'}</span>
                            <span className="quality-issue-main">
                                <strong>{issue.title}</strong>
                                <span>{issue.suggestion}</span>
                                {selectedIssueId === issue.id && issue.details && issue.details.length > 0 && (
                                    <span className="quality-issue-details">
                                        {issue.details.map((detail) => (
                                            <em key={detail}>{detail}</em>
                                        ))}
                                    </span>
                                )}
                            </span>
                        </button>
                    ))}
                    {issues.length > topIssues.length && (
                        <div className="quality-panel-more">{`还有 ${issues.length - topIssues.length} 个问题，优先处理红色错误。`}</div>
                    )}
                </div>
            )}
        </div>
    );
}
