import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { AlertCircle, CheckCircle2, CircleDot, FileJson, GitBranch, RefreshCw, Route } from 'lucide-react';
import { Badge } from 'src/components/ui/badge';
import { Button } from 'src/components/ui/button';
import { MapQualityReport } from 'src/quality/mapQuality';
import FileService from 'src/service/index';

interface ReleaseGatePanelProps {
    currentMapName?: string;
    report: MapQualityReport;
    onOpenQuality: () => void;
    onOpenDeploy: () => void;
}

const normalizeMapName = (value?: string) =>
    String(value || '')
        .trim()
        .replace(/\.json$/i, '');

function formatTime(value: string) {
    if (!value) {
        return '暂无';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}

function formatBytes(value: any) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '暂无';
    }
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
}

function formatNumber(value: any, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '-';
    }
    return number.toFixed(digits);
}

function getCaptureDistanceText(check: any) {
    const distance = Number(check?.details?.distanceMeters);
    if (!Number.isFinite(distance)) {
        return '缺少轨迹中心';
    }
    return `${formatNumber(distance, 1)} m`;
}

function getQualityChecks(map: any) {
    return Array.isArray(map?.qualityGate?.checks) ? map.qualityGate.checks : [];
}

function getCheck(map: any, id: string) {
    return getQualityChecks(map).find((check: any) => check.id === id);
}

function statusToVariant(status: string): 'outline' | 'secondary' | 'destructive' {
    if (status === 'error' || status === 'invalid' || status === 'coordinate_invalid') {
        return 'destructive';
    }
    if (status === 'warning') {
        return 'secondary';
    }
    return 'outline';
}

function statusText(status: string) {
    if (status === 'ok') return '通过';
    if (status === 'warning') return '警告';
    if (status === 'error') return '错误';
    if (status === 'ready') return '可部署';
    if (status === 'coordinate_invalid') return '坐标异常';
    if (status === 'invalid') return '无效';
    return status || '未知';
}

function getHeroState(readyForDeploy: boolean, readyForRelease: boolean) {
    if (readyForDeploy) {
        return 'ready';
    }
    if (readyForRelease) {
        return 'warning';
    }
    return 'blocked';
}

function getHeroCopy(state: string) {
    if (state === 'ready') {
        return {
            title: '发布包可部署',
            detail: '后端质量门禁通过，可以直接进入边缘部署；边缘设备侧负责仿真和实车验证。',
            badge: 'ready',
            variant: 'outline' as const,
        };
    }
    if (state === 'warning') {
        return {
            title: '需要生成或复核发布包',
            detail: '当前编辑态没有红色错误，但还需要确认最新发布包的坐标、route 和 POI。',
            badge: 'review',
            variant: 'secondary' as const,
        };
    }
    return {
        title: '当前标注未过门禁',
        detail: '先清理红色质检错误，再发布地图包。',
        badge: 'blocked',
        variant: 'destructive' as const,
    };
}

function buildGateCards(map: any) {
    if (!map) {
        return [];
    }
    const coordinateCheck = getCheck(map, 'coordinate-metadata');
    const boundsCheck = getCheck(map, 'coordinate-bounds');
    const captureCheck = getCheck(map, 'capture-center-distance');
    const routeCheck = getCheck(map, 'default-routing-artifacts');
    const speedCheck = getCheck(map, 'speed-limit-units');
    return [
        {
            key: 'crs',
            label: '坐标系',
            value:
                map?.coordinateTransform?.targetCrs?.epsg || map?.qualityGate?.checks?.[0]?.details?.epsg || '待发布',
            status: coordinateCheck?.status || (map.ready ? 'ok' : 'error'),
            detail: coordinateCheck?.message || '发布后读取坐标元数据',
        },
        {
            key: 'bounds',
            label: '地图坐标范围',
            value: boundsCheck?.status === 'ok' ? '全局 UTM' : '待确认',
            status: boundsCheck?.status || 'warning',
            detail: boundsCheck?.message || map.statusMessage || '检查地图是否仍停留在本地坐标',
        },
        {
            key: 'capture',
            label: '采图中心距离',
            value: getCaptureDistanceText(captureCheck),
            status: captureCheck?.status || 'warning',
            detail: captureCheck?.message || '没有采图轨迹中心时，边缘部署前还需要实车 pose 校验',
        },
        {
            key: 'route',
            label: 'Route / POI',
            value: map.routeArtifacts ? '已生成' : '缺失',
            status: routeCheck?.status || (map.routeArtifacts ? 'ok' : 'error'),
            detail: routeCheck?.message || '发布包应包含 default route、loop plan 和 POI',
        },
        {
            key: 'speed',
            label: '限速单位',
            value: speedCheck?.status === 'ok' ? 'm/s 正常' : '需复核',
            status: speedCheck?.status || 'warning',
            detail: speedCheck?.message || 'Apollo 导出使用 m/s，编辑器输入使用 km/h',
        },
    ];
}

