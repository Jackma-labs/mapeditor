import React, { useEffect, useState, FC } from 'react';
import PubSub from 'pubsub-js';
import type { MenuProps } from 'antd';
import { ConfigProvider, Dropdown, Modal, Tooltip } from 'antd';
import './index.less';
import { MapElementType, OperationType, PermissionStatus, ThreeElementType } from 'src/interface/commonInterFace';
import { escKeyExitDrawHandle } from 'src/handle/escKeyHandle';
import { useManagerStore } from 'src/store';
import FileService from 'src/service/index';
import { MenuItemType } from 'antd/lib/menu/hooks/useItems';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import DialogMap from './openFileDialog';
import DialogOperate from './operateDialog';
import DialogMessage from './messageDialog';
import AssetManagerDialog from './AssetManagerDialog';
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
import icMoreDefault from '../../assets/images/ic_more.svg';
import icMoreActive from '../../assets/images/ic_more_white.svg';

import LeadIcon from '../../assets/images/ic_lead.svg';
import LeadDisabledIcon from '../../assets/images/ic_lead_disabled.svg';
import LabelIcon from '../../assets/images/ic_map_editor.svg';
import SaveIcon from '../../assets/images/ic_save.svg';
import IssueIcon from '../../assets/images/ic_sissue.svg';

import rangingDefault from '../../assets/images/ic_ranging.svg';
import rangingDisable from '../../assets/images/ic_ranging_forbidden.svg';
import rangingHover from '../../assets/images/ic_ranging_hover.svg';

import { mapElements } from './constData';

interface RenderIconProps {
    url: string;
}

// eslint-disable-next-line react/function-component-definition
const RenderIcon: FC<RenderIconProps> = ({ url }) => <img src={url} alt="My SVG" />;

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

