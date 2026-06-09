import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CloudUploadOutlined,
    HistoryOutlined,
    ReloadOutlined,
    RollbackOutlined,
    SaveOutlined,
    SearchOutlined,
} from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag, message } from 'antd';
import FileService from 'src/service/index';

interface EdgeDeployDialogProps {
    open: boolean;
    onCancel: () => void;
}

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

const checkColor = (status: string) => {
    if (status === 'ok') {
        return 'green';
    }
    if (status === 'warning') {
        return 'gold';
    }
    return 'red';
};

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

const mapStatusColor = (map: any) => {
    if (map?.ready) {
        return 'green';
    }
    if (map?.status === 'invalid') {
        return 'red';
    }
    return 'gold';
};

const getChecks = (preflight: any) => (Array.isArray(preflight?.checks) ? preflight.checks : []);

const getCheck = (preflight: any, name: string) => getChecks(preflight).find((item: any) => item.name === name);

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

const getOverviewStatusText = (status: string, hasPreflight: boolean) => {
    if (!hasPreflight) {
        return '待预检';
    }
    if (status === 'ok') {
        return '可部署';
    }
    if (status === 'warning') {
        return '有警告';
    }
    return '需处理';
};

const getOverviewStatusTagColor = (status: string) => {
    if (status === 'ok') {
        return 'green';
    }
    if (status === 'warning') {
        return 'gold';
    }
    if (status === 'error') {
        return 'red';
    }
    return 'default';
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
            '可信参考地图距离超过阈值，需确认是否跨场地或新场地部署',
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

const renderPreflightIssues = (preflight: any, fallback: string, statuses: string[] = ['error']) => {
    const issues = getPreflightIssues(preflight, statuses);
    if (issues.length === 0) {
        return <div className="edge-deploy-issue-list">{fallback}</div>;
    }
    return (
        <div className="edge-deploy-issue-list">
            <ul>
                {issues.map((item: any) => (
                    <li key={`${item.name}-${item.status}`}>
                        <strong>{checkTitleMap[item.name] || item.name}</strong>
                        <span>{getCheckDisplayMessage(item)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default function EdgeDeployDialog({ open, onCancel }: EdgeDeployDialogProps) {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [preflight, setPreflight] = useState<any>(null);
    const [jobText, setJobText] = useState('');
    const [releasedMaps, setReleasedMaps] = useState<any[]>([]);
    const [deploymentRecords, setDeploymentRecords] = useState<any[]>([]);
    const selectedMapName = Form.useWatch('mapName', form);
    const selectedMap = useMemo(
        () => releasedMaps.find((item: any) => item.mapName === selectedMapName) || null,
        [releasedMaps, selectedMapName],
    );
    const selectableMaps = useMemo(() => releasedMaps.filter((item: any) => item.selectable), [releasedMaps]);
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
    const recentDeploymentRecords = useMemo(() => deploymentRecords.slice(0, 6), [deploymentRecords]);
    let overviewStatus = 'idle';
    if (errorCheckCount > 0) {
        overviewStatus = 'error';
    } else if (warningCheckCount > 0) {
        overviewStatus = 'warning';
    } else if (preflight) {
        overviewStatus = 'ok';
    }
    const overviewStatusText = getOverviewStatusText(overviewStatus, Boolean(preflight));

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
            const currentMapName = form.getFieldValue('mapName');
            const defaultMapName =
                maps.find((item: any) => item.selectable && item.ready)?.mapName ||
                maps.find((item: any) => item.selectable)?.mapName ||
                '';
            setReleasedMaps(maps);
            form.setFieldsValue({
                host: data.host || '',
                user: data.user || 'apollo',
                password: '',
                port: data.port || 22,
                targetMapRoot: data.targetMapRoot || '/apollo/modules/map/data',
                dockerContainer: data.dockerContainer || '',
                nativeMapTools: data.nativeMapTools !== false,
                autoSwitchDreamview: data.autoSwitchDreamview !== false,
                postDeployCommand: data.postDeployCommand || '',
                mapName: currentMapName || defaultMapName,
            });
        } catch (error: any) {
            Modal.error({
                title: '读取边缘设备配置失败',
                content: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
        }
    }, [form]);

    const refreshReleasedMaps = async () => {
        setLoading(true);
        try {
            const response = await FileService.getReleasedMaps();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取发布包失败');
            }
            const maps = Array.isArray(response?.data?.maps) ? response.data.maps : [];
            setReleasedMaps(maps);
            const currentMapName = form.getFieldValue('mapName');
            const currentStillExists = maps.some((item: any) => item.mapName === currentMapName && item.selectable);
            if (!currentStillExists) {
                form.setFieldValue('mapName', maps.find((item: any) => item.selectable && item.ready)?.mapName || '');
            }
        } catch (error: any) {
            Modal.error({
                title: '读取发布包失败',
                content: error?.message || 'Unknown error',
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
        }
    }, [loadConfig, loadDeployments, open]);

    const discoverMapRoot = async () => {
        const values = await form.validateFields(['host', 'user', 'port']);
        setLoading(true);
        try {
            const response = await FileService.discoverEdgeMapRoot({
                ...form.getFieldsValue(),
                ...values,
            });
            if (response?.code !== 0) {
                throw new Error(response?.message || '自动发现地图目录失败');
            }
            form.setFieldValue('targetMapRoot', response.data?.targetMapRoot || '/apollo/modules/map/data');
            message.success('已发现 Apollo 地图目录');
        } catch (error: any) {
            Modal.error({
                title: '自动发现地图目录失败',
                content: error?.message || '请确认服务器到边缘设备已配置免密 SSH，且 Apollo 目录可访问。',
            });
        } finally {
            setLoading(false);
        }
    };

    const saveAndPreflight = async () => {
        const values = await form.validateFields();
        setLoading(true);
        setJobText(`正在预检：${values.mapName || '所选发布包'}`);
        try {
            const response = await FileService.configureEdgeDeploy({
                ...values,
                mode: 'ssh',
                autoDiscover: false,
            });
            const result = response?.data;
            setPreflight(result?.preflight || null);
            if (response?.code === 0) {
                const warnings = getPreflightIssues(result?.preflight, ['warning']);
                if (warnings.length > 0) {
                    message.warning('边缘设备配置已保存，预检通过但存在上线前警告');
                } else {
                    message.success('边缘设备配置已保存，预检通过');
                }
                return;
            }
            Modal.warning({
                title: '配置已保存，但预检未通过',
                width: 680,
                content: renderPreflightIssues(result?.preflight, response?.message || '预检未通过'),
            });
        } catch (error: any) {
            Modal.error({
                title: '保存边缘设备配置失败',
                content: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const deploySelected = async () => {
        const values = await form.validateFields();
        const { mapName } = values;
        setLoading(true);
        setJobText(`正在保存配置并预检：${mapName}`);
        try {
            const configResponse = await FileService.configureEdgeDeploy({
                ...values,
                mode: 'ssh',
                autoDiscover: false,
            });
            setPreflight(configResponse?.data?.preflight || null);
            if (configResponse?.code !== 0) {
                Modal.error({
                    title: '部署失败：预检未通过',
                    width: 720,
                    content: renderPreflightIssues(
                        configResponse?.data?.preflight,
                        configResponse?.message || '预检未通过，已停止部署',
                    ),
                });
                return;
            }
            setJobText(`正在提交部署任务：${mapName}`);
            const response = await FileService.startDeployReleasedMapJob(mapName);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交部署任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, `部署地图 ${mapName}`, setJobText);
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
            Modal.success({
                title: '部署完成',
                content: `地图 ${
                    job.result?.mapName || job.result?.deployment?.mapName || ''
                } 已部署到边缘设备${dreamviewText}。`,
            });
            await loadDeployments();
        } catch (error: any) {
            Modal.error({
                title: '部署失败',
                content: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const rollbackDeployment = async (record: any) => {
        setLoading(true);
        setJobText(`正在回滚部署：${record.mapName || record.id}`);
        try {
            const response = await FileService.startRollbackDeploymentJob(record.id);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交回滚任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, `回滚地图 ${record.mapName || ''}`, setJobText);
            Modal.success({
                title: '回滚完成',
                content: `地图 ${job.result?.deployment?.mapName || record.mapName || ''} 已恢复到上一份备份。`,
            });
            setPreflight(null);
            await loadDeployments();
        } catch (error: any) {
            Modal.error({
                title: '回滚失败',
                content: error?.message || 'Unknown error',
            });
        } finally {
            setLoading(false);
            setJobText('');
        }
    };

    const confirmRollbackDeployment = (record: any) => {
        Modal.confirm({
            title: '确认回滚边缘设备地图？',
            width: 620,
            okText: '确认回滚',
            okButtonProps: { danger: true },
            cancelText: '取消',
            content: (
                <div className="edge-deploy-confirm">
                    <p>{`将把 ${record.mapName || '-'} 回滚到部署前备份。`}</p>
                    <p>{`备份目录：${record.backupDir || '-'}`}</p>
                </div>
            ),
            onOk: () => rollbackDeployment(record),
        });
    };

    const refreshDeployments = () => {
        loadDeployments().catch((error: any) =>
            Modal.error({ title: '读取部署历史失败', content: error?.message || 'Unknown error' }),
        );
    };

    const footer = (
        <Space className="edge-deploy-footer" wrap>
            <Button onClick={onCancel}>关闭</Button>
            <Button icon={<SaveOutlined />} onClick={saveAndPreflight} loading={loading}>
                保存并预检
            </Button>
            <Button icon={<HistoryOutlined />} onClick={refreshDeployments} loading={loading}>
                刷新历史
            </Button>
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={deploySelected} loading={loading}>
                部署所选地图
            </Button>
        </Space>
    );

    return (
        <Modal
            title="边缘设备部署"
            open={open}
            onCancel={onCancel}
            width={960}
            footer={footer}
            centered
            className="edge-deploy-dialog"
        >
            <Form form={form} layout="vertical" className="edge-deploy-form">
                <div className={`edge-deploy-intro ${overviewStatus}`}>
                    <div className="edge-deploy-intro-main">
                        <span>部署流程</span>
                        <strong>{selectedMap?.mapName || '选择发布包后开始预检'}</strong>
                    </div>
                    <div className="edge-deploy-intro-desc">
                        保存并预检后，再执行地图部署；预检会覆盖 SSH、容器、Dreamview 和坐标一致性。
                    </div>
                    <Tag color={getOverviewStatusTagColor(overviewStatus)}>{overviewStatusText}</Tag>
                </div>
                <div className="edge-deploy-overview">
                    <div className={`edge-deploy-metric ${runtimeCheck?.status || 'idle'}`}>
                        <span>边缘实际加载</span>
                        <strong>{runtimeDetails?.map_name || runtimeDetails?.flag_map_dir || '待预检'}</strong>
                    </div>
                    <div className={`edge-deploy-metric ${dreamviewCheck?.status || 'idle'}`}>
                        <span>Dreamview 当前地图</span>
                        <strong>{dreamviewCheck?.details?.currentMap || '待预检'}</strong>
                    </div>
                    <div className={`edge-deploy-metric ${vehiclePoseCheck?.status || 'idle'}`}>
                        <span>车辆到中心线</span>
                        <strong>{formatMeters(vehiclePoseDetails?.nearest?.distanceMeters)}</strong>
                    </div>
                    <div className={`edge-deploy-metric ${coordinateCheck?.status || 'idle'}`}>
                        <span>发布包中心</span>
                        <strong>{formatBoundsCenter(coordinateBounds)}</strong>
                    </div>
                    <div className={`edge-deploy-metric ${overviewStatus}`}>
                        <span>预检概况</span>
                        <strong>
                            {preflight
                                ? `${readyCheckCount} 通过 / ${warningCheckCount} 警告 / ${errorCheckCount} 错误`
                                : '待预检'}
                        </strong>
                    </div>
                </div>
                <div className="edge-deploy-grid">
                    <section className="edge-deploy-section edge-deploy-section-device">
                        <div className="edge-deploy-section-title">目标设备</div>
                        <div className="edge-deploy-section-desc">边缘设备 SSH 连接信息。</div>
                        <div className="edge-deploy-field-grid compact">
                            <Form.Item
                                label="边缘设备 IP"
                                name="host"
                                rules={[{ required: true, message: '请输入边缘设备 IP' }]}
                            >
                                <Input placeholder="192.168.110.50" />
                            </Form.Item>
                            <Form.Item
                                label="SSH 端口"
                                name="port"
                                rules={[{ required: true, message: '请输入 SSH 端口' }]}
                            >
                                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item
                                label="SSH 用户"
                                name="user"
                                rules={[{ required: true, message: '请输入 SSH 用户' }]}
                            >
                                <Input placeholder="apollo / nvidia" />
                            </Form.Item>
                            <Form.Item label="SSH 密码" name="password">
                                <Input.Password placeholder="留空使用已保存密码或密钥" autoComplete="new-password" />
                            </Form.Item>
                        </div>
                    </section>

                    <section className="edge-deploy-section edge-deploy-section-apollo">
                        <div className="edge-deploy-section-title">Apollo 目标</div>
                        <div className="edge-deploy-section-desc">地图目录、容器和部署后动作。</div>
                        <Form.Item label="地图目录" required>
                            <Space.Compact className="edge-deploy-input-action" style={{ width: '100%' }}>
                                <Form.Item name="targetMapRoot" noStyle>
                                    <Input placeholder="/apollo/modules/map/data" />
                                </Form.Item>
                                <Button icon={<SearchOutlined />} onClick={discoverMapRoot} loading={loading}>
                                    自动发现
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <div className="edge-deploy-field-grid">
                            <Form.Item label="Docker 容器" name="dockerContainer">
                                <Input placeholder="apollo_dev_nvidia" />
                            </Form.Item>
                            <Form.Item label="生成原生地图文件" name="nativeMapTools" valuePropName="checked">
                                <Switch checkedChildren="开" unCheckedChildren="关" />
                            </Form.Item>
                        </div>
                        <Form.Item label="部署后切换 Dreamview" name="autoSwitchDreamview" valuePropName="checked">
                            <Switch checkedChildren="开" unCheckedChildren="关" />
                        </Form.Item>
                        <Form.Item label="额外部署后命令" name="postDeployCommand">
                            <Input placeholder="可选，高级命令；默认已自动切换 Dreamview" />
                        </Form.Item>
                    </section>

                    <section className="edge-deploy-section edge-deploy-section-package">
                        <div className="edge-deploy-section-title">发布包</div>
                        <div className="edge-deploy-section-desc">选择已发布且可部署的地图包。</div>
                        <Form.Item label="选择发布包" required>
                            <Space.Compact className="edge-deploy-input-action" style={{ width: '100%' }}>
                                <Form.Item
                                    name="mapName"
                                    noStyle
                                    rules={[{ required: true, message: '请选择要部署的发布包' }]}
                                >
                                    <Select
                                        showSearch
                                        placeholder="选择发布包"
                                        optionFilterProp="title"
                                        optionLabelProp="value"
                                        popupClassName="edge-deploy-map-select-dropdown"
                                        onChange={() => setPreflight(null)}
                                        options={selectableMaps.map((item: any, index: number) => {
                                            const optionStatus = item.ready ? 'ready' : item.status || 'invalid';
                                            const optionTime = item.modifiedAt
                                                ? ` · ${formatModifiedTime(item.modifiedAt)}`
                                                : '';
                                            return {
                                                value: item.mapName,
                                                title: `${item.mapName} ${item.statusMessage || ''}`,
                                                label: (
                                                    <div
                                                        className={`edge-deploy-option ${
                                                            item.ready ? 'is-ready' : 'is-not-ready'
                                                        }`}
                                                    >
                                                        <span>{item.mapName}</span>
                                                        <small>
                                                            {optionStatus}
                                                            {index === 0 ? ' · 最新修改' : ''}
                                                            {optionTime}
                                                        </small>
                                                    </div>
                                                ),
                                            };
                                        })}
                                    />
                                </Form.Item>
                                <Button icon={<ReloadOutlined />} onClick={refreshReleasedMaps} loading={loading}>
                                    刷新
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        {selectedMap && (
                            <div className="edge-deploy-map-summary">
                                <div className="wide">
                                    <span>发布包</span>
                                    <strong>{selectedMap.mapName}</strong>
                                </div>
                                <div>
                                    <span>状态</span>
                                    <Tag color={mapStatusColor(selectedMap)}>
                                        {selectedMap.ready ? 'ready' : selectedMap.status || 'invalid'}
                                    </Tag>
                                </div>
                                <div>
                                    <span>修改时间</span>
                                    <strong>{formatModifiedTime(selectedMap.modifiedAt)}</strong>
                                </div>
                                <div>
                                    <span>大小</span>
                                    <strong>{`${Math.round((Number(selectedMap.sizeBytes) || 0) / 1024)} KB`}</strong>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="edge-deploy-section edge-deploy-section-history">
                        <div className="edge-deploy-section-heading">
                            <div className="edge-deploy-section-title">最近部署</div>
                            <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={refreshDeployments}
                                loading={loading}
                            >
                                刷新
                            </Button>
                        </div>
                        {recentDeploymentRecords.length > 0 ? (
                            <div className="edge-deploy-history-list">
                                {recentDeploymentRecords.map((item: any) => {
                                    const rollbackable =
                                        item.type === 'deploy' &&
                                        item.status === 'succeeded' &&
                                        Boolean(item.backupDir);
                                    return (
                                        <div className="edge-deploy-history-row" key={item.id}>
                                            <div className="edge-deploy-history-main">
                                                <strong>{item.mapName || '-'}</strong>
                                                <span>
                                                    {`${item.type || 'deploy'} / ${item.status || '-'} / ${formatModifiedTime(
                                                        item.finishedAt || item.startedAt,
                                                    )}`}
                                                </span>
                                                <span>{item.remoteMapDir || item.target?.target || '-'}</span>
                                            </div>
                                            <Button
                                                size="small"
                                                danger
                                                disabled={!rollbackable || loading}
                                                icon={<RollbackOutlined />}
                                                onClick={() => confirmRollbackDeployment(item)}
                                            >
                                                回滚
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="edge-deploy-empty">暂无部署记录。</div>
                        )}
                    </section>

                    <section className="edge-deploy-section edge-deploy-section-status">
                        <div className="edge-deploy-section-title">执行状态</div>
                        {jobText ? <div className="edge-deploy-job">{jobText}</div> : null}
                        {runtimeDetails ? (
                            <div className="edge-deploy-runtime-summary">
                                <div>
                                    <span>flag map_dir</span>
                                    <strong>{runtimeDetails.flag_map_dir || '-'}</strong>
                                </div>
                                <div>
                                    <span>Dreamview HTTP</span>
                                    <strong>{runtimeDetails.dreamview_http || '-'}</strong>
                                </div>
                                <div>
                                    <span>坐标范围</span>
                                    <strong>{runtimeDetails.coordinate_bounds || '-'}</strong>
                                </div>
                            </div>
                        ) : null}
                        {preflight ? (
                            <div className="edge-deploy-checks">
                                <div className="edge-deploy-checks-title">
                                    <span>预检结果</span>
                                    {preflight.ready ? <Tag color="green">通过</Tag> : <Tag color="red">未通过</Tag>}
                                </div>
                                {preflightChecks.map((item: any) => (
                                    <div className="edge-deploy-check-row" key={item.name}>
                                        <Tag color={checkColor(item.status)}>{item.status}</Tag>
                                        <div>
                                            <strong>{checkTitleMap[item.name] || item.name}</strong>
                                            <span>{getCheckDisplayMessage(item)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="edge-deploy-empty">
                                保存并预检后显示 SSH、容器、Dreamview 切换和所选发布包坐标校验结果。
                            </div>
                        )}
                    </section>
                </div>
            </Form>
        </Modal>
    );
}