function getSelectedMap(maps: any[], currentMapName?: string, selectedMapName?: string) {
    const selected = normalizeMapName(selectedMapName);
    if (selected) {
        const selectedMap = maps.find((item) => normalizeMapName(item.mapName) === selected);
        if (selectedMap) {
            return selectedMap;
        }
    }
    const current = normalizeMapName(currentMapName);
    if (current) {
        const currentMap = maps.find((item) => normalizeMapName(item.mapName) === current);
        if (currentMap) {
            return currentMap;
        }
    }
    return (
        maps.find((item) => item.selectable && item.ready) || maps.find((item) => item.selectable) || maps[0] || null
    );
}

function buildReleaseCertificate(map: any, report: MapQualityReport) {
    if (!map) {
        return '';
    }
    const checks = getQualityChecks(map);
    const certificate = {
        type: 'landing-mapeditor-release-certificate',
        generatedAt: new Date().toISOString(),
        mapName: map.mapName,
        ready: Boolean(map.ready && map.qualityGate?.ready !== false),
        status: map.status,
        modifiedAt: map.modifiedAt,
        sizeBytes: map.sizeBytes,
        coordinateTransform: map.coordinateTransform || null,
        routeArtifacts: Boolean(map.routeArtifacts),
        files: map.files || [],
        qualityGate: {
            ready: map.qualityGate?.ready,
            errors: checks.filter((check: any) => check.status === 'error').length,
            warnings: checks.filter((check: any) => check.status === 'warning').length,
            checks,
        },
        editorQuality: {
            errors: report.summary.errors,
            warnings: report.summary.warnings,
            lanes: report.summary.lanes,
        },
        deploymentPolicy: 'deploy_to_edge_device_directly; edge_device_runs_simulation',
    };
    return JSON.stringify(certificate, null, 2);
}

