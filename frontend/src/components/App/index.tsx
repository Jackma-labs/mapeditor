import React, { useEffect, useState } from 'react';
import { Button, Input, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import './index.less';
import { useManagerStore } from 'src/store';
import { clearScene } from 'src/utils/threeObjectUtil';
import PubSub from 'pubsub-js';
import FileService from 'src/service/index';
import { MapElementType, OperationType, PermissionStatus } from 'src/interface/commonInterFace';
import MapEditor from '../MapEditor/index';
import Toolbar from '../Toolbar';
import WorkbenchPanel from '../WorkbenchPanel';
import { message as messageFunc } from '../Message/index';
import LandingLogo from '../../assets/images/landing-logo.png';

const drawElementNames: Record<number, string> = {
    [MapElementType.Lane]: '车道',
    [MapElementType.Junction]: '路口',
    [MapElementType.Crosswalk]: '人行横道',
    [MapElementType.SpeedBump]: '减速带',
    [MapElementType.StraightLine]: '直线',
    [MapElementType.CurveLine]: '曲线',
    [MapElementType.StopLine]: '停止线',
    [MapElementType.TrafficSignal]: '信号灯',
    [MapElementType.ParkingSpace]: '停车位',
    [MapElementType.Sign]: '标志牌',
    [MapElementType.RoadBoundary]: '路沿',
    [MapElementType.Area]: '区域',
    [MapElementType.BarrierGate]: '道闸',
};

function getCurrentToolLabel(operationType: OperationType, drawElementType: MapElementType | null, ranging: boolean) {
    if (ranging) {
        return '测距';
    }
    if (operationType === OperationType.Drawing) {
        const drawElementName = drawElementType ? drawElementNames[drawElementType] || '' : '';
        return `绘制${drawElementName}`;
    }
    if (operationType === OperationType.Rotating) {
        return '旋转';
    }
    if (operationType === OperationType.Draging) {
        return '拖动';
    }
    if (operationType === OperationType.InsertPointToBoundary) {
        return '插入边界点';
    }
    return '选择';
}

export default function App() {
    const [messageApi, contextHolder] = message.useMessage();
    const [viewstate, setMapState, storeClear] = useManagerStore((state) => [
        state.mapState,
        state.setMapState,
        state.clear,
    ]);
    const [accountInfo, setAccountInfo] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginForm, setLoginForm] = useState({
        username: '',
        password: '',
    });
    const getMapEditorAuth = async () => {
        const response = await FileService.getAccountMapToolInfo();
        if (response?.info?.code === 0) {
            if (!response?.info?.data?.mapEditorPrerogative) {
                messageFunc({
                    type: 'error',
                    content: <span>没有获取到地图编辑的相关权限数据</span>,
                });
            } else {
                const { status } = response.info.data.mapEditorPrerogative;
                viewstate.permissionStatus = PermissionStatus.HasPermission;
                setMapState({
                    ...useManagerStore.getState().mapState,
                    permissionStatus: PermissionStatus.HasPermission,
                });
                setAccountInfo(response);
                // if (status === PermissionStatus.Expired || status === PermissionStatus.NoPermission) {
                //     PubSub.publish('closeRemind');
                // }
            }
        } else {
            messageFunc({
                type: 'error',
                content: <span>{response?.info?.message || '网络请求错误'}</span>,
            });
        }
    };
    const refreshAuthSession = async (): Promise<any> => {
        try {
            const response = await FileService.getAuthSession();
            if (response?.code === 0) {
                setAccountInfo(response.data);
                return response.data;
            }
            setAccountInfo(null);
            return null;
        } catch (_error) {
            setAccountInfo(null);
            return null;
        } finally {
            setAuthLoading(false);
        }
    };

    const handleLogin = async (): Promise<void> => {
        setLoginLoading(true);
        try {
            const response = await FileService.login(loginForm.username, loginForm.password);
            if (response?.code !== 0) {
                throw new Error(response?.message || '登录失败');
            }
            await refreshAuthSession();
        } catch (error: any) {
            messageApi.error(error?.message || '登录失败');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = async (): Promise<void> => {
        await FileService.logout().catch((): null => null);
        setAccountInfo({
            authEnabled: true,
            authenticated: false,
        });
    };
    useEffect(
        () => () => {
            PubSub.publishSync('removeAllRange');
            clearScene();
            storeClear();
            PubSub.clearAllSubscriptions();
            console.log('app我走了');
        },
        [storeClear],
    );
    // useEffect(() => {
    //     if (!accountInfo) {
    //         getMapEditorAuth();
    //     }
    // }, [accountInfo]);
    useEffect(() => {
        refreshAuthSession();
    }, []);
    function unloadHandle(e: Event) {
        e.preventDefault();
        return '';
    }
    useEffect(() => {
        if (viewstate.onsave) {
            window.onbeforeunload = unloadHandle;
        } else {
            window.onbeforeunload = null;
        }
        return () => {
            window.onbeforeunload = null;
        };
    }, [viewstate.onsave]);

    if (authLoading) {
        return (
            <div className="login-shell">
                <div className="login-panel">
                    <div className="login-brand">
                        <img className="login-brand-logo" src={LandingLogo} alt="LANDING" />
                        <span>高精地图编辑器</span>
                    </div>
                    <div className="login-title">正在检查登录状态</div>
                    <div className="login-subtitle">正在准备地图生产工作台。</div>
                </div>
                {contextHolder}
            </div>
        );
    }

    if (accountInfo?.authEnabled && !accountInfo?.authenticated) {
        return (
            <div className="login-shell">
                <div className="login-panel">
                    <div className="login-brand">
                        <img className="login-brand-logo" src={LandingLogo} alt="LANDING" />
                        <span>高精地图编辑器</span>
                    </div>
                    <div className="login-layout">
                        <div className="login-copy">
                            <div className="login-eyebrow">地图生产控制台</div>
                            <div className="login-title">统一管理高精地图编辑、发布与边缘部署。</div>
                            <div className="login-subtitle">
                                集中处理采图资产、编辑地图、Apollo 发布和边缘设备部署，确保多端地图数据一致。
                            </div>
                            <div className="login-status-list">
                                <span>地图包管理</span>
                                <span>边缘部署</span>
                                <span>Apollo 校验</span>
                            </div>
                        </div>
                        <div className="login-form">
                            <div className="login-field">
                                <span>用户名</span>
                                <Input
                                    id="landing-login-username"
                                    aria-label="用户名"
                                    size="large"
                                    prefix={<UserOutlined />}
                                    placeholder="请输入用户名"
                                    value={loginForm.username}
                                    autoComplete="username"
                                    onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
                                    onPressEnter={handleLogin}
                                />
                            </div>
                            <div className="login-field">
                                <span>密码</span>
                                <Input.Password
                                    id="landing-login-password"
                                    aria-label="密码"
                                    size="large"
                                    prefix={<LockOutlined />}
                                    placeholder="请输入密码"
                                    value={loginForm.password}
                                    autoComplete="current-password"
                                    onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                                    onPressEnter={handleLogin}
                                />
                            </div>
                            <Button
                                size="large"
                                type="primary"
                                block
                                loading={loginLoading}
                                disabled={!loginForm.username || !loginForm.password}
                                onClick={handleLogin}
                            >
                                登录
                            </Button>
                        </div>
                    </div>
                </div>
                {contextHolder}
            </div>
        );
    }

    return (
        <div id="app">
            <Toolbar messageApi={messageApi} account={accountInfo} onLogout={handleLogout} />
            <div className="app-workspace">
                <MapEditor />
                <WorkbenchPanel />
            </div>
            <div className="app-statusbar">
                <span>{`底图：${viewstate.baseMapDir || '未打开'}`}</span>
                <span>{`标注图：${viewstate.hdMapFile || '未打开'}`}</span>
                <span>
                    {`当前工具：${getCurrentToolLabel(
                        viewstate.operationType,
                        viewstate.currentDrawData.drawElementType,
                        viewstate.ranging,
                    )}`}
                </span>
                <span>{`选中：${viewstate.currentPickElement?.length || 0}`}</span>
                <span className={viewstate.onsave ? 'status-unsaved' : 'status-saved'}>
                    {viewstate.onsave ? '有未保存修改' : '已保存'}
                </span>
            </div>
            {contextHolder}
        </div>
    );
}
