import PubSub from 'pubsub-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Space, Table, Tag, message } from 'antd';
import { ModalProps } from 'antd/lib/modal';
import FileService from 'src/service/index';

interface AssetManagerDialogProps extends Omit<ModalProps, 'visible'> {
    open: boolean;
    onCancel?: () => void;
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/i, '');

const sanitizeName = (name: string) =>
    name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 86);

const createFallbackName = () => {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `capture_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
        now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const createMergedMapName = () => `merged_${createFallbackName().replace(/^capture_/, '')}`;

const AUTO_MERGED_BASE_MAP_NAME = 'capture_inbox_merged';

const buildPackageName = (files: File[]) => {
    if (files.length === 0) {
        return createFallbackName();
    }
    if (files.length === 1) {
        return sanitizeName(stripExtension(files[0].name)) || createFallbackName();
    }
    const firstName = sanitizeName(stripExtension(files[0].name));
    return firstName.length >= 4 ? firstName : createFallbackName();
};

const sleep = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const formatCount = (value: any) => {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue.toLocaleString() : '0';
};

const formatBytes = (value: any) => {
    const numberValue = Number(value || 0);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(numberValue) / Math.log(1024)), units.length - 1);
    return `${(numberValue / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
};

const formatDateTime = (value: string) => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
};

const getPackageTitle = (packageInfo: any) =>
    packageInfo?.displayName || packageInfo?.defaultMapName || packageInfo?.packageId || '';

const formatBounds = (bounds: any) => {
    if (!bounds) {
        return '';
    }
    return `X ${bounds.minX} ~ ${bounds.maxX}, Y ${bounds.minY} ~ ${bounds.maxY}`;
};

const getJobStatusColor = (status: string) => {
    if (status === 'succeeded') {
        return 'green';
    }
    if (status === 'failed') {
        return 'red';
    }
    if (status === 'running') {
        return 'blue';
    }
    if (status === 'queued') {
        return 'gold';
    }
    return 'default';
};

const BASE_MAP_JOB_TYPES = new Set([
    'prebuild-data-package-base-maps',
    'import-data-package-base-map',
    'import-data-packages-merged-base-map',
]);

const isActiveJob = (job: any) => job?.status === 'queued' || job?.status === 'running';

const isBaseMapJob = (job: any) => BASE_MAP_JOB_TYPES.has(job?.type);

const getJobTypeLabel = (type: string) => {
    if (type === 'prebuild-data-package-base-maps') {
        return '自动生产';
    }
    if (type === 'import-data-package-base-map') {
        return '单包底图';
    }
    if (type === 'import-data-packages-merged-base-map') {
        return '合并拼图';
    }
    return type || '任务';
};

const getLatestJobMessage = (job: any) => {
    const logs = Array.isArray(job?.logs) ? job.logs : [];
    const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
    return latestLog?.message || job?.message || '';
};

const workflowStatusColor: Record<string, string> = {
    pending_precheck: 'default',
    ready_for_basemap: 'blue',
    base_map_ready: 'green',
    missing_point_cloud: 'orange',
    precheck_failed: 'red',
};

const qualityColor: Record<string, string> = {
    excellent: 'green',
    good: 'blue',
    usable: 'gold',
    sparse: 'orange',
    unknown: 'default',
};

const getWorkflowStatusLabel = (packageInfo: any) =>
    packageInfo?.workflowStatus?.label || (packageInfo?.summary ? '已预检' : '待预检');

const getWorkflowStatusColor = (packageInfo: any) =>
    workflowStatusColor[packageInfo?.workflowStatus?.code] || (packageInfo?.summary ? 'blue' : 'default');

const coordinateKindLabel: Record<string, string> = {
    projected_meters_or_large_local: '投影坐标',
    lonlat_range_compatible: '经纬度',
    local_meters: '局部坐标',
    ecef_xyz: 'ECEF',
};

const getCoordinateLabel = (quality: any) =>
    coordinateKindLabel[quality?.representativeCoordinateKind] || quality?.representativeCoordinateKind || '坐标未知';

const formatQualityText = (quality: any) => {
    if (!quality) {
        return '未知';
    }
    const density = Number(quality.pointDensity || 0);
    const area = Number(quality.areaSquareMeters || 0);
    return `${quality.rating || 'unknown'} / ${density.toFixed(1)} pts/m² / ${(area / 10000).toFixed(2)} ha`;
};

const formatPackageAnalysis = (packageInfo: any) => {
    const summary = packageInfo?.summary || {};
    const analyses = packageInfo?.analyses || [];
    const pointCloud = analyses.flatMap((item: any) => item.pointClouds || [])[0];
    const image = analyses.flatMap((item: any) => item.images || [])[0];
    const trajectory = summary.trajectory || {};
    const lines = [
        `资产 ID: ${packageInfo?.packageId || ''}`,
        `存储路径: ${packageInfo?.path || ''}`,
        `文件数: ${formatCount(summary.totalFiles)}`,
        `点云: ${formatCount(summary.pointCloudFiles)} 个 (LAS ${formatCount(summary.lasFiles)}, PCD ${formatCount(
            summary.pcdFiles,
        )})`,
        `图片: ${formatCount(summary.imageFiles)} 张`,
        `元数据: ${formatCount(summary.metadataFiles)} 个`,
        `估算点数: ${formatCount(summary.pointCount)}`,
        `资产大小: ${formatBytes(packageInfo?.sizeBytes)}`,
    ];
    if (packageInfo?.workflowStatus) {
        lines.push(`资产状态: ${packageInfo.workflowStatus.label || packageInfo.workflowStatus.code}`);
    }
    if (packageInfo?.sourceManifest) {
        lines.push(
            `同步来源: ${packageInfo.sourceManifest.sourcePackage || packageInfo.sourceManifest.sourceRoot || ''}`,
        );
        lines.push(
            `ResultOut: ${formatCount(packageInfo.sourceManifest.fileCount)} 个 LAS / ${formatBytes(
                packageInfo.sourceManifest.totalBytes,
            )}`,
        );
    }
    if (packageInfo?.quality) {
        lines.push(`质量评级: ${formatQualityText(packageInfo.quality)}`);
        lines.push(`坐标组: ${packageInfo.coordinateGroup || packageInfo.quality.coordinateGroup || '未知'}`);
    }
    if (pointCloud) {
        lines.push('');
        lines.push(`点云样例: ${pointCloud.source || ''}`);
        lines.push(`格式: LAS ${pointCloud.version || ''} / point format ${pointCloud.pointFormat ?? ''}`);
        lines.push(`坐标判断: ${pointCloud.coordinate?.kind || ''}`);
        if (pointCloud.coordinate?.message) {
            lines.push(pointCloud.coordinate.message);
        }
        if (pointCloud.bounds) {
            lines.push(
                `范围: X ${pointCloud.bounds.minX} ~ ${pointCloud.bounds.maxX}, Y ${pointCloud.bounds.minY} ~ ${pointCloud.bounds.maxY}`,
            );
        }
    }
    if (image) {
        lines.push('');
        lines.push(`图片样例: ${image.source || ''}`);
        lines.push(`尺寸: ${image.width || '?'} x ${image.height || '?'}`);
        lines.push(`相机: ${image.make || ''} ${image.model || ''}`);
        lines.push(`时间: ${image.dateTime || ''}`);
        if (image.filenameGpsTime) {
            lines.push(
                `文件名 GPS 时间: week ${image.filenameGpsTime.gpsWeek}, SOW ${image.filenameGpsTime.secondsOfWeek}`,
            );
            lines.push(`折算 UTC: ${image.filenameGpsTime.utcIso || ''}`);
        }
    }
    if (trajectory.poseFileCount > 0) {
        lines.push('');
        lines.push(`RTK/轨迹文件: ${formatCount(trajectory.poseFileCount)} 个`);
        lines.push(`轨迹样本: ${formatCount(trajectory.sampleCount)}`);
        lines.push(`拼图优先源: ${trajectory.preferredSource || ''}`);
        lines.push(`轨迹类型: ${trajectory.preferredKind || ''}`);
        lines.push(`轨迹坐标: ${trajectory.preferredCoordinateKind || ''}`);
        if (trajectory.utcRange?.start || trajectory.utcRange?.end) {
            lines.push(`时间范围: ${trajectory.utcRange?.start || ''} ~ ${trajectory.utcRange?.end || ''}`);
        }
        if (trajectory.bounds) {
            lines.push(`轨迹范围: ${formatBounds(trajectory.bounds)}`);
        }
        if (trajectory.message) {
            lines.push(trajectory.message);
        }
        if (trajectory.sources?.length) {
            lines.push('轨迹源:');
            trajectory.sources.forEach((item: any) => {
                lines.push(
                    `- ${item.source}: ${item.kind}, ${formatCount(item.sampleCount)} 样本, ${item.coordinateKind || ''}`,
                );
            });
        }
    }
    if (summary.recommendations?.length) {
        lines.push('');
        lines.push('建议:');
        summary.recommendations.forEach((item: string) => lines.push(`- ${item}`));
    }
    return lines.join('\n');
};

export default function AssetManagerDialog({ open, onCancel, ...rest }: AssetManagerDialogProps) {
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [packages, setPackages] = useState<any[]>([]);
    const [jobs, setJobs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [jobText, setJobText] = useState('');
    const [mergedBaseMapReady, setMergedBaseMapReady] = useState(false);
    const [selectedPackageIds, setSelectedPackageIds] = useState<React.Key[]>([]);
    const selectedPackageIdSet = new Set(selectedPackageIds.map(String));
    const selectedPackages = packages.filter((item) => selectedPackageIdSet.has(item.packageId));
    const primaryPackage = selectedPackages[0];
    const activeBaseMapJob = jobs.find((job) => isBaseMapJob(job) && isActiveJob(job));
    const activeMergeJob = jobs.find((job) => job.type === 'import-data-packages-merged-base-map' && isActiveJob(job));
    const baseMapBusy = Boolean(activeBaseMapJob);
    const activeBaseMapJobMessage = activeBaseMapJob ? getLatestJobMessage(activeBaseMapJob) : '';
    const assetStats = packages.reduce(
        (stats, item) => {
            const summary = item.summary || {};
            const statusCode = item.workflowStatus?.code;
            return {
                totalSizeBytes: stats.totalSizeBytes + Number(item.sizeBytes || 0),
                pointCloudAssets:
                    stats.pointCloudAssets +
                    (item.workflowStatus?.canGenerateBaseMap || Number(summary.pointCloudFiles || 0) > 0 ? 1 : 0),
                rtkAssets: stats.rtkAssets + (Number(summary.trajectory?.poseFileCount || 0) > 0 ? 1 : 0),
                pendingAssets: stats.pendingAssets + (statusCode === 'pending_precheck' ? 1 : 0),
                generatedAssets: stats.generatedAssets + (statusCode === 'base_map_ready' ? 1 : 0),
            };
        },
        { totalSizeBytes: 0, pointCloudAssets: 0, rtkAssets: 0, pendingAssets: 0, generatedAssets: 0 },
    );
    const selectedStats = selectedPackages.reduce(
        (stats, item) => {
            const summary = item.summary || {};
            return {
                totalSizeBytes: stats.totalSizeBytes + Number(item.sizeBytes || 0),
                pointCount: stats.pointCount + Number(summary.pointCount || 0),
                pointCloudFiles: stats.pointCloudFiles + Number(summary.pointCloudFiles || 0),
                imageFiles: stats.imageFiles + Number(summary.imageFiles || 0),
                rtkAssets: stats.rtkAssets + (Number(summary.trajectory?.poseFileCount || 0) > 0 ? 1 : 0),
            };
        },
        { totalSizeBytes: 0, pointCount: 0, pointCloudFiles: 0, imageFiles: 0, rtkAssets: 0 },
    );
    const assetCountText = formatCount(packages.length);
    const selectedCountText = formatCount(selectedPackages.length);
    const generatedBaseMapText = `${formatCount(assetStats.generatedAssets)} / ${formatCount(
        assetStats.pointCloudAssets,
    )}`;
    const selectedSummaryText = `点云文件 ${formatCount(selectedStats.pointCloudFiles)}，估算点数 ${formatCount(
        selectedStats.pointCount,
    )}，图片 ${formatCount(selectedStats.imageFiles)}，含 RTK 资产 ${formatCount(
        selectedStats.rtkAssets,
    )}，大小 ${formatBytes(selectedStats.totalSizeBytes)}`;
    const productionStateText = activeBaseMapJob ? `${getJobTypeLabel(activeBaseMapJob.type)}运行中` : '自动生产空闲';
    const mergeStateText = (() => {
        if (activeMergeJob) {
            return `正在生成 ${activeMergeJob.request?.mapName || '合并底图'}`;
        }
        if (mergedBaseMapReady) {
            return `${AUTO_MERGED_BASE_MAP_NAME} 已可用`;
        }
        return '等待至少两个同坐标组资产';
    })();
    const mergeEntryText = AUTO_MERGED_BASE_MAP_NAME;
    const generationModeText = (() => {
        if (selectedPackages.length > 1) {
            return '多包拼图';
        }
        if (selectedPackages.length === 1) {
            return '单包底图';
        }
        return '等待选择';
    })();
    const openStageText = selectedPackages.length === 1 ? '打开当前底图' : '单选后打开';
    const selectionPanelClassName =
        selectedPackages.length > 0 ? 'asset-selection-panel' : 'asset-selection-panel is-empty';
    const emptySelectionText = '选择一个资产生成单包底图，选择多个资产合并拼图。';

    const loadPackages = useCallback(async () => {
        setLoading(true);
        try {
            const response = await FileService.getDataPackages();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取资产包失败');
            }
            setPackages(response?.data?.packages || []);
        } catch (error) {
            Modal.error({
                title: '读取资产失败',
                content: error instanceof Error ? error.message : '读取资产包失败',
            });
        } finally {
            setLoading(false);
        }
    }, []);

    const loadJobs = useCallback(async () => {
        try {
            const response = await FileService.getRuntimeJobs(12);
            if (response?.code === 0) {
                setJobs(response?.data?.jobs || []);
            }
        } catch (error) {
            setJobs([]);
        }
    }, []);

    const loadMergedBaseMap = useCallback(async () => {
        const response = await FileService.getBaseMapInfo(AUTO_MERGED_BASE_MAP_NAME);
        setMergedBaseMapReady(Boolean(response?.tiles));
    }, []);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadPackages(), loadJobs(), loadMergedBaseMap()]);
    }, [loadJobs, loadMergedBaseMap, loadPackages]);

    const waitForRuntimeJob = async (jobId: string, label: string, attempt = 0): Promise<any> => {
        if (attempt >= 600) {
            setJobText('');
            throw new Error('后台任务等待超时');
        }
        const response = await FileService.getRuntimeJob(jobId, true);
        if (response?.code !== 0) {
            throw new Error(response?.message || '读取后台任务失败');
        }
        const job = response?.data?.job;
        if (!job) {
            throw new Error('Runtime job response is empty');
        }
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 12));
        if (job?.status === 'succeeded') {
            setJobText('');
            return job;
        }
        if (job?.status === 'failed') {
            setJobText('');
            throw new Error(job?.message || '后台任务失败');
        }
        const latestMessage = getLatestJobMessage(job);
        setJobText(`${label}${latestMessage ? `：${latestMessage}` : `，状态：${job?.status || 'running'}`}`);
        await sleep(3000);
        return waitForRuntimeJob(jobId, label, attempt + 1);
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (uploadInputRef.current) {
            uploadInputRef.current.value = '';
        }
        if (files.length === 0) {
            return;
        }
        const packageName = buildPackageName(files);
        setUploading(true);
        setJobText(`正在上传采图包：${packageName}`);
        try {
            const response = await FileService.startAnalyzeDataPackageJob(
                files.length === 1 ? files[0] : files,
                packageName,
            );
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交采图包预检任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, `正在预检采图包 ${packageName}`);
            await refreshAll();
            Modal.info({
                title: '采图包预检完成',
                width: 860,
                content: <pre className="asset-manager-detail">{formatPackageAnalysis(job.result)}</pre>,
            });
        } catch (error) {
            Modal.error({
                title: '上传或预检失败',
                content: error instanceof Error ? error.message : '上传或预检失败',
            });
        } finally {
            setUploading(false);
            setJobText('');
        }
    };

    const handleRefreshAnalysis = async (packageInfo: any) => {
        setUploading(true);
        setJobText(`正在重跑预检：${packageInfo.defaultMapName || packageInfo.packageId}`);
        try {
            const response = await FileService.startRefreshDataPackageAnalysisJob(packageInfo.packageId);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交重跑预检任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(
                jobId,
                `正在重跑预检 ${packageInfo.defaultMapName || packageInfo.packageId}`,
            );
            await refreshAll();
            Modal.info({
                title: '预检已更新',
                width: 860,
                content: <pre className="asset-manager-detail">{formatPackageAnalysis(job.result)}</pre>,
            });
        } catch (error) {
            Modal.error({
                title: '重跑预检失败',
                content: error instanceof Error ? error.message : '重跑预检失败',
            });
        } finally {
            setUploading(false);
            setJobText('');
        }
    };

    const handleRefreshAllAnalysis = async () => {
        setUploading(true);
        setJobText('正在自检待预检采图包');
        try {
            const response = await FileService.startRefreshAllDataPackageAnalysisJob(true);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交批量自检任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, '正在批量自检采图包');
            await refreshAll();
            message.success(`批量自检完成：${formatCount(job.result?.refreshedCount)} 个`);
        } catch (error) {
            Modal.error({
                title: '批量自检失败',
                content: error instanceof Error ? error.message : '批量自检失败',
            });
        } finally {
            setUploading(false);
            setJobText('');
        }
    };

    const handleSyncCaptureSources = async () => {
        setUploading(true);
        setJobText('正在扫描固定采图目录');
        try {
            const response = await FileService.startSyncCaptureSourcePackagesJob({
                onlyNew: true,
                overwrite: false,
                limit: 50,
                autoGenerateBaseMaps: true,
                maxBaseMapJobs: 20,
                autoMerge: true,
                mergedMapName: 'capture_source_merged',
                overwriteBaseMaps: false,
                overwriteMergedMap: true,
            });
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交采图目录同步任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, '正在同步固定采图目录');
            await refreshAll();
            Modal.info({
                title: '采图目录同步完成',
                width: 760,
                content: (
                    <pre className="asset-manager-detail">
                        {[
                            `来源: ${job.result?.sourceRoot || ''}`,
                            `扫描采图包: ${formatCount(job.result?.scannedCount)}`,
                            `新增导入: ${formatCount(job.result?.importedCount)}`,
                            `跳过: ${formatCount(job.result?.skippedCount)}`,
                            `预生成底图: ${formatCount(job.result?.generatedBaseMapCount)}`,
                            `自动拼图: ${job.result?.mergedMap?.mapName || '未生成'}`,
                        ].join('\n')}
                    </pre>
                ),
            });
        } catch (error) {
            Modal.error({
                title: '采图目录同步失败',
                content:
                    error instanceof Error
                        ? error.message
                        : '采图目录同步失败。请确认服务端已配置 MAP_CAPTURE_SOURCE_ROOT。',
            });
        } finally {
            setUploading(false);
            setJobText('');
        }
    };

    const handleGenerateBaseMap = (packageInfo: any) => {
        const mapName = sanitizeName(packageInfo.defaultMapName || packageInfo.packageId) || createFallbackName();
        Modal.confirm({
            title: '生成点云底图',
            width: 720,
            okText: '生成',
            cancelText: '取消',
            content: (
                <pre className="asset-manager-detail">
                    {[
                        `资产: ${packageInfo.defaultMapName || packageInfo.packageId}`,
                        `底图名: ${mapName}`,
                        `点云文件: ${formatCount(packageInfo.summary?.pointCloudFiles)} 个`,
                        `估算点数: ${formatCount(packageInfo.summary?.pointCount)}`,
                        '',
                        '生成会覆盖同名底图，并使用当前后端的点云增强参数重新建图。',
                    ].join('\n')}
                </pre>
            ),
            onOk: async () => {
                setUploading(true);
                setJobText(`正在提交底图生成任务：${mapName}`);
                try {
                    const response = await FileService.startDataPackageBaseMapJob(packageInfo.packageId, mapName, true);
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交底图生成任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, `正在生成底图 ${mapName}`);
                    await refreshAll();
                    message.success(`底图 ${job.result?.mapName || mapName} 生成完成`);
                } catch (error) {
                    Modal.error({
                        title: '底图生成失败',
                        content: error instanceof Error ? error.message : '底图生成失败',
                    });
                    throw error;
                } finally {
                    setUploading(false);
                    setJobText('');
                }
            },
        });
    };

    const handleGenerateMergedBaseMap = async () => {
        const packageIds = selectedPackageIds.map(String);
        const packagesForMerge = packages.filter((item) => packageIds.includes(item.packageId));
        if (packagesForMerge.length < 2) {
            message.warning('请至少选择两个采图包');
            return;
        }
        let stitchPlan: any = null;
        try {
            const planResponse = await FileService.getDataPackageStitchPlan(packageIds);
            stitchPlan = planResponse?.data;
            if (planResponse?.code !== 0 || !stitchPlan?.ready) {
                Modal.error({
                    title: '拼图预检未通过',
                    content: (
                        <pre className="asset-manager-detail">
                            {[
                                `错误: ${(stitchPlan?.errors || []).join(', ') || planResponse?.message || 'unknown'}`,
                                '',
                                ...(stitchPlan?.packages || []).map(
                                    (item: any) =>
                                        `- ${item.displayName || item.packageId}: ${item.stitchingReadiness}, 坐标组 ${
                                            item.coordinateGroup || '未知'
                                        }`,
                                ),
                            ].join('\n')}
                        </pre>
                    ),
                });
                return;
            }
        } catch (error) {
            Modal.error({
                title: '拼图预检失败',
                content: error instanceof Error ? error.message : '拼图预检失败',
            });
            return;
        }
        const mapName = sanitizeName(createMergedMapName()) || createFallbackName();
        Modal.confirm({
            title: '合并生成点云底图',
            width: 760,
            okText: '生成',
            cancelText: '取消',
            content: (
                <pre className="asset-manager-detail">
                    {[
                        `采图包: ${packagesForMerge.length} 个`,
                        `底图名: ${mapName}`,
                        '',
                        ...packagesForMerge.map(
                            (item) =>
                                `- ${item.defaultMapName || item.packageId}: 点云 ${formatCount(
                                    item.summary?.pointCloudFiles,
                                )}, 坐标组 ${item.coordinateGroup || '未知'}, RTK ${formatCount(
                                    item.summary?.trajectory?.poseFileCount,
                                )}`,
                        ),
                        '',
                        `拼图预检: ${stitchPlan?.ready ? '通过' : '未通过'} / 坐标组 ${
                            stitchPlan?.coordinateGroups?.join(', ') || '未知'
                        }`,
                        '系统只允许同坐标组资产自动拼图，避免不同投影或局部坐标误拼。',
                    ].join('\n')}
                </pre>
            ),
            onOk: async () => {
                setUploading(true);
                setJobText(`正在提交多包合并底图任务：${mapName}`);
                try {
                    const response = await FileService.startMergedDataPackagesBaseMapJob(packageIds, mapName, true);
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交多包合并底图任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, `正在合并生成底图 ${mapName}`);
                    await refreshAll();
                    message.success(`合并底图 ${job.result?.mapName || mapName} 生成完成`);
                } catch (error) {
                    Modal.error({
                        title: '合并底图生成失败',
                        content: error instanceof Error ? error.message : '合并底图生成失败',
                    });
                    throw error;
                } finally {
                    setUploading(false);
                    setJobText('');
                }
            },
        });
    };

    const handleOpenBaseMap = async (packageInfo: any) => {
        const mapName = sanitizeName(packageInfo.defaultMapName || packageInfo.packageId) || createFallbackName();
        try {
            const response = await FileService.getBaseMapInfo(mapName);
            if (!response || response?.code) {
                throw new Error(response?.message || `底图 ${mapName} 不存在，请先生成底图`);
            }
            if (response.tiles || response.type === 'point_cloud') {
                PubSub.publish('renderMap', {
                    dir: mapName,
                    json: response,
                });
                message.success(`已打开底图 ${mapName}`);
                onCancel?.();
                return;
            }
            throw new Error(`底图 ${mapName} 格式不完整`);
        } catch (error) {
            Modal.error({
                title: '打开底图失败',
                content: error instanceof Error ? error.message : '打开底图失败',
            });
        }
    };

    const handleOpenMergedBaseMap = async () => {
        try {
            const response = await FileService.getBaseMapInfo(AUTO_MERGED_BASE_MAP_NAME);
            if (!response?.tiles) {
                throw new Error(`合并底图 ${AUTO_MERGED_BASE_MAP_NAME} 还没有生成完成`);
            }
            PubSub.publish('renderMap', {
                dir: AUTO_MERGED_BASE_MAP_NAME,
                json: response,
            });
            message.success(`已打开合并底图 ${AUTO_MERGED_BASE_MAP_NAME}`);
            onCancel?.();
        } catch (error) {
            Modal.error({
                title: '打开合并底图失败',
                content: error instanceof Error ? error.message : '打开合并底图失败',
            });
        }
    };

    const handleRenamePackage = (packageInfo: any) => {
        let nextName = packageInfo.displayName || packageInfo.defaultMapName || packageInfo.packageId;
        Modal.confirm({
            title: '重命名资产',
            width: 560,
            okText: '保存',
            cancelText: '取消',
            content: (
                <Input
                    defaultValue={nextName}
                    maxLength={96}
                    autoFocus
                    placeholder="请输入资产名称"
                    onChange={(event) => {
                        nextName = event.target.value;
                    }}
                />
            ),
            onOk: async () => {
                const displayName = nextName.trim();
                if (!displayName) {
                    message.error('资产名称不能为空');
                    throw new Error('资产名称不能为空');
                }
                setUploading(true);
                setJobText(`正在重命名资产：${displayName}`);
                try {
                    const response = await FileService.renameDataPackage(packageInfo.packageId, displayName);
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '重命名资产失败');
                    }
                    await refreshAll();
                    message.success('资产已重命名');
                } catch (error) {
                    Modal.error({
                        title: '重命名资产失败',
                        content: error instanceof Error ? error.message : '重命名资产失败',
                    });
                    throw error;
                } finally {
                    setUploading(false);
                    setJobText('');
                }
            },
        });
    };

    const handleDeletePackage = (packageInfo: any) => {
        Modal.confirm({
            title: '删除采图包资产',
            width: 720,
            okText: '删除',
            cancelText: '取消',
            okButtonProps: { danger: true },
            content: (
                <pre className="asset-manager-detail">
                    {[
                        `资产: ${packageInfo.displayName || packageInfo.defaultMapName || packageInfo.packageId}`,
                        `资产 ID: ${packageInfo.packageId}`,
                        '',
                        '删除后采图包会移动到服务器回收目录 import_packages_trash。',
                        '这个操作不会删除已经生成的点云底图或标注地图。',
                    ].join('\n')}
                </pre>
            ),
            onOk: async () => {
                setUploading(true);
                setJobText(`正在删除资产：${packageInfo.defaultMapName || packageInfo.packageId}`);
                try {
                    const response = await FileService.deleteDataPackage(packageInfo.packageId);
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '删除资产失败');
                    }
                    setSelectedPackageIds((current) =>
                        current.filter((packageId) => String(packageId) !== packageInfo.packageId),
                    );
                    await refreshAll();
                    message.success('资产已移入回收目录');
                } catch (error) {
                    Modal.error({
                        title: '删除资产失败',
                        content: error instanceof Error ? error.message : '删除资产失败',
                    });
                    throw error;
                } finally {
                    setUploading(false);
                    setJobText('');
                }
            },
        });
    };

    const showDetails = (packageInfo: any) => {
        Modal.info({
            title: '资产详情',
            width: 860,
            content: <pre className="asset-manager-detail">{formatPackageAnalysis(packageInfo)}</pre>,
        });
    };

    const showJobDetails = async (jobInfo: any) => {
        try {
            const response = await FileService.getRuntimeJob(jobInfo.id, true);
            const job = response?.data?.job || jobInfo;
            const logs = job.logs || [];
            Modal.info({
                title: '后台任务详情',
                width: 860,
                content: (
                    <pre className="asset-manager-detail">
                        {[
                            `任务: ${job.id}`,
                            `类型: ${job.type}`,
                            `状态: ${job.status}`,
                            `消息: ${job.message || ''}`,
                            `创建: ${formatDateTime(job.createdAt)}`,
                            `完成: ${formatDateTime(job.finishedAt)}`,
                            '',
                            '请求:',
                            JSON.stringify(job.request || {}, null, 2),
                            '',
                            '日志:',
                            ...logs.map((item: any) => `[${item.time}] ${item.level}: ${item.message}`),
                        ].join('\n')}
                    </pre>
                ),
            });
        } catch (error) {
            Modal.error({
                title: '读取任务失败',
                content: error instanceof Error ? error.message : '读取任务失败',
            });
        }
    };

    const handleGenerateSelectedBaseMap = () => {
        if (baseMapBusy) {
            message.warning('已有底图生成任务正在运行，请先查看当前任务进度');
            if (activeBaseMapJob) {
                showJobDetails(activeBaseMapJob);
            }
            return;
        }
        if (selectedPackages.some((item) => item.workflowStatus?.canGenerateBaseMap === false)) {
            message.warning('所选资产还未通过自检，先执行预检');
            return;
        }
        if (selectedPackages.length > 1) {
            handleGenerateMergedBaseMap();
            return;
        }
        if (primaryPackage) {
            handleGenerateBaseMap(primaryPackage);
        }
    };

    const handleOpenSelectedBaseMap = () => {
        if (primaryPackage) {
            handleOpenBaseMap(primaryPackage);
        }
    };

    const handleRefreshSelectedAnalysis = () => {
        if (primaryPackage) {
            handleRefreshAnalysis(primaryPackage);
        }
    };

    const handleShowSelectedDetails = () => {
        if (primaryPackage) {
            showDetails(primaryPackage);
        }
    };

    useEffect(() => {
        if (open) {
            refreshAll();
        } else {
            setJobText('');
        }
    }, [open, refreshAll]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const timer = window.setInterval(() => {
            loadJobs();
        }, 5000);
        return () => window.clearInterval(timer);
    }, [loadJobs, open]);

    useEffect(() => {
        const packageIds = new Set(packages.map((item) => item.packageId));
        setSelectedPackageIds((current) => current.filter((packageId) => packageIds.has(String(packageId))));
    }, [packages]);

    const columns = [
        {
            title: '资产',
            dataIndex: 'defaultMapName',
            key: 'asset',
            width: 390,
            render: (_value: string, record: any) => (
                <div className="asset-manager-name-cell" title={record.packageId}>
                    <div className="asset-manager-name">{getPackageTitle(record)}</div>
                    {record.supersededByPackageId && (
                        <div className="asset-manager-name-meta">
                            <Tag color="gold">旧采集</Tag>
                            <span>自动拼图使用最新采集</span>
                        </div>
                    )}
                </div>
            ),
        },
        {
            title: '状态',
            key: 'status',
            width: 110,
            render: (_value: string, record: any) => (
                <Tag color={getWorkflowStatusColor(record)}>{getWorkflowStatusLabel(record)}</Tag>
            ),
        },
        {
            title: '坐标/质量',
            key: 'quality',
            width: 150,
            render: (_value: string, record: any) => (
                <div className="asset-manager-tag-line">
                    <Tag color={qualityColor[record.quality?.rating] || 'default'}>
                        {record.quality?.rating || 'unknown'}
                    </Tag>
                    <Tag className="asset-manager-neutral-tag">{getCoordinateLabel(record.quality)}</Tag>
                </div>
            ),
        },
        {
            title: '内容',
            key: 'content',
            width: 180,
            render: (_value: string, record: any) => {
                const summary = record.summary || {};
                return (
                    <div className="asset-manager-tag-line">
                        <Tag className="asset-manager-neutral-tag">{`点云 ${formatCount(summary.pointCloudFiles)}`}</Tag>
                        <Tag className="asset-manager-neutral-tag">{`LAS ${formatCount(summary.lasFiles)}`}</Tag>
                        {Number(summary.imageFiles || 0) > 0 && (
                            <Tag className="asset-manager-neutral-tag">{`Image ${formatCount(summary.imageFiles)}`}</Tag>
                        )}
                        {Number(summary.trajectory?.poseFileCount || 0) > 0 && (
                            <Tag color="blue">{`RTK ${formatCount(summary.trajectory.poseFileCount)}`}</Tag>
                        )}
                    </div>
                );
            },
        },
        {
            title: '点数/大小',
            key: 'size',
            width: 130,
            render: (_value: string, record: any) => (
                <div className="asset-manager-size">
                    <div>{formatCount(record.summary?.pointCount)}</div>
                    <div>{formatBytes(record.sizeBytes)}</div>
                </div>
            ),
        },
        {
            title: '操作',
            key: 'actions',
            width: 190,
            render: (_value: string, record: any) => (
                <Space size={6} className="asset-manager-actions">
                    <Button size="small" onClick={() => showDetails(record)}>
                        详情
                    </Button>
                    <Button size="small" onClick={() => handleRenamePackage(record)} disabled={uploading}>
                        重命名
                    </Button>
                    <Button size="small" danger onClick={() => handleDeletePackage(record)} disabled={uploading}>
                        删除
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <Modal
            {...rest}
            open={open}
            title="采图包工作台"
            width={1240}
            footer={null}
            onCancel={onCancel}
            className="asset-manager-dialog"
        >
            <div className="asset-manager-toolbar">
                <div>
                    <div className="asset-manager-title">采图资产与底图生产</div>
                </div>
                <Space>
                    <Button onClick={refreshAll} disabled={loading || uploading}>
                        刷新
                    </Button>
                    <Button onClick={handleRefreshAllAnalysis} disabled={loading || uploading || packages.length === 0}>
                        自检待预检
                    </Button>
                    <Button onClick={handleSyncCaptureSources} disabled={loading || uploading}>
                        同步采图目录
                    </Button>
                    <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={uploading}>
                        上传采图包
                    </Button>
                </Space>
            </div>
            <div className="asset-production-panel">
                <div className="asset-production-main">
                    <div className="asset-production-eyebrow">生产状态</div>
                    <div className="asset-production-title">{productionStateText}</div>
                    {activeBaseMapJobMessage && <div className="asset-production-meta">{activeBaseMapJobMessage}</div>}
                </div>
                <div className="asset-production-merge">
                    <div className="asset-production-eyebrow">合并底图</div>
                    <div className="asset-production-title">{mergeStateText}</div>
                    <div className="asset-production-meta">{mergeEntryText}</div>
                </div>
                <Space className="asset-production-actions">
                    <Button onClick={handleOpenMergedBaseMap} disabled={!mergedBaseMapReady || Boolean(activeMergeJob)}>
                        打开合并底图
                    </Button>
                    {activeMergeJob && <Button onClick={() => showJobDetails(activeMergeJob)}>查看合并日志</Button>}
                </Space>
            </div>
            <div className="asset-workflow">
                <div className="asset-workflow-card">
                    <div className="asset-workflow-step">资产库</div>
                    <div className="asset-workflow-title">{assetCountText}</div>
                    <div className="asset-workflow-desc">资产包</div>
                    <Button
                        size="small"
                        type="primary"
                        onClick={() => uploadInputRef.current?.click()}
                        loading={uploading}
                    >
                        上传/预检
                    </Button>
                </div>
                <div className="asset-workflow-card">
                    <div className="asset-workflow-step">瓦片</div>
                    <div className="asset-workflow-title">{generatedBaseMapText}</div>
                    <div className="asset-workflow-desc">已生成 / 可生成</div>
                    <Button
                        size="small"
                        onClick={() => setSelectedPackageIds([])}
                        disabled={selectedPackages.length === 0}
                    >
                        清除选择
                    </Button>
                </div>
                <div className="asset-workflow-card">
                    <div className="asset-workflow-step">选择</div>
                    <div className="asset-workflow-title">{generationModeText}</div>
                    <div className="asset-workflow-desc">{`${selectedCountText} 个资产`}</div>
                    <Button
                        size="small"
                        onClick={handleGenerateSelectedBaseMap}
                        disabled={selectedPackages.length === 0 || uploading || baseMapBusy}
                    >
                        {selectedPackages.length > 1 ? '合并生成' : '生成底图'}
                    </Button>
                </div>
                <div className="asset-workflow-card">
                    <div className="asset-workflow-step">标注入口</div>
                    <div className="asset-workflow-title">{openStageText}</div>
                    <div className="asset-workflow-desc">单包底图</div>
                    <Button
                        size="small"
                        type="primary"
                        onClick={handleOpenSelectedBaseMap}
                        disabled={selectedPackages.length !== 1}
                    >
                        打开底图
                    </Button>
                </div>
            </div>
            <div className={selectionPanelClassName}>
                {selectedPackages.length === 0 ? (
                    <div>
                        <div className="asset-selection-title">请选择资产</div>
                        <div className="asset-selection-meta">{emptySelectionText}</div>
                    </div>
                ) : (
                    <>
                        <div className="asset-selection-main">
                            <div className="asset-selection-title">
                                {selectedPackages.length === 1
                                    ? getPackageTitle(primaryPackage)
                                    : `已选择 ${selectedPackages.length} 个资产，准备合并拼图`}
                            </div>
                            <div className="asset-selection-meta">{selectedSummaryText}</div>
                        </div>
                        <Space className="asset-selection-actions">
                            {selectedPackages.length === 1 && (
                                <>
                                    <Button onClick={handleRefreshSelectedAnalysis} disabled={uploading}>
                                        重跑预检
                                    </Button>
                                    <Button onClick={handleShowSelectedDetails}>详情</Button>
                                </>
                            )}
                            <Button onClick={handleGenerateSelectedBaseMap} disabled={uploading || baseMapBusy}>
                                {selectedPackages.length > 1 ? '合并生成底图' : '生成底图'}
                            </Button>
                            <Button
                                type="primary"
                                onClick={handleOpenSelectedBaseMap}
                                disabled={selectedPackages.length !== 1}
                            >
                                打开底图
                            </Button>
                        </Space>
                    </>
                )}
            </div>
            {(jobText || activeBaseMapJob) && (
                <div className={`asset-manager-job${activeBaseMapJob ? ' is-active' : ''}`}>
                    <div className="asset-manager-job-main">
                        <span>
                            {jobText ||
                                `底图任务：${activeBaseMapJobMessage || activeBaseMapJob?.message || activeBaseMapJob?.status}`}
                        </span>
                        {activeBaseMapJob && (
                            <Button size="small" onClick={() => showJobDetails(activeBaseMapJob)}>
                                查看日志
                            </Button>
                        )}
                    </div>
                    {activeBaseMapJob && (
                        <div className="asset-manager-job-meta">
                            {[
                                activeBaseMapJob.type,
                                activeBaseMapJob.status,
                                formatDateTime(activeBaseMapJob.createdAt),
                            ].join(' / ')}
                        </div>
                    )}
                </div>
            )}
            {jobs.length > 0 && (
                <div className="asset-manager-jobs">
                    <div className="asset-manager-jobs-title">最近后台任务</div>
                    <div className="asset-manager-jobs-list">
                        {jobs.slice(0, 5).map((job) => (
                            <button
                                key={job.id}
                                type="button"
                                className="asset-manager-job-item"
                                onClick={() => showJobDetails(job)}
                            >
                                <Tag color={getJobStatusColor(job.status)}>{job.status}</Tag>
                                <span>{getJobTypeLabel(job.type)}</span>
                                <span className="asset-manager-job-message">{getLatestJobMessage(job)}</span>
                                <span>{formatDateTime(job.createdAt)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <Table
                rowKey="packageId"
                rowSelection={{
                    selectedRowKeys: selectedPackageIds,
                    onChange: (keys) => setSelectedPackageIds(keys),
                    getCheckboxProps: (record: any) => ({
                        disabled:
                            uploading ||
                            record.workflowStatus?.canGenerateBaseMap === false ||
                            Number(record.summary?.pointCloudFiles || 0) <= 0,
                    }),
                }}
                columns={columns}
                dataSource={packages}
                loading={loading}
                pagination={{ pageSize: 6, showSizeChanger: false }}
                scroll={{ x: 1150 }}
                className="asset-manager-table"
                locale={{ emptyText: '还没有资产包，请先上传采图 ZIP。' }}
            />
            <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept=".zip,.las,.laz,.pcd,.ply,.xyz,.txt,.csv,.jpg,.jpeg,.png,.bmp"
                style={{ display: 'none' }}
                onChange={handleUpload}
            />
        </Modal>
    );
}