export default function ReleaseGatePanel({
    currentMapName,
    report,
    onOpenQuality,
    onOpenDeploy,
}: ReleaseGatePanelProps) {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [releasedMaps, setReleasedMaps] = useState<any[]>([]);
    const [selectedMapName, setSelectedMapName] = useState('');
    const selectedMap = useMemo(
        () => getSelectedMap(releasedMaps, currentMapName, selectedMapName),
        [releasedMaps, currentMapName, selectedMapName],
    );
    const gateCards = useMemo(() => buildGateCards(selectedMap), [selectedMap]);
    const qualityChecks = getQualityChecks(selectedMap);
    const blockingChecks = qualityChecks.filter((check: any) => check.status === 'error');
    const warningChecks = qualityChecks.filter((check: any) => check.status === 'warning');
    const readyForRelease = report.summary.errors === 0;
    const readyForDeploy = Boolean(selectedMap?.ready && selectedMap?.qualityGate?.ready !== false);
    const heroState = getHeroState(readyForDeploy, readyForRelease);
    const heroCopy = getHeroCopy(heroState);
    const copyReleaseCertificate = async () => {
        if (!selectedMap) {
            return;
        }
        const certificate = buildReleaseCertificate(selectedMap, report);
        if (!navigator.clipboard?.writeText) {
            message.warning('当前浏览器不支持自动复制发布证书');
            return;
        }
        await navigator.clipboard.writeText(certificate);
        message.success('发布证书已复制');
    };

    const loadReleasedMaps = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const response = await FileService.getReleasedMaps();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取发布包失败');
            }
            const maps = Array.isArray(response?.data?.maps) ? response.data.maps : [];
            setReleasedMaps(maps);
            setSelectedMapName((current) => getSelectedMap(maps, currentMapName, current)?.mapName || '');
        } catch (error: any) {
            setLoadError(error?.message || '读取发布包失败');
            setReleasedMaps([]);
        } finally {
            setLoading(false);
        }
    }, [currentMapName]);

    useEffect(() => {
        loadReleasedMaps();
    }, [loadReleasedMaps]);

    return (
        <div className="release-gate-panel">
            <section className={`release-gate-hero ${heroState}`}>
                <div className="release-gate-hero-icon">{readyForDeploy ? <CheckCircle2 /> : <AlertCircle />}</div>
                <div>
                    <strong>{heroCopy.title}</strong>
                    <span>{heroCopy.detail}</span>
                </div>
                <Badge variant={heroCopy.variant}>{heroCopy.badge}</Badge>
            </section>

            <section className="release-deploy-action">
                <div>
                    <strong>部署路径</strong>
                    <span>发布包通过后直接推送到边缘设备；仿真和实车验证在边缘设备侧完成。</span>
                </div>
                <Button type="button" variant="default" onClick={onOpenDeploy} disabled={!readyForDeploy}>
                    边缘部署
                </Button>
            </section>

            <section className="release-edit-gate">
                <div>
                    <span>编辑态质检</span>
                    <strong>{`错误 ${report.summary.errors} / 警告 ${report.summary.warnings}`}</strong>
                </div>
                <Button type="button" variant="outline" onClick={onOpenQuality}>
                    <CircleDot data-icon="inline-start" />
                    打开质检
                </Button>
            </section>

            <section className="release-package-section">
                <div className="release-package-heading">
                    <div>
                        <strong>发布包</strong>
                        <span>{selectedMap ? `当前查看 ${selectedMap.mapName}` : '暂无发布包'}</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={loadReleasedMaps} disabled={loading}>
                        <RefreshCw data-icon="inline-start" />
                        刷新
                    </Button>
                    {selectedMap && (
                        <Button type="button" variant="outline" size="sm" onClick={copyReleaseCertificate}>
                            复制证书
                        </Button>
                    )}
                </div>

                {loadError && <div className="release-error">{loadError}</div>}

                {releasedMaps.length > 0 && (
                    <div className="release-map-switcher">
                        {releasedMaps
                            .filter((item) => item.selectable)
                            .slice(0, 6)
                            .map((item) => (
                                <button
                                    type="button"
                                    key={item.mapName}
                                    className={selectedMap?.mapName === item.mapName ? 'active' : ''}
                                    onClick={() => setSelectedMapName(item.mapName)}
                                >
                                    <span>{item.mapName}</span>
                                    <Badge variant={statusToVariant(item.status)}>{statusText(item.status)}</Badge>
                                </button>
                            ))}
                    </div>
                )}

                {selectedMap ? (
                    <>
                        <div className="release-package-summary">
                            <div>
                                <span>状态</span>
                                <strong>{selectedMap.ready ? '可部署' : statusText(selectedMap.status)}</strong>
                            </div>
                            <div>
                                <span>更新时间</span>
                                <strong>{formatTime(selectedMap.modifiedAt)}</strong>
                            </div>
                            <div>
                                <span>大小</span>
                                <strong>{formatBytes(selectedMap.sizeBytes)}</strong>
                            </div>
                        </div>

                        <div className="release-gate-cards">
                            {gateCards.map((card) => (
                                <div className={`release-gate-card ${card.status}`} key={card.key}>
                                    <span>{card.label}</span>
                                    <strong>{card.value}</strong>
                                    <em>{card.detail}</em>
                                </div>
                            ))}
                        </div>

                        <div className="release-artifact-row">
                            <div>
                                <FileJson />
                                <span>manifest</span>
                                <Badge
                                    variant={selectedMap.files?.includes('manifest.json') ? 'outline' : 'destructive'}
                                >
                                    {selectedMap.files?.includes('manifest.json') ? '存在' : '缺失'}
                                </Badge>
                            </div>
                            <div>
                                <Route />
                                <span>default route</span>
                                <Badge variant={selectedMap.routeArtifacts ? 'outline' : 'destructive'}>
                                    {selectedMap.routeArtifacts ? '存在' : '缺失'}
                                </Badge>
                            </div>
                            <div>
                                <GitBranch />
                                <span>routing</span>
                                <Badge
                                    variant={selectedMap.files?.includes('routing_map.bin') ? 'outline' : 'destructive'}
                                >
                                    {selectedMap.files?.includes('routing_map.bin') ? '存在' : '缺失'}
                                </Badge>
                            </div>
                        </div>

                        {blockingChecks.length > 0 && (
                            <div className="release-blocking-list">
                                <strong>阻塞部署</strong>
                                {blockingChecks.slice(0, 5).map((check: any) => (
                                    <span key={check.id || check.title}>
                                        {check.message || check.title || check.id}
                                    </span>
                                ))}
                            </div>
                        )}

                        {warningChecks.length > 0 && blockingChecks.length === 0 && (
                            <div className="release-warning-list">
                                <strong>需要确认</strong>
                                {warningChecks.slice(0, 5).map((check: any) => (
                                    <span key={check.id || check.title}>
                                        {check.message || check.title || check.id}
                                    </span>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="release-empty">
                        暂无发布包。先保存标注并从顶部“生产”菜单发布，再回到这里确认坐标、route 和质量门禁。
                    </div>
                )}
            </section>
        </div>
    );
}
