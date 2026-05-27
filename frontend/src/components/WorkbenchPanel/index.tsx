import React, { useMemo, useState } from 'react';
import { useManagerStore } from 'src/store';
import { inspectMapQuality } from 'src/quality/mapQuality';
import Attr from '../Attr';
import MapQualityPanel from '../Toolbar/MapQualityPanel';
import AIAssistantPanel from './AIAssistantPanel';
import './index.less';

type WorkbenchTab = 'attr' | 'quality' | 'ai' | 'publish' | 'history';

const tabs: { key: WorkbenchTab; label: string }[] = [
    { key: 'attr', label: '属性' },
    { key: 'quality', label: '质检' },
    { key: 'ai', label: 'AI助手' },
    { key: 'publish', label: '发布' },
    { key: 'history', label: '历史' },
];

function PlaceholderPanel({ title, desc }: { title: string; desc: string }) {
    return (
        <div className="workbench-placeholder">
            <div className="workbench-placeholder-title">{title}</div>
            <p>{desc}</p>
        </div>
    );
}

export default function WorkbenchPanel() {
    const [activeTab, setActiveTab] = useState<WorkbenchTab>('attr');
    const [mapState] = useManagerStore((state) => [state.mapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const selectedCount = mapState.currentPickElement?.length || 0;
    const publishBlocked = report.summary.errors > 0;
    const publishWarning = !publishBlocked && report.summary.warnings > 0;
    let publishStatusClass = 'ready';
    let publishTitle = '可以发布';

    if (publishBlocked) {
        publishStatusClass = 'blocked';
        publishTitle = '禁止发布';
    } else if (publishWarning) {
        publishStatusClass = 'warning';
        publishTitle = '可以发布，需确认警告';
    }

    const stopPanelEvent = (event: React.MouseEvent) => {
        event.stopPropagation();
    };

    return (
        <aside className="workbench-panel" onClick={stopPanelEvent} onMouseUp={stopPanelEvent}>
            <div className="workbench-header">
                <div>
                    <div className="workbench-title">工作台</div>
                    <div className="workbench-subtitle">
                        {selectedCount > 0 ? `已选中 ${selectedCount} 个对象` : '未选中对象'}
                    </div>
                </div>
            </div>
            <div className="workbench-tabs">
                {tabs.map((tab) => (
                    <button
                        type="button"
                        key={tab.key}
                        className={activeTab === tab.key ? 'active' : ''}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="workbench-body">
                {activeTab === 'attr' && <Attr />}
                {activeTab === 'quality' && <MapQualityPanel embedded />}
                {activeTab === 'ai' && <AIAssistantPanel />}
                {activeTab === 'publish' && (
                    <div className="workbench-publish">
                        <div className={`publish-gate ${publishStatusClass}`}>
                            <strong>{publishTitle}</strong>
                            <span>{`错误 ${report.summary.errors} / 警告 ${report.summary.warnings}`}</span>
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
                        <p className="workbench-note">发布前先清理红色错误；只剩黄色警告时，可以发布并在仿真中确认。</p>
                    </div>
                )}
                {activeTab === 'history' && (
                    <PlaceholderPanel
                        title="任务历史"
                        desc="后续这里会汇总导入、构建、发布、部署和 AI 修复记录。当前阶段先保留入口，避免再增加浮窗。"
                    />
                )}
            </div>
        </aside>
    );
}
