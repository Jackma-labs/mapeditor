import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, ListChecks, MousePointer2, Route, Sparkles } from 'lucide-react';
import { Badge } from 'src/components/ui/badge';
import { Button } from 'src/components/ui/button';
import { OperationType, PickElementInfo, ThreeElementType } from 'src/interface/commonInterFace';
import { MapQualityIssue, MapQualityReport, inspectMapQuality } from 'src/quality/mapQuality';
import { useManagerStore } from 'src/store';

type GuideTargetTab = 'attr' | 'quality' | 'ai' | 'publish';
type GuideStatus = 'done' | 'active' | 'warning' | 'blocked' | 'idle';

interface AnnotationGuidePanelProps {
    onOpenTab: (tab: GuideTargetTab) => void;
}

interface GuideStep {
    label: string;
    status: GuideStatus;
    detail: string;
    action?: string;
    tab?: GuideTargetTab;
}

const pickTypeLabels: Partial<Record<ThreeElementType, string>> = {
    [ThreeElementType.LaneGroud]: '直道',
    [ThreeElementType.LaneCurveGroud]: '弯道',
    [ThreeElementType.LaneBoundary]: '车道边界',
    [ThreeElementType.LaneCurveBoundary]: '弯道边界',
    [ThreeElementType.RoadBoundary]: '道路边界',
    [ThreeElementType.JunctionGroud]: '路口',
    [ThreeElementType.TrafficLight]: '交通灯',
    [ThreeElementType.StopLineBoundary]: '停止线',
    [ThreeElementType.ParkingSpaceGroud]: '车位',
    [ThreeElementType.AreaGroud]: '区域',
    [ThreeElementType.BarrierGateGroud]: '道闸',
};

const operationLabels: Partial<Record<OperationType, string>> = {
    [OperationType.Drawing]: '绘制中',
    [OperationType.Draging]: '拖动中',
    [OperationType.Rotating]: '旋转中',
    [OperationType.SplitLaneInVertical]: '垂直拆分车道',
    [OperationType.CopyLane]: '沿车道增加车道',
    [OperationType.CopyParkingSpace]: '复制车位',
    [OperationType.InsertPointToBoundary]: '边界插点',
};

function getIssuePriority(issue: MapQualityIssue) {
    return issue.severity === 'error' ? 0 : 1;
}

function getIssueCategory(issue: MapQualityIssue) {
    const text = `${issue.id} ${issue.title} ${issue.description} ${issue.suggestion}`;
    if (text.includes('前驱')) return '前驱关系';
    if (text.includes('后继')) return '后继关系';
    if (text.includes('拓扑') || text.includes('断点') || text.includes('孤立')) return '拓扑连接';
    if (text.includes('宽度') || text.includes('偏窄')) return '车道宽度';
    if (text.includes('转弯半径')) return '转弯半径';
    if (text.includes('限速')) return '限速';
    if (text.includes('方向')) return '方向';
    return issue.severity === 'error' ? '发布阻塞' : '人工确认';
}

function formatSelection(items: PickElementInfo[]) {
    if (!items || items.length === 0) {
        return {
            title: '未选中对象',
            detail: '先从左侧工具绘制，或在画布上选中一个车道、边界、路口对象。',
        };
    }
    const labels = items.slice(0, 4).map((item) => `${pickTypeLabels[item.type] || '对象'} ${item.id}`);
    return {
        title: `已选中 ${items.length} 个对象`,
        detail: labels.join('、') + (items.length > labels.length ? ` 等 ${items.length} 个` : ''),
    };
}

function getSelectionPlaybook(items: PickElementInfo[]) {
    if (!items || items.length === 0) {
        return [
            '画车道时先确认左侧图层处于“标注车道”模式，避免误选交通设施。',
            '先完成主路直道，再补弯道、路口和交通控制对象。',
            '每完成一段连续路线就跑一次质检，不要等全部画完再查断点。',
        ];
    }
    const laneCount = items.filter(
        (item) => item.type === ThreeElementType.LaneGroud || item.type === ThreeElementType.LaneCurveGroud,
    ).length;
    const boundaryCount = items.filter(
        (item) =>
            item.type === ThreeElementType.LaneBoundary ||
            item.type === ThreeElementType.LaneCurveBoundary ||
            item.type === ThreeElementType.RoadBoundary,
    ).length;
    if (laneCount === 1 && items.length === 1) {
        return [
            '右侧属性里确认限速、方向、车道类型和左右边界。',
            '检查“拓扑关系”里的前驱/后继，缺失但不是入口/出口时要补连接。',
            '需要扩展车道时用下方“增加车道”，不要手工复制散点。',
        ];
    }
    if (laneCount >= 2) {
        return [
            '两段车道首尾相接时优先用“直道连接”或“弯道连接”。',
            '连接后立即打开质检，看是否仍有方向突变、孤立段或断点。',
            '如果合并按钮不可用，通常是车道类型不同、弯道不能合并或边界已被多段共享。',
        ];
    }
    if (boundaryCount > 0) {
        return [
            '车道边界可切换实线/虚线，道路边界用于边界关联。',
            '需要调整几何时优先插点再拖动，避免直接拉出尖角。',
            '车道边界关联道路边界前，确认该车道边界只属于一条车道。',
        ];
    }
    return [
        '先在属性页确认对象必填字段。',
        '和车道、停止线、路口有关的对象补完后跑质检。',
        '不确定修法时打开 AI 诊断，让它基于当前选中对象解释。',
    ];
}

