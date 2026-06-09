import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, message } from 'antd';
import { useManagerStore } from 'src/store';
import { inspectMapQuality, MapQualityIssue, MapQualityReport } from 'src/quality/mapQuality';
import FileService from 'src/service/index';

type ChatRole = 'assistant' | 'user';

interface ChatMessage {
    id: string;
    role: ChatRole;
    content: string;
    provider?: string;
}

interface AssistantStatus {
    provider?: string;
    configured?: boolean;
    model?: string;
    degraded?: boolean;
}

const elementTypeLabel: Record<string, string> = {
    1: '车道点',
    7: '车道边界',
    13: '弯道边界',
    14: '车道面',
    18: '弯道面',
    24: '交通灯',
    31: '标志',
    34: '道路边界',
};

const objectTypeLabel: Record<string, string> = {
    1: '点',
    2: '边界',
    3: '宽线',
    4: '面',
    5: '方向箭头',
    6: '交通灯',
    7: '控制点',
    8: '标志',
};

const starterPrompts = [
    '先看当前地图最影响发布的问题',
    '这些质检警告哪些必须处理',
    '前驱/后继警告怎么判断',
    '转弯半径小和车道偏窄怎么修',
];

function createMessage(role: ChatRole, content: string, provider?: string): ChatMessage {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role,
        content,
        provider,
    };
}

function findLaneForSelection(mapState: any, selected: any) {
    const lanes = Object.values(mapState.lanes || {}) as any[];
    return lanes.find(
        (lane) =>
            String(lane.id) === String(selected.id) ||
            String(lane.groudId) === String(selected.id) ||
            String(lane.leftBoundaryId) === String(selected.id) ||
            String(lane.rightBoundaryId) === String(selected.id),
    );
}

function issueTouchesSelection(issue: MapQualityIssue, selected: any[]) {
    const { target } = issue;
    if (!target) {
        return false;
    }
    return selected.some((item) => {
        const selectedId = String(item.id);
        return (
            String(target.id || '') === selectedId ||
            String(target.groudId || '') === selectedId ||
            (target.boundaryIds || []).some((id) => String(id) === selectedId) ||
            (target.pointIds || []).some((id) => String(id) === selectedId)
        );
    });
}

function buildPublishGate(report: MapQualityReport) {
    if (report.summary.errors > 0) {
        return {
            status: 'blocked',
            title: '禁止发布',
            reason: `仍有 ${report.summary.errors} 个红色错误需要先处理`,
        };
    }
    if (report.summary.warnings > 0) {
        return {
            status: 'warning',
            title: '可发布但需确认',
            reason: `剩余 ${report.summary.warnings} 个黄色警告，建议边缘设备验证`,
        };
    }
    return {
        status: 'ready',
        title: '可以发布',
        reason: '当前质检没有发现阻断项',
    };
}

function compactIssue(issue: MapQualityIssue) {
    return {
        id: issue.id,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        suggestion: issue.suggestion,
        details: issue.details || [],
        target: issue.target,
    };
}

function getIssueCategory(issue: MapQualityIssue) {
    const text = `${issue.id} ${issue.title} ${issue.description} ${issue.suggestion}`;
    if (text.includes('没有前驱') || text.includes('疑似缺少前驱')) return '入口/前驱';
    if (text.includes('没有后继') || text.includes('疑似缺少后继')) return '出口/后继';
    if (text.includes('转弯半径')) return '转弯半径';
    if (text.includes('偏窄') || text.includes('宽度')) return '车道宽度';
    if (text.includes('疑似断点') || text.includes('孤立') || text.includes('拓扑')) return '拓扑断点';
    if (text.includes('方向突变') || text.includes('方向断裂')) return '方向连续性';
    return issue.severity === 'error' ? '发布阻断' : '人工确认';
}

