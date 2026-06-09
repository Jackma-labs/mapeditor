import PubSub from 'pubsub-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Modal, Progress, Space, Table, Tag, message } from 'antd';
import type { MenuProps } from 'antd';
import { ModalProps } from 'antd/lib/modal';
import FileService from 'src/service/index';

interface AssetManagerDialogProps extends Omit<ModalProps, 'visible'> {
    open: boolean;
    onCancel?: () => void;
}

type WorkStage = 'idle' | 'uploading' | 'analyzing' | 'uploaded' | 'building' | 'ready';

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

const buildPackageName = (files: File[]) => {
    if (files.length === 0) {
        return createFallbackName();
    }
    const firstName = sanitizeName(stripExtension(files[0].name));
    return firstName.length >= 4 ? firstName : createFallbackName();
};

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

const getMapName = (packageInfo: any) =>
    sanitizeName(packageInfo?.defaultMapName || packageInfo?.displayName || packageInfo?.packageId || '') ||
    createFallbackName();

const formatBounds = (bounds: any) => {
    if (!bounds) {
        return '';
    }
    return `X ${bounds.minX} ~ ${bounds.maxX}, Y ${bounds.minY} ~ ${bounds.maxY}`;
};

const qualityColor: Record<string, string> = {
    excellent: 'green',
    good: 'blue',
    usable: 'gold',
    sparse: 'orange',
    unknown: 'default',
};

const coordinateKindLabel: Record<string, string> = {
    projected_meters_or_large_local: '投影坐标',
    lonlat_range_compatible: '经纬度',
    local_meters: '局部坐标',
    ecef_xyz: 'ECEF',
};

const getCoordinateLabel = (quality: any) =>
    coordinateKindLabel[quality?.representativeCoordinateKind] || quality?.representativeCoordinateKind || '坐标未知';

const getWorkflowStatusLabel = (packageInfo: any) => {
    if (packageInfo?.baseMapExists) {
        return '点云资产可用';
    }
    if (packageInfo?.workflowStatus?.canGenerateBaseMap) {
        return '可生成';
    }
    if (packageInfo?.summary?.pointCloudFiles > 0) {
        return '已上传';
    }
    return '缺少点云';
};

const getWorkflowStatusColor = (packageInfo: any) => {
    if (packageInfo?.baseMapExists) {
        return 'green';
    }
    if (packageInfo?.workflowStatus?.canGenerateBaseMap || packageInfo?.summary?.pointCloudFiles > 0) {
        return 'blue';
    }
    return 'red';
};

const formatQualityText = (quality: any) => {
    if (!quality) {
        return '未知';
    }
    const density = Number(quality.pointDensity || 0);
    const area = Number(quality.areaSquareMeters || 0);
    return `${quality.rating || 'unknown'} / ${density.toFixed(1)} pts/m2 / ${(area / 10000).toFixed(2)} ha`;
};

const formatPackageAnalysis = (packageInfo: any) => {
    const summary = packageInfo?.summary || {};
    const analyses = packageInfo?.analyses || [];
    const pointCloud = analyses.flatMap((item: any) => item.pointClouds || [])[0];
    const trajectory = summary.trajectory || {};
    const lines = [
        `资产 ID: ${packageInfo?.packageId || ''}`,
        `存储路径: ${packageInfo?.path || ''}`,
        `文件数: ${formatCount(summary.totalFiles)}`,
        `点云: ${formatCount(summary.pointCloudFiles)} 个 (LAS ${formatCount(summary.lasFiles)}, PCD ${formatCount(
            summary.pcdFiles,
        )})`,
        `估算点数: ${formatCount(summary.pointCount)}`,
        `资产大小: ${formatBytes(packageInfo?.sizeBytes)}`,
    ];
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
    if (trajectory.poseFileCount > 0) {
        lines.push('');
        lines.push(`RTK/轨迹文件: ${formatCount(trajectory.poseFileCount)} 个`);
        lines.push(`轨迹样本: ${formatCount(trajectory.sampleCount)}`);
        lines.push(`轨迹坐标: ${trajectory.preferredCoordinateKind || ''}`);
        if (trajectory.bounds) {
            lines.push(`轨迹范围: ${formatBounds(trajectory.bounds)}`);
        }
    }
    if (summary.recommendations?.length) {
        lines.push('');
        lines.push('建议:');
        summary.recommendations.forEach((item: string) => lines.push(`- ${item}`));
    }
    return lines.join('\n');
};

