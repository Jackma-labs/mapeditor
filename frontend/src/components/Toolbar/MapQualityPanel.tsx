import React, { useEffect, useMemo, useState } from 'react';
import { Button, Modal, message } from 'antd';
import PubSub from 'pubsub-js';
import * as THREE from 'three';
import { mapElementZ } from 'src/constant/mapElementZ';
import { MapState } from 'src/interface/mapStateInterface';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { inspectMapQuality, MapQualityIssue, MapQualityReport, pickElementFromIssue } from 'src/quality/mapQuality';
import { ApplyMapQualityRepairsCommand, buildMapQualityRepairActions } from 'src/quality/mapQualityRepair';

const OVERLAY_GROUP_NAME = '__map_quality_overlay__';

type WorkflowStepStatus = 'pass' | 'warning' | 'error';
type IssueFilter = 'all' | 'error' | 'warning';

interface WorkflowStep {
    label: string;
    status: WorkflowStepStatus;
    text: string;
}

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

function getPreflightStatus(errors: number, warnings: number): WorkflowStepStatus {
    if (errors > 0) {
        return 'error';
    }
    if (warnings > 0) {
        return 'warning';
    }
    return 'pass';
}

function getTopologyStatus(hasLanes: boolean, topologyBlocked: boolean): WorkflowStepStatus {
    if (topologyBlocked) {
        return 'error';
    }
    if (hasLanes) {
        return 'pass';
    }
    return 'warning';
}

function getWorkflowSteps(report: MapQualityReport): WorkflowStep[] {
    const { lanes, laneEdges, laneComponents, errors, warnings } = report.summary;
    const hasLanes = lanes > 0;
    const topologyBlocked = hasLanes && lanes > 1 && (laneEdges < lanes - 1 || laneComponents > 1);
    const preflightStatus = getPreflightStatus(errors, warnings);

    return [
        {
            label: '绘制',
            status: hasLanes ? 'pass' : 'warning',
            text: hasLanes ? `${lanes} 条车道` : '未画车道',
        },
        {
            label: '拓扑',
            status: getTopologyStatus(hasLanes, topologyBlocked),
            text: hasLanes ? `${laneEdges} 条连接 / ${laneComponents || 0} 区域` : '等待车道',
        },
        {
            label: '预检',
            status: preflightStatus,
            text: errors > 0 ? `${errors} 个错误` : `${warnings} 个警告`,
        },
        {
            label: '发布',
            status: errors > 0 ? 'error' : 'pass',
            text: errors > 0 ? '禁止发布' : '可发布',
        },
    ];
}

function formatIssueReport(report: MapQualityReport, issues: MapQualityIssue[]) {
    const lines = [
        '地图质量检查报告',
        `车道：${report.summary.lanes}，连接：${report.summary.laneEdges}，拓扑区域：${report.summary.laneComponents}`,
        `错误：${report.summary.errors}，警告：${report.summary.warnings}`,
        '',
    ];
    if (issues.length === 0) {
        lines.push('当前未发现阻塞发布的问题。');
        return lines.join('\n');
    }
    issues.slice(0, 80).forEach((issue, index) => {
        lines.push(`${index + 1}. [${issue.severity === 'error' ? '错误' : '警告'}] ${issue.title}`);
        lines.push(`   建议：${issue.suggestion}`);
        (issue.details || []).forEach((detail) => {
            lines.push(`   ${detail}`);
        });
    });
    if (issues.length > 80) {
        lines.push(`还有 ${issues.length - 80} 个问题未列出。`);
    }
    return lines.join('\n');
}

