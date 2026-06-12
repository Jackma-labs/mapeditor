import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PubSub from 'pubsub-js';
import {
    AlertTriangleIcon,
    CheckCircle2Icon,
    CloudUploadIcon,
    ExternalLinkIcon,
    HistoryIcon,
    InfoIcon,
    MapIcon,
    PencilIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    SaveIcon,
    SearchIcon,
    ServerIcon,
    ShieldCheckIcon,
    WifiIcon,
    XCircleIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from 'src/components/ui/alert';
import { Badge } from 'src/components/ui/badge';
import { Button } from 'src/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'src/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from 'src/components/ui/dialog';
import { Input } from 'src/components/ui/input';
import { Label } from 'src/components/ui/label';
import { ScrollArea } from 'src/components/ui/scroll-area';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from 'src/components/ui/select';
import { Separator } from 'src/components/ui/separator';
import { Switch } from 'src/components/ui/switch';
import { cn } from 'src/lib/utils';
import FileService from 'src/service/index';

interface EdgeDeployDialogProps {
    open: boolean;
    onCancel: () => void;
}

type StatusLevel = 'ok' | 'warning' | 'error' | 'idle';

type NoticeType = 'success' | 'warning' | 'error' | 'info';

type PreflightGroupKey = 'blocking' | 'confirm' | 'passed';

const DEVICE_CHECK_TIMEOUT_MS = 10000;

interface NoticeState {
    type: NoticeType;
    title: string;
    description?: ReactNode;
}

interface DeployValues {
    host: string;
    user: string;
    password: string;
    port: number;
    targetMapRoot: string;
    dockerContainer: string;
    nativeMapTools: boolean;
    autoSwitchDreamview: boolean;
    postDeployCommand: string;
    mapName: string;
}

const DEFAULT_VALUES: DeployValues = {
    host: '',
    user: 'apollo',
    password: '',
    port: 22,
    targetMapRoot: '/apollo/modules/map/data',
    dockerContainer: '',
    nativeMapTools: true,
    autoSwitchDreamview: true,
    postDeployCommand: '',
    mapName: '',
};

const sleep = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const getLatestJobMessage = (job: any) => {
    const logs = Array.isArray(job?.logs) ? job.logs : [];
    const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
    return latestLog?.message || job?.message || '';
};

const waitForRuntimeJob = async (
    jobId: string,
    label: string,
    onProgress?: (text: string) => void,
    attempt = 0,
): Promise<any> => {
    if (attempt >= 600) {
        throw new Error(`${label}等待超时`);
    }
    const response = await FileService.getRuntimeJob(jobId, true);
    if (response?.code !== 0) {
        throw new Error(response?.message || '读取后台任务失败');
    }
    const job = response?.data?.job;
    const latestMessage = getLatestJobMessage(job);
    onProgress?.(`${label}${latestMessage ? `：${latestMessage}` : `，状态：${job?.status || 'running'}`}`);
    if (job?.status === 'succeeded') {
        return job;
    }
    if (job?.status === 'failed') {
        throw new Error(job?.message || `${label}失败`);
    }
    await sleep(3000);
    return waitForRuntimeJob(jobId, label, onProgress, attempt + 1);
};

const normalizeStatus = (status: any): StatusLevel => {
    if (status === 'ok' || status === 'warning' || status === 'error') {
        return status;
    }
    return 'idle';
};

const statusRank: Record<StatusLevel, number> = {
    idle: 0,
    ok: 1,
    warning: 2,
    error: 3,
};

const combineStatus = (items: StatusLevel[]): StatusLevel => {
    if (items.length === 0) {
        return 'idle';
    }
    return items.reduce((current, next) => (statusRank[next] > statusRank[current] ? next : current), 'idle');
};

const getChecks = (preflight: any) => (Array.isArray(preflight?.checks) ? preflight.checks : []);

const getCheck = (preflight: any, name: string) => getChecks(preflight).find((item: any) => item.name === name);

const getCheckLevel = (preflight: any, name: string): StatusLevel => normalizeStatus(getCheck(preflight, name)?.status);

const formatModifiedTime = (value: string) => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
};

const formatMeters = (value: any) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '待预检';
    }
    return `${number.toFixed(number >= 10 ? 1 : 2)} m`;
};

const formatSeconds = (value: any) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '待验证';
    }
    return `${number.toFixed(3)} s`;
};

const formatDegrees = (value: any) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '待验证';
    }
    return `${((number * 180) / Math.PI).toFixed(2)} deg`;
};

const formatBoundsCenter = (bounds: any) => {
    if (!bounds || !Number.isFinite(Number(bounds.centerX)) || !Number.isFinite(Number(bounds.centerY))) {
        return '待预检';
    }
    return `${Number(bounds.centerX).toFixed(3)}, ${Number(bounds.centerY).toFixed(3)}`;
};

const getRoadReadinessLevel = (readiness: any): StatusLevel => {
    if (!readiness) {
        return 'idle';
    }
    if (readiness.ready && readiness.severity !== 'warning') {
        return 'ok';
    }
    if (readiness.ready || readiness.status === 'needs_confirmation') {
        return 'warning';
    }
    return 'error';
};

const getRoadReadinessText = (readiness: any) => {
    if (!readiness) {
        return '未验证';
    }
    if (readiness.status === 'ready') {
        return '可动车验证';
    }
    if (readiness.status === 'needs_confirmation') {
        return '需现场确认';
    }
    if (readiness.status === 'blocked') {
        return '禁止动车';
    }
    return '未验证';
};

const getRoadCheck = (readiness: any, id: string) => {
    if (!Array.isArray(readiness?.checks)) {
        return null;
    }
    return readiness.checks.find((item: any) => item.id === id) || null;
};

const getReleaseMapIssueLines = (map: any) => {
    const lines: string[] = [];
    if (map?.statusMessage) {
        lines.push(String(map.statusMessage));
    }
    const missingFiles = Array.isArray(map?.missingExpectedFiles) ? map.missingExpectedFiles : [];
    if (missingFiles.length > 0) {
        lines.push(`缺失文件：${missingFiles.slice(0, 8).join('、')}${missingFiles.length > 8 ? ' 等' : ''}`);
    }
    const conversionErrors = Array.isArray(map?.conversionErrors) ? map.conversionErrors : [];
    conversionErrors.slice(0, 3).forEach((item: any) => {
        lines.push(String(item?.message || item));
    });
    if (lines.length === 0) {
        lines.push('发布检查未通过，请重新执行发布检查。');
    }
    return lines;
};

const getOverviewStatusText = (status: StatusLevel, hasPreflight: boolean) => {
    if (!hasPreflight) {
        return '待预检';
    }
    if (status === 'ok') {
        return '可部署';
    }
    if (status === 'warning') {
        return '可部署，有警告';
    }
    return '不可部署';
};

const checkTitleMap: Record<string, string> = {
    'edge-mode': '部署模式',
    'edge-target': '目标设备',
    'edge-config-lock': '固定设备配置',
    'ssh-connectivity': 'SSH 连接',
    'host-upload-root': '上传目录',
    'target-map-root': '地图目录',
    'edge-docker-container': 'Docker 容器',
    'edge-runtime-status': '边缘运行状态',
    'edge-dreamview-switch': 'Dreamview 切换',
    'edge-dreamview-hmi': 'Dreamview 当前地图',
    'edge-dreamview-runtime-sync': 'Dreamview/运行时一致性',
    'selected-map-coordinates': '发布包坐标',
    'selected-map-edge-reference': '边缘参考地图',
    'selected-map-vehicle-pose': '车辆位置',
};

const getLocalizationIssueText = (item: any) => {
    const issueMessage = String(item?.message || '');
    if (item?.id === 'rtk-fix') {
        return issueMessage.includes('not available') ? 'RTK / INS fix 状态未读到' : issueMessage;
    }
    if (item?.id === 'pose-delay') {
        const rawDelay = item?.details?.sampleTimeSec
            ? Number(item?.details?.sampleTimeSec) - Number(item?.details?.measurementTimeSec)
            : null;
        const delayMatch = issueMessage.match(/([0-9.]+)s/);
        const delayText = delayMatch?.[1] || (Number.isFinite(rawDelay) ? rawDelay?.toFixed(3) : '');
        return delayText ? `定位延迟 ${delayText}s` : issueMessage;
    }
    if (item?.id === 'map-boundary') {
        return issueMessage.includes('outside') ? '当前车辆定位不在所选地图边界内' : issueMessage;
    }
    if (item?.id === 'nearest-lane-distance') {
        const distance = item?.details?.nearest?.distanceMeters;
        return `车辆离最近车道中心线 ${formatMeters(distance)}`;
    }
    if (item?.id === 'heading-stability') {
        return issueMessage.includes('drift')
            ? issueMessage.replace('Heading drift over recent localization samples is', '航向角抖动')
            : issueMessage;
    }
    return issueMessage || item?.id || '';
};

const getEdgeReferenceIssueText = (item: any) => {
    const details = item?.details || {};
    const trustedCount = Number(details.trustedReferencesChecked || 0);
    const legacyCount = Number(details.legacyReferencesChecked || 0);
    const totalCount = Number(details.referencesChecked || 0);
    const nearest = details.nearestTrustedReference || details.nearestReference || {};
    const nearestText = nearest?.mapName
        ? `最近参考 ${nearest.mapName}，距离 ${formatMeters(nearest.distanceMeters)}`
        : '';
    if (item?.status === 'ok') {
        return [`已找到 ${trustedCount} 个同坐标链路可信参考地图`, nearestText].filter(Boolean).join('；');
    }
    if (trustedCount === 0 && totalCount > 0) {
        return [
            `边缘设备上有 ${legacyCount || totalCount} 个旧参考地图，但没有同坐标链路可信参考`,
            nearestText,
            '这不阻断部署，系统按当前发布包的投影、坐标元数据和质检结果放行。',
        ]
            .filter(Boolean)
            .join('；');
    }
    if (trustedCount > 0) {
        return [
            '可信参考地图距离超过阈值，需要确认是否跨场地或新场地部署',
            nearestText,
            `阈值 ${formatMeters(details.maxDistanceMeters)}`,
        ]
            .filter(Boolean)
            .join('；');
    }
    return item?.message || '没有可用于对照的边缘参考地图，已按发布包自身坐标门禁放行。';
};

const getCheckDisplayMessage = (item: any) => {
    if (item?.name === 'selected-map-edge-reference') {
        return getEdgeReferenceIssueText(item);
    }
    if (item?.name === 'selected-map-vehicle-pose') {
        const details = item?.details || {};
        const distance = details?.nearest?.distanceMeters;
        const distanceText = Number.isFinite(Number(distance))
            ? `当前车辆离所选地图最近车道中心线 ${formatMeters(distance)}`
            : '';
        const gateChecks = Array.isArray(details?.localizationGate?.checks)
            ? details.localizationGate.checks.filter((check: any) => check.status !== 'ok')
            : [];
        const gateText = gateChecks.slice(0, 4).map(getLocalizationIssueText).filter(Boolean).join('；');
        const advisory =
            details.deploymentAdvisory || item.status === 'warning'
                ? '这不会阻断地图下发，但实车启用前必须确认定位链路正常。'
                : '';
        return [distanceText || item.message, gateText, advisory].filter(Boolean).join('；');
    }
    if (typeof item?.details === 'string' && item.details && !String(item.message || '').includes(item.details)) {
        return `${item.message}：${item.details}`;
    }
    return item?.message || item?.name || '';
};