const sleep = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const waitForRuntimeJob = async (
    jobId: string,
    label: string,
    onProgress?: (message: string, job?: any) => void,
    attempt = 0,
): Promise<any> => {
    if (attempt >= 1200) {
        throw new Error(`${label}等待超时`);
    }
    const response = await FileService.getRuntimeJob(jobId, true);
    if (response?.code !== 0) {
        throw new Error(response?.message || '读取后台任务失败');
    }
    const job = response?.data?.job;
    onProgress?.(job?.message || label, job);
    if (job?.status === 'succeeded') {
        return job;
    }
    if (job?.status === 'failed') {
        throw new Error(job?.message || `${label}失败`);
    }
    await sleep(2500);
    return waitForRuntimeJob(jobId, label, onProgress, attempt + 1);
};

export default function AssetManagerDialog({ open, onCancel, ...rest }: AssetManagerDialogProps) {
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [packages, setPackages] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [working, setWorking] = useState(false);
    const [workingText, setWorkingText] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadDetail, setUploadDetail] = useState('');
    const [activeJob, setActiveJob] = useState<any>(null);
    const [selectedPackageId, setSelectedPackageId] = useState<string>('');
    const [stage, setStage] = useState<WorkStage>('idle');

    const selectedPackage = useMemo(
        () => packages.find((item) => item.packageId === selectedPackageId) || null,
        [packages, selectedPackageId],
    );

    const latestPackage = packages[0] || null;
    const canGenerateSelected = Boolean(
        selectedPackage &&
            Number(selectedPackage.summary?.pointCloudFiles || 0) > 0 &&
            selectedPackage.workflowStatus?.canGenerateBaseMap !== false,
    );
    const canOpenSelected = Boolean(selectedPackage?.baseMapExists);
    const pointCloudAssetCount = packages.filter((item) => Number(item.summary?.pointCloudFiles || 0) > 0).length;
    const generatedAssetCount = packages.filter((item) => item.baseMapExists).length;
    const selectedSummary = selectedPackage?.summary || {};

    const loadPackages = useCallback(async () => {
        setLoading(true);
        try {
            const response = await FileService.getDataPackages();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取点云资产失败');
            }
            const nextPackages = response?.data?.packages || [];
            setPackages(nextPackages);
            if (!selectedPackageId && nextPackages[0]?.packageId) {
                setSelectedPackageId(nextPackages[0].packageId);
            }
            return nextPackages;
        } catch (error) {
            Modal.error({
                title: '读取点云资产失败',
                content: error instanceof Error ? error.message : '读取点云资产失败',
            });
            return [];
        } finally {
            setLoading(false);
        }
    }, [selectedPackageId]);

    const refreshPackages = useCallback(async () => loadPackages(), [loadPackages]);

    const uploadFiles = async (files: File[]) => {
        if (files.length === 0) {
            return;
        }
        const packageName = buildPackageName(files);
        setUploading(true);
        setWorkingText(`正在上传 ${packageName}`);
        setUploadDetail('大文件采用分片上传，上传完成后服务器会自动合并并识别。');
        setUploadProgress(0);
        setActiveJob(null);
        setStage('uploading');
        try {
            const response = await FileService.uploadDataPackageResumable(
                files.length === 1 ? files[0] : files,
                packageName,
                (percent: number, detail?: string) => {
                    setUploadProgress(percent);
                    setUploadDetail(detail || '');
                },
            );
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交采图包分析任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            setStage('analyzing');
            setWorkingText('服务器正在合并并识别采图包');
            const job = await waitForRuntimeJob(jobId, '采图包识别', (jobMessage, nextJob) => {
                setActiveJob(nextJob);
                setWorkingText(jobMessage || '服务器正在识别采图包');
            });
            const uploadedPackageId = job?.result?.packageId;
            if (uploadedPackageId) {
                setSelectedPackageId(uploadedPackageId);
            }
            setStage('uploaded');
            setUploadProgress(100);
            await refreshPackages();
            message.success('LAS 包已上传并识别，可以生成点云资产');
        } catch (error) {
            setStage('idle');
            Modal.error({
                title: '上传失败',
                content: error instanceof Error ? error.message : '上传并识别 LAS 包失败',
            });
        } finally {
            setUploading(false);
            setWorkingText('');
            setUploadDetail('');
        }
    };

    const handleUploadInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (uploadInputRef.current) {
            uploadInputRef.current.value = '';
        }
        await uploadFiles(files);
    };

    const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (uploading || working) {
            return;
        }
        await uploadFiles(Array.from(event.dataTransfer.files || []));
    };

    const handleGenerateAsset = async (packageInfo: any = selectedPackage) => {
        if (!packageInfo) {
            message.warning('先选择一个 LAS 点云包');
            return null;
        }
        if (Number(packageInfo.summary?.pointCloudFiles || 0) <= 0) {
            message.warning('这个资产没有可用点云文件');
            return null;
        }
        const mapName = getMapName(packageInfo);
        setWorking(true);
        setWorkingText(`正在生成可编辑点云资产：${mapName}`);
        setUploadDetail('');
        setActiveJob(null);
        setStage('building');
        try {
            const response = await FileService.startDataPackageBaseMapJob(packageInfo.packageId, mapName, true);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交点云资产生成任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            await waitForRuntimeJob(jobId, '生成点云资产', (jobMessage, nextJob) => {
                setActiveJob(nextJob);
                setWorkingText(jobMessage || `正在生成可编辑点云资产：${mapName}`);
            });
            setStage('ready');
            const nextPackages = await refreshPackages();
            message.success(`点云资产已生成：${mapName}`);
            return (
                nextPackages.find((item: any) => item.packageId === packageInfo.packageId) || {
                    ...packageInfo,
                    baseMapExists: true,
                }
            );
        } catch (error) {
            Modal.error({
                title: '生成点云资产失败',
                content: error instanceof Error ? error.message : '生成点云资产失败',
            });
            return null;
        } finally {
            setWorking(false);
            setWorkingText('');
        }
    };

    const handleOpenBaseMap = async (packageInfo: any = selectedPackage) => {
        if (!packageInfo) {
            message.warning('先选择一个点云资产');
            return;
        }
        const mapName = getMapName(packageInfo);
        try {
            const response = await FileService.getBaseMapInfo(mapName, 'point_cloud');
            if (!response || response?.code) {
                throw new Error(response?.message || `点云资产 ${mapName} 还没有生成，请先一键生成`);
            }
            if (response.tiles || response.type === 'point_cloud') {
                PubSub.publish('renderMap', {
                    dir: mapName,
                    json: response,
                });
                message.success(`已打开点云资产：${mapName}`);
                onCancel?.();
                return;
            }
            throw new Error(`点云资产 ${mapName} 格式不完整`);
        } catch (error) {
            Modal.error({
                title: '打开点云资产失败',
                content: error instanceof Error ? error.message : '打开点云资产失败',
            });
        }
    };

    const handleGenerateAndOpen = async () => {
        if (!selectedPackage) {
            message.warning('先选择一个 LAS 点云包');
            return;
        }
        let packageToOpen = selectedPackage;
        if (!selectedPackage.baseMapExists) {
            const generatedPackage = await handleGenerateAsset(selectedPackage);
            if (!generatedPackage) {
                return;
            }
            packageToOpen = generatedPackage;
        }
        await handleOpenBaseMap(packageToOpen);
    };

    const handleRenamePackage = (packageInfo: any) => {
        let nextName = packageInfo.displayName || packageInfo.defaultMapName || packageInfo.packageId;
        Modal.confirm({
            title: '重命名点云资产',
            width: 560,
            okText: '保存',
            cancelText: '取消',
            content: (
                <Input
                    defaultValue={nextName}
                    onChange={(event) => {
                        nextName = event.target.value;
                    }}
                />
            ),
            onOk: async () => {
                const normalized = sanitizeName(nextName);
                if (!normalized) {
                    throw new Error('名称不能为空');
                }
                const response = await FileService.renameDataPackage(packageInfo.packageId, normalized);
                if (response?.code !== 0) {
                    throw new Error(response?.message || '重命名失败');
                }
                await refreshPackages();
            },
        });
    };

    const handleDeletePackage = (packageInfo: any) => {
        Modal.confirm({
            title: '删除点云包资产',
            width: 640,
            okText: '删除',
            okButtonProps: { danger: true },
            cancelText: '取消',
            content: (
                <pre className="asset-manager-detail">
                    {[
                        `资产: ${getPackageTitle(packageInfo)}`,
                        `点云文件: ${formatCount(packageInfo.summary?.pointCloudFiles)}`,
                        `大小: ${formatBytes(packageInfo.sizeBytes)}`,
                        '',
                        '只删除上传的采图包资产，不会删除已经生成的标注地图。',
                    ].join('\n')}
                </pre>
            ),
            onOk: async () => {
                setWorking(true);
                setWorkingText(`正在删除资产：${getPackageTitle(packageInfo)}`);
                try {
                    const response = await FileService.deleteDataPackage(packageInfo.packageId);
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '删除资产失败');
                    }
                    if (selectedPackageId === packageInfo.packageId) {
                        setSelectedPackageId('');
                    }
                    await refreshPackages();
                    message.success('点云包资产已删除');
                } finally {
                    setWorking(false);
                    setWorkingText('');
                }
            },
        });
    };

    const handleDeleteOtherPackages = () => {
        const keepId = selectedPackage?.packageId || '';
        const targets = packages.filter((item) => item.packageId !== keepId);
        if (targets.length === 0) {
            message.info('没有需要清理的旧点云资产');
            return;
        }
        Modal.confirm({
            title: '清理旧点云资产',
            width: 680,
            okText: '清理',
            okButtonProps: { danger: true },
            cancelText: '取消',
            content: (
                <pre className="asset-manager-detail">
                    {[
                        keepId ? `保留: ${getPackageTitle(selectedPackage)}` : '当前没有选择保留资产',
                        `将清理: ${targets.length} 个旧采图包资产`,
                        '',
                        '这个操作只清理上传资产库，避免旧采集参与后续标注；已发布地图和标注文件不会被删除。',
                    ].join('\n')}
                </pre>
            ),
            onOk: async () => {
                setWorking(true);
                setWorkingText('正在清理旧点云资产');
                try {
                    await Promise.all(
                        targets.map(async (item) => {
                            const response = await FileService.deleteDataPackage(item.packageId);
                            if (response?.code !== 0) {
                                throw new Error(response?.message || `删除失败：${getPackageTitle(item)}`);
                            }
                        }),
                    );
                    await refreshPackages();
                    message.success('旧点云资产已清理');
                } finally {
                    setWorking(false);
                    setWorkingText('');
                }
            },
        });
    };

    const showDetails = (packageInfo: any) => {
        Modal.info({
            title: '点云资产详情',
            width: 860,
            content: <pre className="asset-manager-detail">{formatPackageAnalysis(packageInfo)}</pre>,
        });
    };

    useEffect(() => {
        if (open) {
            refreshPackages();
        } else {
            setWorkingText('');
            setUploadDetail('');
            setActiveJob(null);
            setUploadProgress(0);
            setStage('idle');
        }
    }, [open, refreshPackages]);

    useEffect(() => {
        if (selectedPackageId && packages.some((item) => item.packageId === selectedPackageId)) {
            return;
        }
        setSelectedPackageId(packages[0]?.packageId || '');
    }, [packages, selectedPackageId]);

    const handlePrimaryRowAction = async (record: any) => {
        if (record.baseMapExists) {
            await handleOpenBaseMap(record);
            return;
        }
        await handleGenerateAsset(record);
    };

    const getRowMenuItems = (record: any): MenuProps['items'] => {
        const items: MenuProps['items'] = [
            {
                key: 'details',
                label: '查看详情',
            },
            {
                key: 'rename',
                label: '重命名',
                disabled: working,
            },
            {
                key: 'delete',
                label: '删除采图包',
                danger: true,
                disabled: working,
            },
        ];
        if (record.baseMapExists) {
            items.push({
                key: 'regenerate',
                label: '重新生成点云资产',
                disabled: working,
            });
        }
        return items;
    };

    const handleRowMenuClick = async (key: React.Key, record: any) => {
        if (key === 'details') {
            showDetails(record);
            return;
        }
        if (key === 'rename') {
            handleRenamePackage(record);
            return;
        }
        if (key === 'delete') {
            handleDeletePackage(record);
            return;
        }
        if (key === 'regenerate') {
            await handleGenerateAsset(record);
        }
    };

    const columns = [
        {
            title: '点云资产',
            dataIndex: 'defaultMapName',
            key: 'asset',
            width: 300,
            render: (_value: string, record: any) => (
                <div className="asset-manager-name-cell" title={record.packageId}>
                    <div className="asset-manager-name">{getPackageTitle(record)}</div>
                    <div className="asset-manager-name-meta">
                        <span>{formatDateTime(record.modifiedAt)}</span>
                    </div>
                </div>
            ),
        },
        {
            title: '状态',
            key: 'status',
            width: 120,
            render: (_value: string, record: any) => (
                <Tag color={getWorkflowStatusColor(record)}>{getWorkflowStatusLabel(record)}</Tag>
            ),
        },
        {
            title: '质量/坐标',
            key: 'quality',
            width: 116,
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
            width: 116,
            render: (_value: string, record: any) => {
                const summary = record.summary || {};
                return (
                    <div className="asset-manager-tag-line">
                        <Tag className="asset-manager-neutral-tag">{`点云 ${formatCount(summary.pointCloudFiles)}`}</Tag>
                        <Tag className="asset-manager-neutral-tag">{`LAS ${formatCount(summary.lasFiles)}`}</Tag>
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
            width: 120,
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
            width: 164,
            render: (_value: string, record: any) => (
                <Space size={6} className="asset-manager-actions">
                    <Button
                        size="small"
                        type="primary"
                        onClick={() => handlePrimaryRowAction(record)}
                        disabled={
                            working ||
                            uploading ||
                            (!record.baseMapExists && Number(record.summary?.pointCloudFiles || 0) <= 0)
                        }
                    >
                        {record.baseMapExists ? '打开标注' : '生成资产'}
                    </Button>
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: getRowMenuItems(record),
                            onClick: ({ key }) => handleRowMenuClick(key, record),
                        }}
                    >
                        <Button size="small" disabled={uploading}>
                            更多
                        </Button>
                    </Dropdown>
                </Space>
            ),
        },
    ];
    const progressDetailText = (() => {
        if (uploading) {
            return `${Math.round(uploadProgress)}%${uploadDetail ? ` · ${uploadDetail}` : ''}`;
        }
        if (activeJob?.id) {
            return `任务 ${activeJob.id} · ${activeJob.status}`;
        }
        return uploadDetail || workingText;
    })();

    return (
        <Modal
            {...rest}
            open={open}
            title="点云采图工作台"
            width={1120}
            footer={null}
            onCancel={onCancel}
            className="asset-manager-dialog"
        >
            <div className="asset-manager-toolbar">
                <div>
                    <div className="asset-manager-title">最新 LAS 包上传与点云标注入口</div>
                    <div className="asset-manager-subtitle">
                        人工确认上传最新采集包，生成可编辑点云资产后直接进入标注。
                    </div>
                </div>
                <Space>
                    <Button onClick={refreshPackages} disabled={loading || uploading || working}>
                        刷新
                    </Button>
                    <Button
                        danger
                        onClick={handleDeleteOtherPackages}
                        disabled={loading || uploading || working || packages.length === 0}
                    >
                        清理旧资产
                    </Button>
                    <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={uploading}>
                        上传 LAS 包
                    </Button>
                </Space>
            </div>

            <div className="asset-lite-steps">
                <div className={`asset-lite-step ${stage === 'uploading' || stage === 'analyzing' ? 'active' : ''}`}>
                    <span>1</span>
                    <strong>上传最新 LAS 包</strong>
                    <em>只从网页手工上传，分片落盘后由服务器识别，不再扫描或同步旧目录。</em>
                </div>
                <div className={`asset-lite-step ${stage === 'building' ? 'active' : ''}`}>
                    <span>2</span>
                    <strong>生成点云资产</strong>
                    <em>后台任务切片为 MapEditor 可编辑的高清点云底图。</em>
                </div>
                <div className={`asset-lite-step ${stage === 'ready' ? 'active' : ''}`}>
                    <span>3</span>
                    <strong>打开并标注</strong>
                    <em>按点云直接画车道、边界、路口和交通控制对象。</em>
                </div>
            </div>

            <div className="asset-upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                <div>
                    <strong>上传最新采集结果</strong>
                    <span>
                        支持 `.las`、`.laz` 或包含 LAS 的
                        `.zip`，可一次选择多个文件。大文件采用分片上传，完成后自动识别。
                    </span>
                </div>
                <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={uploading}>
                    选择文件
                </Button>
            </div>

            {(uploading || uploadProgress > 0 || workingText || activeJob) && (
                <div className="asset-lite-progress">
                    <div>
                        <strong>{workingText || (uploading ? '正在上传' : '处理中')}</strong>
                        <span>{progressDetailText}</span>
                    </div>
                    {uploading && <Progress percent={Math.round(uploadProgress)} status="active" />}
                </div>
            )}

            {activeJob && !uploading && (
                <div className={`asset-manager-job ${activeJob.status === 'running' ? 'is-active' : ''}`}>
                    <div className="asset-manager-job-main">
                        <strong>{activeJob.type}</strong>
                        <span className="asset-manager-job-message">{activeJob.message || '处理中'}</span>
                    </div>
                    <div className="asset-manager-job-meta">{`Job ${activeJob.id} · ${activeJob.status}`}</div>
                </div>
            )}

            <div className="asset-lite-summary">
                <div>
                    <span>资产库</span>
                    <strong>{formatCount(packages.length)}</strong>
                </div>
                <div>
                    <span>点云包</span>
                    <strong>{formatCount(pointCloudAssetCount)}</strong>
                </div>
                <div>
                    <span>已生成</span>
                    <strong>{formatCount(generatedAssetCount)}</strong>
                </div>
                <div>
                    <span>最新资产</span>
                    <strong>{latestPackage ? getPackageTitle(latestPackage) : '暂无'}</strong>
                </div>
            </div>

            <div className={selectedPackage ? 'asset-selection-panel' : 'asset-selection-panel is-empty'}>
                {selectedPackage ? (
                    <>
                        <div className="asset-selection-main">
                            <div className="asset-selection-title">{getPackageTitle(selectedPackage)}</div>
                            <div className="asset-selection-meta">
                                {[
                                    `点云文件 ${formatCount(selectedSummary.pointCloudFiles)}`,
                                    `估算点数 ${formatCount(selectedSummary.pointCount)}`,
                                    `大小 ${formatBytes(selectedPackage.sizeBytes)}`,
                                    selectedPackage.baseMapExists ? '点云资产已生成' : '等待生成点云资产',
                                ].join(' / ')}
                            </div>
                        </div>
                        <Space className="asset-selection-actions">
                            <Button onClick={() => handleGenerateAsset()} disabled={!canGenerateSelected || working}>
                                生成点云资产
                            </Button>
                            <Button type="primary" onClick={() => handleOpenBaseMap()} disabled={!canOpenSelected}>
                                打开标注
                            </Button>
                            <Button onClick={handleGenerateAndOpen} disabled={!canGenerateSelected || working}>
                                生成并打开
                            </Button>
                        </Space>
                    </>
                ) : (
                    <div>
                        <div className="asset-selection-title">还没有选择点云包</div>
                        <div className="asset-selection-meta">先上传最新 LAS 包，系统会自动选中新上传的资产。</div>
                    </div>
                )}
            </div>

            <Table
                rowKey="packageId"
                rowSelection={{
                    type: 'radio',
                    selectedRowKeys: selectedPackageId ? [selectedPackageId] : [],
                    onChange: (keys) => setSelectedPackageId(String(keys[0] || '')),
                    getCheckboxProps: (record: any) => ({
                        disabled: uploading || working || Number(record.summary?.pointCloudFiles || 0) <= 0,
                    }),
                }}
                columns={columns}
                dataSource={packages}
                loading={loading}
                tableLayout="fixed"
                pagination={{ pageSize: 6, showSizeChanger: false }}
                className="asset-manager-table"
                locale={{ emptyText: '还没有点云资产，请上传最新 LAS/LAZ/ZIP 包。' }}
            />

            <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept=".las,.laz,.zip"
                style={{ display: 'none' }}
                onChange={handleUploadInput}
            />
        </Modal>
    );
}
