import React, { useEffect, useState } from 'react';
import { Button, Input, message } from 'antd';
import './index.less';
import { useManagerStore } from 'src/store';
import { clearScene } from 'src/utils/threeObjectUtil';
import PubSub from 'pubsub-js';
import FileService from 'src/service/index';
import { PermissionStatus } from 'src/interface/commonInterFace';
import MapEditor from '../MapEditor/index';
import Attr from '../Attr';
import Toolbar from '../Toolbar';
import { message as messageFunc } from '../Message/index';

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
                    <div className="login-title">高清地图编辑器</div>
                    <div className="login-subtitle">正在检查登录状态</div>
                </div>
                {contextHolder}
            </div>
        );
    }

    if (accountInfo?.authEnabled && !accountInfo?.authenticated) {
        return (
            <div className="login-shell">
                <div className="login-panel">
                    <div className="login-title">高清地图编辑器</div>
                    <div className="login-subtitle">登录后进入采图、标注、仿真与部署工作台</div>
                    <Input
                        size="large"
                        placeholder="用户名"
                        value={loginForm.username}
                        onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
                        onPressEnter={handleLogin}
                    />
                    <Input.Password
                        size="large"
                        placeholder="密码"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                        onPressEnter={handleLogin}
                    />
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
                {contextHolder}
            </div>
        );
    }

    return (
        <div id="app">
            <Toolbar messageApi={messageApi} account={accountInfo} onLogout={handleLogout} />
            <MapEditor />
            <Attr />
            {contextHolder}
        </div>
    );
}