export default function MapQualityPanel() {
    const [collapsed, setCollapsed] = useState(false);
    const [selectedIssueId, setSelectedIssueId] = useState('');
    const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
    const [mapState, setMapState, addCommand] = useManagerStore((state) => [
        state.mapState,
        state.setMapState,
        state.addCommand,
    ]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const repairActions = useMemo(() => buildMapQualityRepairActions(mapState), [mapState]);
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

    const handleCopyReport = async () => {
        try {
            await navigator.clipboard.writeText(formatIssueReport(report, issues));
            message.success('已复制质量报告');
        } catch (_error) {
            message.error('复制失败，请检查浏览器剪贴板权限');
        }
    };

    const handleAutoRepair = () => {
        if (repairActions.length === 0) {
            message.info('当前没有可安全自动修复的问题');
            return;
        }
        const previewActions = repairActions.slice(0, 6);
        Modal.confirm({
            title: `自动修复 ${repairActions.length} 项质量问题`,
            content: (
                <div>
                    <p>
                        本次只修复确定性的结构问题，例如失效引用、缺失基础属性和缺失渲染对象；拓扑连接和交通语义仍需人工确认。
                    </p>
                    <ul>
                        {previewActions.map((action) => (
                            <li key={`${action.kind}-${action.targetId}`}>{action.title}</li>
                        ))}
                    </ul>
                    {repairActions.length > previewActions.length && (
                        <p>{`还有 ${repairActions.length - previewActions.length} 项将一起处理。`}</p>
                    )}
                </div>
            ),
            okText: '执行修复',
            cancelText: '取消',
            onOk: () => {
                addCommand([new ApplyMapQualityRepairsCommand(repairActions)]);
                setSelectedIssueId('');
                PubSub.publish('render');
                message.success(`已自动修复 ${repairActions.length} 项问题，请复核后再发布`);
            },
        });
    };

    const filteredIssues = issues.filter((issue) => issueFilter === 'all' || issue.severity === issueFilter);
    const topIssues = filteredIssues.slice(0, 18);
    const remainingIssueCount = filteredIssues.length - topIssues.length;
    const statusClass = getStatusClass(report.summary.errors, report.summary.warnings);
    const workflowSteps = getWorkflowSteps(report);
    const filterItems: { label: string; value: IssueFilter; count: number }[] = [
        {
            label: '全部',
            value: 'all',
            count: issues.length,
        },
        {
            label: '错误',
            value: 'error',
            count: report.summary.errors,
        },
        {
            label: '警告',
            value: 'warning',
            count: report.summary.warnings,
        },
    ];

    return (
        <div className={`quality-panel ${statusClass} ${collapsed ? 'is-collapsed' : ''}`}>
            <div className="quality-panel-header">
                <div>
                    <div className="quality-panel-title">地图质量检查</div>
                    <div className="quality-panel-summary">
                        {`车道 ${report.summary.lanes} / 连接 ${report.summary.laneEdges} / 错误 ${report.summary.errors} / 警告 ${report.summary.warnings}`}
                    </div>
                </div>
                <div className="quality-panel-actions">
                    <Button size="small" disabled={repairActions.length === 0} onClick={handleAutoRepair}>
                        {repairActions.length > 0 ? `自动修复 ${repairActions.length}` : '自动修复'}
                    </Button>
                    {issues.length > 0 && (
                        <Button size="small" onClick={handleCopyReport}>
                            复制
                        </Button>
                    )}
                    <Button size="small" onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? '展开' : '收起'}
                    </Button>
                </div>
            </div>
            {!collapsed && (
                <>
                    <div className="quality-workflow">
                        {workflowSteps.map((step) => (
                            <div key={step.label} className={`quality-workflow-step ${step.status}`}>
                                <strong>{step.label}</strong>
                                <span>{step.text}</span>
                            </div>
                        ))}
                    </div>
                    <div className="quality-panel-body">
                        <div className="quality-filter">
                            {filterItems.map((item) => (
                                <button
                                    type="button"
                                    key={item.value}
                                    className={issueFilter === item.value ? 'active' : ''}
                                    onClick={() => setIssueFilter(item.value)}
                                >
                                    {`${item.label} ${item.count}`}
                                </button>
                            ))}
                        </div>
                        {filteredIssues.length === 0 && (
                            <div className="quality-panel-empty">
                                {issues.length === 0 ? '当前未发现阻塞发布的问题。' : '当前筛选下没有问题。'}
                            </div>
                        )}
                        {topIssues.map((issue) => (
                            <button
                                type="button"
                                key={issue.id}
                                className={`quality-issue ${issue.severity} ${
                                    selectedIssueId === issue.id ? 'active' : ''
                                }`}
                                onClick={() => handleIssueClick(issue)}
                            >
                                <span className="quality-issue-level">
                                    {issue.severity === 'error' ? '错误' : '警告'}
                                </span>
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
                        {remainingIssueCount > 0 && (
                            <div className="quality-panel-more">{`还有 ${remainingIssueCount} 个问题，优先处理红色错误。`}</div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
