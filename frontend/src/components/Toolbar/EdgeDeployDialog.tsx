import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudUploadOutlined, ReloadOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons';
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
    'selected-map-coordinates': '发布包坐标',
    'selected-map-vehicle-pose': '车辆位置',
};

export default function EdgeDeployDialog({ open, onCancel }: EdgeDeployDialogProps) {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [preflight, setPreflight] = useState<any>(null);
    const [jobText, setJobText] = useState('');
    const [releasedMaps, setReleasedMaps] = useState<any[]>([]);
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
    let overviewStatus = 'idle';
    if (errorCheckCount > 0) {
        overviewStatus = 'error';
    } else if (warningCheckCount > 0) {
        overviewStatus = 'warning';
    } else if (preflight) {
        overviewStatus = 'ok';
    }

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
        } else {
            setJobText('');
        }
    }, [loadConfig, open]);

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
                message.success('边缘设备配置已保存，预检通过');
                return;
            }
            Modal.warning({
                title: '配置已保存，但预检未通过',
                width: 680,
                content: (
                    <pre className="edge-deploy-detail">
                        {(result?.preflight?.checks || [])
                            .map((item: any) => `[${item.status}] ${item.message}`)
                            .join('\n')}
                    </pre>
                ),
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
                throw new Error(configResponse?.message || '预检未通过，已停止部署');
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
            let dreamviewText = '';
            if (dreamviewVerification) {
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

    const footer = (
        <Space className="edge-deploy-footer">
            <Button onClick={onCancel}>关闭</Button>
            <Button icon={<SaveOutlined />} onClick={saveAndPreflight} loading={loading}>
                保存并预检
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
            width={980}
            footer={footer}
            className="edge-deploy-dialog"
        >
            <Form form={form} layout="vertical" className="edge-deploy-form">
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
                    <section className="edge-deploy-section">
                        <div className="edge-deploy-section-title">目标设备</div>
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

                    <section className="edge-deploy-section">
                        <div className="edge-deploy-section-title">Apollo 目标</div>
                        <Form.Item label="地图目录" required>
                            <Space.Compact style={{ width: '100%' }}>
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

                    <section className="edge-deploy-section">
                        <div className="edge-deploy-section-title">发布包</div>
                        <Form.Item label="选择发布包" required>
                            <Space.Compact style={{ width: '100%' }}>
                                <Form.Item
                                    name="mapName"
                                    noStyle
                                    rules={[{ required: true, message: '请选择要部署的发布包' }]}
                                >
                                    <Select
                                        showSearch
                                        placeholder="选择发布包"
                                        optionFilterProp="title"
                                        onChange={() => setPreflight(null)}
                                        options={selectableMaps.map((item: any, index: number) => {
                                            const optionStatus = item.ready ? 'ready' : item.status || 'invalid';
                                            const optionTime = item.modifiedAt
                                                ? ` · ${formatModifiedTime(item.modifiedAt)}`
                                                : '';
                                            return {
                                                value: item.mapName,
                                                title: `${item.mapName} ${item.statusMessage || ''}`,
                                                disabled: !item.ready,
                                                label: (
                                                    <div className="edge-deploy-option">
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

                    <section className="edge-deploy-section">
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
                                            <span>{item.message}</span>
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
