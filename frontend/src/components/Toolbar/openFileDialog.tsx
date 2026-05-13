// import { rename } from 'fs';
import PubSub from 'pubsub-js';
import React, { ReactNode, useRef, useState } from 'react';
import { Modal, Menu, Tooltip, Button, message } from 'antd';
import { ModalProps } from 'antd/lib/modal';
import FileService from 'src/service/index';
import FileIcon from '../../assets/images/ic_base_map.svg';
import MapIcon from '../../assets/images/ic_map.svg';
import CloseIcon from '../../assets/images/ic_close.svg';
import DoingIcon from '../../assets/images/ic_loading.svg';
import { message as messageFunc } from '../Message/index';

const closeNode = <img src={CloseIcon} alt="close" />;
interface DialogProps extends Omit<ModalProps, 'visible'> {
    title: string;
    items?: ReactNode;
    open: boolean;
    onCancel?: () => void;
}
interface MenuItemData {
    key: string;
    content: string;
    label: ReactNode;
}

// eslint-disable-next-line react/function-component-definition
const Dialog: React.FC<DialogProps> = ({ title, open, onCancel, items, ...rest }) => {
    const Icon = title === '打开底图' ? FileIcon : MapIcon;
    const name = title === '打开底图' ? '/apollo/data/base_map/' : '/apollo/data/editor_map/';
    // 提交按钮禁用状态
    const [visible, setVisible] = useState(true);
    const [currentKey, setCurrentKey] = useState('0');
    const [titleAddress, setTitleAddress] = useState(name);
    const [menuData, setMenuData] = useState<MenuItemData[]>([]);
    const [listLoading, setListLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const isBaseMapDialog = title === '打开底图';

    // 选中菜单项某个目录
    const handleItemClick = (event: any) => {
        setCurrentKey(event.key);
        setVisible(false);
    };

    // 取消关闭对话框
    const handleCancel = () => {
        setVisible(true);
        setCurrentKey('');
        onCancel();
    };

    const onOkButton = () => {
        menuData.forEach(async (item) => {
            if (item.key === currentKey) {
                if (title === '打开底图') {
                    const response = await FileService.getBaseMapInfo(item.content);
                    if (!response) {
                        messageFunc({
                            type: 'error',
                            content: <span>加载失败</span>,
                        });
                        return;
                    }
                    if (response.tiles) {
                        PubSub.publish('renderMap', {
                            dir: item.content,
                            json: response,
                        });
                    }
                    if (response?.code) {
                        messageFunc({
                            type: 'error',
                            content: <span>{response.message}</span>,
                        });
                        return;
                    }
                } else if (title === '打开标注地图') {
                    const response = await FileService.getHDMap(item.content);
                    if (response?.info?.code !== 0) {
                        messageFunc({
                            type: 'error',
                            content: <span>{response?.info?.message || '加载失败'}</span>,
                        });
                        return;
                    }

                    PubSub.publish('renderHDMap', {
                        file: item.content,
                        json: response.info.data.map,
                    });
                }

                message.destroy();
                handleCancel();
                messageFunc({
                    type: 'success',
                    content: <span>导入成功</span>,
                });
            }
        });
    };

    const generateMenuItems = (contents: string[]): MenuItemData[] => {
        const menuItems: MenuItemData[] = [];

        for (let i = 0; i < contents.length; i += 1) {
            const key = (i + 1).toString();
            const content = contents[i];
            const label = (
                <Tooltip title={contents[i]} color="#50586680">
                    <img src={Icon} alt="" className="file-icon" />
                    {contents[i]}
                </Tooltip>
            );

            const menuItem: MenuItemData = {
                key,
                label,
                content,
            };
            menuItems.push(menuItem);
        }

        return menuItems;
    };

    // 发起接口请求并处理返回的数据
    const fetchData = async () => {
        setListLoading(true);
        let response: any;
        try {
            if (title === '打开底图') {
                response = await FileService.getBaseMapList();
            } else if (title === '打开标注地图') {
                response = await FileService.getHDMapList();
            }

            if (!title && !response) {
                return;
            }

            if (response?.info?.code !== 0) {
                messageFunc({
                    type: 'error',
                    content: <span>{response?.info?.message}</span>,
                });
                return;
            }

            const data = response.info.data.map_list;
            setMenuData(generateMenuItems(data));
        } finally {
            setListLoading(false);
        }
    };

    const handleImportBaseMap = () => {
        importInputRef.current?.click();
    };

    const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (importInputRef.current) {
            importInputRef.current.value = '';
        }
        if (!file) {
            return;
        }
        const defaultName = file.name.replace(/\.zip$/i, '');
        if (!defaultName) {
            return;
        }
        setImportLoading(true);
        try {
            const response = await FileService.importBaseMapZip(file, defaultName.trim(), false);
            if (response?.code !== 0) {
                messageFunc({
                    type: 'error',
                    content: <span>{response?.message || '导入失败'}</span>,
                });
                return;
            }
            messageFunc({
                type: 'success',
                content: <span>{`底图 ${response.data?.mapName || defaultName} 导入成功`}</span>,
            });
            await fetchData();
        } finally {
            setImportLoading(false);
        }
    };

    const getList = () => {
        const address = title === '打开底图' ? '/apollo/data/base_map/' : '/apollo/data/editor_map/';
        setTitleAddress(address);
        if (open) {
            fetchData();
        } else {
            setMenuData([]);
        }
    };

    const renderDialogContent = () => {
        if (listLoading) {
            return (
                <div className="dialog-body-doing">
                    <img src={DoingIcon} alt="" className="file-icon" />
                    <span>加载中...</span>
                </div>
            );
        }
        if (menuData.length === 0) {
            const emptyText = isBaseMapDialog ? '还没有可用底图，请先导入底图 ZIP。' : '还没有可用标注地图。';
            return (
                <div className="dialog-body-empty">
                    <span>{emptyText}</span>
                </div>
            );
        }
        return (
            <div className="dialog-body-list">
                <Menu mode="vertical" onClick={handleItemClick} selectedKeys={[currentKey]} items={menuData} />
            </div>
        );
    };

    return (
        <Modal
            title={title}
            open={open}
            className="file-model-dialog"
            closeIcon={closeNode}
            onCancel={handleCancel}
            width={1000}
            afterOpenChange={() => getList()}
            footer={[
                <Button key="cancel" onClick={handleCancel} className="button-cancel">
                    取消
                </Button>,
                <Button key="ok" disabled={visible} className="button-ok" type="primary" onClick={onOkButton}>
                    打开
                </Button>,
            ]}
            {...rest}
        >
            {items}
            <p className="dialog-body-title">{titleAddress}</p>
            {isBaseMapDialog && (
                <div className="base-map-import">
                    <Button onClick={handleImportBaseMap} loading={importLoading} className="button-cancel">
                        导入底图 ZIP
                    </Button>
                    <span>ZIP 文件名会作为底图名称，内容需包含 map_images/tiles.json</span>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        style={{ display: 'none' }}
                        onChange={handleImportFileChange}
                    />
                </div>
            )}
            {renderDialogContent()}
        </Modal>
    );
};

export default Dialog;