const getPreflightIssues = (preflight: any, statuses: string[]) =>
    getChecks(preflight).filter((item: any) => statuses.includes(item.status));

const getPreflightGroup = (item: any): PreflightGroupKey => {
    if (item?.status === 'error') {
        return 'blocking';
    }
    if (item?.status === 'warning') {
        return 'confirm';
    }
    return 'passed';
};

const retryablePreflightChecks = new Set([
    'ssh-connectivity',
    'host-upload-root',
    'edge-docker-container',
    'edge-runtime-status',
    'edge-dreamview-switch',
    'edge-dreamview-hmi',
    'edge-dreamview-runtime-sync',
]);

const isRetryablePreflightCheck = (item: any) => {
    const message = `${item?.message || ''} ${item?.details || ''}`;
    return (
        retryablePreflightChecks.has(item?.name) ||
        /timed out|timeout|handshake|connection closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message)
    );
};

const getCheckStatusLabel = (item: any) => {
    if (item?.status === 'ok') {
        return '已通过';
    }
    if (item?.status === 'warning') {
        return item?.name === 'selected-map-vehicle-pose' ? '动态定位未验证' : '部署后确认';
    }
    return isRetryablePreflightCheck(item) ? '可重试' : '需处理';
};

const getPreflightNextAction = (item: any) => {
    switch (item?.name) {
        case 'edge-mode':
            return '先保存边缘设备配置，确认已启用 SSH 部署模式。';
        case 'edge-target':
            return '补齐设备 IP、SSH 用户、端口和密码后重新预检。';
        case 'edge-config-lock':
            return '不要继续部署到非固定设备。请恢复 Dell 的边缘设备 IP、SSH 用户、端口、Apollo 地图目录和容器配置。';
        case 'ssh-connectivity':
            return '先点“刷新状态”重试一次；连续失败再检查设备在线、SSH 账号和端口。';
        case 'host-upload-root':
            return '先点“刷新状态”重试；若仍失败，检查边缘设备 /tmp 写权限或 SSH 握手稳定性。';
        case 'target-map-root':
            return '确认 Apollo 地图目录存在且可写，必要时点“自动发现”。';
        case 'edge-docker-container':
            return '确认 Apollo 容器正在运行；如果不用容器，就清空 Docker 容器名。';
        case 'edge-runtime-status':
            return '先重试刷新；连续失败时检查边缘设备上的 Dreamview/Apollo runtime 状态。';
        case 'edge-dreamview-switch':
        case 'edge-dreamview-hmi':
        case 'edge-dreamview-runtime-sync':
            return '部署文件可以先排查，启用前需要确认 Dreamview 当前地图和 runtime 加载地图一致。';
        case 'selected-map-coordinates':
            return '回到发布检查，修复投影元数据、轨迹中心或坐标质量门控后重新生成发布包。';
        case 'selected-map-edge-reference':
            return '确认这是同一场地或首次部署新场地；必要时先部署一份可信参考地图。';
        case 'selected-map-vehicle-pose':
            return '地图可继续下发，但实车启用前必须确认 RTK/定位链路正常。';
        default:
            return '按检查明细处理后，点击“刷新状态”重新预检。';
    }
};

