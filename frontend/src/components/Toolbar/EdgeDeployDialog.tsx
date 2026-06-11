import React, { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangleIcon,
    BoxIcon,
    CheckCircle2Icon,
    CloudUploadIcon,
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
    SelectSeparator,
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

const formatBytes = (value: any) => {
    const bytes = Number(value) || 0;
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 * 1024 ? 1 : 2)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
};

const formatMeters = (value: any) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '待预检';
    }
    return `${number.toFixed(number >= 10 ? 1 : 2)} m`;
};

const formatBoundsCenter = (bounds: any) => {
    if (!bounds || !Number.isFinite(Number(bounds.centerX)) || !Number.isFinite(Number(bounds.centerY))) {
        return '待预检';
    }
    return `${Number(bounds.centerX).toFixed(3)}, ${Number(bounds.centerY).toFixed(3)}`;
};

const mapStatusColor = (map: any): StatusLevel => {
    if (map?.ready) {
        return 'ok';
    }
    if (map?.status === 'invalid') {
        return 'error';
    }
    return 'warning';
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

const getPreflightNextAction = (item: any) => {
    switch (item?.name) {
        case 'edge-mode':
            return '先保存边缘设备配置，确认已启用 SSH 部署模式。';
        case 'edge-target':
            return '补齐设备 IP、SSH 用户、端口和密码后重新预检。';
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

function StatusLight({ level, label }: { level: StatusLevel; label: string }) {
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
            <span className={cn('size-2.5 shrink-0 rounded-full', statusDotClass[level])} />
            <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{label}</div>
                <div className="truncate text-sm font-medium text-foreground">{statusTextMap[level]}</div>
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

function InfoPair({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="min-w-0 rounded-lg border border-border bg-muted/25 px-3 py-2">
            <div className="truncate text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 truncate text-sm font-medium text-foreground">{value || '-'}</div>
        </div>
    );
}

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
    const latestReadyMapName = readyMaps[0]?.mapName || '';
    const preflightChecks = useMemo(() => getChecks(preflight), [preflight]);
    const runtimeCheck = useMemo(() => getCheck(preflight, 'edge-runtime-status'), [preflight]);
    const dreamviewCheck = useMemo(() => getCheck(preflight, 'edge-dreamview-hmi'), [preflight]);
    const coordinateCheck = useMemo(() => getCheck(preflight, 'selected-map-coordinates'), [preflight]);
    const vehiclePoseCheck = useMemo(() => getCheck(preflight, 'selected-map-vehicle-pose'), [preflight]);
    const runtimeDetails = runtimeCheck?.details || null;
    const vehiclePoseDetails = vehiclePoseCheck?.details || coordinateCheck?.details?.vehiclePoseValidation || null;
    const coordinateBounds = coordinateCheck?.details?.localBounds || null;
    const readyCheckCount = preflightChecks.filter((item: any) => item.status === 'ok').length;
    const warningCheckCount = preflightChecks.filter((item: any) => item.status === 'warning').length;
    const errorCheckCount = preflightChecks.filter((item: any) => item.status === 'error').length;
    const recentDeploymentRecords = useMemo(
        () => deploymentRecords.filter((item: any) => item?.type === 'deploy' || item?.type === 'rollback').slice(0, 6),
        [deploymentRecords],
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
            const [response, mapsResponse] = await Promise.all([
                FileService.getDeployConfig(),
                FileService.getReleasedMaps(),
            ]);
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取边缘设备配置失败');
            }
            const data = response.data || {};
            const maps = Array.isArray(mapsResponse?.data?.maps) ? mapsResponse.data.maps : [];
            const defaultMapName = resolveDefaultMapName(maps);
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
        }
    }, [loadConfig, loadDeployments, open]);

    const validateValues = (requireMap = true) => {
        const errors: string[] = [];
        if (!values.host.trim()) {
            errors.push('请输入边缘设备 IP');
        }
        if (!values.user.trim()) {
            errors.push('请输入 SSH 用户');
        }
        if (!Number.isFinite(Number(values.port)) || Number(values.port) <= 0) {
            errors.push('请输入有效 SSH 端口');
        }
        if (!values.targetMapRoot.trim()) {
            errors.push('请输入 Apollo 地图目录');
        }
        if (requireMap && !values.mapName) {
            errors.push('请选择发布包');
        }
        return errors;
    };

    const buildDeployPayload = () => ({
        ...values,
        mode: 'ssh',
        autoDiscover: false,
    });

    const runPreflight = async (saveConfig: boolean) => {
        const errors = validateValues(true);
        if (errors.length > 0) {
            setNotice({
                type: 'error',
                title: '配置不完整',
                description: errors.join('；'),
            });
            return false;
        }
        const response = saveConfig
            ? await FileService.configureEdgeDeploy(buildDeployPayload())
            : await FileService.preflightDeploy(values.mapName);
        const nextPreflight = saveConfig ? response?.data?.preflight : response?.data;
        setPreflight(nextPreflight || null);
        if (saveConfig) {
            setDeployConfig(
                response?.data?.deployConfig || {
                    ...deployConfig,
                    host: values.host,
                    user: values.user,
                    port: values.port,
                    mode: 'ssh',
                    enabled: true,
                    targetMapRoot: values.targetMapRoot,
                    dockerContainer: values.dockerContainer,
                    nativeMapTools: values.nativeMapTools,
                    autoSwitchDreamview: values.autoSwitchDreamview,
                    postDeployCommand: values.postDeployCommand,
                    passwordConfigured: passwordConfigured || Boolean(values.password),
                },
            );
            setEditingDevice(false);
        }
        if (response?.code === 0) {
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
        setNotice({
            type: 'error',
            title: saveConfig ? '设备已保存，但预检未通过' : '预检未通过',
            description: buildPreflightFailureDescription(errorsOrWarnings, response?.message || '预检未通过'),
        });
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
        setLoading(true);
        setJobText(`正在刷新边缘设备状态：${values.mapName || '所选发布包'}`);
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
            setLoading(false);
            setJobText('');
        }
    };

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

    const selectedMapStatusValue = selectedMap ? (
        <span className="inline-flex items-center gap-2">
            <span className={cn('size-2 rounded-full', statusDotClass[mapStatusColor(selectedMap)])} />
            {selectedMap.ready ? 'ready' : selectedMap.status || 'invalid'}
        </span>
    ) : null;
    const primaryBlockedMap = nonReadyMaps[0] || null;

    const selectLatestReadyMap = () => {
        if (!latestReadyMapName) {
            return;
        }
        updateValue('mapName', latestReadyMapName);
        setPreflight(null);
    };

    const renderMapOption = (item: any, optionIndex: number) => {
        const optionStatus = item.ready ? 'ready' : item.status || 'invalid';
        const optionTime = item.modifiedAt ? ` / ${formatModifiedTime(item.modifiedAt)}` : '';
        let warningHint = '';
        if (!item.ready && item.statusMessage) {
            warningHint = ` / ${String(item.statusMessage).slice(0, 96)}`;
        } else if (!item.ready) {
            warningHint = ' / 不可部署：请修复检查项';
        }

        return (
            <SelectItem key={item.mapName} value={item.mapName} disabled={!item.ready}>
                <span className="flex min-w-0 flex-col py-0.5">
                    <span className="truncate text-sm">{`${optionIndex + 1}. ${item.mapName}`}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {optionStatus}
                        {optionTime}
                        {warningHint}
                    </span>
                </span>
            </SelectItem>
        );
    };

    let releasePackageSummary: ReactNode;
    if (selectedMap) {
        releasePackageSummary = (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <InfoPair label="发布包" value={selectedMap.mapName} />
                <InfoPair label="状态" value={selectedMapStatusValue} />
                <InfoPair label="修改时间" value={formatModifiedTime(selectedMap.modifiedAt)} />
                <InfoPair label="大小" value={formatBytes(selectedMap.sizeBytes)} />
            </div>
        );
    } else if (primaryBlockedMap) {
        const blockedMessage = `${primaryBlockedMap.mapName}：${
            primaryBlockedMap.statusMessage || '发布检查未通过，请先修复后重新生成发布包。'
        }`;
        releasePackageSummary = (
            <Alert>
                <AlertTriangleIcon />
                <AlertTitle>没有可部署发布包</AlertTitle>
                <AlertDescription>{blockedMessage}</AlertDescription>
            </Alert>
        );
    } else {
        releasePackageSummary = (
            <Alert>
                <InfoIcon />
                <AlertTitle>没有可部署发布包</AlertTitle>
                <AlertDescription>请先从当前地图生成发布包，并确保发布检查通过。</AlertDescription>
            </Alert>
        );
    }

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
                className="grid-rows-none flex-col gap-0 overflow-hidden border border-border bg-popover p-0 text-popover-foreground"
                style={{
                    display: 'flex',
                    top: '16px',
                    right: '16px',
                    bottom: '16px',
                    left: '16px',
                    width: 'auto',
                    maxWidth: 'none',
                    height: 'auto',
                    transform: 'none',
                }}
            >
                <DialogHeader className="border-b border-border px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-semibold">边缘设备部署</DialogTitle>
                            <DialogDescription className="mt-2">
                                固定边缘设备配置后，后续只需要选择发布包、刷新状态、部署地图。
                            </DialogDescription>
                        </div>
                        <Badge variant={overviewStatus === 'error' ? 'destructive' : 'secondary'} className="shrink-0">
                            {getOverviewStatusText(overviewStatus, Boolean(preflight))}
                        </Badge>
                    </div>
                </DialogHeader>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
                        <div className="flex min-w-0 flex-col gap-4">
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
                                        <StatusLight level={sshStatus} label="设备在线" />
                                        <StatusLight level={dockerStatus} label="容器可用" />
                                        <StatusLight level={dreamviewStatus} label="Dreamview" />
                                        <StatusLight level={overviewStatus} label="是否可部署" />
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                        <InfoPair label="Docker 容器" value={values.dockerContainer || '宿主机模式'} />
                                        <InfoPair label="密码状态" value={passwordConfigured ? '已保存' : '未保存'} />
                                        <InfoPair label="当前加载" value={runtimeDetails?.map_name || '待预检'} />
                                        <InfoPair label="发布包中心" value={formatBoundsCenter(coordinateBounds)} />
                                    </div>
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
                                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                                        <Select
                                            value={values.mapName}
                                            onValueChange={(mapName) => {
                                                updateValue('mapName', mapName);
                                                setPreflight(null);
                                            }}
                                            disabled={loading || selectableMaps.length === 0}
                                        >
                                            <SelectTrigger className="h-8 w-full">
                                                <SelectValue placeholder="选择发布包" />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-[360px] min-w-[560px]">
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
                                                {nonReadyMaps.length > 0 ? (
                                                    <>
                                                        <SelectSeparator />
                                                        <SelectGroup>
                                                            <SelectLabel className="px-2 text-[11px] font-medium text-muted-foreground">
                                                                不可部署（待修复）
                                                            </SelectLabel>
                                                            {nonReadyMaps.map((item: any, index: number) =>
                                                                renderMapOption(item, readyMaps.length + index),
                                                            )}
                                                        </SelectGroup>
                                                    </>
                                                ) : null}
                                                {selectableMaps.length === 0 ? (
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
                                            onClick={selectLatestReadyMap}
                                            disabled={loading || !latestReadyMapName}
                                        >
                                            <HistoryIcon data-icon="inline-start" />
                                            选择最新可部署
                                        </Button>
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

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <CheckCircle2Icon data-icon="inline-start" />
                                        发布预检
                                    </CardTitle>
                                    <CardDescription>当前地图是否能安全下发到固定边缘设备。</CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <InfoPair label="通过" value={preflight ? readyCheckCount : '待预检'} />
                                        <InfoPair
                                            label="警告/错误"
                                            value={preflight ? `${warningCheckCount} / ${errorCheckCount}` : '待预检'}
                                        />
                                        <InfoPair
                                            label="车辆到中心线"
                                            value={formatMeters(vehiclePoseDetails?.nearest?.distanceMeters)}
                                        />
                                        <InfoPair label="坐标链路" value={statusTextMap[packageStatus]} />
                                    </div>

                                    <ScrollArea className="h-[290px] rounded-lg border border-border">
                                        {preflightChecks.length > 0 ? (
                                            <div className="flex flex-col p-2">
                                                {preflightChecks.map((item: any) => {
                                                    const level = normalizeStatus(item.status);
                                                    return (
                                                        <div
                                                            className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2"
                                                            key={item.name}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    'mt-1 size-2.5 rounded-full',
                                                                    statusDotClass[level],
                                                                )}
                                                            />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <strong className="truncate text-sm text-foreground">
                                                                        {checkTitleMap[item.name] || item.name}
                                                                    </strong>
                                                                    <Badge
                                                                        variant={
                                                                            level === 'error'
                                                                                ? 'destructive'
                                                                                : 'outline'
                                                                        }
                                                                    >
                                                                        {item.status}
                                                                    </Badge>
                                                                </div>
                                                                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                                                    {getCheckDisplayMessage(item)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                                                点击“刷新状态”或“保存设备并预检”后，这里会显示 SSH、Docker、Dreamview
                                                和坐标检查结果。
                                            </div>
                                        )}
                                    </ScrollArea>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <CardTitle className="flex items-center gap-2">
                                                <HistoryIcon data-icon="inline-start" />
                                                最近部署
                                            </CardTitle>
                                            <CardDescription>只保留操作需要看的部署和回滚记录。</CardDescription>
                                        </div>
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
                                </CardHeader>
                                <CardContent>
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
                                </CardContent>
                            </Card>

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
                    <Button type="button" variant="outline" onClick={refreshStatus} disabled={loading}>
                        <WifiIcon data-icon="inline-start" />
                        刷新状态
                    </Button>
                    <Button type="button" variant="secondary" onClick={saveAndPreflight} disabled={loading}>
                        <SaveIcon data-icon="inline-start" />
                        保存设备并预检
                    </Button>
                    <Button type="button" onClick={deploySelected} disabled={loading || !selectedMap?.ready}>
                        <CloudUploadIcon data-icon="inline-start" />
                        部署所选地图
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
