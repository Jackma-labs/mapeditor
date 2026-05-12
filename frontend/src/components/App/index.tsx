import React, { useEffect, useState } from 'react';
import { message } from 'antd';
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
    const [accountInfo, setAccountInfo] = useState(null);
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
    useEffect(
        () => () => {
            PubSub.publishSync('removeAllRange');
            clearScene();
            storeClear();
            PubSub.clearAllSubscriptions();
            console.log('app我走了');
        },
        [],
    );
    // useEffect(() => {
    //     if (!accountInfo) {
    //         getMapEditorAuth();
    //     }
    // }, [accountInfo]);
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

    return (
        <div id="app">
            <Toolbar messageApi={messageApi} />
            <MapEditor />
            <Attr />
            {contextHolder}
        </div>
    );
}