const buildPreflightFailureDescription = (items: any[], fallback: ReactNode) => {
    if (items.length === 0) {
        return fallback || '预检未通过。请刷新状态后重试；如果仍失败，检查边缘设备配置和发布包状态。';
    }
    return (
        <div className="flex flex-col gap-3">
            <div>系统没有崩溃，部署已被预检拦截。请先处理下面的阻断项。</div>
            <div className="flex flex-col gap-2">
                {items.slice(0, 4).map((item: any) => {
                    const retryable = isRetryablePreflightCheck(item);
                    return (
                        <div key={item.name} className="rounded-md border border-border bg-background/65 p-2">
                            <div className="flex items-center justify-between gap-2">
                                <strong className="truncate text-sm">{checkTitleMap[item.name] || item.name}</strong>
                                <Badge variant={retryable ? 'outline' : 'destructive'}>
                                    {retryable ? '可重试' : '需处理'}
                                </Badge>
                            </div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                {getCheckDisplayMessage(item)}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-foreground">
                                <span>下一步：</span>
                                <span>{getPreflightNextAction(item)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            {items.length > 4 ? (
                <div className="text-xs text-muted-foreground">
                    <span>还有 </span>
                    <span>{items.length - 4}</span>
                    <span> 个阻断项，请在预检列表中查看。</span>
                </div>
            ) : null}
        </div>
    );
};

const buildOperationFailureDescription = (message: ReactNode, nextAction: ReactNode) => (
    <div className="flex flex-col gap-2">
        <div>{message || '操作失败。'}</div>
        <div className="text-xs leading-5 text-muted-foreground">
            是否可重试：如果不是账号、目录或发布包质量问题，可以先点“刷新状态”再重试一次。
        </div>
        <div className="text-xs leading-5 text-foreground">
            <span>下一步：</span>
            <span>{nextAction}</span>
        </div>
    </div>
);

const statusDotClass: Record<StatusLevel, string> = {
    ok: 'bg-[var(--landing-success)] shadow-[0_0_0_4px_rgba(34,197,94,0.14)]',
    warning: 'bg-[var(--landing-warning)] shadow-[0_0_0_4px_rgba(245,158,11,0.14)]',
    error: 'bg-destructive shadow-[0_0_0_4px_rgba(239,68,68,0.14)]',
    idle: 'bg-muted-foreground/45',
};

const statusTextMap: Record<StatusLevel, string> = {
    ok: '正常',
    warning: '需关注',
    error: '异常',
    idle: '未检查',
};

function StatusLight({ level, label, value }: { level: StatusLevel; label: string; value?: string }) {
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
            <span className={cn('size-2.5 shrink-0 rounded-full', statusDotClass[level])} />
            <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{label}</div>
                <div className="truncate text-sm font-medium text-foreground">{value || statusTextMap[level]}</div>
            </div>
        </div>
    );
}

function NoticeAlert({ notice, onClear }: { notice: NoticeState; onClear: () => void }) {
    let Icon = InfoIcon;
    if (notice.type === 'error') {
        Icon = XCircleIcon;
    } else if (notice.type === 'warning') {
        Icon = AlertTriangleIcon;
    }
    return (
        <Alert
            variant={notice.type === 'error' ? 'destructive' : 'default'}
            className={cn(
                'border-border bg-card',
                notice.type === 'success' && 'border-[rgba(34,197,94,0.45)]',
                notice.type === 'warning' && 'border-[rgba(245,158,11,0.5)]',
            )}
        >
            <Icon />
            <AlertTitle className="flex items-center justify-between gap-3">
                <span>{notice.title}</span>
                <Button type="button" variant="ghost" size="xs" onClick={onClear}>
                    关闭
                </Button>
            </AlertTitle>
            {notice.description ? <AlertDescription>{notice.description}</AlertDescription> : null}
        </Alert>
    );
}

function FieldBlock({
    label,
    htmlFor,
    children,
    hint,
}: {
    label: string;
    htmlFor?: string;
    children: ReactNode;
    hint?: string;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {hint ? <div className="text-xs leading-5 text-muted-foreground">{hint}</div> : null}
        </div>
    );
}

function InfoPair({ label, value, wrap = false }: { label: string; value: ReactNode; wrap?: boolean }) {
    return (
        <div className="min-w-0 rounded-lg border border-border bg-muted/25 px-3 py-2">
            <div className="truncate text-xs text-muted-foreground">{label}</div>
            <div
                className={cn('mt-1 text-sm font-medium text-foreground', wrap ? 'break-words leading-5' : 'truncate')}
            >
                {value || '-'}
            </div>
        </div>
    );
}

function PreflightCheckRow({ item, group }: { item: any; group: PreflightGroupKey }) {
    const level = normalizeStatus(item.status);
    const isBlocking = group === 'blocking';
    const label = getCheckStatusLabel(item);
    return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <span className={cn('mt-1 size-2.5 rounded-full', statusDotClass[level])} />
            <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <strong className="min-w-0 truncate text-sm text-foreground">
                        {checkTitleMap[item.name] || item.name}
                    </strong>
                    <Badge variant={level === 'error' ? 'destructive' : 'outline'} className="shrink-0">
                        {label}
                    </Badge>
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    <span>{isBlocking ? '失败原因：' : '检查结果：'}</span>
                    <span>{getCheckDisplayMessage(item)}</span>
                </div>
                {isBlocking || group === 'confirm' ? (
                    <div className="mt-1 text-xs leading-5 text-foreground">
                        <span>{isBlocking ? '下一步：' : '现场确认：'}</span>
                        <span>{getPreflightNextAction(item)}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function PreflightGroup({
    title,
    description,
    items,
    group,
    defaultOpen,
    emptyText,
}: {
    title: string;
    description: string;
    items: any[];
    group: PreflightGroupKey;
    defaultOpen: boolean;
    emptyText: string;
}) {
    return (
        <details className="rounded-lg border border-border bg-card" open={defaultOpen}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                    <strong className="block truncate text-sm text-foreground">{title}</strong>
                    <span className="block truncate text-xs text-muted-foreground">{description}</span>
                </span>
                <Badge variant={group === 'blocking' && items.length > 0 ? 'destructive' : 'outline'}>
                    {items.length}
                </Badge>
            </summary>
            <div className="flex flex-col gap-2 border-t border-border p-2">
                {items.length > 0 ? (
                    items.map((item: any) => <PreflightCheckRow key={item.name} item={item} group={group} />)
                ) : (
                    <div className="rounded-lg bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                        {emptyText}
                    </div>
                )}
            </div>
        </details>
    );
}

const buildDeploymentVerification = (job: any, fallbackMapName: string) => {
    const result = job?.result || {};
    const deployment = result.deployment || {};
    const verification =
        result.postDeployVerification ||
        deployment.postDeployVerification ||
        result.dreamviewSwitchResult?.verification ||
        deployment.dreamviewSwitch?.verification ||
        {};
    return {
        jobId: job?.id || '',
        expectedMapName: verification.expectedMapName || deployment.mapName || result.mapName || fallbackMapName,
        expectedMapDir:
            verification.expectedMapDir ||
            verification.resolvedMapDir ||
            verification.flagMapDir ||
            deployment.remoteMapDir ||
            result.remoteMapDir ||
            '',
        runtimeMapName: verification.runtimeMapName || '',
        hmiCurrentMap: verification.hmiCurrentMap || '',
        flagMapDir: verification.flagMapDir || '',
        resolvedMapDir: verification.resolvedMapDir || deployment.remoteMapDir || result.remoteMapDir || '',
        remoteMapDir: deployment.remoteMapDir || result.remoteMapDir || verification.expectedMapDir || '',
        runtimeMatches: verification.runtimeMatches,
        hmiMatches: verification.hmiMatches,
        passed: Boolean(verification.passed),
        skipped: Boolean(verification.skipped),
        verifiedAt: new Date().toISOString(),
    };
};

export default function EdgeDeployDialog({ open, onCancel }: EdgeDeployDialogProps) {
    const [values, setValues] = useState<DeployValues>(DEFAULT_VALUES);
    const [deployConfig, setDeployConfig] = useState<any>(null);
    const [editingDevice, setEditingDevice] = useState(false);
    const [loading, setLoading] = useState(false);
    const [preflight, setPreflight] = useState<any>(null);
    const [jobText, setJobText] = useState('');
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const [releasedMaps, setReleasedMaps] = useState<any[]>([]);
    const [deploymentRecords, setDeploymentRecords] = useState<any[]>([]);
    const [rollbackCandidate, setRollbackCandidate] = useState<any>(null);
    const [runtimeDoctor, setRuntimeDoctor] = useState<any>(null);
    const [lastDeployVerification, setLastDeployVerification] = useState<any>(null);
    const [lastCheckedAt, setLastCheckedAt] = useState('');
    const [checkingDevice, setCheckingDevice] = useState(false);
    const [deviceCheckTimedOut, setDeviceCheckTimedOut] = useState(false);
    const autoPreflightInFlightRef = useRef(false);

    const updateValue = useCallback(<K extends keyof DeployValues>(key: K, value: DeployValues[K]) => {
        setValues((current) => ({
            ...current,
            [key]: value,
        }));
        if (key !== 'mapName') {
            setPreflight(null);
        }
    }, []);

    const resolveDefaultMapName = useCallback(
        (maps: any[]) => {
            const current = values.mapName;
            if (maps.some((item: any) => item.selectable && item.ready && item.mapName === current)) {
                return current;
            }
            const readyMapName = maps.find((item: any) => item.selectable && item.ready)?.mapName;
            return readyMapName || '';
        },
        [values.mapName],
    );

    const selectedMap = useMemo(
        () => releasedMaps.find((item: any) => item.mapName === values.mapName) || null,
        [releasedMaps, values.mapName],
    );
    const selectableMaps = useMemo(() => releasedMaps.filter((item: any) => item.selectable), [releasedMaps]);
    const readyMaps = useMemo(() => selectableMaps.filter((item: any) => item.ready), [selectableMaps]);
    const nonReadyMaps = useMemo(() => selectableMaps.filter((item: any) => !item.ready), [selectableMaps]);
    const preflightChecks = useMemo(() => getChecks(preflight), [preflight]);
    const runtimeCheck = useMemo(() => getCheck(preflight, 'edge-runtime-status'), [preflight]);
    const dreamviewCheck = useMemo(() => getCheck(preflight, 'edge-dreamview-hmi'), [preflight]);
    const coordinateCheck = useMemo(() => getCheck(preflight, 'selected-map-coordinates'), [preflight]);
    const vehiclePoseCheck = useMemo(() => getCheck(preflight, 'selected-map-vehicle-pose'), [preflight]);
    const runtimeDetails = runtimeCheck?.details || null;
    const vehiclePoseDetails = vehiclePoseCheck?.details || coordinateCheck?.details?.vehiclePoseValidation || null;
    const roadReadiness = preflight?.roadReadiness || preflight?.readiness?.road || null;
    const roadPose = roadReadiness?.pose || vehiclePoseDetails?.pose || null;
    const roadNearest = roadReadiness?.nearest || vehiclePoseDetails?.nearest || null;
    const roadPoseDelayCheck = getRoadCheck(roadReadiness, 'pose-delay');
    const roadRtkCheck = getRoadCheck(roadReadiness, 'rtk-fix');
    const roadHeadingCheck = getRoadCheck(roadReadiness, 'heading-stability');
    const roadBoundaryCheck = getRoadCheck(roadReadiness, 'map-boundary');
    const roadPoseDelayValue = Number.isFinite(Number(roadPose?.delaySeconds))
        ? roadPose.delaySeconds
        : roadPoseDelayCheck?.details?.delaySeconds;
    const coordinateBounds = coordinateCheck?.details?.localBounds || null;
    const readyCheckCount = preflightChecks.filter((item: any) => item.status === 'ok').length;
    const warningCheckCount = preflightChecks.filter((item: any) => item.status === 'warning').length;
    const errorCheckCount = preflightChecks.filter((item: any) => item.status === 'error').length;
    const blockingPreflightChecks = preflightChecks.filter((item: any) => getPreflightGroup(item) === 'blocking');
    const confirmPreflightChecks = preflightChecks.filter((item: any) => getPreflightGroup(item) === 'confirm');
    const passedPreflightChecks = preflightChecks.filter((item: any) => getPreflightGroup(item) === 'passed');
    const recentDeploymentRecords = useMemo(
        () => deploymentRecords.filter((item: any) => item?.type === 'deploy' || item?.type === 'rollback').slice(0, 6),
        [deploymentRecords],
    );
    const rollbackableDeployment = useMemo(
        () =>
            recentDeploymentRecords.find(
                (item: any) => item.type === 'deploy' && item.status === 'succeeded' && Boolean(item.backupDir),
            ) || null,
        [recentDeploymentRecords],
    );

    const overviewStatus: StatusLevel = useMemo(() => {
        if (errorCheckCount > 0) {
            return 'error';
        }
        if (warningCheckCount > 0) {
            return 'warning';
        }
        return preflight ? 'ok' : 'idle';
    }, [errorCheckCount, preflight, warningCheckCount]);

    const hasSavedDevice = Boolean(deployConfig?.enabled && values.host && values.user && values.targetMapRoot);
    const passwordConfigured = Boolean(deployConfig?.passwordConfigured || values.password);
    const hasReadyMaps = readyMaps.length > 0;
    const hasSelectedReadyMap = Boolean(selectedMap?.ready);
    const releaseGateStatus: StatusLevel = hasReadyMaps ? 'ok' : 'error';
    const deviceGateStatus: StatusLevel = hasSavedDevice ? 'ok' : 'error';
    const buildHash = runtimeDoctor?.frontendBuildHash || runtimeDoctor?.frontendBuild?.hash || '';
    const buildTime = runtimeDoctor?.frontendBuildTime || runtimeDoctor?.frontendBuild?.buildTime || '';
    const buildCommit = runtimeDoctor?.frontendCommit || runtimeDoctor?.frontendBuild?.commit || '';
    const buildTimeLabel = buildTime ? formatModifiedTime(buildTime) : 'unknown';
    const sshStatus = getCheckLevel(preflight, 'ssh-connectivity');
    const dockerStatus = getCheckLevel(preflight, 'edge-docker-container');
    const dreamviewStatus = combineStatus(
        [getCheckLevel(preflight, 'edge-dreamview-switch'), getCheckLevel(preflight, 'edge-dreamview-hmi')].filter(
            (item) => item !== 'idle',
        ),
    );
    const packageStatus = combineStatus(
        [
            getCheckLevel(preflight, 'selected-map-coordinates'),
            getCheckLevel(preflight, 'selected-map-edge-reference'),
        ].filter((item) => item !== 'idle'),
    );
    const deployReadyValue = Boolean(preflight?.deployReady ?? preflight?.ready);
    let deployReadinessStatus: StatusLevel = 'idle';
    if (preflight) {
        deployReadinessStatus = deployReadyValue ? 'ok' : 'error';
    }
    const roadReadinessStatus = getRoadReadinessLevel(roadReadiness);
    const roadReadinessText = getRoadReadinessText(roadReadiness);
    const dreamviewHttpUrl = useMemo(() => {
        const wsUrl =
            getCheck(preflight, 'edge-dreamview-runtime-sync')?.details?.wsUrl ||
            getCheck(preflight, 'edge-dreamview-hmi')?.details?.wsUrl ||
            '';
        if (typeof wsUrl === 'string' && wsUrl.startsWith('ws://')) {
            return wsUrl.replace(/^ws:\/\//u, 'http://').replace(/\/websocket.*$/u, '');
        }
        if (typeof wsUrl === 'string' && wsUrl.startsWith('wss://')) {
            return wsUrl.replace(/^wss:\/\//u, 'https://').replace(/\/websocket.*$/u, '');
        }
        return values.host ? `http://${values.host}:8888` : '';
    }, [preflight, values.host]);
    let dynamicPoseLabel = '待设备预检后读取 localization pose。';
    if (preflight && roadReadiness) {
        dynamicPoseLabel = roadReadiness.message || roadReadinessText;
    } else if (preflight && vehiclePoseDetails?.available) {
        dynamicPoseLabel = getCheckDisplayMessage(vehiclePoseCheck);
    } else if (preflight) {
        dynamicPoseLabel = '动态定位未验证：当前没有 localization pose，不能承诺定位不飘。';
    }
    let roadBoundaryValue = '待验证';
    if (roadBoundaryCheck?.status === 'ok') {
        roadBoundaryValue = '在地图内';
    } else if (roadBoundaryCheck?.status === 'error') {
        roadBoundaryValue = '不在地图内';
    }
    const roadPoseValue =
        Number.isFinite(Number(roadPose?.x)) && Number.isFinite(Number(roadPose?.y))
            ? `${Number(roadPose.x).toFixed(3)}, ${Number(roadPose.y).toFixed(3)}`
            : '待验证';
    let roadAlertTitle = '动态定位需要现场确认';
    if (roadReadinessStatus === 'error') {
        roadAlertTitle = '不能动车验证';
    } else if (roadReadinessStatus === 'ok') {
        roadAlertTitle = '动态定位已满足动车验证条件';
    }
    let deployVerificationStatus: StatusLevel = 'idle';
    if (lastDeployVerification?.passed) {
        deployVerificationStatus = 'ok';
    } else if (lastDeployVerification) {
        deployVerificationStatus = 'warning';
    }
    let deployVerificationBadgeText = '待部署';
    if (lastDeployVerification?.passed) {
        deployVerificationBadgeText = '一致';
    } else if (lastDeployVerification) {
        deployVerificationBadgeText = '待复核';
    }
    const verificationExpectedMap = lastDeployVerification?.expectedMapName || values.mapName || '待部署';
    const verificationDreamviewMap =
        lastDeployVerification?.hmiCurrentMap || dreamviewCheck?.details?.currentMap || '待验证';
    const verificationRuntimeMap = lastDeployVerification?.runtimeMapName || runtimeDetails?.map_name || '待验证';
    const verificationTime = lastDeployVerification?.verifiedAt
        ? formatModifiedTime(lastDeployVerification.verifiedAt)
        : '待部署';
    const verificationTargetDir =
        lastDeployVerification?.resolvedMapDir ||
        lastDeployVerification?.flagMapDir ||
        runtimeDetails?.resolved_map_dir ||
        runtimeDetails?.flag_map_dir ||
        values.targetMapRoot ||
        '待验证';
    const checkingStatusText = checkingDevice ? '检查中' : undefined;

    const loadDeployments = useCallback(async () => {
        const response = await FileService.getDeployments();
        if (response?.code !== 0) {
            throw new Error(response?.message || '读取部署历史失败');
        }
        setDeploymentRecords(Array.isArray(response?.data?.deployments) ? response.data.deployments : []);
    }, []);

    const loadConfig = useCallback(async () => {
        setLoading(true);
        try {
            const [response, mapsResponse, doctorResponse] = await Promise.all([
                FileService.getDeployConfig(),
                FileService.getReleasedMaps(),
                FileService.getRuntimeDoctor(),
            ]);
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取边缘设备配置失败');
            }
            const data = response.data || {};
            const maps = Array.isArray(mapsResponse?.data?.maps) ? mapsResponse.data.maps : [];
            const defaultMapName = resolveDefaultMapName(maps);
            if (doctorResponse?.code === 0) {
                setRuntimeDoctor(doctorResponse.data || null);
            }
            setReleasedMaps(maps);
            setDeployConfig(data);
            setValues((current) => ({
                ...current,
                host: data.host || '',
                user: data.user || 'apollo',
                password: '',
                port: data.port || 22,
                targetMapRoot: data.targetMapRoot || '/apollo/modules/map/data',
                dockerContainer: data.dockerContainer || '',
                nativeMapTools: data.nativeMapTools !== false,
                autoSwitchDreamview: data.autoSwitchDreamview !== false,
                postDeployCommand: data.postDeployCommand || '',
                mapName: defaultMapName,
            }));
            setEditingDevice(!(data.enabled && data.host && data.user));
            setNotice(null);
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '读取边缘设备配置失败',
                description: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
        }
    }, [resolveDefaultMapName]);

    const refreshReleasedMaps = async () => {
        setLoading(true);
        try {
            const response = await FileService.getReleasedMaps();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取发布包失败');
            }
            const maps = Array.isArray(response?.data?.maps) ? response.data.maps : [];
            setReleasedMaps(maps);
            const currentStillExists = maps.some(
                (item: any) => item.mapName === values.mapName && item.selectable && item.ready,
            );
            if (!currentStillExists) {
                const fallbackReadyMapName = maps.find((item: any) => item.selectable && item.ready)?.mapName;
                updateValue('mapName', fallbackReadyMapName || '');
            }
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '读取发布包失败',
                description: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadConfig();
            loadDeployments().catch(() => {
                setDeploymentRecords([]);
            });
        } else {
            setJobText('');
            setRollbackCandidate(null);
            setNotice(null);
            setLastCheckedAt('');
            setCheckingDevice(false);
            setDeviceCheckTimedOut(false);
        }
    }, [loadConfig, loadDeployments, open]);

    const validateValues = (requireMap = true, nextValues: DeployValues = values) => {
        const errors: string[] = [];
        if (!nextValues.host.trim()) {
            errors.push('请输入边缘设备 IP');
        }
        if (!nextValues.user.trim()) {
            errors.push('请输入 SSH 用户');
        }
        if (!Number.isFinite(Number(nextValues.port)) || Number(nextValues.port) <= 0) {
            errors.push('请输入有效 SSH 端口');
        }
        if (!nextValues.targetMapRoot.trim()) {
            errors.push('请输入 Apollo 地图目录');
        }
        if (requireMap && !nextValues.mapName) {
            errors.push('请选择发布包');
        }
        return errors;
    };

    const buildDeployPayload = (nextValues: DeployValues = values) => ({
        ...nextValues,
        mode: 'ssh',
        autoDiscover: false,
    });

    const runPreflight = async (
        saveConfig: boolean,
        options: {
            silent?: boolean;
            mapName?: string;
            nextValues?: DeployValues;
        } = {},
    ) => {
        const nextValues = options.nextValues || values;
        const mapName = options.mapName || nextValues.mapName;
        const errors = validateValues(true, {
            ...nextValues,
            mapName,
        });
        if (errors.length > 0) {
            if (!options.silent) {
                setNotice({
                    type: 'error',
                    title: '配置不完整',
                    description: errors.join('；'),
                });
            }
            return false;
        }
        const response = saveConfig
            ? await FileService.configureEdgeDeploy(buildDeployPayload(nextValues))
            : await FileService.preflightDeploy(mapName);
        const nextPreflight = saveConfig ? response?.data?.preflight : response?.data;
        setPreflight(nextPreflight || null);
        setLastCheckedAt(new Date().toISOString());
        if (saveConfig) {
            setDeployConfig(
                response?.data?.deployConfig || {
                    ...deployConfig,
                    host: nextValues.host,
                    user: nextValues.user,
                    port: nextValues.port,
                    mode: 'ssh',
                    enabled: true,
                    targetMapRoot: nextValues.targetMapRoot,
                    dockerContainer: nextValues.dockerContainer,
                    nativeMapTools: nextValues.nativeMapTools,
                    autoSwitchDreamview: nextValues.autoSwitchDreamview,
                    postDeployCommand: nextValues.postDeployCommand,
                    passwordConfigured: passwordConfigured || Boolean(nextValues.password),
                },
            );
            setEditingDevice(false);
        }
        if (response?.code === 0) {
            if (options.silent) {
                return true;
            }
            const warnings = getPreflightIssues(nextPreflight, ['warning']);
            const warningText = warnings
                .slice(0, 3)
                .map((item: any) => `${checkTitleMap[item.name] || item.name}：${getCheckDisplayMessage(item)}`)
                .join('；');
            setNotice({
                type: warnings.length > 0 ? 'warning' : 'success',
                title: warnings.length > 0 ? '预检通过，但存在上线前警告' : '预检通过，可以部署',
                description: warnings.length > 0 ? warningText : '设备连接、容器、坐标和发布包检查已通过。',
            });
            return true;
        }
        const errorsOrWarnings = getPreflightIssues(nextPreflight, ['error']);
        if (!options.silent) {
            setNotice({
                type: 'error',
                title: saveConfig ? '设备已保存，但预检未通过' : '预检未通过',
                description: buildPreflightFailureDescription(errorsOrWarnings, response?.message || '预检未通过'),
            });
        }
        return false;
    };

    const discoverMapRoot = async () => {
        const errors = validateValues(false).filter((item) => !item.includes('地图目录'));
        if (errors.length > 0) {
            setNotice({
                type: 'error',
                title: '无法自动发现',
                description: errors.join('；'),
            });
            return;
        }
        setLoading(true);
        setJobText('正在发现 Apollo 地图目录');
        try {
            const response = await FileService.discoverEdgeMapRoot(buildDeployPayload());
            if (response?.code !== 0) {
                throw new Error(response?.message || '自动发现地图目录失败');
            }
            updateValue('targetMapRoot', response.data?.targetMapRoot || '/apollo/modules/map/data');
            setNotice({
                type: 'success',
                title: '已发现 Apollo 地图目录',
                description: response.data?.targetMapRoot || '/apollo/modules/map/data',
            });
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '自动发现地图目录失败',
                description: error?.message || '请确认服务器到边缘设备 SSH 可用，且 Apollo 目录可访问。',
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const saveAndPreflight = async () => {
        setLoading(true);
        setJobText(`正在保存设备并预检：${values.mapName || '所选发布包'}`);
        try {
            await runPreflight(true);
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '保存边缘设备配置失败',
                description: buildOperationFailureDescription(
                    error?.message || 'Unknown error',
                    '确认后端服务正常、设备配置字段完整后，再保存并预检。',
                ),
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const refreshStatus = async () => {
        setCheckingDevice(true);
        setDeviceCheckTimedOut(false);
        try {
            await runPreflight(editingDevice || !hasSavedDevice);
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '刷新状态失败',
                description: buildOperationFailureDescription(
                    error?.message || 'Unknown error',
                    '确认后端服务可访问后重新打开弹窗；如果仍失败，查看服务日志。',
                ),
            });
        } finally {
            setCheckingDevice(false);
        }
    };

    useEffect(() => {
        if (!open || !hasSavedDevice || !passwordConfigured || !hasSelectedReadyMap || editingDevice) {
            return undefined;
        }
        let cancelled = false;
        const executeAutoPreflight = async (initial: boolean) => {
            if (autoPreflightInFlightRef.current) {
                return;
            }
            autoPreflightInFlightRef.current = true;
            if (initial) {
                setCheckingDevice(true);
                setDeviceCheckTimedOut(false);
            }
            let timeoutId: number | undefined;
            try {
                const preflightTask = runPreflight(false, {
                    silent: true,
                    mapName: values.mapName,
                });
                if (initial) {
                    const result = await Promise.race([
                        preflightTask,
                        new Promise<'timeout'>((resolve) => {
                            timeoutId = window.setTimeout(() => resolve('timeout'), DEVICE_CHECK_TIMEOUT_MS);
                        }),
                    ]);
                    if (result === 'timeout') {
                        setDeviceCheckTimedOut(true);
                        setNotice({
                            type: 'warning',
                            title: '检查超时，可手动刷新',
                            description: '设备状态检查超过 10 秒，界面已恢复可操作；可以点击“刷新设备状态”重试。',
                        });
                    }
                } else {
                    await preflightTask;
                }
            } catch (error: any) {
                if (!cancelled && initial) {
                    setNotice({
                        type: 'error',
                        title: '自动检查设备失败',
                        description: buildOperationFailureDescription(
                            error?.message || 'Unknown error',
                            '可以点击“刷新设备状态”重试；如果仍失败，再检查边缘设备在线状态。',
                        ),
                    });
                }
            } finally {
                if (timeoutId !== undefined) {
                    window.clearTimeout(timeoutId);
                }
                autoPreflightInFlightRef.current = false;
                if (!cancelled && initial) {
                    setCheckingDevice(false);
                }
            }
        };
        executeAutoPreflight(true);
        const timer = window.setInterval(() => {
            executeAutoPreflight(false);
        }, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
        // runPreflight reads current dialog state; polling is keyed by the stable values below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingDevice, hasSavedDevice, hasSelectedReadyMap, open, passwordConfigured, values.mapName]);

    const deploySelected = async () => {
        const deployableMap = releasedMaps.find(
            (item: any) => item.mapName === values.mapName && item.selectable && item.ready,
        );
        if (!deployableMap) {
            setNotice({
                type: 'error',
                title: '发布包不可部署',
                description: buildOperationFailureDescription(
                    selectedMap?.statusMessage || '请选择状态为 ready 的发布包后再部署。',
                    '回到“发布检查”修复当前地图，重新生成 ready 发布包，再回到这里选择部署。',
                ),
            });
            return;
        }
        setLoading(true);
        setJobText(`正在预检：${values.mapName}`);
        try {
            const preflightOk = await runPreflight(editingDevice || !hasSavedDevice);
            if (!preflightOk) {
                return;
            }
            setJobText(`正在提交部署任务：${values.mapName}`);
            const response = await FileService.startDeployReleasedMapJob(values.mapName);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交部署任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, `部署地图 ${values.mapName}`, setJobText);
            const dreamviewSwitched = Boolean(
                job.result?.dreamviewSwitchResult || job.result?.deployment?.dreamviewSwitch,
            );
            const dreamviewVerification =
                job.result?.dreamviewSwitchResult?.verification ||
                job.result?.deployment?.dreamviewSwitch?.verification ||
                null;
            const postDeployVerification =
                job.result?.postDeployVerification || job.result?.deployment?.postDeployVerification || null;
            let dreamviewText = '';
            if (postDeployVerification?.passed && !postDeployVerification?.skipped) {
                dreamviewText = `，边缘运行时已确认加载 ${
                    postDeployVerification.hmiCurrentMap ||
                    postDeployVerification.runtimeMapName ||
                    postDeployVerification.expectedMapName
                }`;
            } else if (dreamviewVerification) {
                dreamviewText = `，Dreamview 已确认加载 ${
                    dreamviewVerification.hmiCurrentMap || dreamviewVerification.expectedMapName
                }`;
            } else if (dreamviewSwitched) {
                dreamviewText = '，Dreamview 已执行切换';
            }
            setLastDeployVerification(buildDeploymentVerification(job, values.mapName));
            setNotice({
                type: 'success',
                title: '部署完成',
                description: `地图 ${
                    job.result?.mapName || job.result?.deployment?.mapName || values.mapName
                } 已部署到边缘设备${dreamviewText}。`,
            });
            await loadDeployments();
            await runPreflight(false);
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '部署失败',
                description: buildOperationFailureDescription(
                    error?.message || 'Unknown error',
                    '先点击“刷新状态”确认设备在线和 Dreamview 状态；如果连续失败，再查看最近部署记录和后端日志。',
                ),
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const rollbackDeployment = async () => {
        if (!rollbackCandidate) {
            return;
        }
        setLoading(true);
        setJobText(`正在回滚部署：${rollbackCandidate.mapName || rollbackCandidate.id}`);
        try {
            const response = await FileService.startRollbackDeploymentJob(rollbackCandidate.id);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交回滚任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, `回滚地图 ${rollbackCandidate.mapName || ''}`, setJobText);
            setNotice({
                type: 'success',
                title: '回滚完成',
                description: `地图 ${
                    job.result?.deployment?.mapName || rollbackCandidate.mapName || ''
                } 已恢复到上一份备份。`,
            });
            setPreflight(null);
            setRollbackCandidate(null);
            await loadDeployments();
        } catch (error: any) {
            setNotice({
                type: 'error',
                title: '回滚失败',
                description: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const refreshDeployments = () => {
        setLoading(true);
        loadDeployments()
            .then(() => {
                setNotice({
                    type: 'success',
                    title: '部署历史已刷新',
                });
            })
            .catch((error: any) =>
                setNotice({
                    type: 'error',
                    title: '读取部署历史失败',
                    description: error?.message || 'Unknown error',
                }),
            )
            .finally(() => setLoading(false));
    };

    const goToPublishCheck = () => {
        onCancel();
        window.setTimeout(() => {
            PubSub.publish('openWorkbenchTab', 'publish');
        }, 0);
    };

    const primaryBlockedMap = nonReadyMaps[0] || null;

    const renderMapOption = (item: any, optionIndex: number) => (
        <SelectItem
            key={item.mapName}
            value={item.mapName}
            disabled={!item.ready}
            className="h-8 text-foreground focus:bg-[var(--landing-primary)] focus:text-white data-[disabled]:text-muted-foreground data-[disabled]:opacity-70 data-[state=checked]:bg-[var(--landing-primary)] data-[state=checked]:text-white"
        >
            <span className="block min-w-0 truncate text-sm">{`${optionIndex + 1}. ${item.mapName}`}</span>
        </SelectItem>
    );

    const renderBlockedMapCard = (item: any) => (
        <div key={item.mapName} className="min-w-0 rounded-lg border border-destructive/35 bg-destructive/5 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{item.mapName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">需要回到发布检查修复后重新生成。</div>
                </div>
                <Badge variant="destructive" className="shrink-0">
                    不可部署
                </Badge>
            </div>
            <ul className="mt-2 flex list-disc flex-col gap-1 break-words pl-4 text-xs leading-5 text-muted-foreground">
                {getReleaseMapIssueLines(item).map((line) => (
                    <li key={line} className="min-w-0 break-words">
                        {line}
                    </li>
                ))}
            </ul>
        </div>
    );

    let releasePackageSummary: ReactNode;
    if (selectedMap) {
        releasePackageSummary = (
            <div className="flex flex-col gap-3">
                <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{selectedMap.mapName}</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            已通过发布检查。部署前会自动确认设备、坐标链路和 Dreamview 状态。
                        </div>
                    </div>
                    <Badge variant={selectedMap.ready ? 'outline' : 'destructive'} className="shrink-0">
                        {selectedMap.ready ? '可部署' : '不可部署'}
                    </Badge>
                </div>
                {!selectedMap.ready ? renderBlockedMapCard(selectedMap) : null}
            </div>
        );
    } else if (primaryBlockedMap) {
        releasePackageSummary = (
            <div className="flex flex-col gap-3">
                <Alert variant="destructive">
                    <AlertTriangleIcon />
                    <AlertTitle>没有可部署发布包</AlertTitle>
                    <AlertDescription>
                        下面这些发布包还不能下发。先进入“发布检查”修复并重新生成 ready 发布包。
                    </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">{nonReadyMaps.slice(0, 5).map(renderBlockedMapCard)}</div>
                <Button type="button" variant="secondary" onClick={goToPublishCheck} disabled={loading}>
                    去发布检查
                </Button>
            </div>
        );
    } else {
        releasePackageSummary = (
            <div className="flex flex-col gap-3">
                <Alert>
                    <InfoIcon />
                    <AlertTitle>没有可部署发布包</AlertTitle>
                    <AlertDescription>请先从当前地图生成发布包，并确保发布检查通过。</AlertDescription>
                </Alert>
                <Button type="button" variant="secondary" onClick={goToPublishCheck} disabled={loading}>
                    去发布检查
                </Button>
            </div>
        );
    }

    let primaryActionLabel = '一键发布到边缘设备';
    let PrimaryActionIcon = CloudUploadIcon;
    let primaryAction: () => void | Promise<void> = deploySelected;
    let primaryActionDisabled = loading || checkingDevice || !hasSavedDevice || editingDevice || !hasSelectedReadyMap;
    if (!hasReadyMaps) {
        primaryActionLabel = '去发布地图包';
        PrimaryActionIcon = ShieldCheckIcon;
        primaryAction = goToPublishCheck;
        primaryActionDisabled = loading;
    } else if (!hasSavedDevice || editingDevice) {
        primaryActionLabel = '保存固定设备';
        PrimaryActionIcon = SaveIcon;
        primaryAction = saveAndPreflight;
        primaryActionDisabled = loading;
    }
    const hasPreflightAttention = blockingPreflightChecks.length > 0 || confirmPreflightChecks.length > 0;
    let deployDecisionLevel: StatusLevel = 'idle';
    let deployDecisionTitle = '等待设备检查';
    let deployDecisionDescription = '选择可部署发布包后，系统会自动检查设备、容器、Dreamview 和坐标链路。';
    if (!hasReadyMaps) {
        deployDecisionLevel = 'error';
        deployDecisionTitle = '先完成发布检查';
        deployDecisionDescription = '当前没有 ready 发布包，不能部署到边缘设备。';
    } else if (!hasSavedDevice || editingDevice) {
        deployDecisionLevel = 'warning';
        deployDecisionTitle = '先保存固定设备';
        deployDecisionDescription = '保存设备后会立即预检，之后打开弹窗会自动首检。';
    } else if (checkingDevice) {
        deployDecisionLevel = 'warning';
        deployDecisionTitle = '正在检查设备';
        deployDecisionDescription = '检查结束前不会锁死界面；超时后可手动刷新。';
    } else if (preflight && errorCheckCount > 0) {
        deployDecisionLevel = 'error';
        deployDecisionTitle = '暂不能部署';
        deployDecisionDescription = `发现 ${errorCheckCount} 个阻断项，先按下方原因处理。`;
    } else if (preflight && warningCheckCount > 0) {
        deployDecisionLevel = 'warning';
        deployDecisionTitle = '可以部署，部署后确认';
        deployDecisionDescription = `预检有 ${warningCheckCount} 个现场确认项，部署后不要直接承诺定位可运营。`;
    } else if (preflight) {
        deployDecisionLevel = 'ok';
        deployDecisionTitle = '可以部署';
        deployDecisionDescription = '设备、发布包和坐标链路已通过部署预检。';
    }
    let preflightSummaryText = '待检查';
    if (checkingDevice) {
        preflightSummaryText = '检查中';
    } else if (preflight) {
        preflightSummaryText = statusTextMap[deployReadinessStatus];
    }
    const workflowSummary: Array<{ title: string; level: StatusLevel; text: string }> = [
        {
            title: '固定设备',
            level: deviceGateStatus,
            text: hasSavedDevice ? `${values.user}@${values.host}:${values.port}` : '待配置',
        },
        {
            title: '可部署地图',
            level: releaseGateStatus,
            text: hasReadyMaps ? `${readyMaps.length} 个 ready 包` : '没有 ready 包',
        },
        {
            title: '部署预检',
            level: checkingDevice ? 'warning' : deployReadinessStatus,
            text: preflightSummaryText,
        },
        {
            title: '动车定位',
            level: roadReadinessStatus,
            text: roadReadinessText,
        },
    ];

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onCancel();
                }
            }}
        >
            <DialogContent
                className="grid-rows-none flex-col gap-0 overflow-hidden border border-border bg-popover p-0 text-popover-foreground shadow-2xl [&_.text-xs]:text-[12px] [&_.text-xs]:leading-5"
                style={{
                    display: 'flex',
                    top: 'clamp(20px, 5vh, 56px)',
                    right: 'auto',
                    bottom: 'auto',
                    left: '50%',
                    width: 'min(780px, calc(100vw - 48px))',
                    maxWidth: 'calc(100vw - 32px)',
                    height: 'min(820px, calc(100vh - 80px))',
                    transform: 'translateX(-50%)',
                }}
            >
                <DialogHeader className="border-b border-border px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-semibold">边缘设备部署</DialogTitle>
                            <DialogDescription className="mt-2">
                                使用最新 Apollo 发布包，一键推送到已配置的边缘设备。
                            </DialogDescription>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline">{`frontend ${buildHash || 'unknown'}`}</Badge>
                                <Badge variant="outline">{`commit ${buildCommit || 'unknown'}`}</Badge>
                                <Badge variant="outline">{`build ${buildTimeLabel}`}</Badge>
                            </div>
                        </div>
                        <Badge variant={overviewStatus === 'error' ? 'destructive' : 'secondary'} className="shrink-0">
                            {getOverviewStatusText(overviewStatus, Boolean(preflight))}
                        </Badge>
                    </div>
                </DialogHeader>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="flex min-w-0 flex-col gap-4 p-5">
                        {notice ? <NoticeAlert notice={notice} onClear={() => setNotice(null)} /> : null}

                        <Card>
                            <CardHeader>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <CardTitle className="flex items-center gap-2">
                                            <ServerIcon data-icon="inline-start" />
                                            固定边缘设备
                                        </CardTitle>
                                        <CardDescription>
                                            部署目标固定为已保存设备；现场不需要每次重新输入。
                                        </CardDescription>
                                    </div>
                                    <Badge variant={hasSavedDevice ? 'outline' : 'destructive'} className="shrink-0">
                                        {hasSavedDevice ? '已配置' : '未配置'}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                                {hasSavedDevice && !editingDevice ? (
                                    <>
                                        <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-base font-semibold text-foreground">
                                                    {`${values.user}@${values.host}:${values.port}`}
                                                </div>
                                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                                    {values.targetMapRoot}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setEditingDevice(true)}
                                                disabled={loading}
                                            >
                                                <PencilIcon data-icon="inline-start" />
                                                更换设备
                                            </Button>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-4">
                                            <StatusLight
                                                level={checkingDevice ? 'warning' : sshStatus}
                                                label="设备在线"
                                                value={checkingStatusText}
                                            />
                                            <StatusLight
                                                level={checkingDevice ? 'warning' : dockerStatus}
                                                label="Apollo 容器"
                                                value={checkingStatusText}
                                            />
                                            <StatusLight
                                                level={checkingDevice ? 'warning' : dreamviewStatus}
                                                label="Dreamview"
                                                value={checkingStatusText}
                                            />
                                            <StatusLight
                                                level={checkingDevice ? 'warning' : deployReadinessStatus}
                                                label="部署状态"
                                                value={checkingStatusText}
                                            />
                                        </div>
                                        <div className="flex justify-end">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={refreshStatus}
                                                disabled={loading || checkingDevice || !hasSelectedReadyMap}
                                            >
                                                <RefreshCwIcon data-icon="inline-start" />
                                                检查设备
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px]">
                                            <FieldBlock label="边缘设备 IP" htmlFor="edge-host-simple">
                                                <Input
                                                    id="edge-host-simple"
                                                    value={values.host}
                                                    placeholder="192.168.110.187"
                                                    onChange={(event) => updateValue('host', event.target.value)}
                                                />
                                            </FieldBlock>
                                            <FieldBlock label="SSH 端口" htmlFor="edge-port-simple">
                                                <Input
                                                    id="edge-port-simple"
                                                    type="number"
                                                    min={1}
                                                    max={65535}
                                                    value={values.port}
                                                    onChange={(event) => {
                                                        updateValue('port', Number(event.target.value) || 22);
                                                    }}
                                                />
                                            </FieldBlock>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <FieldBlock label="SSH 用户" htmlFor="edge-user-simple">
                                                <Input
                                                    id="edge-user-simple"
                                                    value={values.user}
                                                    placeholder="nvidia"
                                                    onChange={(event) => updateValue('user', event.target.value)}
                                                />
                                            </FieldBlock>
                                            <FieldBlock
                                                label="SSH 密码"
                                                htmlFor="edge-password-simple"
                                                hint={
                                                    passwordConfigured
                                                        ? '已保存密码可以留空。'
                                                        : '首次配置需要输入密码。'
                                                }
                                            >
                                                <Input
                                                    id="edge-password-simple"
                                                    type="password"
                                                    value={values.password}
                                                    autoComplete="new-password"
                                                    placeholder={
                                                        passwordConfigured ? '已保存，留空即可' : '请输入 SSH 密码'
                                                    }
                                                    onChange={(event) => updateValue('password', event.target.value)}
                                                />
                                            </FieldBlock>
                                        </div>
                                        <FieldBlock label="Apollo 地图目录" htmlFor="edge-map-root-simple">
                                            <Input
                                                id="edge-map-root-simple"
                                                value={values.targetMapRoot}
                                                placeholder="/apollo/modules/map/data"
                                                onChange={(event) => updateValue('targetMapRoot', event.target.value)}
                                            />
                                        </FieldBlock>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className={cn(!hasReadyMaps && 'border-destructive/45')}>
                            <CardHeader>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <CardTitle className="flex items-center gap-2">
                                            <MapIcon data-icon="inline-start" />
                                            Apollo 发布包
                                        </CardTitle>
                                        <CardDescription>
                                            画完图后发布地图包，系统自动生成 Apollo 可部署格式。
                                        </CardDescription>
                                    </div>
                                    <Badge variant={hasReadyMaps ? 'outline' : 'destructive'} className="shrink-0">
                                        {hasReadyMaps ? '可部署' : '待发布'}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                {selectedMap?.ready ? (
                                    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor="edge-map-select-simple" className="text-sm font-semibold">
                                                发布地图
                                            </Label>
                                            <Badge variant="outline" className="shrink-0">
                                                {readyMaps.length > 1 ? `${readyMaps.length} 个可选` : '默认最新'}
                                            </Badge>
                                        </div>
                                        <Select
                                            value={values.mapName}
                                            onValueChange={(mapName) => {
                                                updateValue('mapName', mapName);
                                                setPreflight(null);
                                                setLastDeployVerification(null);
                                                setDeviceCheckTimedOut(false);
                                                setNotice(null);
                                            }}
                                            disabled={loading || readyMaps.length === 0}
                                        >
                                            <SelectTrigger
                                                id="edge-map-select-simple"
                                                className="h-10 w-full border-border bg-background text-left text-foreground data-placeholder:text-muted-foreground [&_svg]:text-muted-foreground"
                                            >
                                                <SelectValue placeholder="选择发布地图" />
                                            </SelectTrigger>
                                            <SelectContent
                                                position="popper"
                                                sideOffset={4}
                                                align="start"
                                                className="max-h-[280px] w-[var(--radix-select-trigger-width)] min-w-0 max-w-[var(--radix-select-trigger-width)] border border-border bg-popover text-popover-foreground shadow-xl"
                                            >
                                                <SelectGroup>
                                                    <SelectLabel className="px-2 text-[11px] font-medium text-muted-foreground">
                                                        可部署发布包
                                                    </SelectLabel>
                                                    {readyMaps.map((item: any, index: number) =>
                                                        renderMapOption(item, index),
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                        <div className="text-xs leading-5 text-muted-foreground">
                                            默认选择最新可部署包；需要发布其它地图时，先在这里切换。
                                        </div>
                                    </div>
                                ) : (
                                    <Alert variant="destructive">
                                        <AlertTriangleIcon />
                                        <AlertTitle>还没有可部署的 Apollo 发布包</AlertTitle>
                                        <AlertDescription>
                                            先发布地图包。发布动作会自动转换成 Apollo 可部署产物，不需要单独转换。
                                        </AlertDescription>
                                    </Alert>
                                )}
                                {nonReadyMaps.length > 0 ? (
                                    <details className="rounded-lg border border-border bg-muted/15">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                            <span className="min-w-0">
                                                <strong className="block truncate text-sm text-foreground">
                                                    不可部署包
                                                </strong>
                                                <span className="block truncate text-xs text-muted-foreground">
                                                    只有失败排查时需要看。
                                                </span>
                                            </span>
                                            <Badge variant="outline" className="shrink-0">
                                                {nonReadyMaps.length}
                                            </Badge>
                                        </summary>
                                        <div className="flex flex-col gap-2 border-t border-border p-3">
                                            {nonReadyMaps.slice(0, 3).map(renderBlockedMapCard)}
                                        </div>
                                    </details>
                                ) : null}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <CardTitle className="flex items-center gap-2">
                                            <CloudUploadIcon data-icon="inline-start" />
                                            一键发布
                                        </CardTitle>
                                        <CardDescription>
                                            边缘设备固定；发布地图默认最新，需要时可在上方切换。
                                        </CardDescription>
                                    </div>
                                    <Badge
                                        variant={deployDecisionLevel === 'error' ? 'destructive' : 'outline'}
                                        className="shrink-0"
                                    >
                                        {deployDecisionTitle}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                                {jobText ? (
                                    <Alert className="border-[rgba(47,127,247,0.45)] bg-card">
                                        <RefreshCwIcon className="animate-spin" />
                                        <AlertTitle>正在发布</AlertTitle>
                                        <AlertDescription>{jobText}</AlertDescription>
                                    </Alert>
                                ) : (
                                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-3 text-sm leading-6 text-muted-foreground">
                                        {hasSavedDevice && hasReadyMaps
                                            ? '点击“一键发布到边缘设备”，系统会自动预检、上传、切换 Dreamview 并记录结果。'
                                            : deployDecisionDescription}
                                    </div>
                                )}
                                {lastDeployVerification ? (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <InfoPair label="期望地图" value={verificationExpectedMap} />
                                        <InfoPair label="Dreamview 当前地图" value={verificationDreamviewMap} />
                                        <InfoPair label="runtime 当前地图" value={verificationRuntimeMap} />
                                        <InfoPair label="验证时间" value={verificationTime} />
                                    </div>
                                ) : null}
                                {preflightChecks.length > 0 || deviceCheckTimedOut ? (
                                    <details
                                        className="rounded-lg border border-border bg-muted/15"
                                        open={blockingPreflightChecks.length > 0}
                                    >
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                            <span className="min-w-0">
                                                <strong className="block truncate text-sm text-foreground">
                                                    失败排查
                                                </strong>
                                                <span className="block truncate text-xs text-muted-foreground">
                                                    正常发布不用看；失败时按阻断项处理。
                                                </span>
                                            </span>
                                            <Badge
                                                variant={blockingPreflightChecks.length > 0 ? 'destructive' : 'outline'}
                                                className="shrink-0"
                                            >
                                                {`${blockingPreflightChecks.length} 阻断`}
                                            </Badge>
                                        </summary>
                                        <div className="flex flex-col gap-3 border-t border-border p-3">
                                            {deviceCheckTimedOut ? (
                                                <Alert className="border-[rgba(245,158,11,0.45)] bg-card">
                                                    <AlertTriangleIcon />
                                                    <AlertTitle>检查超时</AlertTitle>
                                                    <AlertDescription>
                                                        自动检查超过 10 秒，可以重新点击一键发布或检查设备。
                                                    </AlertDescription>
                                                </Alert>
                                            ) : null}
                                            <PreflightGroup
                                                title="阻断部署"
                                                description="这些问题会阻止地图下发"
                                                items={blockingPreflightChecks}
                                                group="blocking"
                                                defaultOpen={blockingPreflightChecks.length > 0}
                                                emptyText="没有阻断项。"
                                            />
                                            <PreflightGroup
                                                title="部署后确认"
                                                description="可以部署，但上线前现场确认"
                                                items={confirmPreflightChecks}
                                                group="confirm"
                                                defaultOpen={false}
                                                emptyText="没有确认项。"
                                            />
                                        </div>
                                    </details>
                                ) : null}
                            </CardContent>
                        </Card>

                        <details className="rounded-lg border border-border bg-card">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                                <span className="min-w-0">
                                    <strong className="flex items-center gap-2 text-sm text-foreground">
                                        <HistoryIcon data-icon="inline-start" />
                                        部署记录与回滚
                                    </strong>
                                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                                        默认收起；只有需要回滚时打开。
                                    </span>
                                </span>
                                <Badge variant="outline" className="shrink-0">
                                    {recentDeploymentRecords.length}
                                </Badge>
                            </summary>
                            <div className="flex flex-col gap-3 border-t border-border p-3">
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={refreshDeployments}
                                        disabled={loading}
                                    >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        刷新记录
                                    </Button>
                                </div>
                                {recentDeploymentRecords.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                        {recentDeploymentRecords.slice(0, 3).map((item: any) => {
                                            const rollbackable =
                                                item.type === 'deploy' &&
                                                item.status === 'succeeded' &&
                                                Boolean(item.backupDir);
                                            return (
                                                <div
                                                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2"
                                                    key={item.id}
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-medium text-foreground">
                                                            {item.mapName || '-'}
                                                        </div>
                                                        <div className="truncate text-xs text-muted-foreground">
                                                            {`${item.status || '-'} / ${formatModifiedTime(
                                                                item.finishedAt || item.startedAt,
                                                            )}`}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="sm"
                                                        disabled={!rollbackable || loading}
                                                        onClick={() => setRollbackCandidate(item)}
                                                    >
                                                        <RotateCcwIcon data-icon="inline-start" />
                                                        回滚
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                                        暂无部署记录。
                                    </div>
                                )}
                            </div>
                        </details>

                        {rollbackCandidate ? (
                            <Alert variant="destructive">
                                <AlertTriangleIcon />
                                <AlertTitle>确认回滚边缘设备地图？</AlertTitle>
                                <AlertDescription>
                                    <div className="flex flex-col gap-3">
                                        <span>
                                            <span>将把</span>
                                            <strong className="mx-1">{rollbackCandidate.mapName || '-'}</strong>
                                            <span>回滚到部署前备份。</span>
                                        </span>
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setRollbackCandidate(null)}
                                                disabled={loading}
                                            >
                                                取消
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                onClick={rollbackDeployment}
                                                disabled={loading}
                                            >
                                                <RotateCcwIcon data-icon="inline-start" />
                                                确认回滚
                                            </Button>
                                        </div>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        ) : null}
                    </div>
                    <div className="hidden">
                        <div className="flex min-w-0 flex-col gap-4">
                            <div className="grid gap-2 md:grid-cols-4">
                                {workflowSummary.map((item) => (
                                    <div
                                        key={item.title}
                                        className={cn(
                                            'min-w-0 rounded-lg border border-border bg-card px-3 py-3',
                                            item.level === 'error' && 'border-destructive/45 bg-destructive/5',
                                            item.level === 'warning' && 'border-[rgba(245,158,11,0.45)]',
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={cn(
                                                    'size-2.5 shrink-0 rounded-full',
                                                    statusDotClass[item.level],
                                                )}
                                            />
                                            <div className="truncate text-xs text-muted-foreground">{item.title}</div>
                                        </div>
                                        <div className="mt-2 truncate text-sm font-semibold text-foreground">
                                            {item.text}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <Alert
                                variant={deployDecisionLevel === 'error' ? 'destructive' : 'default'}
                                className={cn(
                                    'bg-card',
                                    deployDecisionLevel === 'ok' && 'border-[rgba(34,197,94,0.45)]',
                                    deployDecisionLevel === 'warning' && 'border-[rgba(245,158,11,0.45)]',
                                )}
                            >
                                {deployDecisionLevel === 'error' ? <XCircleIcon /> : <InfoIcon />}
                                <AlertTitle>{deployDecisionTitle}</AlertTitle>
                                <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span>{deployDecisionDescription}</span>
                                    <span className="text-foreground">{`下一步：${primaryActionLabel}`}</span>
                                </AlertDescription>
                            </Alert>

                            {!hasSavedDevice ? (
                                <Alert variant="destructive">
                                    <AlertTriangleIcon />
                                    <AlertTitle>先配置设备</AlertTitle>
                                    <AlertDescription>
                                        边缘部署未启用或缺少设备地址/SSH 用户。保存设备并预检后，系统才会允许下发地图。
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            <Card>
                                <CardHeader className="gap-3">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <CardTitle className="flex items-center gap-2">
                                                <ServerIcon data-icon="inline-start" />
                                                <span className="truncate">
                                                    {hasSavedDevice
                                                        ? `${values.user}@${values.host}`
                                                        : '尚未配置边缘设备'}
                                                </span>
                                            </CardTitle>
                                            <CardDescription className="mt-1 truncate">
                                                {hasSavedDevice
                                                    ? `SSH ${values.port} / ${values.targetMapRoot}`
                                                    : '第一次配置后会保存为固定设备卡片'}
                                            </CardDescription>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setEditingDevice((current) => !current)}
                                            disabled={loading}
                                        >
                                            <PencilIcon data-icon="inline-start" />
                                            {editingDevice ? '收起配置' : '编辑配置'}
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                        <StatusLight
                                            level={checkingDevice ? 'warning' : sshStatus}
                                            label="设备在线"
                                            value={checkingStatusText}
                                        />
                                        <StatusLight
                                            level={checkingDevice ? 'warning' : dockerStatus}
                                            label="容器可用"
                                            value={checkingStatusText}
                                        />
                                        <StatusLight
                                            level={checkingDevice ? 'warning' : dreamviewStatus}
                                            label="Dreamview"
                                            value={checkingStatusText}
                                        />
                                        <StatusLight
                                            level={checkingDevice ? 'warning' : deployReadinessStatus}
                                            label="是否可部署"
                                            value={checkingStatusText}
                                        />
                                    </div>
                                    <details className="rounded-lg border border-border bg-muted/15">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                            <span className="min-w-0">
                                                <strong className="block truncate text-sm text-foreground">
                                                    设备细节
                                                </strong>
                                                <span className="block truncate text-xs text-muted-foreground">
                                                    排查时再打开，默认不占主流程空间。
                                                </span>
                                            </span>
                                            <Badge variant="outline" className="shrink-0">
                                                {lastCheckedAt ? '已检查' : '待检查'}
                                            </Badge>
                                        </summary>
                                        <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-4">
                                            <InfoPair
                                                label="Docker 容器"
                                                value={values.dockerContainer || '宿主机模式'}
                                            />
                                            <InfoPair
                                                label="密码状态"
                                                value={passwordConfigured ? '已保存' : '未保存'}
                                            />
                                            <InfoPair label="当前加载" value={runtimeDetails?.map_name || '待预检'} />
                                            <InfoPair label="发布包中心" value={formatBoundsCenter(coordinateBounds)} />
                                        </div>
                                    </details>
                                    {deviceCheckTimedOut ? (
                                        <Alert className="border-[rgba(245,158,11,0.45)] bg-card">
                                            <AlertTriangleIcon />
                                            <AlertTitle>检查超时，可手动刷新</AlertTitle>
                                            <AlertDescription>
                                                自动设备检查超过 10 秒，界面已恢复可操作。请点击“刷新设备状态”重试。
                                            </AlertDescription>
                                        </Alert>
                                    ) : null}
                                    {jobText ? (
                                        <Alert className="border-[rgba(47,127,247,0.45)] bg-card">
                                            <RefreshCwIcon className="animate-spin" />
                                            <AlertTitle>任务进行中</AlertTitle>
                                            <AlertDescription>{jobText}</AlertDescription>
                                        </Alert>
                                    ) : null}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <MapIcon data-icon="inline-start" />
                                        发布包
                                    </CardTitle>
                                    <CardDescription>
                                        只显示当前可以选择的发布包；不可部署的包会保留原因。
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                        <Select
                                            value={values.mapName}
                                            onValueChange={(mapName) => {
                                                updateValue('mapName', mapName);
                                                setPreflight(null);
                                                setLastDeployVerification(null);
                                            }}
                                            disabled={loading || readyMaps.length === 0}
                                        >
                                            <SelectTrigger className="h-8 w-full border-border bg-background text-foreground data-placeholder:text-muted-foreground [&_svg]:text-muted-foreground">
                                                <SelectValue placeholder="选择发布包" />
                                            </SelectTrigger>
                                            <SelectContent
                                                position="popper"
                                                sideOffset={4}
                                                align="start"
                                                className="max-h-[280px] w-[var(--radix-select-trigger-width)] min-w-0 max-w-[var(--radix-select-trigger-width)] border border-border bg-popover text-popover-foreground shadow-xl [&_[data-position=popper]]:!h-auto [&_[data-position=popper]]:max-h-[260px]"
                                            >
                                                {readyMaps.length > 0 ? (
                                                    <SelectGroup>
                                                        <SelectLabel className="px-2 text-[11px] font-medium text-muted-foreground">
                                                            可部署
                                                        </SelectLabel>
                                                        {readyMaps.map((item: any, index: number) =>
                                                            renderMapOption(item, index),
                                                        )}
                                                    </SelectGroup>
                                                ) : null}
                                                {readyMaps.length === 0 ? (
                                                    <SelectGroup>
                                                        <SelectLabel className="px-2 py-2 text-sm text-muted-foreground">
                                                            暂无可用发布包
                                                        </SelectLabel>
                                                    </SelectGroup>
                                                ) : null}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={refreshReleasedMaps}
                                            disabled={loading}
                                        >
                                            <RefreshCwIcon data-icon="inline-start" />
                                            刷新发布包
                                        </Button>
                                    </div>

                                    {nonReadyMaps.length > 0 ? (
                                        <details className="rounded-lg border border-border bg-muted/15">
                                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                                <span className="min-w-0">
                                                    <strong className="block truncate text-sm text-foreground">
                                                        不可部署原因
                                                    </strong>
                                                    <span className="block truncate text-xs text-muted-foreground">
                                                        {`默认收起，只显示前 ${Math.min(nonReadyMaps.length, 3)} 个异常包摘要。`}
                                                    </span>
                                                </span>
                                                <Badge variant="outline" className="shrink-0">
                                                    {nonReadyMaps.length}
                                                </Badge>
                                            </summary>
                                            <div className="flex flex-col gap-2 border-t border-border p-3">
                                                {nonReadyMaps.slice(0, 3).map(renderBlockedMapCard)}
                                            </div>
                                        </details>
                                    ) : null}

                                    {releasePackageSummary}
                                </CardContent>
                            </Card>

                            {editingDevice ? (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <ShieldCheckIcon data-icon="inline-start" />
                                            设备配置
                                        </CardTitle>
                                        <CardDescription>
                                            首次输入会保存到后端配置；后续密码留空会继续使用已保存密码。
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex flex-col gap-4">
                                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
                                            <FieldBlock label="边缘设备 IP" htmlFor="edge-host">
                                                <Input
                                                    id="edge-host"
                                                    value={values.host}
                                                    placeholder="192.168.110.187"
                                                    onChange={(event) => updateValue('host', event.target.value)}
                                                />
                                            </FieldBlock>
                                            <FieldBlock label="SSH 端口" htmlFor="edge-port">
                                                <Input
                                                    id="edge-port"
                                                    type="number"
                                                    min={1}
                                                    max={65535}
                                                    value={values.port}
                                                    onChange={(event) => {
                                                        updateValue('port', Number(event.target.value) || 22);
                                                    }}
                                                />
                                            </FieldBlock>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <FieldBlock label="SSH 用户" htmlFor="edge-user">
                                                <Input
                                                    id="edge-user"
                                                    value={values.user}
                                                    placeholder="nvidia"
                                                    onChange={(event) => updateValue('user', event.target.value)}
                                                />
                                            </FieldBlock>
                                            <FieldBlock
                                                label="SSH 密码"
                                                htmlFor="edge-password"
                                                hint={
                                                    passwordConfigured
                                                        ? '留空继续使用已保存密码。'
                                                        : '首次配置需要输入密码。'
                                                }
                                            >
                                                <Input
                                                    id="edge-password"
                                                    type="password"
                                                    value={values.password}
                                                    autoComplete="new-password"
                                                    placeholder={
                                                        passwordConfigured ? '已保存，留空即可' : '请输入 SSH 密码'
                                                    }
                                                    onChange={(event) => updateValue('password', event.target.value)}
                                                />
                                            </FieldBlock>
                                        </div>
                                        <Separator />
                                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                                            <FieldBlock label="Apollo 地图目录" htmlFor="edge-map-root">
                                                <Input
                                                    id="edge-map-root"
                                                    value={values.targetMapRoot}
                                                    placeholder="/apollo/modules/map/data"
                                                    onChange={(event) => {
                                                        updateValue('targetMapRoot', event.target.value);
                                                    }}
                                                />
                                            </FieldBlock>
                                            <div className="flex items-end">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={discoverMapRoot}
                                                    disabled={loading}
                                                >
                                                    <SearchIcon data-icon="inline-start" />
                                                    自动发现
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <FieldBlock label="Docker 容器" htmlFor="edge-container">
                                                <Input
                                                    id="edge-container"
                                                    value={values.dockerContainer}
                                                    placeholder="apollo_dev_nvidia"
                                                    onChange={(event) => {
                                                        updateValue('dockerContainer', event.target.value);
                                                    }}
                                                />
                                            </FieldBlock>
                                            <FieldBlock label="额外部署后命令" htmlFor="edge-post-command">
                                                <Input
                                                    id="edge-post-command"
                                                    value={values.postDeployCommand}
                                                    placeholder="可选，高级命令"
                                                    onChange={(event) => {
                                                        updateValue('postDeployCommand', event.target.value);
                                                    }}
                                                />
                                            </FieldBlock>
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-3">
                                                <div>
                                                    <Label>生成 Apollo 原生地图文件</Label>
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        部署后在边缘容器内生成 routing/二进制地图产物。
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={values.nativeMapTools}
                                                    onCheckedChange={(checked) => {
                                                        updateValue('nativeMapTools', checked);
                                                    }}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-3">
                                                <div>
                                                    <Label>部署后切换 Dreamview</Label>
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        部署完成后自动写入 map_dir 并验证当前地图。
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={values.autoSwitchDreamview}
                                                    onCheckedChange={(checked) => {
                                                        updateValue('autoSwitchDreamview', checked);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : null}
                        </div>

                        <div className="flex min-w-0 flex-col gap-4">
                            {notice ? <NoticeAlert notice={notice} onClear={() => setNotice(null)} /> : null}

                            <Card className={cn(deployDecisionLevel === 'error' && 'border-destructive/45')}>
                                <CardHeader>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <CardTitle className="flex items-center gap-2">
                                                <CheckCircle2Icon data-icon="inline-start" />
                                                部署判断
                                            </CardTitle>
                                            <CardDescription>
                                                先看结论；需要排查时再展开预检和定位明细。
                                            </CardDescription>
                                        </div>
                                        <Badge
                                            variant={deployDecisionLevel === 'error' ? 'destructive' : 'outline'}
                                            className="shrink-0"
                                        >
                                            {deployDecisionTitle}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <InfoPair label="当前发布包" value={values.mapName || '未选择'} />
                                        <InfoPair
                                            label="预检结果"
                                            value={
                                                preflight
                                                    ? `${readyCheckCount} 通过 / ${errorCheckCount} 阻断`
                                                    : '待预检'
                                            }
                                        />
                                        <InfoPair
                                            label="车辆到中心线"
                                            value={formatMeters(roadNearest?.distanceMeters)}
                                        />
                                        <InfoPair label="动车定位" value={roadReadinessText} />
                                    </div>

                                    {preflightChecks.length > 0 ? (
                                        <details
                                            className="rounded-lg border border-border bg-muted/15"
                                            open={hasPreflightAttention}
                                        >
                                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                                <span className="min-w-0">
                                                    <strong className="block truncate text-sm text-foreground">
                                                        预检明细
                                                    </strong>
                                                    <span className="block truncate text-xs text-muted-foreground">
                                                        阻断项默认展开，通过项默认收起。
                                                    </span>
                                                </span>
                                                <Badge
                                                    variant={
                                                        blockingPreflightChecks.length > 0 ? 'destructive' : 'outline'
                                                    }
                                                    className="shrink-0"
                                                >
                                                    {`${blockingPreflightChecks.length} 阻断`}
                                                </Badge>
                                            </summary>
                                            <div className="flex flex-col gap-3 border-t border-border p-3">
                                                <PreflightGroup
                                                    title="阻断部署"
                                                    description="这些问题会直接阻止地图下发"
                                                    items={blockingPreflightChecks}
                                                    group="blocking"
                                                    defaultOpen={blockingPreflightChecks.length > 0}
                                                    emptyText="没有阻断项。"
                                                />
                                                <PreflightGroup
                                                    title="部署后必须确认"
                                                    description="可以下发，但上线前必须现场确认"
                                                    items={confirmPreflightChecks}
                                                    group="confirm"
                                                    defaultOpen={confirmPreflightChecks.length > 0}
                                                    emptyText="没有需要现场确认的警告。"
                                                />
                                                <PreflightGroup
                                                    title="已通过"
                                                    description="设备、发布包和坐标链路已经检查通过"
                                                    items={passedPreflightChecks}
                                                    group="passed"
                                                    defaultOpen={false}
                                                    emptyText="还没有通过项。"
                                                />
                                            </div>
                                        </details>
                                    ) : (
                                        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm leading-6 text-muted-foreground">
                                            打开弹窗后会自动检查固定设备。也可以点击底部“刷新设备状态”手动重试。
                                        </div>
                                    )}

                                    <details
                                        className="rounded-lg border border-border bg-muted/15"
                                        open={roadReadinessStatus === 'error' && Boolean(preflight)}
                                    >
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                            <span className="min-w-0">
                                                <strong className="block truncate text-sm text-foreground">
                                                    动态定位明细
                                                </strong>
                                                <span className="block truncate text-xs text-muted-foreground">
                                                    只影响动车验证，不影响地图文件下发。
                                                </span>
                                            </span>
                                            <Badge
                                                variant={roadReadinessStatus === 'error' ? 'destructive' : 'outline'}
                                                className="shrink-0"
                                            >
                                                {roadReadinessText}
                                            </Badge>
                                        </summary>
                                        <div className="flex flex-col gap-3 border-t border-border p-3">
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <InfoPair
                                                    label="最近车道中心线"
                                                    value={formatMeters(roadNearest?.distanceMeters)}
                                                />
                                                <InfoPair label="pose 延迟" value={formatSeconds(roadPoseDelayValue)} />
                                                <InfoPair
                                                    label="RTK / INS"
                                                    value={roadPose?.rtkFix?.raw || roadRtkCheck?.message || '待验证'}
                                                />
                                                <InfoPair
                                                    label="heading 稳定性"
                                                    value={formatDegrees(roadHeadingCheck?.details?.maxDeltaRadians)}
                                                />
                                                <InfoPair label="地图边界" value={roadBoundaryValue} />
                                                <InfoPair label="当前 pose" value={roadPoseValue} wrap />
                                            </div>
                                            <Alert
                                                variant={roadReadinessStatus === 'error' ? 'destructive' : 'default'}
                                                className={cn(
                                                    'bg-card',
                                                    roadReadinessStatus === 'warning' &&
                                                        'border-[rgba(245,158,11,0.5)]',
                                                    roadReadinessStatus === 'ok' && 'border-[rgba(34,197,94,0.45)]',
                                                )}
                                            >
                                                {roadReadinessStatus === 'error' ? <XCircleIcon /> : <InfoIcon />}
                                                <AlertTitle>{roadAlertTitle}</AlertTitle>
                                                <AlertDescription>
                                                    {dynamicPoseLabel}
                                                    {roadReadiness?.blockerCount || roadReadiness?.warningCount ? (
                                                        <span className="ml-1">
                                                            {`阻断 ${roadReadiness?.blockerCount || 0} 项，警告 ${
                                                                roadReadiness?.warningCount || 0
                                                            } 项。`}
                                                        </span>
                                                    ) : null}
                                                </AlertDescription>
                                            </Alert>
                                        </div>
                                    </details>

                                    {!lastDeployVerification ? (
                                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm leading-6 text-muted-foreground">
                                            部署成功后才显示设备验证结果；当前不会把动态定位包装成已通过。
                                        </div>
                                    ) : null}
                                </CardContent>
                            </Card>

                            {lastDeployVerification ? (
                                <Card>
                                    <CardHeader>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <CardTitle className="flex items-center gap-2">
                                                    <ShieldCheckIcon data-icon="inline-start" />
                                                    设备验证
                                                </CardTitle>
                                                <CardDescription>
                                                    部署后确认 Dreamview、runtime 和 map_dir 是否一致。
                                                </CardDescription>
                                            </div>
                                            <Badge
                                                variant={deployVerificationStatus === 'ok' ? 'outline' : 'secondary'}
                                                className="shrink-0"
                                            >
                                                {deployVerificationBadgeText}
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex flex-col gap-4">
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <InfoPair label="期望地图" value={verificationExpectedMap} />
                                            <InfoPair label="Dreamview 当前地图" value={verificationDreamviewMap} />
                                            <InfoPair label="runtime 当前地图" value={verificationRuntimeMap} />
                                            <InfoPair label="验证时间" value={verificationTime} />
                                        </div>
                                        <div className="grid gap-2">
                                            <InfoPair label="目标目录 / map_dir" value={verificationTargetDir} wrap />
                                            <InfoPair label="动态定位" value={dynamicPoseLabel} wrap />
                                        </div>
                                        <div className="flex flex-wrap justify-end gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => {
                                                    if (dreamviewHttpUrl) {
                                                        window.open(dreamviewHttpUrl, '_blank', 'noreferrer');
                                                    }
                                                }}
                                                disabled={!dreamviewHttpUrl}
                                            >
                                                <ExternalLinkIcon data-icon="inline-start" />
                                                打开 Dreamview
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                disabled={!rollbackableDeployment || loading}
                                                onClick={() => setRollbackCandidate(rollbackableDeployment)}
                                            >
                                                <RotateCcwIcon data-icon="inline-start" />
                                                回滚
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : null}

                            <details className="rounded-lg border border-border bg-card">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                                    <span className="min-w-0">
                                        <strong className="flex items-center gap-2 text-sm text-foreground">
                                            <HistoryIcon data-icon="inline-start" />
                                            高级 / 最近部署与回滚
                                        </strong>
                                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                                            默认折叠；需要回滚或核对历史时再打开。
                                        </span>
                                    </span>
                                    <Badge variant="outline" className="shrink-0">
                                        {recentDeploymentRecords.length}
                                    </Badge>
                                </summary>
                                <div className="flex flex-col gap-3 border-t border-border p-3">
                                    <div className="flex justify-end">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={refreshDeployments}
                                            disabled={loading}
                                        >
                                            <RefreshCwIcon data-icon="inline-start" />
                                            刷新
                                        </Button>
                                    </div>
                                    <ScrollArea className="h-[230px]">
                                        {recentDeploymentRecords.length > 0 ? (
                                            <div className="flex flex-col gap-2 pr-3">
                                                {recentDeploymentRecords.map((item: any) => {
                                                    const rollbackable =
                                                        item.type === 'deploy' &&
                                                        item.status === 'succeeded' &&
                                                        Boolean(item.backupDir);
                                                    return (
                                                        <div
                                                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2"
                                                            key={item.id}
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-medium text-foreground">
                                                                    {item.mapName || '-'}
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    {`${item.type || 'deploy'} / ${item.status || '-'} / ${formatModifiedTime(
                                                                        item.finishedAt || item.startedAt,
                                                                    )}`}
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    {item.remoteMapDir || item.target?.target || '-'}
                                                                </div>
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="destructive"
                                                                size="sm"
                                                                disabled={!rollbackable || loading}
                                                                onClick={() => setRollbackCandidate(item)}
                                                            >
                                                                <RotateCcwIcon data-icon="inline-start" />
                                                                回滚
                                                            </Button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                                暂无部署记录。
                                            </div>
                                        )}
                                    </ScrollArea>
                                </div>
                            </details>

                            {rollbackCandidate ? (
                                <Alert variant="destructive">
                                    <AlertTriangleIcon />
                                    <AlertTitle>确认回滚边缘设备地图？</AlertTitle>
                                    <AlertDescription>
                                        <div className="flex flex-col gap-3">
                                            <span>
                                                <span>将把</span>
                                                <strong className="mx-1">{rollbackCandidate.mapName || '-'}</strong>
                                                <span>回滚到部署前备份：</span>
                                                <code className="ml-1 rounded bg-background px-1 py-0.5">
                                                    {rollbackCandidate.backupDir || '-'}
                                                </code>
                                            </span>
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => setRollbackCandidate(null)}
                                                    disabled={loading}
                                                >
                                                    取消
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    onClick={rollbackDeployment}
                                                    disabled={loading}
                                                >
                                                    <RotateCcwIcon data-icon="inline-start" />
                                                    确认回滚
                                                </Button>
                                            </div>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            ) : null}
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t border-border bg-muted/40 px-5 py-4">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                        关闭
                    </Button>
                    <Button type="button" onClick={primaryAction} disabled={primaryActionDisabled}>
                        <PrimaryActionIcon data-icon="inline-start" />
                        {primaryActionLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
