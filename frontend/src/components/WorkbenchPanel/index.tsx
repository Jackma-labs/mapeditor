import React, { useMemo, useState } from 'react';
import { AlertCircle, Bot, CheckCircle2, ClipboardCheck, ListChecks, MousePointer2 } from 'lucide-react';
import { Badge } from 'src/components/ui/badge';
import { Button } from 'src/components/ui/button';
import { useManagerStore } from 'src/store';
import { inspectMapQuality } from 'src/quality/mapQuality';
import Attr from '../Attr';
import MapQualityPanel from '../Toolbar/MapQualityPanel';
import AIAssistantPanel from './AIAssistantPanel';
import './index.less';

type WorkbenchTab = 'attr' | 'quality' | 'ai' | 'publish';

const tabs: { key: WorkbenchTab; label: string; desc: string; icon: React.ElementType }[] = [
    { key: 'attr', label: '属性', desc: '编辑选中对象', icon: MousePointer2 },
    { key: 'quality', label: '质检', desc: '定位地图问题', icon: ListChecks },
    { key: 'ai', label: 'AI诊断', desc: '解释修复建议', icon: Bot },
    { key: 'publish', label: '发布检查', desc: '确认能否发布', icon: ClipboardCheck },
];

export default function WorkbenchPanel() {
    const [activeTab, setActiveTab] = useState<WorkbenchTab>('attr');
    const [mapState] = useManagerStore((state) => [state.mapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const selectedCount = mapState.currentPickElement?.length || 0;
    const publishBlocked = report.summary.errors > 0;
    const publishWarning = !publishBlocked && report.summary.warnings > 0;
    let publishStatusClass = 'ready';
    let publishTitle = '可以发布';
    let publishDescription = '当前没有阻断发布的问题，可以保存后从顶部“生产”菜单发布。';
    let PublishIcon = CheckCircle2;

    if (publishBlocked) {
        publishStatusClass = 'blocked';
        publishTitle = '禁止发布';
        publishDescription = '请先处理红色错误。发布按钮仍会保留，但不建议绕过门禁。';
        PublishIcon = AlertCircle;
    } else if (publishWarning) {
        publishStatusClass = 'warning';
        publishTitle = '可以发布，需确认警告';
        publishDescription = '黄色警告不会阻断发布，但需要在仿真和实车前确认。';
        PublishIcon = AlertCircle;
    }
    const selectionSubtitle =
        selectedCount > 0
            ? `已选中 ${selectedCount} 个对象，右侧显示可编辑属性。`
            : '未选中对象，先在画布或左侧工具开始。';
    let publishBadgeVariant: 'outline' | 'secondary' | 'destructive' = 'outline';
    if (publishBlocked) {
        publishBadgeVariant = 'destructive';
    } else if (publishWarning) {
        publishBadgeVariant = 'secondary';
    }

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
                {activeTab === 'quality' && <MapQualityPanel embedded />}
                {activeTab === 'ai' && <AIAssistantPanel />}
                {activeTab === 'publish' && (
                    <div className="workbench-publish">
                        <div className={`publish-gate ${publishStatusClass}`}>
                            <PublishIcon />
                            <div>
                                <strong>{publishTitle}</strong>
                                <span>{publishDescription}</span>
                            </div>
                            <Badge variant={publishBadgeVariant}>
                                {`错误 ${report.summary.errors} / 警告 ${report.summary.warnings}`}
                            </Badge>
                        </div>
                        <div className="publish-metrics">
                            <div>
                                <span>车道</span>
                                <strong>{report.summary.lanes}</strong>
                            </div>
                            <div>
                                <span>连接</span>
                                <strong>{report.summary.laneEdges}</strong>
                            </div>
                            <div>
                                <span>拓扑区域</span>
                                <strong>{report.summary.laneComponents}</strong>
                            </div>
                        </div>
                        <div className="publish-next-actions">
                            <Button type="button" variant="secondary" onClick={() => setActiveTab('quality')}>
                                查看质检问题
                            </Button>
                            <span>发布入口在顶部“生产”菜单，避免检查页和发布动作重复。</span>
                        </div>
                        <p className="workbench-note">
                            发布前先保存标注，再清理红色错误；只剩黄色警告时，发布后进入仿真确认。
                        </p>
                    </div>
                )}
            </div>
        </aside>
    );
}
