import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Space, Tag, message } from 'antd';
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

export default function EdgeDeployDialog({ open, onCancel }: EdgeDeployDialogProps) {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [preflight, setPreflight] = useState<any>(null);
    const [jobText, setJobText] = useState('');

    const loadConfig = useCallback(async () => {
        setLoading(true);
        try {
            const response = await FileService.getDeployConfig();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取边缘设备配置失败');
            }
            const data = response.data || {};
            form.setFieldsValue({
                host: data.host || '',
                user: data.user || 'apollo',
                port: data.port || 22,
                targetMapRoot: data.targetMapRoot || '/apollo/modules/map/data',
                postDeployCommand: data.postDeployCommand || '',
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
        }
    };

    const deployLatest = async () => {
        setLoading(true);
        setJobText('正在提交部署任务');
        try {
            const response = await FileService.startDeployLatestReleasedMapJob();
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交部署任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, '部署最新地图', setJobText);
            Modal.success({
                title: '部署完成',
                content: `地图 ${job.result?.mapName || job.result?.deployment?.mapName || ''} 已部署到边缘设备。`,
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
        <Space>
            <Button onClick={onCancel}>关闭</Button>
            <Button onClick={discoverMapRoot} loading={loading}>
                自动发现目录
            </Button>
            <Button onClick={saveAndPreflight} loading={loading}>
                保存并预检
            </Button>
            <Button type="primary" onClick={deployLatest} loading={loading}>
                部署最新地图
            </Button>
        </Space>
    );

    return (
        <Modal
            title="边缘设备部署"
            open={open}
            onCancel={onCancel}
            width={760}
            footer={footer}
            className="edge-deploy-dialog"
        >
            <Form form={form} layout="vertical">
                <Form.Item label="边缘设备 IP" name="host" rules={[{ required: true, message: '请输入边缘设备 IP' }]}>
                    <Input placeholder="例如 192.168.110.50" />
                </Form.Item>
                <Form.Item label="SSH 用户" name="user" rules={[{ required: true, message: '请输入 SSH 用户' }]}>
                    <Input placeholder="例如 apollo / dell / root" />
                </Form.Item>
                <Form.Item label="SSH 端口" name="port" rules={[{ required: true, message: '请输入 SSH 端口' }]}>
                    <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="Apollo 地图目录" name="targetMapRoot">
                    <Input placeholder="/apollo/modules/map/data" />
                </Form.Item>
                <Form.Item label="部署后命令" name="postDeployCommand">
                    <Input placeholder="可选，例如重启 Dreamview 或刷新地图服务" />
                </Form.Item>
            </Form>
            {jobText && <div className="edge-deploy-job">{jobText}</div>}
            {preflight && (
                <div className="edge-deploy-checks">
                    <div className="edge-deploy-checks-title">
                        <span>预检结果：</span>
                        {preflight.ready ? <Tag color="green">通过</Tag> : <Tag color="red">未通过</Tag>}
                    </div>
                    {(preflight.checks || []).map((item: any) => (
                        <div className="edge-deploy-check-row" key={item.name}>
                            <Tag color={checkColor(item.status)}>{item.status}</Tag>
                            <span>{item.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </Modal>
    );
}
