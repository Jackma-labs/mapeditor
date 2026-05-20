import React, { useEffect, useState, FC } from 'react';
import PubSub from 'pubsub-js';
import type { MenuProps } from 'antd';
import { Button, ConfigProvider, Dropdown, Modal, Tooltip } from 'antd';
import './index.less';
import { MapElementType, OperationType, PermissionStatus, ThreeElementType } from 'src/interface/commonInterFace';
import { escKeyExitDrawHandle } from 'src/handle/escKeyHandle';
import { useManagerStore } from 'src/store';
import FileService from 'src/service/index';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import DialogMap from './openFileDialog';
import DialogOperate from './operateDialog';
import DialogMessage from './messageDialog';
import AssetManagerDialog from './AssetManagerDialog';
import EdgeDeployDialog from './EdgeDeployDialog';
import arrowsDown from '../../assets/images/ic_arrows_down.svg';
import RemindModal from '../RemindModal';

import backCanClick from '../../assets/images/ic_back_to_ast_point.svg';
import backDisable from '../../assets/images/ic_back_to_ast_point_not_applicable.svg';
import backStepHover from '../../assets/images/ic_back_to_ast_point_hover.svg';
import nextCanClick from '../../assets/images/ic_next_step.svg';
import nextDisable from '../../assets/images/ic_next_step_not_applicable.svg';
import nextStepHover from '../../assets/images/ic_next_step_hover.svg';
import rotateHover from '../../assets/images/ic_spin_hover.svg';

import rotateDisable from '../../assets/images/ic_spin_not_applicable.svg';
import rotate from '../../assets/images/ic_spin.svg';
import rotateActive from '../../assets/images/ic_spin_pitch_on.svg';

import LeadIcon from '../../assets/images/ic_lead.svg';
import LeadDisabledIcon from '../../assets/images/ic_lead_disabled.svg';
import LabelIcon from '../../assets/images/ic_map_editor.svg';
import SaveIcon from '../../assets/images/ic_save.svg';
import IssueIcon from '../../assets/images/ic_sissue.svg';
import LandingLogo from '../../assets/images/landing-logo.png';

import rangingDefault from '../../assets/images/ic_ranging.svg';
import rangingDisable from '../../assets/images/ic_ranging_forbidden.svg';
import rangingHover from '../../assets/images/ic_ranging_hover.svg';

import { mapElements } from './constData';

interface RenderIconProps {
    url: string;
}

// eslint-disable-next-line react/function-component-definition
const RenderIcon: FC<RenderIconProps> = ({ url }) => <img src={url} alt="My SVG" />;

function MapElementIcon({ type }: { type: MapElementType }) {
    const common = {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
    };
    switch (type) {
        case MapElementType.Lane:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M7 21c2-5 2-13 0-18" />
                    <path {...common} d="M17 21c-2-5-2-13 0-18" />
                    <path {...common} d="M12 5v3M12 11v3M12 17v2" />
                </svg>
            );
        case MapElementType.Junction:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M12 3v18M3 12h18" />
                    <path {...common} d="M7 7l10 10M17 7L7 17" />
                </svg>
            );
        case MapElementType.Crosswalk:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M4 6h16M4 18h16" />
                    <path {...common} d="M7 8v8M11 8v8M15 8v8" />
                </svg>
            );
        case MapElementType.SpeedBump:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M4 15c2-4 4-4 6 0s4 4 6 0 3-4 4-2" />
                    <path {...common} d="M4 19h16" />
                </svg>
            );
        case MapElementType.TrafficSignal:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect {...common} x="8" y="3" width="8" height="14" rx="2" />
                    <path {...common} d="M12 17v4" />
                    <circle cx="12" cy="7" r="1.3" fill="currentColor" />
                    <circle cx="12" cy="11" r="1.3" fill="currentColor" />
                    <circle cx="12" cy="15" r="1.3" fill="currentColor" />
                </svg>
            );
        case MapElementType.ParkingSpace:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect {...common} x="5" y="4" width="14" height="16" rx="1" />
                    <path {...common} d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
                </svg>
            );
        case MapElementType.Sign:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M12 3l8 8-8 8-8-8 8-8Z" />
                    <path {...common} d="M12 8v5" />
                    <path {...common} d="M12 16h.01" />
                </svg>
            );
        case MapElementType.RoadBoundary:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M6 20c3-4 3-12 0-16" />
                    <path {...common} d="M18 20c-3-4-3-12 0-16" />
                </svg>
            );
        case MapElementType.Area:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M5 7l7-3 7 5-2 8-9 3-4-6 1-7Z" />
                </svg>
            );
        case MapElementType.BarrierGate:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M5 19V9M19 19V9M4 9h16" />
                    <path {...common} d="M7 9l3 4M11 9l3 4M15 9l3 4" />
                </svg>
            );
        case MapElementType.StraightLine:
        default:
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path {...common} d="M5 19L19 5" />
                    <path {...common} d="M15 5h4v4" />
                </svg>
            );
    }
}

