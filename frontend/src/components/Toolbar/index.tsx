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

type MapDialogMode = 'baseMap' | 'editorMap';

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
    const [mapDialogMode, setMapDialogMode] = useState<MapDialogMode>('baseMap');
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

    const showApolloLiteDiagnosis = async () => {
        try {
            const response = await FileService.diagnoseApolloLiteRuntime();
            const result = response?.data;
            const checks = result?.checks || [];
            const mapData = result?.mapData;
            const hmi = result?.hmi;
            const content = (
                <div className="runtime-status-modal">
                    <p>{`运行状态: ${result?.ready ? '正常' : '需要修复'}`}</p>
                    <p>{`Dreamview 当前地图: ${hmi?.currentMap || '未读取'}`}</p>
                    <p>{`地图数据: ${mapData?.ok ? `${mapData.mapData?.bytes || 0} bytes` : mapData?.error || '未返回'}`}</p>
                    <ul>
                        {checks.map((check: any) => (
                            <li key={check.name}>{`[${check.status}] ${check.name}: ${check.message}`}</li>
                        ))}
                    </ul>
                </div>
            );
            if (response?.code === 0) {
                Modal.success({
                    title: 'ApolloLite 诊断通过',
                    width: 720,
                    content,
                });
                return;
            }
            Modal.confirm({
                title: 'ApolloLite 需要自愈',
                width: 720,
                content,
                okText: '自动修复',
                cancelText: '取消',
                onOk: async () => {
                    const repairResponse = await FileService.startApolloLiteRepairJob();
                    if (repairResponse?.code !== 0) {
                        throw new Error(repairResponse?.message || '提交自动修复任务失败');
                    }
                    const jobId = repairResponse?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, 'ApolloLite 自动修复');
                    const after = job.result?.after;
                    Modal.success({
                        title: after?.ready ? 'ApolloLite 自动修复完成' : 'ApolloLite 自动修复已执行',
                        width: 720,
                        content: (
                            <div className="runtime-status-modal">
                                <p>{`最终状态: ${after?.ready ? '正常' : '仍需人工检查'}`}</p>
                                {(after?.checks || []).map((check: any) => (
                                    <p key={check.name}>{`[${check.status}] ${check.name}: ${check.message}`}</p>
                                ))}
                            </div>
                        ),
                    });
                },
            });
        } catch (error: any) {
            Modal.error({
                title: 'ApolloLite 诊断失败',
                content: error?.message || 'Unknown error',
            });
        }
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

    const resetApolloLiteSimulation = () => {
        Modal.confirm({
            title: '重置仿真会话',
            content:
                '用于第二次换路段测试前清理上一条 Routing、重置 Sim Control，并确保 Dreamview 仍加载当前 ApolloLite 地图。',
            okText: '重置',
            cancelText: '取消',
            onOk: async () => {
                try {
                    const response = await FileService.startApolloLiteResetSimulationJob();
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交仿真重置任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, 'ApolloLite 仿真重置');
                    const after = job.result?.after;
                    Modal.success({
                        title: after?.ready ? '仿真会话已重置' : '仿真会话已重置，但仍需检查',
                        width: 720,
                        content: (
                            <div className="runtime-status-modal">
                                <p>{`当前地图: ${after?.hmi?.currentMap || job.result?.targetMapName || '未读取'}`}</p>
                                {(after?.checks || []).map((check: any) => (
                                    <p key={check.name}>{`[${check.status}] ${check.name}: ${check.message}`}</p>
                                ))}
                            </div>
                        ),
                    });
                } catch (error: any) {
                    Modal.error({
                        title: '仿真重置失败',
                        content: error?.message || 'Unknown error',
                    });
                }
            },
        });
    };

    const startApolloLiteTrafficLightSimulation = () => {
        Modal.confirm({
            title: '启动绿灯仿真',
            content:
                '用于开发测试：系统会读取当前 ApolloLite 地图中的红绿灯 ID，并向 Apollo 发布全绿灯色，避免 Planning 因未知灯色在停止线前一直等待。',
            okText: '启动全绿',
            cancelText: '取消',
            onOk: async () => {
                try {
                    const response = await FileService.startApolloLiteTrafficLightSimulation('GREEN');
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '启动绿灯仿真失败');
                    }
                    const result = response?.data || {};
                    Modal.success({
                        title: '绿灯仿真已启动',
                        width: 640,
                        content: (
                            <div className="runtime-status-modal">
                                <p>{`通道: ${result.channel || '/apollo/perception/traffic_light'}`}</p>
                                <p>{`红绿灯数量: ${(result.signalIds || []).length}`}</p>
                                <p>{`当前地图目录: ${result.signalSourceDir || ''}`}</p>
                            </div>
                        ),
                    });
                } catch (error: any) {
                    Modal.error({
                        title: '绿灯仿真启动失败',
                        content: error?.message || 'Unknown error',
                    });
                }
            },
        });
    };

    const stopApolloLiteTrafficLightSimulation = async () => {
        try {
            const response = await FileService.stopApolloLiteTrafficLightSimulation();
            if (response?.code !== 0) {
                throw new Error(response?.message || '停止绿灯仿真失败');
            }
            Modal.success({
                title: '绿灯仿真已停止',
                content: response?.data?.message || 'ApolloLite traffic light simulation stopped.',
            });
        } catch (error: any) {
            Modal.error({
                title: '绿灯仿真停止失败',
                content: error?.message || 'Unknown error',
            });
        }
    };

    const showApolloLiteWorkflow = async () => {
        try {
            const response = await FileService.getApolloLiteWorkflow();
            const result = response?.data;
            const steps = result?.steps || [];
            const routingFailure = result?.diagnosis?.routingDiagnostics?.latestFailure;
            Modal.info({
                title: 'ApolloLite 仿真工作流',
                width: 760,
                okText: '关闭',
                content: (
                    <div className="runtime-status-modal workflow-modal">
                        <p>{`当前状态: ${result?.ready ? '可仿真' : '需要处理'}`}</p>
                        <p>{`下一步: ${result?.nextAction || '无'}`}</p>
                        <div className="workflow-step-list">
                            {steps.map((step: any, index: number) => (
                                <div className={`workflow-step-row ${step.status}`} key={step.key || index}>
                                    <span>{index + 1}</span>
                                    <div>
                                        <strong>{step.title}</strong>
                                        <p>{step.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {routingFailure && (
                            <div className="workflow-routing-failure">
                                <strong>最近 Routing 失败</strong>
                                <p>{routingFailure.message}</p>
                                <p>{routingFailure.suggestion}</p>
                            </div>
                        )}
                    </div>
                ),
            });
        } catch (error: any) {
            Modal.error({
                title: '读取仿真工作流失败',
                content: error?.message || 'Unknown error',
            });
        }
    };

    const showHelpDocs = () => {
        Modal.info({
            title: '地图生产工作流',
            width: 860,
            icon: null,
            okText: '关闭',
            className: 'help-doc-dialog',
            content: (
                <div className="help-doc-modal">
                    <section>
                        <h3>标准流程</h3>
                        <div className="help-doc-step">
                            <span>1</span>
                            <p>进入采图包工作台，同步 NAS 采图包，完成预检、单包底图生成和多段底图合并。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>2</span>
                            <p>新建标注任务时选择一个已生成底图，从空标注开始绘制。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>3</span>
                            <p>继续编辑标注时打开已有标注地图，系统会自动加载关联底图瓦片作为背景。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>4</span>
                            <p>标注完成后先看左下角地图质量检查，红色错误必须清零；发布地图包会再次执行预检。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>5</span>
                            <p>
                                发布成功后执行 ApolloLite 仿真验证；仿真通过后再部署到边缘设备，必要时从部署历史中回滚。
                            </p>
                        </div>
                    </section>
                    <section>
                        <h3>入口区别</h3>
                        <p>
                            新建标注任务只选择底图，适合从零开始；继续编辑标注选择已有 Apollo
                            标注成果，并自动带出对应底图。
                        </p>
                    </section>
                    <section>
                        <h3>标注作业顺序</h3>
                        <div className="help-doc-step">
                            <span>1</span>
                            <p>先确认底图瓦片完整、道路边缘清楚、车道线和停止线可辨认；底图错位时先回采图包处理。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>2</span>
                            <p>先画道路边界，圈定车辆真实可行驶范围；边界要连续，不要把人行区、绿化带画进车道区域。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>3</span>
                            <p>
                                再画大车道骨架，从入口到出口建立主通行路径，路口内左转、直行、右转和掉头路径都要自然连通。
                            </p>
                        </div>
                        <div className="help-doc-step">
                            <span>4</span>
                            <p>使用自动连接形成拓扑闭环，先处理断头、误连和反向连接；不要用后续属性去弥补错误几何。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>5</span>
                            <p>
                                拓扑稳定后拆分车道：按物理车道线、转向功能、分流和合流关系拆；同向多车道保持平行和间距稳定。
                            </p>
                        </div>
                        <div className="help-doc-step">
                            <span>6</span>
                            <p>设置车道方向和前后继关系，单行、双向、左转、右转、掉头都必须和真实行驶规则一致。</p>
                        </div>
                        <div className="help-doc-step">
                            <span>7</span>
                            <p>
                                补车道边界和线型，实线表示不可跨越，虚线表示可按规则变道；中央隔离和道路边缘不要误设为可变道。
                            </p>
                        </div>
                        <div className="help-doc-step">
                            <span>8</span>
                            <p>
                                画路口区域、停止线和人行横道。路口只覆盖冲突区；停止线要落在车辆真实停车位置并横跨受控车道。
                            </p>
                        </div>
                        <div className="help-doc-step">
                            <span>9</span>
                            <p>
                                最后补交通灯、标志、方向箭头、减速带、闸机、停车位和区域，并确认它们关联到正确车道或控制点。
                            </p>
                        </div>
                        <div className="help-doc-step">
                            <span>10</span>
                            <p>
                                按地图质量检查的错误列表逐条定位：先修红色拓扑和几何错误，再处理黄色警告；前驱、后继和拓扑区域要和真实路线一致。
                            </p>
                        </div>
                    </section>
                    <section>
                        <h3>发布前检查</h3>
                        <p>
                            质量面板会按绘制、拓扑、预检、发布展示状态。发布预检只拦截红色错误，黄色警告需要人工确认；
                            禁止转向处不能残留可通行连接，信号灯必须关联正确停止线，车道入口和出口要明确。
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
                setDialogTitle('新建标注任务');
                setMapDialogMode('baseMap');
                setVisibleVal({ ...visibleVal, map: true });
                break;
            case '2':
                setDialogTitle('继续编辑标注');
                setMapDialogMode('editorMap');
                if (viewstate.onsave) {
                    changeShowSaveDataRemind(true);
                } else {
                    changeShowSaveDataRemind(false);
                    setVisibleVal({ ...visibleVal, map: true });
                }
                break;
            case '3':
                setDialogTitle('保存标注');
                setVisibleVal({ ...visibleVal, operate: true });
                break;
            case '4':
                setDialogTitle('发布地图包');
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
            case 'apollolite-diagnose':
                showApolloLiteDiagnosis();
                break;
            case 'apollolite-stage-latest':
                stageLatestMapToApolloLite();
                break;
            case 'apollolite-sim-smoke-test':
                runApolloLiteSimulationSmokeTest();
                break;
            case 'apollolite-reset-simulation':
                resetApolloLiteSimulation();
                break;
            case 'apollolite-traffic-light-green':
                startApolloLiteTrafficLightSimulation();
                break;
            case 'apollolite-traffic-light-stop':
                stopApolloLiteTrafficLightSimulation();
                break;
            case 'apollolite-workflow':
                showApolloLiteWorkflow();
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
    const canEdit = account?.authEnabled ? account?.permissions?.canEdit === true : true;
    const canDeploy = account?.authEnabled ? account?.permissions?.canDeploy === true : true;
    const productionMenus = [
        {
            key: 'data',
            label: '采图数据',
            items: [
                {
                    type: 'group' as const,
                    label: '采图数据准备',
                    children: [
                        {
                            label: (
                                <FileMenuLabel
                                    title="采图包工作台"
                                    description="同步 NAS、上传、预检、生成底图、合并多段底图"
                                />
                            ),
                            key: 'asset-manager',
                        },
                    ],
                },
            ],
        },
        {
            key: 'map',
            label: '标注生产',
            items: [
                {
                    type: 'group' as const,
                    label: '标注生产',
                    children: [
                        {
                            label: (
                                <FileMenuLabel title="新建标注任务" description="选择已生成底图，从空标注开始绘制" />
                            ),
                            key: '1',
                            icon: <RenderIcon url={LeadIcon} />,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="继续编辑标注"
                                    description="打开已有 Apollo 标注地图，并自动加载关联底图"
                                />
                            ),
                            key: '2',
                            icon: <RenderIcon url={LabelIcon} />,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="保存标注"
                                    description={canEdit ? '保存当前编辑成果' : '需要编辑权限'}
                                />
                            ),
                            key: '3',
                            icon: <RenderIcon url={SaveIcon} />,
                            disabled: !canEdit,
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
                            label: (
                                <FileMenuLabel
                                    title="发布地图包"
                                    description={canEdit ? '把已保存标注生成 Apollo 可部署产物' : '需要编辑权限'}
                                />
                            ),
                            key: '4',
                            icon: <RenderIcon url={IssueIcon} />,
                            disabled: !canEdit,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="ApolloLite 仿真预检"
                                    description={canDeploy ? '检查并同步最新发布地图到本机仿真目录' : '需要管理员权限'}
                                />
                            ),
                            key: 'apollolite-stage-latest',
                            disabled: !canDeploy,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="一键仿真跑图"
                                    description={
                                        canEdit ? '启动仿真模块、下发测试路线、检查车辆是否起步' : '需要编辑权限'
                                    }
                                />
                            ),
                            key: 'apollolite-sim-smoke-test',
                            disabled: !canEdit,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="重置仿真会话"
                                    description={
                                        canEdit ? '换路段测试前清理上一条 Routing 和 Sim Control 状态' : '需要编辑权限'
                                    }
                                />
                            ),
                            key: 'apollolite-reset-simulation',
                            disabled: !canEdit,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="启动绿灯仿真"
                                    description={
                                        canEdit
                                            ? '向 Apollo 发布当前地图红绿灯全绿状态，便于开发测试连续跑图'
                                            : '需要编辑权限'
                                    }
                                />
                            ),
                            key: 'apollolite-traffic-light-green',
                            disabled: !canEdit,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="停止绿灯仿真"
                                    description={canEdit ? '停止开发测试用的红绿灯状态发布器' : '需要编辑权限'}
                                />
                            ),
                            key: 'apollolite-traffic-light-stop',
                            disabled: !canEdit,
                        },
                    ],
                },
            ],
        },
        {
            key: 'device',
            label: '设备部署',
            items: [
                {
                    type: 'group' as const,
                    label: '边缘设备',
                    children: [
                        {
                            label: (
                                <FileMenuLabel
                                    title="边缘设备部署"
                                    description={
                                        canDeploy ? '选择发布包、保存预检并部署到 Apollo 边缘设备' : '需要管理员权限'
                                    }
                                />
                            ),
                            key: 'edge-device',
                            disabled: !canDeploy,
                        },
                    ],
                },
            ],
        },
        {
            key: 'system',
            label: '系统诊断',
            items: [
                {
                    type: 'group' as const,
                    label: '系统',
                    children: [
                        {
                            label: (
                                <FileMenuLabel
                                    title="运行状态"
                                    description="查看导入、转换、底图生成、仿真和部署状态"
                                />
                            ),
                            key: 'runtime-status',
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="ApolloLite 诊断修复"
                                    description={
                                        canDeploy
                                            ? '检查 Dreamview 地图数据、残留模块和 map_dir，并可一键自愈'
                                            : '需要管理员权限'
                                    }
                                />
                            ),
                            key: 'apollolite-diagnose',
                            disabled: !canDeploy,
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="ApolloLite 仿真工作流"
                                    description="查看发布、同步、Dreamview、PNC、Routing 的精确状态"
                                />
                            ),
                            key: 'apollolite-workflow',
                        },
                        {
                            label: (
                                <FileMenuLabel
                                    title="生产工作流"
                                    description="查看采图、标注、发布、仿真、部署的标准步骤"
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

                {visibleVal.map && (
                    <DialogMap
                        title={dialogTitle}
                        mode={mapDialogMode}
                        open={visibleVal.map}
                        onCancel={handleCloseDialog}
                    />
                )}
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
                title="没有可撤销的操作"
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
                title="没有可重做的操作"
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
                title="请先选中可旋转的对象"
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
                    content="未保存的编辑内容将不会保留"
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