function getIssueAction(issue: MapQualityIssue) {
    const category = getIssueCategory(issue);
    if (category === '入口/前驱') {
        return '系统已找到近距离同向候选前驱；确认它是否属于上一段路线，是就智能修复或手动连接。';
    }
    if (category === '出口/后继') {
        return '系统已找到近距离同向候选后继；确认它是否属于下一段路线，是就智能修复或手动连接。';
    }
    if (category === '转弯半径') {
        return '拉开端点或重建弯道；低速场景可降限速后在 Dreamview 里验证不压线、不抖动。';
    }
    if (category === '车道宽度') {
        return '加宽左右边界或重建连接段；常规车道建议最窄处不低于 2.6m。';
    }
    if (category === '拓扑断点') {
        return '定位两个端点，确认是否同一路线；是就用直道或弯道连接补齐。';
    }
    if (category === '方向连续性') {
        return '用单独弯道连接段替代硬连接，或调整端点方向让航向变化更平顺。';
    }
    return issue.suggestion || '先定位问题对象，按红色错误优先、黄色警告确认的顺序处理。';
}

function buildIssueGuidance(issues: MapQualityIssue[]) {
    return issues.slice(0, 16).map((issue) => ({
        issueId: issue.id,
        severity: issue.severity,
        title: issue.title,
        category: getIssueCategory(issue),
        action: getIssueAction(issue),
    }));
}

function buildAssistantContext(mapState: any, report: MapQualityReport) {
    const selected = (mapState.currentPickElement || []).slice(0, 12);
    const selectedElements = selected.map((item: any) => {
        const lane = findLaneForSelection(mapState, item);
        let laneContext;
        if (lane) {
            const relation = report.laneRelations?.[lane.id];
            laneContext = {
                id: lane.id,
                speed: lane.attr?.speed,
                direction: lane.attr?.direction,
                possibleDirection: lane.attr?.prossibleDrivingDirection,
                trend: lane.type,
                width: lane.width,
                leftBoundaryId: lane.leftBoundaryId,
                rightBoundaryId: lane.rightBoundaryId,
                predecessors: relation?.predecessors || [],
                successors: relation?.successors || [],
                leftNeighbors: relation?.leftNeighbors || [],
                rightNeighbors: relation?.rightNeighbors || [],
            };
        }
        return {
            id: item.id,
            type: elementTypeLabel[String(item.type)] || String(item.type),
            threeObject: objectTypeLabel[String(item.threeObject)] || String(item.threeObject),
            lane: laneContext,
        };
    });

    return {
        mapName: mapState.hdMapFile || '',
        currentOperation: String(mapState.operationType || ''),
        publishGate: buildPublishGate(report),
        summary: report.summary,
        elementCounts: {
            points: Object.keys(mapState.points || {}).length,
            boundaries: Object.keys(mapState.boundarys || {}).length,
            grouds: Object.keys(mapState.grouds || {}).length,
            lanes: Object.keys(mapState.lanes || {}).length,
            trafficSignals: Object.keys(mapState.trafficSignals || {}).length,
            stopLines: Object.keys(mapState.stopLines || {}).length,
            signs: Object.keys(mapState.signs || {}).length,
        },
        selectedElements,
        selectedIssues: report.issues.filter((issue) => issueTouchesSelection(issue, selected)).map(compactIssue),
        topIssues: report.issues.slice(0, 24).map(compactIssue),
        issueGuidance: buildIssueGuidance(report.issues),
    };
}