function getBaseLaneStatus(hasLane: boolean, hasBaseMap: boolean): GuideStatus {
    if (hasLane) {
        return 'done';
    }
    return hasBaseMap ? 'active' : 'idle';
}

function getTopologyStatus(hasLane: boolean, topologyBlocked: boolean): GuideStatus {
    if (topologyBlocked) {
        return 'blocked';
    }
    return hasLane ? 'done' : 'idle';
}

function getTopologyDetail(report: MapQualityReport, hasLane: boolean, topologyBlocked: boolean) {
    if (topologyBlocked) {
        return `当前有 ${report.summary.laneComponents} 个拓扑区域，发布前需要确认是否都是合法入口/出口。`;
    }
    if (hasLane) {
        return '车道拓扑未发现明显分裂。';
    }
    return '待车道完成后检查前驱/后继。';
}

function getQualityStatus(report: MapQualityReport, hasLane: boolean): GuideStatus {
    if (report.summary.errors > 0) {
        return 'blocked';
    }
    if (report.summary.warnings > 0) {
        return 'warning';
    }
    return hasLane ? 'done' : 'idle';
}

function getQualityDetail(report: MapQualityReport, hasLane: boolean) {
    if (report.summary.errors > 0) {
        return `${report.summary.errors} 个红色错误会阻塞发布。`;
    }
    if (report.summary.warnings > 0) {
        return `${report.summary.warnings} 个黄色警告需要人工确认。`;
    }
    if (hasLane) {
        return '当前没有阻塞发布的问题。';
    }
    return '待标注完成后运行质检。';
}

function getPublishStatus(report: MapQualityReport, hasLane: boolean): GuideStatus {
    if (report.summary.errors > 0) {
        return 'blocked';
    }
    return hasLane ? 'active' : 'idle';
}

function getPublishDetail(report: MapQualityReport) {
    if (report.summary.errors > 0) {
        return '先清理红色错误，再生成发布包。';
    }
    return '保存标注后，从发布检查确认地图包。';
}

function buildGuideSteps(report: MapQualityReport, hasBaseMap: boolean): GuideStep[] {
    const hasLane = report.summary.lanes > 0;
    const topologyBlocked = hasLane && report.summary.lanes > 1 && report.summary.laneComponents > 1;
    const hasIssue = report.issues.length > 0;
    return [
        {
            label: '底图与采图资产',
            status: hasBaseMap ? 'done' : 'active',
            detail: hasBaseMap ? '底图已加载，可以开始标注。' : '先导入底图或地图包，否则后续质量检查缺少参照。',
            action: hasBaseMap ? undefined : '打开文件菜单',
        },
        {
            label: '基础车道',
            status: getBaseLaneStatus(hasLane, hasBaseMap),
            detail: hasLane ? `已有 ${report.summary.lanes} 条车道。` : '从主路线开始画直道，再补弯道。',
            action: hasLane ? undefined : '去标注属性',
            tab: 'attr',
        },
        {
            label: '拓扑连通',
            status: getTopologyStatus(hasLane, topologyBlocked),
            detail: getTopologyDetail(report, hasLane, topologyBlocked),
            action: topologyBlocked ? '查看质检' : undefined,
            tab: topologyBlocked ? 'quality' : undefined,
        },
        {
            label: '地图质量门禁',
            status: getQualityStatus(report, hasLane),
            detail: getQualityDetail(report, hasLane),
            action: hasIssue ? '处理问题' : undefined,
            tab: hasIssue ? 'quality' : undefined,
        },
        {
            label: '发布与部署',
            status: getPublishStatus(report, hasLane),
            detail: getPublishDetail(report),
            action: '发布检查',
            tab: 'publish',
        },
    ];
}

function getPrimaryAction(report: MapQualityReport, hasBaseMap: boolean) {
    if (!hasBaseMap) {
        return {
            title: '先导入底图',
            detail: '没有底图时不建议继续做拓扑和发布判断。',
            tab: 'attr' as GuideTargetTab,
        };
    }
    if (report.summary.lanes === 0) {
        return {
            title: '开始标注车道',
            detail: '先把主路线画成连续车道，再补充路口和交通设施。',
            tab: 'attr' as GuideTargetTab,
        };
    }
    if (report.summary.errors > 0) {
        return {
            title: '处理红色错误',
            detail: '红色错误会阻塞发布，优先从质检列表第一项开始定位。',
            tab: 'quality' as GuideTargetTab,
        };
    }
    if (report.summary.warnings > 0) {
        return {
            title: '确认黄色警告',
            detail: '黄色警告不一定阻塞，但实车前必须确认是否合理。',
            tab: 'quality' as GuideTargetTab,
        };
    }
    return {
        title: '进入发布检查',
        detail: '当前地图质量门禁通过，下一步确认发布包和部署目标。',
        tab: 'publish' as GuideTargetTab,
    };
}