export default function Index(prop: { messageApi: any }) {
    const [viewstate, setMapState, canUndo, canRedo, undo, redo] = useManagerStore((state) => [
        state.mapState,
        state.setMapState,
        state.canUndo,
        state.canRedo,
        state.undo,
        state.redo,
    ]);
    const { messageApi } = prop;
    const [rotateStatus, setRotateStatus] = useState(RotateStatus.Disable);
    const [dialogTitle, setDialogTitle] = useState('');
    const [curHoverTool, setCurHoverTool] = useState<HoverTool>(null);
    const [visibleMapElemets, setVisibleMapElemets] = useState([]);
    const [moreToolItems, setMoreToolItems] = useState<MenuProps['items']>([]);
    const [moreToolItemSeleted, setMoreToolItemSeleted] = useState<string[]>([]);
    const [showSaveDataRemind, changeShowSaveDataRemind] = useState(false);

    // 页面中不足以显示所以元素按钮时，显示更多按钮的数据处理
    const mapElementsVisibleHandle = () => {
        const { operationType, currentDrawData } = useManagerStore.getState().mapState;
        // 判断竖线距离右侧的距离
        const lineDom = document.getElementsByClassName('line')?.[0];
        if (lineDom) {
            const domRect = lineDom.getBoundingClientRect();
            if (domRect) {
                const { left } = domRect;
                const restWidth = document.body.clientWidth - left - 128;
                const maxMapIndex = Math.min(Math.max(Math.floor(restWidth / 96), 0), mapElements.length);
                const curVisibleMapElements = [];
                const curMoreMapElements: MenuItemType[] = [];
                for (let i = 0; i < maxMapIndex && i < mapElements.length; i += 1) {
                    curVisibleMapElements[i] = { ...mapElements[i] };
                }
                if (maxMapIndex < mapElements.length) {
                    setMoreToolItemSeleted([]);
                    for (let i = maxMapIndex; i < mapElements.length; i += 1) {
                        if (
                            operationType === OperationType.Drawing &&
                            currentDrawData.drawElementType === mapElements[i].mapElementType
                        ) {
                            setMoreToolItemSeleted(() => [`${mapElements[i].mapElementType}`]);
                        }
                        curMoreMapElements[i] = {
                            label: mapElements[i].name,
                            key: mapElements[i].mapElementType,
                        };
                    }
                }
                setVisibleMapElemets(curVisibleMapElements);
                setMoreToolItems(curMoreMapElements);
            }
        }
    };
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
    });

    const handleCloseDialog = () => {
        setVisibleVal({ map: false, operate: false, message: false, assets: false });
    };

    const items: MenuProps['items'] = [
        {
            label: (
                <span
                    onFocus={() => false}
                    onMouseOver={() => setCurHoverTool(HoverTool.OpenImg)}
                    onMouseLeave={() => setCurHoverTool(null)}
                >
                    打开底图
                </span>
            ),
            key: '1',
            icon: <RenderIcon url={LeadIcon} />,
        },
        {
            label: '打开标注地图',
            key: '2',
            icon: <RenderIcon url={LabelIcon} />,
        },
        {
            type: 'divider',
        },
        {
            label: '采图包资产',
            key: 'asset-manager',
        },
        {
            type: 'divider',
        },
        {
            label: '保存',
            key: '3',
            icon: <RenderIcon url={SaveIcon} />,
        },
        {
            label: '发布',
            key: '4',
            icon: <RenderIcon url={IssueIcon} />,
        },
        {
            type: 'divider',
        },
        {
            label: '运行状态',
            key: 'runtime-status',
        },
        {
            label: '部署预检',
            key: 'preflight-deploy',
        },
        {
            label: '部署最新地图',
            key: 'deploy-latest',
        },
    ];
    const showRuntimeStatus = async () => {
        try {
            const response = await FileService.getRuntimeDoctor();
            if (response?.code !== 0) {
                throw new Error(response?.message || 'Runtime status request failed');
            }
            const doctor = response.data;
            const checks = doctor.checks || [];
            const runtimeLines = [
                `运行模式: ${doctor.status?.mode || ''}`,
                `生产就绪: ${doctor.ready ? '是' : '否'}`,
                `地图转换器: ${doctor.status?.local?.converterAvailable ? '已安装' : '缺失'}`,
                `底图生成器: ${doctor.status?.local?.tileMapCreatorAvailable ? '已安装' : '缺失'}`,
                `边缘部署: ${doctor.status?.edgeDeploy?.enabled ? '已启用' : '未启用'}`,
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
                    const response = await FileService.deployLatestReleasedMap();
                    if (response?.code !== 0) {
                        throw new Error(response?.message || 'Deploy failed');
                    }
                    Modal.success({
                        title: '部署完成',
                        content: `地图 ${response.data?.mapName || ''} 已部署完成。`,
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
            case 'runtime-status':
                showRuntimeStatus();
                break;
            case 'preflight-deploy':
                showPreflightResult();
                break;
            case 'deploy-latest':
                deployLatestReleasedMap();
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
    const menuProps = {
        items,
        onClick: handleMenuClick,
    };
    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            mapElementsVisibleHandle();
        });
        resizeObserver.observe(document.getElementById('webgl'));
    }, []);

    useEffect(() => {
        mapElementsVisibleHandle();
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
            <div className="title">Map Editing</div>
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
                <Dropdown
                    menu={menuProps}
                    placement="bottomLeft"
                    overlayClassName="file-select"
                    onOpenChange={() => PubSub.publish('closeRemind')}
                >
                    <div className="tool-item file">
                        文件
                        <img src={arrowsDown} alt="" className="arrow" />
                    </div>
                </Dropdown>

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
            </ConfigProvider>
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

            {visibleMapElemets.map((item) => (
                <div
                    key={item.mapElementType}
                    className={`tool-item ${
                        viewstate.currentDrawData.drawElementType === item.mapElementType ? 'active' : ''
                    }`}
                    onClick={() => startDrawMapElement(item.mapElementType)}
                >
                    {item.name}
                </div>
            ))}
            {moreToolItems.length !== 0 && (
                <Dropdown
                    overlayClassName="file-select"
                    menu={{
                        items: moreToolItems,
                        selectedKeys: moreToolItemSeleted,
                        onClick: (item) => startDrawMapElement(Number(item.key) as MapElementType),
                    }}
                    trigger={['click']}
                >
                    <div className={`more ${moreToolItemSeleted?.length === 0 ? '' : 'active'}`}>
                        {moreToolItemSeleted?.length === 0 && <img src={icMoreDefault} alt="" />}
                        {moreToolItemSeleted?.length !== 0 && <img src={icMoreActive} alt="" />}
                    </div>
                </Dropdown>
            )}
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
