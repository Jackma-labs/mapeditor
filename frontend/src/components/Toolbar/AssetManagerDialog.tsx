import PubSub from 'pubsub-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, Space, Table, Tag, message } from 'antd';
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
    return 'default';
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
    const [selectedPackageIds, setSelectedPackageIds] = useState<React.Key[]>([]);

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
            const response = await FileService.getRuntimeJobs(8);
            if (response?.code === 0) {
                setJobs(response?.data?.jobs || []);
            }
        } catch (error) {
            setJobs([]);
        }
    }, []);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadPackages(), loadJobs()]);
    }, [loadJobs, loadPackages]);

    const waitForRuntimeJob = async (jobId: string, label: string, attempt = 0): Promise<any> => {
        if (attempt >= 600) {
            setJobText('');
            throw new Error('后台任务等待超时');
        }
        const response = await FileService.getRuntimeJob(jobId);
        if (response?.code !== 0) {
            throw new Error(response?.message || '读取后台任务失败');
        }
        const job = response?.data?.job;
        if (job?.status === 'succeeded') {
            setJobText('');
            return job;
        }
        if (job?.status === 'failed') {
            setJobText('');
            throw new Error(job?.message || '后台任务失败');
        }
        setJobText(`${label}，状态：${job?.status || 'running'}`);
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

    const handleGenerateMergedBaseMap = () => {
        const packageIds = selectedPackageIds.map(String);
        const selectedPackages = packages.filter((item) => packageIds.includes(item.packageId));
        if (selectedPackages.length < 2) {
            message.warning('请至少选择两个采图包');
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
                        `采图包: ${selectedPackages.length} 个`,
                        `底图名: ${mapName}`,
                        '',
                        ...selectedPackages.map(
                            (item) =>
                                `- ${item.defaultMapName || item.packageId}: 点云 ${formatCount(
                                    item.summary?.pointCloudFiles,
                                )}, RTK ${formatCount(item.summary?.trajectory?.poseFileCount)}`,
                        ),
                        '',
                        '系统会按资产预检中的 RTK/轨迹锚点生成拼接计划，并把所有点云合成为一张可标注底图。',
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

    useEffect(() => {
        if (open) {
            refreshAll();
        } else {
            setJobText('');
        }
    }, [open, refreshAll]);

    useEffect(() => {
        const packageIds = new Set(packages.map((item) => item.packageId));
        setSelectedPackageIds((current) => current.filter((packageId) => packageIds.has(String(packageId))));
    }, [packages]);

    const columns = [
        {
            title: '资产',
            dataIndex: 'defaultMapName',
            key: 'asset',
            render: (_value: string, record: any) => (
                <div className="asset-manager-name-cell">
                    <div className="asset-manager-name">{record.defaultMapName || record.packageId}</div>
                    <div className="asset-manager-id">{record.packageId}</div>
                </div>
            ),
        },
        {
            title: '状态',
            key: 'status',
            width: 96,
            render: (_value: string, record: any) => {
                const hasPointCloud = Number(record.summary?.pointCloudFiles || 0) > 0;
                return <Tag color={hasPointCloud ? 'green' : 'orange'}>{hasPointCloud ? '已预检' : '缺点云'}</Tag>;
            },
        },
        {
            title: '内容',
            key: 'content',
            render: (_value: string, record: any) => {
                const summary = record.summary || {};
                return (
                    <div className="asset-manager-content">
                        <span>{`点云 ${formatCount(summary.pointCloudFiles)}`}</span>
                        <span>{`LAS ${formatCount(summary.lasFiles)}`}</span>
                        <span>{`PCD ${formatCount(summary.pcdFiles)}`}</span>
                        <span>{`Image ${formatCount(summary.imageFiles)}`}</span>
                        {Number(summary.trajectory?.poseFileCount || 0) > 0 && (
                            <span>{`RTK ${formatCount(summary.trajectory.poseFileCount)}`}</span>
                        )}
                    </div>
                );
            },
        },
        {
            title: '点数/大小',
            key: 'size',
            width: 150,
            render: (_value: string, record: any) => (
                <div className="asset-manager-size">
                    <div>{formatCount(record.summary?.pointCount)}</div>
                    <div>{formatBytes(record.sizeBytes)}</div>
                </div>
            ),
        },
        {
            title: '更新时间',
            dataIndex: 'modifiedAt',
            key: 'modifiedAt',
            width: 180,
            render: (value: string) => formatDateTime(value),
        },
        {
            title: '操作',
            key: 'actions',
            width: 300,
            render: (_value: string, record: any) => (
                <Space size={8}>
                    <Button size="small" onClick={() => showDetails(record)}>
                        详情
                    </Button>
                    <Button size="small" onClick={() => handleRefreshAnalysis(record)} disabled={uploading}>
                        重跑预检
                    </Button>
                    <Button size="small" onClick={() => handleGenerateBaseMap(record)} disabled={uploading}>
                        生成底图
                    </Button>
                    <Button size="small" type="primary" onClick={() => handleOpenBaseMap(record)}>
                        打开
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <Modal
            {...rest}
            open={open}
            title="采图包资产"
            width={1120}
            footer={null}
            onCancel={onCancel}
            className="asset-manager-dialog"
        >
            <div className="asset-manager-toolbar">
                <div>
                    <div className="asset-manager-title">原始采图包资产管理</div>
                    <div className="asset-manager-subtitle">
                        上传 ZIP 或多文件包，预检 LAS/PCD/Image，再生成可标注点云底图。
                    </div>
                </div>
                <Space>
                    <Button onClick={refreshAll} disabled={loading || uploading}>
                        刷新
                    </Button>
                    <Button onClick={handleGenerateMergedBaseMap} disabled={selectedPackageIds.length < 2 || uploading}>
                        合并生成底图
                    </Button>
                    <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={uploading}>
                        上传/预检采图包
                    </Button>
                </Space>
            </div>
            {jobText && <div className="asset-manager-job">{jobText}</div>}
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
                                <span>{job.type}</span>
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
                        disabled: uploading || Number(record.summary?.pointCloudFiles || 0) <= 0,
                    }),
                }}
                columns={columns}
                dataSource={packages}
                loading={loading}
                pagination={{ pageSize: 6, showSizeChanger: false }}
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