export default function AnnotationGuidePanel({ onOpenTab }: AnnotationGuidePanelProps) {
    const [mapState] = useManagerStore((state) => [state.mapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const prioritizedIssues = useMemo(
        () => [...report.issues].sort((left, right) => getIssuePriority(left) - getIssuePriority(right)).slice(0, 5),
        [report.issues],
    );
    const selection = formatSelection(mapState.currentPickElement || []);
    const playbook = getSelectionPlaybook(mapState.currentPickElement || []);
    const steps = buildGuideSteps(report, Boolean(mapState.baseMapDir));
    const primaryAction = getPrimaryAction(report, Boolean(mapState.baseMapDir));
    const completedCount = steps.filter((step) => step.status === 'done').length;
    const progress = Math.round((completedCount / steps.length) * 100);
    const operationLabel = mapState.operationType ? operationLabels[mapState.operationType] || '操作中' : '选择/编辑';

    return (
        <div className="annotation-guide-panel">
            <section className="annotation-hero">
                <div>
                    <span className="annotation-eyebrow">当前建议</span>
                    <h2>{primaryAction.title}</h2>
                    <p>{primaryAction.detail}</p>
                </div>
                <Button type="button" variant="secondary" onClick={() => onOpenTab(primaryAction.tab)}>
                    <MousePointer2 data-icon="inline-start" />
                    去处理
                </Button>
            </section>

            <section className="annotation-progress">
                <div className="annotation-progress-head">
                    <strong>生产进度</strong>
                    <span>{`${progress}%`}</span>
                </div>
                <div className="annotation-progress-track">
                    <span style={{ width: `${progress}%` }} />
                </div>
                <div className="annotation-metrics">
                    <div>
                        <span>车道</span>
                        <strong>{report.summary.lanes}</strong>
                    </div>
                    <div>
                        <span>错误</span>
                        <strong className={report.summary.errors > 0 ? 'danger' : ''}>{report.summary.errors}</strong>
                    </div>
                    <div>
                        <span>警告</span>
                        <strong className={report.summary.warnings > 0 ? 'warning' : ''}>
                            {report.summary.warnings}
                        </strong>
                    </div>
                </div>
            </section>

            <section className="annotation-section">
                <div className="annotation-section-title">
                    <ClipboardCheck />
                    <strong>交付检查</strong>
                </div>
                <div className="annotation-checklist">
                    {steps.map((step) => (
                        <button
                            type="button"
                            key={step.label}
                            className={`annotation-step ${step.status}`}
                            disabled={!step.tab}
                            onClick={() => step.tab && onOpenTab(step.tab)}
                        >
                            <span className="annotation-step-icon">
                                {step.status === 'done' ? <CheckCircle2 /> : <AlertCircle />}
                            </span>
                            <span className="annotation-step-main">
                                <strong>{step.label}</strong>
                                <em>{step.detail}</em>
                            </span>
                            {step.action && (
                                <Badge variant={step.status === 'blocked' ? 'destructive' : 'outline'}>
                                    {step.action}
                                </Badge>
                            )}
                        </button>
                    ))}
                </div>
            </section>

            <section className="annotation-section">
                <div className="annotation-section-title">
                    <Route />
                    <strong>当前选择</strong>
                    <Badge variant="secondary">{operationLabel}</Badge>
                </div>
                <div className="annotation-selection-card">
                    <strong>{selection.title}</strong>
                    <span>{selection.detail}</span>
                </div>
                <div className="annotation-playbook">
                    {playbook.map((item, index) => (
                        <div key={item}>
                            <span>{index + 1}</span>
                            <p>{item}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="annotation-section">
                <div className="annotation-section-title">
                    <ListChecks />
                    <strong>优先问题</strong>
                    {report.issues.length > 0 && <Badge variant="outline">{report.issues.length}</Badge>}
                </div>
                {prioritizedIssues.length === 0 ? (
                    <div className="annotation-empty">当前没有质检问题。继续保存并进入发布检查。</div>
                ) : (
                    <div className="annotation-issue-list">
                        {prioritizedIssues.map((issue) => (
                            <button type="button" key={issue.id} onClick={() => onOpenTab('quality')}>
                                <Badge variant={issue.severity === 'error' ? 'destructive' : 'secondary'}>
                                    {issue.severity === 'error' ? '错误' : '警告'}
                                </Badge>
                                <span>
                                    <strong>{issue.title}</strong>
                                    <em>{getIssueCategory(issue)}</em>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            <section className="annotation-quick-actions">
                <Button type="button" variant="outline" onClick={() => onOpenTab('attr')}>
                    <MousePointer2 data-icon="inline-start" />
                    属性
                </Button>
                <Button type="button" variant="outline" onClick={() => onOpenTab('quality')}>
                    <ListChecks data-icon="inline-start" />
                    质检
                </Button>
                <Button type="button" variant="outline" onClick={() => onOpenTab('ai')}>
                    <Sparkles data-icon="inline-start" />
                    诊断
                </Button>
            </section>
        </div>
    );
}
