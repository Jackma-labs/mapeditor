import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PubSub from 'pubsub-js';
import { Bot, ClipboardCheck, ListChecks, Map, MousePointer2 } from 'lucide-react';
import { Button } from 'src/components/ui/button';
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
    { key: 'publish', label: '发布检查', desc: '生成 Apollo 包', icon: ClipboardCheck },
];

export default function WorkbenchPanel() {
    const [activeTab, setActiveTab] = useState<WorkbenchTab>('guide');
    const [mapState] = useManagerStore((state) => [state.mapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const selectedCount = mapState.currentPickElement?.length || 0;
    const hasMapContext = Boolean(
        mapState.baseMapDir ||
            mapState.hdMapFile ||
            report.summary.lanes > 0 ||
            Object.keys(mapState.points || {}).length > 0 ||
            Object.keys(mapState.grouds || {}).length > 0 ||
            Object.keys(mapState.boundarys || {}).length > 0,
    );
    const openAssetManager = useCallback(() => PubSub.publish('openAssetManager'), []);
    const openEdgeDeploy = useCallback(() => PubSub.publish('openEdgeDeploy'), []);

    useEffect(() => {
        const token = PubSub.subscribe('openWorkbenchTab', (_message, tab: WorkbenchTab) => {
            if (tabs.some((item) => item.key === tab)) {
                setActiveTab(tab);
            }
        });
        return () => {
            PubSub.unsubscribe(token);
        };
    }, []);
    const nextAction = useMemo(() => {
        if (!hasMapContext) {
            return {
                title: '上传最新采图包',
                detail: '先生成可编辑点云资产，再开始标注。',
                button: '采图包',
                status: 'idle' as FlowStatus,
                action: openAssetManager,
            };
        }
        if (report.summary.lanes === 0) {
            return {
                title: '开始基础车道标注',
                detail: '先画连续主路线，再补路口和交通控制。',
                button: '看向导',
                status: 'idle' as FlowStatus,
                tab: 'guide' as WorkbenchTab,
            };
        }
        if (report.summary.errors > 0) {
            return {
                title: '处理红色错误',
                detail: `${report.summary.errors} 个错误会阻塞发布，先从质检列表定位。`,
                button: '打开质检',
                status: 'blocked' as FlowStatus,
                tab: 'quality' as WorkbenchTab,
            };
        }
        if (report.summary.warnings > 0) {
            return {
                title: '确认黄色警告',
                detail: `${report.summary.warnings} 个警告需要确认，不阻塞但会影响实车信心。`,
                button: '确认警告',
                status: 'warning' as FlowStatus,
                tab: 'quality' as WorkbenchTab,
            };
        }
        return {
            title: '生成 Apollo 发布包',
            detail: '编辑态质检通过后，发布地图包会自动生成 Apollo 可部署产物。',
            button: '发布检查',
            status: 'ready' as FlowStatus,
            tab: 'publish' as WorkbenchTab,
        };
    }, [hasMapContext, openAssetManager, report.summary.errors, report.summary.lanes, report.summary.warnings]);
    const selectionSubtitle =
        selectedCount > 0
            ? `已选中 ${selectedCount} 个对象，右侧显示可编辑属性。`
            : '未选中对象，按下一步推进生产流程。';

    const getTabBadge = (tabKey: WorkbenchTab) => {
        if (tabKey === 'quality') {
            return report.summary.errors + report.summary.warnings;
        }
        if (tabKey === 'publish') {
            return report.summary.errors || report.summary.warnings;
        }
        return 0;
    };

    const stopPanelEvent = (event: React.MouseEvent) => {
        event.stopPropagation();
    };

    const runNextAction = () => {
        if (nextAction.action) {
            nextAction.action();
            return;
        }
        if (nextAction.tab) {
            setActiveTab(nextAction.tab);
        }
    };

    return (
        <aside className="workbench-panel" onClick={stopPanelEvent} onMouseUp={stopPanelEvent}>
            <div className="workbench-header">
                <div>
                    <div className="workbench-title">工作台</div>
                    <div className="workbench-subtitle">{selectionSubtitle}</div>
                </div>
            </div>
            <div className={`workbench-next-action ${nextAction.status}`}>
                <div>
                    <span>下一步</span>
                    <strong>{nextAction.title}</strong>
                    <em>{nextAction.detail}</em>
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant={nextAction.status === 'ready' ? 'default' : 'secondary'}
                    onClick={runNextAction}
                >
                    {nextAction.button}
                </Button>
            </div>
            <div className="workbench-tabs" aria-label="工作台功能">
                {tabs.map((tab) => {
                    const TabIcon = tab.icon;
                    const tabBadge = getTabBadge(tab.key);
                    return (
                        <button
                            type="button"
                            key={tab.key}
                            className={activeTab === tab.key ? 'active' : ''}
                            title={tab.desc}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            <TabIcon />
                            <strong>{tab.label}</strong>
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