function FileMenuLabel({ title, description }: { title: string; description?: string }) {
    return (
        <span className="file-menu-label">
            <span className="file-menu-label-title">{title}</span>
            {description && <span className="file-menu-label-desc">{description}</span>}
        </span>
    );
}

const sleep = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

enum RotateStatus {
    Disable = 1,
    Active,
    Default,
}
enum HoverTool {
    Next = 1,
    Back,
    Rotate,
    Ranging,
    OpenImg,
}

interface ToolbarProps {
    messageApi: any;
    account?: any;
    onLogout?: () => void;
}

export default function Index(prop: ToolbarProps) {
    const [viewstate, setMapState, canUndo, canRedo, undo, redo] = useManagerStore((state) => [
        state.mapState,
        state.setMapState,
        state.canUndo,
        state.canRedo,
        state.undo,
        state.redo,
    ]);
    const { messageApi, account, onLogout } = prop;
    const [rotateStatus, setRotateStatus] = useState(RotateStatus.Disable);
    const [dialogTitle, setDialogTitle] = useState('');
    const [curHoverTool, setCurHoverTool] = useState<HoverTool>(null);
    const [showSaveDataRemind, changeShowSaveDataRemind] = useState(false);

    const startDrawMapElement = (type: MapElementType) => {
        PubSub.publish('closeRemind');
        PubSub.publish('emptyPickObjects');
        const newState = { ...viewstate };
        if (newState.operationType === OperationType.Drawing) {
            escKeyExitDrawHandle();
            return;
        }
        if (newState.currentDrawData.drawElementType === type) {
            escKeyExitDrawHandle();
            PubSub.publish('render');
            return;
        }
        newState.currentDrawData = {
            ...newState.currentDrawData,
            drawElementType: type,
        };
        newState.currentPickElement = [];
        newState.operationType = OperationType.Drawing;
        newState.needRender = true;
        setMapState(newState);
    };
    const handleRotating = () => {
        if (rotateStatus === RotateStatus.Active) {
            useManagerStore.getState().addCommand([new SetOperationTypeCommand(null)]);
        }
        if (rotateStatus === RotateStatus.Default) {
            useManagerStore.getState().addCommand([new SetOperationTypeCommand(OperationType.Rotating)]);
        }
    };

    const [visibleVal, setVisibleVal] = useState({
        map: false,
        operate: false,
        message: false,
        assets: false,
        edge: false,
    });

    const handleCloseDialog = () => {
        setVisibleVal({ map: false, operate: false, message: false, assets: false, edge: false });
    };

    const waitForRuntimeJob = async (jobId: string, label: string, attempt = 0): Promise<any> => {
        if (attempt >= 600) {
            throw new Error(`${label}等待超时`);
        }
        const response = await FileService.getRuntimeJob(jobId);
        if (response?.code !== 0) {
            throw new Error(response?.message || '读取后台任务失败');
        }
        const job = response?.data?.job;
        if (job?.status === 'succeeded') {
            return job;
        }
        if (job?.status === 'failed') {
            throw new Error(job?.message || `${label}失败`);
        }
        await sleep(3000);
        return waitForRuntimeJob(jobId, label, attempt + 1);
    };
    const showRuntimeStatus = async () => {
        try {
            const response = await FileService.getRuntimeDoctor();
            if (response?.code !== 0) {
                throw new Error(response?.message || 'Runtime status request failed');
            }
            const doctor = response.data;
            const checks = doctor.checks || [];
            const apolloLite = doctor.status?.apolloLite;
            let apolloLiteState = '\u672a\u542f\u7528';
            if (apolloLite?.simulationReady) {
                apolloLiteState = '\u4eff\u771f\u5c31\u7eea';
            } else if (apolloLite?.stagingReady) {
                apolloLiteState = '\u4ec5\u5730\u56fe\u5206\u53d1\u5c31\u7eea';
            } else if (apolloLite?.enabled) {
                apolloLiteState = '\u672a\u5c31\u7eea';
            }
            let dreamviewState = '未编译';
            if (apolloLite?.dreamviewRuntimeAvailable) {
                dreamviewState = apolloLite?.dreamviewHttpReady
                    ? `已运行 ${apolloLite.dreamviewUrl || ''}`
                    : `已编译，页面未响应 ${apolloLite.dreamviewUrl || ''}`;
            }
            const runtimeLines = [
                `运行模式: ${doctor.status?.mode || ''}`,
                `生产就绪: ${doctor.ready ? '是' : '否'}`,
                `地图转换器: ${doctor.status?.local?.converterAvailable ? '已安装' : '缺失'}`,
                `底图生成器: ${doctor.status?.local?.tileMapCreatorAvailable ? '已安装' : '缺失'}`,
                `边缘部署: ${doctor.status?.edgeDeploy?.enabled ? '已启用' : '未启用'}`,
                `ApolloLite: ${apolloLiteState}`,
                `Dreamview: ${dreamviewState}`,
            ];
            Modal.info({
                title: '运行状态',
                width: 640,
                content: (
                    <div className="runtime-status-modal">
                        {runtimeLines.map((line) => (
                            <p key={line}>{line}</p>
                        ))}
                        <ul>
                            {checks.map((check: any) => (
                                <li key={check.name}>{`[${check.status}] ${check.message}`}</li>
                            ))}
                        </ul>
                    </div>
                ),
            });
        } catch (error: any) {
            Modal.error({
                title: '运行状态获取失败',
                content: error?.message || 'Unknown error',
            });
        }
    };

    const showPreflightResult = async () => {
        try {
            const response = await FileService.preflightDeploy();
            const result = response?.data;
            const checks = result?.checks || [];
            const content = (
                <div className="runtime-status-modal">
                    <p>{`预检通过: ${result?.ready ? '是' : '否'}`}</p>
                    <p>{`目标设备: ${result?.deployConfig?.target || '未配置'}`}</p>
                    <p>{`地图目录: ${result?.deployConfig?.targetMapRoot || ''}`}</p>
                    <ul>
                        {checks.map((check: any) => (
                            <li key={check.name}>{`[${check.status}] ${check.message}`}</li>
                        ))}
                    </ul>
                </div>
            );
            if (response?.code === 0) {
                Modal.success({
                    title: '部署预检通过',
                    width: 640,
                    content,
                });
                return;
            }
            Modal.warning({
                title: '部署预检失败',
                width: 640,
                content,
            });
        } catch (error: any) {
            Modal.error({
                title: '部署预检失败',
                content: error?.message || 'Unknown error',
            });
        }
    };

    const deployLatestReleasedMap = () => {
        Modal.confirm({
            title: '部署最新地图',
            content: '将最新发布的地图部署到已配置的边缘设备。',
            okText: '部署',
            cancelText: '取消',
            onOk: async () => {
                try {
                    const response = await FileService.startDeployLatestReleasedMapJob();
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交部署任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, '部署最新地图');
                    Modal.success({
                        title: '部署完成',
                        content: `地图 ${job.result?.mapName || job.result?.deployment?.mapName || ''} 已部署完成。`,
                    });
                } catch (error: any) {
                    Modal.error({
                        title: '部署失败',
                        content: error?.message || 'Unknown error',
                    });
                }
            },
        });
    };

    const stageLatestMapToApolloLite = () => {
        Modal.confirm({
            title: 'ApolloLite 仿真预检',
            content: '检查最新发布地图，并同步到本机 ApolloLite 地图目录。该步骤不会影响边缘设备。',
            okText: '预检并同步',
            cancelText: '取消',
            onOk: async () => {
                try {
                    const response = await FileService.startStageLatestMapToApolloLiteJob();
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交 ApolloLite 预检任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, 'ApolloLite 仿真预检');
                    const warnings = job.result?.inspection?.warnings || [];
                    const apolloLite = job.result?.apolloLite;
                    const apolloLiteState = apolloLite?.simulationReady
                        ? '\u4eff\u771f\u5c31\u7eea'
                        : '\u5730\u56fe\u5df2\u540c\u6b65\uff0c\u4eff\u771f\u8fd0\u884c\u73af\u5883\u5f85\u5c31\u7eea';
                    const dreamviewReady = apolloLite?.dreamviewRuntimeAvailable && apolloLite?.dreamviewHttpReady;
                    Modal.success({
                        title: 'ApolloLite 预检完成',
                        width: 680,
                        content: (
                            <div className="runtime-status-modal">
                                <p>{`地图: ${job.result?.mapName || ''}`}</p>
                                <p>{`目录: ${job.result?.targetDir || ''}`}</p>
                                <p>{`ApolloLite: ${apolloLiteState}`}</p>
                                {apolloLite?.dreamviewUrl && (
                                    <p>
                                        {`Dreamview: ${dreamviewReady ? '可访问' : '未响应'} `}
                                        <a href={apolloLite.dreamviewUrl} target="_blank" rel="noreferrer">
                                            {apolloLite.dreamviewUrl}
                                        </a>
                                    </p>
                                )}
                                {apolloLite?.simulationMessage && <p>{apolloLite.simulationMessage}</p>}
                                {warnings.length > 0 && (
                                    <ul>
                                        {warnings.map((item: string) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ),
                    });
                } catch (error: any) {
                    Modal.error({
                        title: 'ApolloLite 预检失败',
                        content: error?.message || 'Unknown error',
                    });
                }
            },
        });
    };

    const runApolloLiteSimulationSmokeTest = () => {
        Modal.confirm({
            title: '一键仿真跑图',
            content:
                '同步最新发布地图到 ApolloLite，启动 Routing / Planning / Control，自动生成一条测试路线并检查车辆是否起步。',
            okText: '开始跑图',
            cancelText: '取消',
            onOk: async () => {
                try {
                    const response = await FileService.startApolloLiteSimulationSmokeTestJob();
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交仿真跑图任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, 'ApolloLite 仿真跑图');
                    const result = job.result || {};
                    const route = result.route || {};
                    const motion = result.motion || {};
                    const dreamviewUrl = result.stage?.apolloLite?.dreamviewUrl || result.apolloLite?.dreamviewUrl;
                    const content = (
                        <div className="runtime-status-modal">
                            <p>{`地图: ${result.mapName || ''}`}</p>
                            <p>{`测试路线: ${route.laneIds?.length || 0} 条车道，约 ${Number(route.estimatedLengthMeters || 0).toFixed(1)} m`}</p>
                            <p>{`车辆起步: ${motion.moved ? '通过' : '未确认'}`}</p>
                            <p>{`最大速度: ${Number.isFinite(motion.maxSpeedMps) ? `${motion.maxSpeedMps.toFixed(3)} m/s` : '未读取'}`}</p>
                            {motion.message && <p>{motion.message}</p>}
                            {dreamviewUrl && (
                                <p>
                                    <span>Dreamview: </span>
                                    <a href={dreamviewUrl} target="_blank" rel="noreferrer">
                                        {dreamviewUrl}
                                    </a>
                                </p>
                            )}
                        </div>
                    );
                    if (result.ready) {
                        Modal.success({
                            title: '仿真跑图通过',
                            width: 680,
                            content,
                        });
                        return;
                    }
                    Modal.warning({
                        title: '仿真跑图未完全通过',
                        width: 680,
                        content,
                    });
                } catch (error: any) {
                    Modal.error({
                        title: '仿真跑图失败',
                        content: error?.message || 'Unknown error',
                    });
                }
            },
        });
    };

    const rollbackDeployment = async (deploymentId: string) => {
        try {
            const response = await FileService.startRollbackDeploymentJob(deploymentId);
            if (response?.code !== 0) {
                throw new Error(response?.message || '提交回滚任务失败');
            }
            const jobId = response?.data?.job?.id;
            if (!jobId) {
                throw new Error('后台任务没有返回 jobId');
            }
            const job = await waitForRuntimeJob(jobId, '回滚部署');
            Modal.success({
                title: '回滚完成',
                content: `地图 ${job.result?.deployment?.mapName || ''} 已恢复到上一个备份。`,
            });
        } catch (error: any) {
            Modal.error({
                title: '回滚失败',
                content: error?.message || 'Unknown error',
            });
        }
    };

    const showDeploymentHistory = async () => {
        try {
            const response = await FileService.getDeployments();
            if (response?.code !== 0) {
                throw new Error(response?.message || '读取部署历史失败');
            }
            const deployments = response?.data?.deployments || [];
            Modal.info({
                title: '部署历史',
                width: 760,
                content: (
                    <div className="runtime-status-modal deployment-history-modal">
                        {deployments.length === 0 && <p>还没有部署记录。</p>}
                        {deployments.slice(0, 12).map((item: any) => (
                            <div className="deployment-history-row" key={item.id}>
                                <div>
                                    <p>{`${item.type || 'deploy'} / ${item.status} / ${item.mapName || ''}`}</p>
                                    <p>{`${item.finishedAt || item.startedAt || ''}`}</p>
                                </div>
                                <Button
                                    size="small"
                                    disabled={item.type !== 'deploy' || item.status !== 'succeeded' || !item.backupDir}
                                    onClick={() => rollbackDeployment(item.id)}
                                >
                                    回滚
                                </Button>
                            </div>
                        ))}
                    </div>
                ),
            });
        } catch (error: any) {
            Modal.error({
                title: '读取部署历史失败',
                content: error?.message || 'Unknown error',
            });
        }
    };

    const showHelpDocs = () => {
        Modal.info({
            title: '地图生产帮助文档',
            width: 760,
            icon: null,
            okText: '关闭',
            className: 'help-doc-dialog',
            content: (
                <div className="help-doc-modal">
                    <section>
                        <h3>标准流程</h3>
                        <div className="help-doc-step">
                            <span>1</span>
                            <p>采图数据进入采图包工作台，系统自动预检、生成单包底图，并维护一张合并底图。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>2</span>
                            <p>打开合并底图开始标注；需要局部返工时，可打开单包底图核对点云质量。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>3</span>
                            <p>标注完成后保存并发布地图包，系统会生成 Apollo 可部署文件。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>4</span>
                            <p>发布后先执行 ApolloLite 仿真跑图，确认车辆可起步，Routing / Planning / Control 正常。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>5</span>
                            <p>仿真通过后执行边缘设备部署，必要时从部署历史中回滚。</p>
                        </div>
                    </section>
                    <section>
                        <h3>采图包规则</h3>
                        <p>
                            采集目录内优先识别 ResultOut 中的 LAS 文件。同一采集段重复采集时，自动拼图会优先使用最新包。
                        </p>
                    </section>
                    <section>
                        <h3>后台任务</h3>
                        <p>底图生成和合并会在后台执行；大合并会占用 CPU 和磁盘 I/O，系统会跳过仍在写入的采图目录。</p>
                    </section>
                </div>
            ),
        });
    };

    const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
        switch (key) {
            case '1':
                setDialogTitle('打开底图');
                setVisibleVal({ ...visibleVal, map: true });
                break;
            case '2':
                setDialogTitle('打开标注地图');
                if (viewstate.onsave) {
                    changeShowSaveDataRemind(true);
                } else {
                    changeShowSaveDataRemind(false);
                    setVisibleVal({ ...visibleVal, map: true });
                }
                break;
            case '3':
                setDialogTitle('保存标注地图');
                setVisibleVal({ ...visibleVal, operate: true });
                break;
            case '4':
                setDialogTitle('发布地图');
                setVisibleVal({ ...visibleVal, operate: true });
                break;
            case 'asset-manager':
                setVisibleVal({ ...visibleVal, assets: true });
                break;
            case 'edge-device':
                setVisibleVal({ ...visibleVal, edge: true });
                break;
            case 'runtime-status':
                showRuntimeStatus();
                break;
            case 'preflight-deploy':
                showPreflightResult();
                break;
            case 'deploy-latest':
                deployLatestReleasedMap();
                break;
            case 'apollolite-stage-latest':
                stageLatestMapToApolloLite();
                break;
            case 'apollolite-sim-smoke-test':
                runApolloLiteSimulationSmokeTest();
                break;
            case 'deploy-history':
                showDeploymentHistory();
                break;
            case 'help-doc':
                showHelpDocs();
                break;
            default:
                break;
        }
    };
    const rangingHandle = () => {
        PubSub.publish('closeRemind');
        const { ranging, operationType } = viewstate;
        if (operationType === OperationType.Drawing) {
            return;
        }
        if (ranging) {
            PubSub.publishSync('exitRanging');
            PubSub.publish('render');
        }
        setMapState({ ...viewstate, ranging: !ranging });
    };

    const handleUndo = () => {
        if (canUndo) {
            undo();
            PubSub.publishSync('removeMouseMoveElements');
            PubSub.publish('render');
        }
    };
    const handleRedo = () => {
        if (canRedo) {
            redo();
            PubSub.publishSync('removeMouseMoveElements');
            PubSub.publish('render');
        }
    };
    const productionMenus = [
        {
            key: 'data',
            label: '数据',
            items: [
                {
                    type: 'group' as const,
                    label: '数据准备',
                    children: [
                        {
                            label: (
                                <FileMenuLabel
                                    title="采图包工作台"
                                    description="上传、预检、管理、生成底图、合并拼图"
                                />
                            ),
                            key: 'asset-manager',
                        },
                        {
                            label: (
                                <FileMenuLabel title="打开点云底图" description="选择已生成底图，进入图层辅助标注" />
                            ),
                            key: '1',
                            icon: <RenderIcon url={LeadIcon} />,
                        },
                    ],
                },
            ],
        },
        {
            key: 'map',
            label: '标注',
            items: [
                {
                    type: 'group' as const,
                    label: '标注生产',
                    children: [
                        {
                            label: <FileMenuLabel title="打开标注地图" description="载入已有 Apollo 地图继续编辑" />,
                            key: '2',
                            icon: <RenderIcon url={LabelIcon} />,
                        },
                        {
                            label: <FileMenuLabel title="保存标注地图" description="保存当前编辑结果" />,
                            key: '3',
                            icon: <RenderIcon url={SaveIcon} />,
                        },
                    ],
                },
            ],
        },
        {
            key: 'delivery',
            label: '发布仿真',
            items: [
                {
                    type: 'group' as const,
                    label: '发布仿真',
                    children: [
                        {
                            label: <FileMenuLabel title="发布地图包" description="生成可部署的 Apollo 地图产物" />,
                            key: '4',
                            icon: <RenderIcon url={IssueIcon} />,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="ApolloLite 仿真预检"
                                    description="检查并同步最新发布地图到本机仿真目录"
                                />
                            ),
                            key: 'apollolite-stage-latest',
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="一键仿真跑图"
                                    description="启动仿真模块、下发测试路线、检查车辆是否起步"
                                />
                            ),
                            key: 'apollolite-sim-smoke-test',
                        },
                    ],
                },
            ],
        },
        {
            key: 'device',
            label: '设备',
            items: [
                {
                    type: 'group' as const,
                    label: '边缘设备',
                    children: [
                        {
                            label: (
                                <FileMenuLabel title="边缘设备" description="添加 IP、自动发现 Apollo 地图目录并部署" />
                            ),
                            key: 'edge-device',
                        },
                        {
                            label: <FileMenuLabel title="部署预检" description="检查本地服务器到边缘设备的部署条件" />,
                            key: 'preflight-deploy',
                        },
                        {
                            label: (
                                <FileMenuLabel title="一键部署最新地图" description="把最新发布地图推送到边缘设备" />
                            ),
                            key: 'deploy-latest',
                        },
                        {
                            label: <FileMenuLabel title="部署历史 / 回滚" description="查看部署记录，必要时回滚" />,
                            key: 'deploy-history',
                        },
                    ],
                },
            ],
        },
        {
            key: 'system',
            label: '系统',
            items: [
                {
                    type: 'group' as const,
                    label: '系统',
                    children: [
                        {
                            label: (
                                <FileMenuLabel title="运行状态" description="查看导入、转换、底图生成、部署环境状态" />
                            ),
                            key: 'runtime-status',
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="生产帮助文档"
                                    description="采图、底图、标注、仿真、部署标准流程"
                                />
                            ),
                            key: 'help-doc',
                        },
                    ],
                },
            ],
        },
    ];
    useEffect(() => {
        if (!viewstate.currentPickElement || viewstate.currentPickElement.length === 0) {
            setRotateStatus(RotateStatus.Disable);
            return;
        }
        const name = viewstate.currentPickElement[0].type;
        if (
            name !== ThreeElementType.LaneBoundary &&
            name !== ThreeElementType.RoadBoundary &&
            name !== ThreeElementType.LaneGroud &&
            name !== ThreeElementType.JunctionGroud &&
            name !== ThreeElementType.AreaGroud &&
            name !== ThreeElementType.CrosswalkGroud &&
            name !== ThreeElementType.ParkingSpaceGroud &&
            name !== ThreeElementType.TrafficLight &&
            name !== ThreeElementType.BarrierGateGroud
        ) {
            setRotateStatus(RotateStatus.Disable);
            return;
        }
        if (viewstate.operationType !== OperationType.Rotating) {
            setRotateStatus(RotateStatus.Default);
        } else {
            setRotateStatus(RotateStatus.Active);
        }
    }, [viewstate.currentPickElement, viewstate.operationType, viewstate.currentPickElement.length]);
    return (
        <div id="toolbar-container">
            <div className="title brand-logo">
                <img src={LandingLogo} alt="LANDING" />
                <span className="brand-divider" />
                <span className="brand-title">高清地图编辑器</span>
            </div>
            <ConfigProvider
                autoInsertSpaceInButton={false}
                theme={{
                    token: {},
                    components: {
                        Menu: {
                            itemSelectedBg: '#3288fa',
                            itemSelectedColor: '#ffffff',
                            itemHoverBg: 'rgba(115,193,250,0.08)',
                            itemHoverColor: '#A6b5cc',
                            itemHeight: 32,
                            algorithm: true, // 启用算法
                        },
                    },
                }}
            >
                <div className="production-menu-bar">
                    {productionMenus.map((menu) => (
                        <Dropdown
                            key={menu.key}
                            menu={{ items: menu.items, onClick: handleMenuClick }}
                            placement="bottomLeft"
                            overlayClassName="file-select"
                            onOpenChange={() => PubSub.publish('closeRemind')}
                        >
                            <button type="button" className="production-menu-trigger">
                                {menu.label}
                                <img src={arrowsDown} alt="" className="arrow" />
                            </button>
                        </Dropdown>
                    ))}
                </div>

                {visibleVal.map && <DialogMap title={dialogTitle} open={visibleVal.map} onCancel={handleCloseDialog} />}
                {visibleVal.operate && (
                    <DialogOperate
                        title={dialogTitle}
                        open={visibleVal.operate}
                        onCancel={handleCloseDialog}
                        messageApi={messageApi}
                    />
                )}
                {visibleVal.message && (
                    <DialogMessage title="重复" open={visibleVal.message} onCancel={handleCloseDialog} />
                )}
                {visibleVal.assets && <AssetManagerDialog open={visibleVal.assets} onCancel={handleCloseDialog} />}
                {visibleVal.edge && <EdgeDeployDialog open={visibleVal.edge} onCancel={handleCloseDialog} />}
            </ConfigProvider>
            {account?.authenticated && (
                <div className="account-chip">
                    <span>{account.user?.username || 'admin'}</span>
                    {onLogout && (
                        <button type="button" onClick={onLogout}>
                            退出
                        </button>
                    )}
                </div>
            )}
            <Tooltip
                title="还没有编辑内容!"
                trigger="hover"
                color="rgba(61,67,78,0.80)"
                open={!canUndo && curHoverTool === HoverTool.Back}
                style={{
                    background: 'rgba(61,67,78,0.80)',
                    borderRadius: '6px',
                }}
            >
                <div
                    className={`tool-item back ${!canUndo ? 'disable' : ''}`}
                    onClick={handleUndo}
                    onFocus={() => false}
                    onMouseOver={() => setCurHoverTool(HoverTool.Back)}
                    onMouseLeave={() => setCurHoverTool(null)}
                >
                    {canUndo && curHoverTool !== HoverTool.Back && <img src={backCanClick} alt="" className="arrow" />}
                    {canUndo && curHoverTool === HoverTool.Back && <img src={backStepHover} alt="" className="arrow" />}
                    {!canUndo && <img src={backDisable} alt="" className="arrow" />}
                </div>
            </Tooltip>

            <Tooltip
                title="还没有撤销内容!"
                trigger="hover"
                color="rgba(61,67,78,0.80)"
                open={!canRedo && curHoverTool === HoverTool.Next}
                style={{
                    background: 'rgba(61,67,78,0.80)',
                    borderRadius: '6px',
                }}
            >
                <div
                    className={`tool-item next ${!canRedo ? 'disable' : ''} ${
                        curHoverTool === HoverTool.Next ? 'hover' : ''
                    }`}
                    onClick={handleRedo}
                    onFocus={() => false}
                    onMouseOver={() => setCurHoverTool(HoverTool.Next)}
                    onMouseLeave={() => setCurHoverTool(null)}
                >
                    {canRedo && curHoverTool !== HoverTool.Next && <img src={nextCanClick} alt="" className="arrow" />}
                    {canRedo && curHoverTool === HoverTool.Next && <img src={nextStepHover} alt="" className="arrow" />}
                    {!canRedo && <img src={nextDisable} alt="" className="arrow" />}
                </div>
            </Tooltip>

            <Tooltip
                title="为选中内容!"
                trigger="hover"
                color="rgba(61,67,78,0.80)"
                open={rotateStatus === RotateStatus.Disable && curHoverTool === HoverTool.Rotate}
                style={{
                    background: 'rgba(61,67,78,0.80)',
                    borderRadius: '6px',
                }}
            >
                <div
                    className={`tool-item rotate ${rotateStatus === RotateStatus.Disable ? 'disable' : ''}`}
                    onClick={handleRotating}
                    onFocus={() => false}
                    onMouseOver={() => setCurHoverTool(HoverTool.Rotate)}
                    onMouseLeave={() => setCurHoverTool(null)}
                >
                    {rotateStatus === RotateStatus.Active && <img src={rotateActive} alt="" className="arrow" />}
                    {rotateStatus === RotateStatus.Disable && <img src={rotateDisable} alt="" className="arrow" />}
                    {rotateStatus === RotateStatus.Default && curHoverTool !== HoverTool.Rotate && (
                        <img src={rotate} alt="" className="arrow" />
                    )}
                    {rotateStatus === RotateStatus.Default && curHoverTool === HoverTool.Rotate && (
                        <img src={rotateHover} alt="" className="arrow" />
                    )}
                </div>
            </Tooltip>

            <div className="line" />
            <Tooltip
                title={`${viewstate.operationType === OperationType.Drawing ? '绘制内容时不可用' : '测距'}`}
                trigger="hover"
                color="rgba(61,67,78,0.80)"
                open={curHoverTool === HoverTool.Ranging}
                style={{
                    background: 'rgba(61,67,78,0.80)',
                    borderRadius: '6px',
                }}
            >
                <div
                    style={{ width: '32px' }}
                    className={`tool-item ${viewstate.operationType === OperationType.Drawing ? 'disable' : ''}`}
                    onClick={rangingHandle}
                    onFocus={() => false}
                    onMouseOver={() => setCurHoverTool(HoverTool.Ranging)}
                    onMouseLeave={() => setCurHoverTool(null)}
                >
                    {viewstate.operationType === OperationType.Drawing && <img src={rangingDisable} alt="" />}
                    {viewstate.operationType !== OperationType.Drawing && viewstate.ranging && (
                        <img src={rangingHover} alt="" />
                    )}
                    {viewstate.operationType !== OperationType.Drawing && !viewstate.ranging && (
                        <img src={rangingDefault} alt="" />
                    )}
                </div>
            </Tooltip>

            <div className="draw-tool-sidebar">
                {mapElements.map((item) => {
                    const active =
                        viewstate.operationType === OperationType.Drawing &&
                        viewstate.currentDrawData.drawElementType === item.mapElementType;
                    return (
                        <Tooltip title={item.name} placement="right" key={item.mapElementType}>
                            <button
                                type="button"
                                className={`draw-tool-button ${active ? 'active' : ''}`}
                                onClick={() => startDrawMapElement(item.mapElementType)}
                                aria-label={item.name}
                            >
                                <span className="draw-tool-icon">
                                    <MapElementIcon type={item.mapElementType} />
                                </span>
                                <span className="draw-tool-label">{item.name}</span>
                            </button>
                        </Tooltip>
                    );
                })}
            </div>
            {showSaveDataRemind && (
                <RemindModal
                    titledata="确定退出当前界面吗？"
                    content="已编辑的内容不被保存"
                    onCancelCallback={() => changeShowSaveDataRemind(false)}
                    onOkCallback={() => {
                        setVisibleVal({ ...visibleVal, map: true });
                        changeShowSaveDataRemind(false);
                    }}
                />
            )}
        </div>
    );
}