export default function AIAssistantPanel() {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<AssistantStatus | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([
        createMessage(
            'assistant',
            '我会读取当前地图、选中对象、质检报告和发布门禁，优先帮你定位发布阻断、车辆过不去、弯道半径、断点和拓扑问题。',
            'local',
        ),
    ]);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [mapState] = useManagerStore((state) => [state.mapState]);
    const report = useMemo(() => inspectMapQuality(mapState), [mapState]);
    const publishGate = useMemo(() => buildPublishGate(report), [report]);
    const selectedCount = mapState.currentPickElement?.length || 0;
    const selectedIssues = useMemo(
        () => report.issues.filter((issue) => issueTouchesSelection(issue, mapState.currentPickElement || [])),
        [report, mapState.currentPickElement],
    );
    const primaryIssue = selectedIssues[0] || report.issues[0];
    const primaryIssueMeta = primaryIssue
        ? `${getIssueCategory(primaryIssue)} · ${primaryIssue.severity === 'error' ? '错误' : '警告'}`
        : '';

    useEffect(() => {
        FileService.getAIAssistantStatus()
            .then((response: any) => {
                if (response?.code === 0) {
                    setStatus(response.data);
                }
            })
            .catch(() => {
                setStatus({ provider: 'local', configured: false });
            });
    }, []);

    useEffect(() => {
        bodyRef.current?.scrollTo({
            top: bodyRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [messages, loading]);

    const ask = async (question: string) => {
        const normalizedQuestion = question.trim();
        if (!normalizedQuestion || loading) {
            return;
        }
        setInput('');
        setLoading(true);
        setMessages((items) => [...items, createMessage('user', normalizedQuestion)]);
        try {
            const response = await FileService.askMapAssistant({
                question: normalizedQuestion,
                context: buildAssistantContext(mapState, report),
            });
            if (response?.code !== 0) {
                throw new Error(response?.message || 'AI 助手请求失败');
            }
            const data = response.data || {};
            if (data.degraded) {
                setStatus((current) => ({ ...(current || {}), degraded: true }));
            }
            setMessages((items) => [
                ...items,
                createMessage('assistant', data.answer || '没有拿到有效回复。', data.provider || 'local'),
            ]);
        } catch (error: any) {
            message.error(error?.message || 'AI 助手请求失败');
            setMessages((items) => [
                ...items,
                createMessage('assistant', `请求失败：${error?.message || '未知错误'}`, 'local'),
            ]);
        } finally {
            setLoading(false);
        }
    };

    const providerLabel = status?.configured
        ? `${status.provider === 'openai' ? 'OpenAI' : '本地'} ${status.model || ''}`.trim()
        : '本地诊断';
    let providerState = '无需配置可用';
    if (status?.degraded) {
        providerState = '外部 AI 兜底中';
    } else if (status?.configured) {
        providerState = '已接入';
    }

    return (
        <div className="ai-assistant-panel">
            <div className="ai-assistant-summary">
                <div>
                    <span>错误</span>
                    <strong className={report.summary.errors > 0 ? 'danger' : ''}>{report.summary.errors}</strong>
                </div>
                <div>
                    <span>警告</span>
                    <strong className={report.summary.warnings > 0 ? 'warning' : ''}>{report.summary.warnings}</strong>
                </div>
                <div>
                    <span>车道</span>
                    <strong>{report.summary.lanes}</strong>
                </div>
            </div>

            <div className={`ai-assistant-gate ${publishGate.status}`}>
                <strong>{publishGate.title}</strong>
                <span>{publishGate.reason}</span>
            </div>

            <div className="ai-assistant-status">
                <span>{providerLabel}</span>
                <span>{`${providerState} / 已选 ${selectedCount} 个对象`}</span>
            </div>

            <div className="ai-assistant-prompts">
                {starterPrompts.map((prompt) => (
                    <button type="button" key={prompt} onClick={() => ask(prompt)} disabled={loading}>
                        {prompt}
                    </button>
                ))}
            </div>

            {primaryIssue && (
                <div className="ai-assistant-insight">
                    <span>{primaryIssueMeta}</span>
                    <strong>{primaryIssue.title}</strong>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => ask(`解释这个质检问题并给出处理步骤：${primaryIssue.title}`)}
                    >
                        追问处理步骤
                    </button>
                </div>
            )}

            <div className="ai-assistant-messages" ref={bodyRef}>
                {messages.map((item) => (
                    <div className={`ai-message ${item.role}`} key={item.id}>
                        <div className="ai-message-meta">
                            <span>{item.role === 'user' ? '你' : 'AI 助手'}</span>
                            {item.provider && <em>{item.provider}</em>}
                        </div>
                        <pre>{item.content}</pre>
                    </div>
                ))}
                {loading && (
                    <div className="ai-message assistant">
                        <div className="ai-message-meta">
                            <span>AI 助手</span>
                        </div>
                        <pre>正在结合当前地图、选中对象和质检结果分析...</pre>
                    </div>
                )}
            </div>

            <div className="ai-assistant-input">
                <Input.TextArea
                    value={input}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder="例如：这两个断点为什么连不上？当前地图还能发布吗？"
                    onChange={(event) => setInput(event.target.value)}
                    onPressEnter={(event) => {
                        if (!event.shiftKey) {
                            event.preventDefault();
                            ask(input);
                        }
                    }}
                />
                <Button type="primary" loading={loading} onClick={() => ask(input)}>
                    发送
                </Button>
            </div>
        </div>
    );
}
