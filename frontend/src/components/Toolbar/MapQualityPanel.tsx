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
import { QUALITY_OVERLAY_GROUP_NAME, applyEditorLayerVisibility } from 'src/utils/editorLayerUtil';

const QUALITY_FOCUS_MIN_EXTENT = 45;
const TOPOLOGY_GAP_DISTANCE_METERS = 6;
const TOPOLOGY_COMPONENT_COLORS = [0x2f80ed, 0x27ae60, 0xf2994a, 0x9b51e0, 0x00a6a6, 0xeb5757, 0x56ccf2, 0xf2c94c];

type WorkflowStepStatus = 'pass' | 'warning' | 'error';
type IssueFilter = 'all' | 'error' | 'warning' | 'topology';

interface WorkflowStep {
    label: string;
    status: WorkflowStepStatus;
    text: string;
}

interface IssueGuide {
    title: string;
    steps: string[];
    note?: string;
}

interface TopologyComponent {
    id: number;
    laneIds: string[];
}

interface TopologyEndpoint {
    laneId: string;
    componentId: number;
    endpoint: 'start' | 'end';
    center: THREE.Vector3;
}

interface TopologyGap {
    from: TopologyEndpoint;
    to: TopologyEndpoint;
    distance: number;
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
    (target.pointIds || []).forEach((pointId) => {
        const point = getPointPosition(mapState, pointId);
        if (point) {
            positions.push(new THREE.Vector3(point.x, point.y, point.z + 0.2));
        }
    });
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

function isTopologyIssue(issue: MapQualityIssue) {
    return (
        issue.id.startsWith('topology-') ||
        issue.title.includes('断点') ||
        issue.title.includes('孤立') ||
        issue.title.includes('拓扑') ||
        issue.title.includes('前驱') ||
        issue.title.includes('后继') ||
        issue.title.includes('方向断裂') ||
        issue.title.includes('转向突变')
    );
}

function getFocusCoordinates(mapState: MapState, issue: MapQualityIssue) {
    const positions = getIssuePositions(mapState, issue);
    if (positions.length === 0) {
        const allPoints = Object.values(mapState.points).map((point) => point.position);
        return allPoints.map((point) => [point.x, point.y]);
    }
    const box = new THREE.Box2().setFromPoints(positions.map((position) => new THREE.Vector2(position.x, position.y)));
    const center = box.getCenter(new THREE.Vector2());
    const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    const targetExtent = Math.max(QUALITY_FOCUS_MIN_EXTENT, extent * 1.7);
    const halfExtent = targetExtent / 2;
    return [
        [center.x - halfExtent, center.y - halfExtent],
        [center.x + halfExtent, center.y - halfExtent],
        [center.x + halfExtent, center.y + halfExtent],
        [center.x - halfExtent, center.y + halfExtent],
    ];
}

function getIssueGuide(issue: MapQualityIssue): IssueGuide {
    const text = `${issue.id} ${issue.title} ${issue.description} ${issue.suggestion}`;
    if (text.includes('没有前驱')) {
        return {
            title: '没有前驱怎么处理',
            steps: [
                '如果它是地图入口或采图起点，可以保留为警告，发布后在仿真里确认车辆能从这里进入。',
                '如果它不是入口，选中这条车道和上一段车道，按几何关系使用“直道连接”或“弯道连接”。',
                '连接后重新质检；如果仍无前驱，检查两段车道行驶方向是否相反。',
            ],
        };
    }
    if (text.includes('没有后继')) {
        return {
            title: '没有后继怎么处理',
            steps: [
                '如果它是地图出口或道路终点，可以保留为警告。',
                '如果车辆应该继续行驶，选中这条车道和下一段车道，用“直道连接”或“弯道连接”补齐后继。',
                '连接后看箭头方向；后继接反时会继续出现断点或方向突变。',
            ],
        };
    }
    if (text.includes('转弯半径') || text.includes('转弯限速') || text.includes('低速急弯')) {
        return {
            title: '转弯半径/限速怎么处理',
            steps: [
                '半径低于 2m 按硬错误处理，需要拉开端点或重建弯道。',
                '普通弯道先按 15 km/h 上限处理；如果中心线半径太小，按质检给出的建议限速继续降低。',
                '3m 左右的中心线半径属于低速急弯，不适合直接用 15 km/h 跑；15 km/h 通常需要更大的弯道半径。',
                '优先用弯道连接重建，少用手动拖控制点硬拐；重建后检查最小宽度和左右边界是否交叉。',
            ],
        };
    }
    if (text.includes('偏窄') || text.includes('宽度')) {
        return {
            title: '车道偏窄怎么处理',
            steps: [
                '先点选定位，确认是不是自动连接段或合流段被挤窄。',
                '如果不是特殊窄道，把左右边界或弯道端点拉开，目标最小宽度建议不低于 2.6m。',
                '如果是确实很窄的园区入口，保留前需要在仿真里低速通过验证。',
            ],
        };
    }
    if (text.includes('疑似断点') || text.includes('拓扑') || text.includes('孤立')) {
        return {
            title: '拓扑断点怎么处理',
            steps: [
                '点击问题后看高亮的两个端点，确认它们是否属于同一条可通行路线。',
                '直线延续用“直道连接”；存在明显转向、进出环岛或合流时用“弯道连接”。',
                '如果是地图边界入口/出口，可以保留警告，但要确认它不会阻断主路线。',
            ],
        };
    }
    if (text.includes('方向突变') || text.includes('方向断裂')) {
        return {
            title: '方向突变怎么处理',
            steps: [
                '两条车道虽然已经接上，但航向变化过大，车辆会急打方向。',
                '删除硬连接段，改用单独的弯道连接段过渡。',
                '如果这是路口内急转，降低限速并在仿真里确认轨迹稳定。',
            ],
        };
    }
    return {
        title: '处理顺序',
        steps: [
            '先处理红色错误；黄色警告可以发布，但需要人工确认是否是合法入口、出口或低速场景。',
            '点击问题会定位到地图对象；修完后重新打开质检确认数量变化。',
        ],
    };
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

function getEndpointCenter(mapState: MapState, pointIds: [string | null, string | null], z = 0.34) {
    const leftPoint = pointIds[0] ? mapState.points[pointIds[0]] : null;
    const rightPoint = pointIds[1] ? mapState.points[pointIds[1]] : null;
    if (!leftPoint || !rightPoint) {
        return null;
    }
    return new THREE.Vector3(
        (leftPoint.position.x + rightPoint.position.x) / 2,
        (leftPoint.position.y + rightPoint.position.y) / 2,
        z,
    );
}

function buildTopologyComponents(report: MapQualityReport): TopologyComponent[] {
    const relations = report.laneRelations || {};
    const laneIds = Object.keys(relations);
    const visited = new Set<string>();
    const components: TopologyComponent[] = [];
    laneIds.forEach((laneId) => {
        if (visited.has(laneId)) {
            return;
        }
        const componentLaneIds: string[] = [];
        const queue = [laneId];
        visited.add(laneId);
        while (queue.length > 0) {
            const currentLaneId = queue.shift();
            if (currentLaneId) {
                componentLaneIds.push(currentLaneId);
                const relation = relations[currentLaneId];
                [...(relation?.predecessors || []), ...(relation?.successors || [])].forEach((nextLaneId) => {
                    if (!visited.has(nextLaneId) && relations[nextLaneId]) {
                        visited.add(nextLaneId);
                        queue.push(nextLaneId);
                    }
                });
            }
        }
        components.push({
            id: components.length + 1,
            laneIds: componentLaneIds,
        });
    });
    return components;
}

function getTopologyEndpoints(mapState: MapState, component: TopologyComponent, report: MapQualityReport) {
    return component.laneIds.flatMap((laneId) => {
        const relation = report.laneRelations[laneId];
        if (!relation) {
            return [];
        }
        return [
            {
                laneId,
                componentId: component.id,
                endpoint: 'start' as const,
                center: getEndpointCenter(mapState, relation.startPointIds),
            },
            {
                laneId,
                componentId: component.id,
                endpoint: 'end' as const,
                center: getEndpointCenter(mapState, relation.endPointIds),
            },
        ].filter((item) => Boolean(item.center)) as TopologyEndpoint[];
    });
}

function getNearestTopologyGaps(mapState: MapState, components: TopologyComponent[], report: MapQualityReport) {
    const gaps: TopologyGap[] = [];
    for (let i = 0; i < components.length; i += 1) {
        for (let j = i + 1; j < components.length; j += 1) {
            const leftEndpoints = getTopologyEndpoints(mapState, components[i], report);
            const rightEndpoints = getTopologyEndpoints(mapState, components[j], report);
            let bestGap: TopologyGap = null;
            leftEndpoints.forEach((from) => {
                rightEndpoints.forEach((to) => {
                    const distance = from.center.distanceTo(to.center);
                    if (!bestGap || distance < bestGap.distance) {
                        bestGap = { from, to, distance };
                    }
                });
            });
            if (bestGap && bestGap.distance <= TOPOLOGY_GAP_DISTANCE_METERS) {
                gaps.push(bestGap);
            }
        }
    }
    return gaps.sort((left, right) => left.distance - right.distance);
}

function addTopologyGapLine(group: THREE.Group, gap: TopologyGap) {
    const geometry = new THREE.BufferGeometry().setFromPoints([gap.from.center, gap.to.center]);
    const material = new THREE.LineDashedMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        dashSize: 1.2,
        gapSize: 0.7,
        depthTest: false,
        depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 905;
    group.add(line);
    addMarker(group, [gap.from.center, gap.to.center], 0xffffff);
}

function removeQualityOverlay(mapState: MapState) {
    const { scene } = mapState;
    if (!scene) {
        return false;
    }
    const oldGroup = scene.getObjectByName(QUALITY_OVERLAY_GROUP_NAME);
    if (!oldGroup) {
        return false;
    }
    scene.remove(oldGroup);
    oldGroup.traverse((object: any) => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
    });
    return true;
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
    const oldGroup = scene.getObjectByName(QUALITY_OVERLAY_GROUP_NAME);
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
    group.name = QUALITY_OVERLAY_GROUP_NAME;
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
    applyEditorLayerVisibility(mapState);
    PubSub.publish('render');
}

function renderTopologyOverlay(mapState: MapState, report: MapQualityReport) {
    const { scene } = mapState;
    if (!scene) {
        return;
    }
    removeQualityOverlay(mapState);
    const components = buildTopologyComponents(report);
    if (components.length === 0) {
        return;
    }
    const group = new THREE.Group();
    group.name = QUALITY_OVERLAY_GROUP_NAME;
    components.forEach((component, index) => {
        const color = TOPOLOGY_COMPONENT_COLORS[index % TOPOLOGY_COMPONENT_COLORS.length];
        component.laneIds.forEach((laneId) => {
            const lane = mapState.lanes[laneId];
            if (!lane) {
                return;
            }
            const leftPositions = getBoundaryPositions(mapState, lane.leftBoundaryId);
            const rightPositions = getBoundaryPositions(mapState, lane.rightBoundaryId);
            addLine(group, leftPositions, color);
            addLine(group, rightPositions, color);
            addMarker(group, [...leftPositions, ...rightPositions], color);
        });
    });
    getNearestTopologyGaps(mapState, components, report)
        .slice(0, 16)
        .forEach((gap) => addTopologyGapLine(group, gap));
    scene.add(group);
    applyEditorLayerVisibility(mapState);
    PubSub.publish('render');
}

function clearQualityOverlay(mapState: MapState) {
    if (removeQualityOverlay(mapState)) {
        PubSub.publish('render');
    }
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

function getIssueTargetIds(issue: MapQualityIssue) {
    const targetIds: string[] = [];
    if (issue.target.id) {
        targetIds.push(`${issue.target.type}:${issue.target.id}`);
    }
    if (issue.target.groudId) {
        targetIds.push(`groud:${issue.target.groudId}`);
    }
    (issue.target.boundaryIds || []).forEach((boundaryId) => targetIds.push(`boundary:${boundaryId}`));
    (issue.target.pointIds || []).forEach((pointId) => targetIds.push(`point:${pointId}`));
    return targetIds;
}

function getRepairActionTargetIds(action: ReturnType<typeof buildMapQualityRepairActions>[number]) {
    switch (action.kind) {
        case 'removeMissingBoundaryPoints':
            return [`boundary:${action.targetId}`];
        case 'restoreTrafficSignalStopLine': {
            const targetIds = [`trafficSignal:${action.targetId}`];
            if (action.stopLineId) {
                targetIds.push(`stopLine:${action.stopLineId}`);
            }
            if (action.boundaryId) {
                targetIds.push(`boundary:${action.boundaryId}`);
            }
            return targetIds;
        }
        case 'snapLaneSuccessorStart': {
            const targetIds = [`lane:${action.targetId}`];
            if (action.targetLaneId) {
                targetIds.push(`lane:${action.targetLaneId}`);
            }
            return targetIds;
        }
        default:
            return [`lane:${action.targetId}`];
    }
}

function getIssuePriority(issue: MapQualityIssue) {
    if (issue.severity === 'error') {
        return 0;
    }
    if (isTopologyIssue(issue)) {
        return 1;
    }
    return 2;
}

interface MapQualityPanelProps {
    embedded?: boolean;
}

export default function MapQualityPanel({ embedded = false }: MapQualityPanelProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [selectedIssueId, setSelectedIssueId] = useState('');
    const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
    const [topologyOverlayEnabled, setTopologyOverlayEnabled] = useState(false);
    const [mapState, setMapState, addCommand] = useManagerStore((state) => [
        state.mapState,
        state.setMapState,
        state.addCommand,
    ]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const repairActions = useMemo(() => buildMapQualityRepairActions(mapState), [mapState]);
    const repairableTargetIds = useMemo(
        () => new Set(repairActions.flatMap((action) => getRepairActionTargetIds(action).filter(Boolean))),
        [repairActions],
    );
    const hasMapData = Object.keys(mapState.lanes).length > 0 || Object.keys(mapState.boundarys).length > 0;
    const issues = report.issues;

    useEffect(() => () => clearQualityOverlay(useManagerStore.getState().mapState), []);

    useEffect(() => {
        if (topologyOverlayEnabled) {
            renderTopologyOverlay(mapState, report);
        }
    }, [mapState, report, topologyOverlayEnabled]);

    if (!hasMapData && !embedded) {
        return null;
    }
    if (!hasMapData) {
        return (
            <div className="quality-panel quality-panel-docked is-pass">
                <div className="quality-panel-header">
                    <div>
                        <div className="quality-panel-title">地图质量检查</div>
                        <div className="quality-panel-summary">等待地图数据</div>
                    </div>
                </div>
                <div className="quality-panel-empty">打开底图或标注地图后，这里会显示绘制、拓扑、预检和发布问题。</div>
            </div>
        );
    }

    const handleIssueClick = (issue: MapQualityIssue) => {
        setSelectedIssueId(issue.id);
    };

    const handleToggleTopologyOverlay = () => {
        setTopologyOverlayEnabled((enabled) => {
            const nextEnabled = !enabled;
            if (!nextEnabled) {
                clearQualityOverlay(mapState);
            } else {
                setSelectedIssueId('');
            }
            return nextEnabled;
        });
    };

    const handleLocateIssue = (issue: MapQualityIssue, event?: React.MouseEvent) => {
        event?.stopPropagation();
        setTopologyOverlayEnabled(false);
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
            PubSub.publishSync('cameraMove', {
                coordinates,
                minExtent: QUALITY_FOCUS_MIN_EXTENT,
                padding: {
                    top: 112,
                    right: 32,
                    bottom: 36,
                    left: 138,
                },
            });
            renderQualityOverlay(useManagerStore.getState().mapState, [issue], issue.id);
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
            Modal.info({
                title: '暂无可自动修复项',
                content: (
                    <div>
                        <p>当前质量问题需要人工判断，或者端点距离/方向差超过自动连接阈值。</p>
                        {issues.length > 0 && (
                            <ul>
                                {issues.slice(0, 5).map((issue) => (
                                    <li key={issue.id}>{issue.title}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                ),
                okText: '知道了',
            });
            return;
        }
        const previewActions = repairActions.slice(0, 6);
        Modal.confirm({
            title: `智能修复 ${repairActions.length} 项质量问题`,
            content: (
                <div>
                    <p>
                        本次会修复确定性的结构问题，并对端点接近、方向一致的车道断点执行确认后的吸附连接；交通语义仍需人工确认。
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
                setTimeout(() => {
                    const nextReport = inspectMapQuality(useManagerStore.getState().mapState);
                    if (nextReport.summary.errors === 0) {
                        message.success(
                            `已智能修复 ${repairActions.length} 项，当前无阻断发布的红色错误，剩余 ${nextReport.summary.warnings} 个警告待确认。`,
                        );
                        return;
                    }
                    message.warning(
                        `已智能修复 ${repairActions.length} 项，仍有 ${nextReport.summary.errors} 个错误和 ${nextReport.summary.warnings} 个警告需要处理。`,
                    );
                }, 0);
            },
        });
    };

    const filteredIssues = issues
        .filter((issue) => {
            if (issueFilter === 'all') {
                return true;
            }
            if (issueFilter === 'topology') {
                return isTopologyIssue(issue);
            }
            return issue.severity === issueFilter;
        })
        .sort((left, right) => getIssuePriority(left) - getIssuePriority(right));
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
        {
            label: '拓扑',
            value: 'topology',
            count: issues.filter(isTopologyIssue).length,
        },
    ];

    const handleLocateNextIssue = () => {
        if (filteredIssues.length === 0) {
            return;
        }
        const currentIndex = filteredIssues.findIndex((issue) => issue.id === selectedIssueId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % filteredIssues.length : 0;
        handleLocateIssue(filteredIssues[nextIndex]);
    };

    return (
        <div
            className={`quality-panel ${embedded ? 'quality-panel-docked' : ''} ${statusClass} ${collapsed ? 'is-collapsed' : ''}`}
        >
            <div className="quality-panel-header">
                <div>
                    <div className="quality-panel-title">地图质量检查</div>
                    <div className="quality-panel-summary">
                        {`车道 ${report.summary.lanes} / 连接 ${report.summary.laneEdges} / 错误 ${report.summary.errors} / 警告 ${report.summary.warnings}`}
                    </div>
                </div>
                <div className="quality-panel-actions">
                    <Button size="small" disabled={issues.length === 0} onClick={handleAutoRepair}>
                        {repairActions.length > 0 ? `智能修复 ${repairActions.length}` : '智能修复'}
                    </Button>
                    <Button
                        size="small"
                        disabled={report.summary.lanes === 0}
                        type={topologyOverlayEnabled ? 'primary' : 'default'}
                        onClick={handleToggleTopologyOverlay}
                    >
                        {topologyOverlayEnabled ? '隐藏拓扑' : '显示拓扑'}
                    </Button>
                    <Button size="small" disabled={filteredIssues.length === 0} onClick={handleLocateNextIssue}>
                        定位下一项
                    </Button>
                    {issues.length > 0 && (
                        <Button size="small" onClick={handleCopyReport}>
                            复制
                        </Button>
                    )}
                    {!embedded && (
                        <Button size="small" onClick={() => setCollapsed(!collapsed)}>
                            {collapsed ? '展开' : '收起'}
                        </Button>
                    )}
                </div>
            </div>
            {(!collapsed || embedded) && (
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
                        {filteredIssues.length > 0 && (
                            <div className="quality-queue-hint">
                                <strong>问题队列</strong>
                                <span>先处理红色错误；点击问题展开说明，点“定位到地图”会选中对象并移动视角。</span>
                            </div>
                        )}
                        {filteredIssues.length === 0 && (
                            <div className="quality-panel-empty">
                                {issues.length === 0 ? '当前未发现阻塞发布的问题。' : '当前筛选下没有问题。'}
                            </div>
                        )}
                        {topIssues.map((issue) => {
                            const issueGuide = getIssueGuide(issue);
                            const autoRepairable = getIssueTargetIds(issue).some((targetId) =>
                                repairableTargetIds.has(targetId),
                            );
                            return (
                                <div
                                    role="button"
                                    tabIndex={0}
                                    key={issue.id}
                                    className={`quality-issue ${issue.severity} ${
                                        selectedIssueId === issue.id ? 'active' : ''
                                    }`}
                                    onClick={() => handleIssueClick(issue)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            handleIssueClick(issue);
                                        }
                                    }}
                                >
                                    <span className="quality-issue-level">
                                        {issue.severity === 'error' ? '错误' : '警告'}
                                    </span>
                                    <span className="quality-issue-main">
                                        <strong>{issue.title}</strong>
                                        <span>{issue.suggestion}</span>
                                        <span className="quality-issue-meta">
                                            <em>{isTopologyIssue(issue) ? '拓扑/连接' : '对象属性'}</em>
                                            <em>{autoRepairable ? '可智能修复' : '需人工确认'}</em>
                                        </span>
                                        {selectedIssueId === issue.id && (
                                            <>
                                                {issue.details && issue.details.length > 0 && (
                                                    <span className="quality-issue-details">
                                                        {issue.details.map((detail) => (
                                                            <em key={detail}>{detail}</em>
                                                        ))}
                                                    </span>
                                                )}
                                                <span className="quality-issue-guide">
                                                    <b>{issueGuide.title}</b>
                                                    {issueGuide.steps.map((step, index) => (
                                                        <em key={step}>{`${index + 1}. ${step}`}</em>
                                                    ))}
                                                    {issueGuide.note && <em>{issueGuide.note}</em>}
                                                </span>
                                                <span className="quality-issue-tools">
                                                    <button
                                                        type="button"
                                                        onClick={(event) => handleLocateIssue(issue, event)}
                                                    >
                                                        定位到地图
                                                    </button>
                                                </span>
                                            </>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                        {remainingIssueCount > 0 && (
                            <div className="quality-panel-more">{`还有 ${remainingIssueCount} 个问题，优先处理红色错误。`}</div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
