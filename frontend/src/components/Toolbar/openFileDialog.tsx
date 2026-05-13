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
type ImportMode = 'base-map-zip' | 'point-cloud' | 'map-package';

const stripExtension = (name: string) => name.replace(/\.[^.]+$/i, '');

const sanitizeMapName = (name: string) =>
    name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 86);

const getCommonPrefix = (values: string[]) => {
    if (values.length === 0) {
        return '';
    }
    let prefix = values[0];
    for (let index = 1; index < values.length; index += 1) {
        while (prefix && !values[index].startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
        }
    }
    return prefix.replace(/[._\-\s]+$/g, '');
};

const createFallbackPointCloudName = () => {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `point_cloud_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
        now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const buildImportMapName = (files: File[]) => {
    if (files.length === 1) {
        return sanitizeMapName(stripExtension(files[0].name));
    }
    const prefix = sanitizeMapName(getCommonPrefix(files.map((file) => stripExtension(file.name))));
    return prefix.length >= 4 ? prefix : createFallbackPointCloudName();
};

// eslint-disable-next-line react/function-component-definition
const Dialog: React.FC<DialogProps> = ({ title, open, onCancel, items, ...rest }) => {
    const Icon = title === '打开底图' ? FileIcon : MapIcon;
    const defaultAddress = title === '打开底图' ? '/apollo/data/base_map/' : '/apollo/data/editor_map/';
    // 提交按钮禁用状态
    const [visible, setVisible] = useState(true);
    const [currentKey, setCurrentKey] = useState('0');
    const [titleAddress, setTitleAddress] = useState(defaultAddress);
    const [menuData, setMenuData] = useState<MenuItemData[]>([]);
    const [listLoading, setListLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const importModeRef = useRef<ImportMode>('base-map-zip');
    const isBaseMapDialog = title === '打开底图';
    const isEditorMapDialog = title === '打开标注地图';

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
                    if (response.tiles || response.type === 'point_cloud') {
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

    const handleImportFile = (mode: ImportMode) => {
        importModeRef.current = mode;
        importInputRef.current?.click();
    };

    const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (importInputRef.current) {
            importInputRef.current.value = '';
        }
        if (files.length === 0) {
            return;
        }
        const mode = isEditorMapDialog ? 'map-package' : importModeRef.current;
        if (mode !== 'point-cloud' && files.length > 1) {
            Modal.error({
                title: '导入失败',
                content: '这个入口一次只能上传一个 ZIP 文件。',
            });
            return;
        }
        const defaultName = mode === 'point-cloud' ? buildImportMapName(files) : buildImportMapName([files[0]]);
        if (!defaultName) {
            return;
        }
        setImportLoading(true);
        try {
            let response;
            if (mode === 'point-cloud') {
                response = await FileService.importPointCloudBaseMap(
                    files.length === 1 ? files[0] : files,
                    defaultName.trim(),
                    false,
                );
            } else if (mode === 'base-map-zip') {
                response = await FileService.importBaseMapZip(files[0], defaultName.trim(), false);
            } else {
                response = await FileService.importMapPackageZip(files[0], defaultName.trim(), false);
            }
            if (response?.code !== 0) {
                Modal.error({
                    title: isBaseMapDialog ? '底图导入失败' : '地图包导入失败',
                    content: response?.message || '导入失败',
                });
                return;
            }
            const importType = mode === 'map-package' ? '地图包' : '底图';
            const importedName = response.data?.mapName || defaultName;
            messageFunc({
                type: 'success',
                content: <span>{`${importType} ${importedName} 导入成功`}</span>,
            });
            await fetchData();
        } catch (error) {
            Modal.error({
                title: '导入失败',
                content: error instanceof Error ? error.message : '上传或解析文件失败',
            });
        } finally {
            setImportLoading(false);
        }
    };

    const getList = async () => {
        setTitleAddress(defaultAddress);
        if (open) {
            try {
                const status = await FileService.getRuntimeStatus();
                const paths = status?.data?.paths;
                if (title === '打开底图' && paths?.baseMapRoot) {
                    setTitleAddress(paths.baseMapRoot);
                } else if (title === '打开标注地图' && paths?.editorMapRoot) {
                    setTitleAddress(paths.editorMapRoot);
                }
            } catch (error) {
                console.log(error);
            }
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
            const emptyText = isBaseMapDialog
                ? '还没有可用底图，请先导入瓦片底图 ZIP 或点云底图。'
                : '还没有可用标注地图，可导入 Apollo 地图包 ZIP。';
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
            {(isBaseMapDialog || isEditorMapDialog) && (
                <div className="base-map-import">
                    {isBaseMapDialog && (
                        <>
                            <Button
                                onClick={() => handleImportFile('base-map-zip')}
                                loading={importLoading}
                                className="button-cancel"
                            >
                                导入瓦片底图 ZIP
                            </Button>
                            <Button
                                onClick={() => handleImportFile('point-cloud')}
                                loading={importLoading}
                                className="button-cancel"
                            >
                                导入点云底图
                            </Button>
                        </>
                    )}
                    {isEditorMapDialog && (
                        <Button
                            onClick={() => handleImportFile('map-package')}
                            loading={importLoading}
                            className="button-cancel"
                        >
                            导入 Apollo 地图包 ZIP
                        </Button>
                    )}
                    <span>
                        {isBaseMapDialog
                            ? '点云支持 PCD/PLY/XYZ/TXT/CSV/LAS 或 ZIP；瓦片 ZIP 需包含 map_images/tiles.json'
                            : 'ZIP 文件名会作为地图名称，内容需包含 editor_map.json'}
                    </span>
                    <input
                        ref={importInputRef}
                        type="file"
                        multiple
                        accept=".zip,.pcd,.ply,.xyz,.txt,.csv,.las,.laz,application/zip"
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
