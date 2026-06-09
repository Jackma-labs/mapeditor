import React, { useMemo, useState } from 'react';
import PubSub from 'pubsub-js';
import { Bot, ClipboardCheck, ListChecks, Map, MousePointer2 } from 'lucide-react';
import { useManagerStore } from 'src/store';
import { inspectMapQuality } from 'src/quality/mapQuality';
import Attr from '../Attr';
import MapQualityPanel from '../Toolbar/MapQualityPanel';
import AnnotationGuidePanel from './AnnotationGuidePanel';
import AIAssistantPanel from './AIAssistantPanel';
import ReleaseGatePanel from './ReleaseGatePanel';
import './index.less';

type WorkbenchTab = 'guide' | 'attr' | 'quality' | 'ai' | 'publish';
type FlowStatus = 'ready' | 'warning' | 'blocked' | 'idle';

const tabs: { key: WorkbenchTab; label: string; desc: string; icon: React.ElementType }[] = [
    { key: 'guide', label: '向导', desc: '下一步建议', icon: Map },
    { key: 'attr', label: '属性', desc: '编辑选中对象', icon: MousePointer2 },
    { key: 'quality', label: '质检', desc: '定位地图问题', icon: ListChecks },
    { key: 'ai', label: 'AI 诊断', desc: '解释修复建议', icon: Bot },
    { key: 'publish', label: '发布检查', desc: '确认能否部署', icon: ClipboardCheck },
];

function getGateStatus(blocked: boolean, warning: boolean): FlowStatus {
    if (blocked) {
        return 'blocked';
    }
    if (warning) {
        return 'warning';
    }
    return 'ready';
}

export default function WorkbenchPanel() {
    const [activeTab, setActiveTab] = useState<WorkbenchTab>('guide');
    const [mapState] = useManagerStore((state) => [state.mapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const selectedCount = mapState.currentPickElement?.length || 0;
    const publishBlocked = report.summary.errors > 0;
    const publishWarning = !publishBlocked && report.summary.warnings > 0;
    const qualityStatus = getGateStatus(report.summary.errors > 0, report.summary.warnings > 0);
    const publishFlowStatus = getGateStatus(publishBlocked, publishWarning);
    const openAssetManager = () => PubSub.publish('openAssetManager');
    const openEdgeDeploy = () => PubSub.publish('openEdgeDeploy');
    const flowItems: {
        label: string;
        value: string;
        status: FlowStatus;
        tab?: WorkbenchTab;
        action?: () => void;
    }[] = [
        {
            label: '采图',
            value: mapState.baseMapDir ? '底图已加载' : '上传 LAS',
            status: mapState.baseMapDir ? 'ready' : 'idle',
            action: openAssetManager,
        },
        {
            label: '标注',
            value: report.summary.lanes > 0 ? `${report.summary.lanes} 条车道` : '待标注',
            status: report.summary.lanes > 0 ? 'ready' : 'idle',
            tab: 'attr',
        },
        {
            label: '质检',
            value: report.summary.errors > 0 ? `${report.summary.errors} 错误` : `${report.summary.warnings} 警告`,
            status: qualityStatus,
            tab: 'quality',
        },
        {
            label: '发布',
            value: publishBlocked ? '被阻塞' : '可检查',
            status: publishFlowStatus,
            tab: 'publish',
        },
        {
            label: '边缘',
            value: publishBlocked ? '待发布' : '可部署',
            status: publishBlocked ? 'idle' : publishFlowStatus,
            action: openEdgeDeploy,
        },
    ];
    const selectionSubtitle =
        selectedCount > 0
            ? `已选中 ${selectedCount} 个对象，右侧显示可编辑属性。`
            : '未选中对象，先在画布或左侧工具开始。';

    const getTabBadge = (tabKey: WorkbenchTab) => {
        if (tabKey === 'quality') {
            return report.summary.errors + report.summary.warnings;
        }
        if (tabKey === 'publish') {
            return report.summary.errors;
        }
        return 0;
    };

    const stopPanelEvent = (event: React.MouseEvent) => {
        event.stopPropagation();
    };

    return (
        <aside className="workbench-panel" onClick={stopPanelEvent} onMouseUp={stopPanelEvent}>
            <div className="workbench-header">
                <div>
                    <div className="workbench-title">工作台</div>
                    <div className="workbench-subtitle">{selectionSubtitle}</div>
                </div>
            </div>
            <div className="workbench-flow" aria-label="地图生产流程">
                {flowItems.map((item) => (
                    <button
                        type="button"
                        key={item.label}
                        className={item.status}
                        disabled={!item.tab && !item.action}
                        onClick={() => {
                            if (item.action) {
                                item.action();
                                return;
                            }
                            if (item.tab) {
                                setActiveTab(item.tab);
                            }
                        }}
                    >
                        <strong>{item.label}</strong>
                        <span>{item.value}</span>
                    </button>
                ))}
            </div>
            <div className="workbench-tabs">
                {tabs.map((tab) => {
                    const TabIcon = tab.icon;
                    const tabBadge = getTabBadge(tab.key);
                    return (
                        <button
                            type="button"
                            key={tab.key}
                            className={activeTab === tab.key ? 'active' : ''}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            <TabIcon />
                            <span>
                                <strong>{tab.label}</strong>
                                <small>{tab.desc}</small>
                            </span>
                            {tabBadge > 0 && <em>{tabBadge}</em>}
                        </button>
                    );
                })}
            </div>
            <div className="workbench-body">
                {activeTab === 'attr' && <Attr />}
                {activeTab === 'guide' && (
                    <AnnotationGuidePanel
                        onOpenTab={setActiveTab}
                        onOpenAssets={openAssetManager}
                        onOpenDeploy={openEdgeDeploy}
                    />
                )}
                {activeTab === 'quality' && <MapQualityPanel embedded />}
                {activeTab === 'ai' && <AIAssistantPanel />}
                {activeTab === 'publish' && (
                    <ReleaseGatePanel
                        currentMapName={mapState.hdMapFile}
                        report={report}
                        onOpenQuality={() => setActiveTab('quality')}
                        onOpenDeploy={openEdgeDeploy}
                    />
                )}
            </div>
        </aside>
    );
}
