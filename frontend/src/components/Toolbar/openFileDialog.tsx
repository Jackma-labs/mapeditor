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

const sleep = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const formatCount = (value: any) => {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue.toLocaleString() : '0';
};

const formatBytes = (value: any) => {
    const numberValue = Number(value || 0);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(numberValue) / Math.log(1024)), units.length - 1);
    return `${(numberValue / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
};

const formatDateTime = (value: string) => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
};

const formatPackageAnalysis = (data: any) => {
    const summary = data?.summary || {};
    const analyses = data?.analyses || [];
    const pointCloud = analyses.flatMap((item: any) => item.pointClouds || [])[0];
    const image = analyses.flatMap((item: any) => item.images || [])[0];
    const lines = [
        `包 ID: ${data?.packageId || ''}`,
        `保存路径: ${data?.path || ''}`,
        `文件数: ${summary.totalFiles || 0}`,
        `点云: ${summary.pointCloudFiles || 0} 个 (LAS ${summary.lasFiles || 0}, PCD ${summary.pcdFiles || 0})`,
        `图片: ${summary.imageFiles || 0} 个`,
        `元数据文件: ${summary.metadataFiles || 0} 个`,
        `估算点数: ${summary.pointCount || 0}`,
    ];
    if (pointCloud) {
        lines.push('');
        lines.push(`点云样例: ${pointCloud.source}`);
        lines.push(`格式: LAS ${pointCloud.version || ''} / point format ${pointCloud.pointFormat ?? ''}`);
        lines.push(`坐标判断: ${pointCloud.coordinate?.kind || ''}`);
        lines.push(pointCloud.coordinate?.message || '');
        if (pointCloud.bounds) {
            lines.push(
                `范围: X ${pointCloud.bounds.minX} ~ ${pointCloud.bounds.maxX}, Y ${pointCloud.bounds.minY} ~ ${pointCloud.bounds.maxY}`,
            );
        }
    }
    if (image) {
        lines.push('');
        lines.push(`图片样例: ${image.source}`);
        lines.push(`尺寸: ${image.width || '?'} x ${image.height || '?'}`);
        lines.push(`相机: ${image.make || ''} ${image.model || ''}`);
        lines.push(`时间: ${image.dateTime || ''}`);
        lines.push(`可直接贴图: ${image.poseUsable ? '是' : '否'}`);
        if (image.filenameGpsTime) {
            const gpsTime = image.filenameGpsTime;
            lines.push(`文件名 GPS 时间: week ${gpsTime.gpsWeek}, SOW ${gpsTime.secondsOfWeek}`);
            lines.push(`折算 UTC: ${gpsTime.utcIso || ''}`);
            lines.push(gpsTime.message || '');
        }
    }
    if (summary.recommendations?.length) {
        lines.push('');
        lines.push('建议:');
        summary.recommendations.forEach((item: string) => lines.push(`- ${item}`));
    }
    return lines.join('\n');
};

const formatPackageImportSummary = (data: any, mapName: string) => {
    const summary = data?.summary || {};
    return [
        `包 ID: ${data?.packageId || ''}`,
        `保存路径: ${data?.path || ''}`,
        `生成底图名称: ${mapName}`,
        `点云: ${formatCount(summary.pointCloudFiles)} 个 (LAS ${formatCount(summary.lasFiles)}, PCD ${formatCount(
            summary.pcdFiles,
        )})`,
        `图片: ${formatCount(summary.imageFiles)} 个`,
        `估算点数: ${formatCount(summary.pointCount)}`,
        '',
        '生成过程会读取预检包里的原始 ZIP，不需要再次上传。',
        '如果同名底图已存在，会覆盖重建。',
    ].join('\n');
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
    const [dataPackages, setDataPackages] = useState<any[]>([]);
    const [listLoading, setListLoading] = useState(false);
    const [packageLoading, setPackageLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [packageJobText, setPackageJobText] = useState('');
    const importInputRef = useRef<HTMLInputElement>(null);
    const importModeRef = useRef<ImportMode>('base-map-zip');
    const isBaseMapDialog = title === '打开底图';
    const isEditorMapDialog = title === '打开标注地图';
    const dataPackagePanelDesc =
        '完整资产管理、重命名、删除、多包合并请走“文件 > 采图包工作台”；这里只保留从已预检包快速生成单张底图。';

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

    const fetchDataPackages = async () => {
        if (!isBaseMapDialog) {
            setDataPackages([]);
            return;
        }
        setPackageLoading(true);
        try {
            const response = await FileService.getDataPackages();
            if (response?.code !== 0) {
                messageFunc({
                    type: 'error',
                    content: <span>{response?.message || '读取预检包失败'}</span>,
                });
                return;
            }
            setDataPackages(response?.data?.packages || []);
        } catch (error) {
            messageFunc({
                type: 'error',
                content: <span>{error instanceof Error ? error.message : '读取预检包失败'}</span>,
            });
        } finally {
            setPackageLoading(false);
        }
    };

    const handleImportFile = (mode: ImportMode) => {
        importModeRef.current = mode;
        importInputRef.current?.click();
    };

    const waitForRuntimeJob = async (jobId: string, label: string, attempt = 0): Promise<any> => {
        if (attempt >= 600) {
            setPackageJobText('');
            throw new Error('后台任务等待超时');
        }
        const response = await FileService.getRuntimeJob(jobId);
        if (response?.code !== 0) {
            throw new Error(response?.message || '读取后台任务失败');
        }
        const job = response?.data?.job;
        if (job?.status === 'succeeded') {
            setPackageJobText('');
            return job;
        }
        if (job?.status === 'failed') {
            setPackageJobText('');
            throw new Error(job?.message || '后台生成失败');
        }
        setPackageJobText(`${label}，状态：${job?.status || 'running'}`);
        await sleep(3000);
        return waitForRuntimeJob(jobId, label, attempt + 1);
    };

    const handleGenerateDataPackageBaseMap = async (packageInfo: any) => {
        const defaultMapName = sanitizeMapName(packageInfo.defaultMapName || packageInfo.packageId);
        Modal.confirm({
            title: '从预检包生成底图',
            width: 760,
            okText: '生成底图',
            cancelText: '取消',
            content: (
                <pre style={{ whiteSpace: 'pre-wrap' }}>{formatPackageImportSummary(packageInfo, defaultMapName)}</pre>
            ),
            onOk: async () => {
                setImportLoading(true);
                setPackageJobText(`正在提交后台生成任务：${defaultMapName}`);
                try {
                    const response = await FileService.startDataPackageBaseMapJob(
                        packageInfo.packageId,
                        defaultMapName,
                        true,
                    );
                    if (response?.code !== 0) {
                        throw new Error(response?.message || '提交后台生成任务失败');
                    }
                    const jobId = response?.data?.job?.id;
                    if (!jobId) {
                        throw new Error('后台任务没有返回 jobId');
                    }
                    const job = await waitForRuntimeJob(jobId, `正在生成底图 ${defaultMapName}`);
                    messageFunc({
                        type: 'success',
                        content: <span>{`底图 ${job.result?.mapName || defaultMapName} 生成成功`}</span>,
                    });
                    await fetchData();
                    await fetchDataPackages();
                } catch (error) {
                    Modal.error({
                        title: '底图生成失败',
                        content: error instanceof Error ? error.message : '底图生成失败',
                    });
                    throw error;
                } finally {
                    setImportLoading(false);
                    setPackageJobText('');
                }
            },
        });
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
            fetchDataPackages();
        } else {
            setMenuData([]);
            setDataPackages([]);
            setPackageJobText('');
        }
    };

    const renderDataPackagePanel = () => {
        if (!isBaseMapDialog) {
            return null;
        }
        if (packageLoading) {
            return <div className="data-package-progress">正在读取预检包...</div>;
        }
        if (dataPackages.length === 0 && !packageJobText) {
            return null;
        }
        return (
            <div className="data-package-panel">
                <div className="data-package-panel-title">
                    <span>采图包快捷生成</span>
                    <Button size="small" onClick={fetchDataPackages} disabled={importLoading} className="button-cancel">
                        刷新
                    </Button>
                </div>
                <div className="data-package-panel-desc">{dataPackagePanelDesc}</div>
                {packageJobText && <div className="data-package-progress">{packageJobText}</div>}
                <div className="data-package-list">
                    {dataPackages.slice(0, 5).map((packageInfo) => {
                        const summary = packageInfo.summary || {};
                        const mapName = sanitizeMapName(packageInfo.defaultMapName || packageInfo.packageId);
                        const hasPointCloud = Number(summary.pointCloudFiles || 0) > 0;
                        const metaText = `${formatCount(summary.pointCloudFiles)} 个点云 / ${formatCount(
                            summary.imageFiles,
                        )} 张图片 / ${formatCount(summary.pointCount)} 点 / ${formatBytes(packageInfo.sizeBytes)}`;
                        const pathText = `${formatDateTime(packageInfo.modifiedAt)} · ${packageInfo.packageId}`;
                        const showPackageAnalysis = () => {
                            Modal.info({
                                title: '数据包预检结果',
                                width: 860,
                                content: (
                                    <pre style={{ whiteSpace: 'pre-wrap' }}>{formatPackageAnalysis(packageInfo)}</pre>
                                ),
                            });
                        };
                        return (
                            <div className="data-package-item" key={packageInfo.packageId}>
                                <div className="data-package-main">
                                    <div className="data-package-name">{mapName}</div>
                                    <div className="data-package-meta">{metaText}</div>
                                    <div className="data-package-path">{pathText}</div>
                                </div>
                                <div className="data-package-actions">
                                    <Button size="small" onClick={showPackageAnalysis} className="button-cancel">
                                        详情
                                    </Button>
                                    <Button
                                        size="small"
                                        type="primary"
                                        disabled={!hasPointCloud || importLoading}
                                        loading={importLoading}
                                        onClick={() => handleGenerateDataPackageBaseMap(packageInfo)}
                                    >
                                        生成底图
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
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

    const selectedItem = menuData.find((item) => item.key === currentKey);
    const libraryTitle = isBaseMapDialog ? '底图库' : '标注地图库';
    const libraryDescription = isBaseMapDialog
        ? '选择已经生成好的点云/瓦片底图进入画布。原始采图包请先在采图包工作台完成预检和底图生成。'
        : '选择已经保存的 Apollo 标注地图继续编辑，也可以导入已有地图包。';
    const selectedText = selectedItem?.content || '未选择';
    const countText = `${formatCount(menuData.length)} 个文件`;

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
            <div className="file-dialog-overview">
                <div className="file-dialog-overview-main">
                    <div className="file-dialog-overview-title">{libraryTitle}</div>
                    <div className="file-dialog-overview-desc">{libraryDescription}</div>
                </div>
                <div className="file-dialog-overview-stats">
                    <div>
                        <span>当前库</span>
                        <strong>{countText}</strong>
                    </div>
                    <div>
                        <span>当前选择</span>
                        <strong>{selectedText}</strong>
                    </div>
                </div>
            </div>
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
                            <Button onClick={fetchData} disabled={listLoading} className="button-cancel">
                                刷新底图库
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
                            ? '兼容导入旧格式；原始 Image/LAS/PCD 采图包请从采图包工作台进入。'
                            : 'ZIP 文件名会作为地图名称，内容需包含 editor_map.json'}
                    </span>
                    <input
                        ref={importInputRef}
                        type="file"
                        multiple
                        accept=".zip,.pcd,.ply,.xyz,.txt,.csv,.las,.laz,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/zip"
                        style={{ display: 'none' }}
                        onChange={handleImportFileChange}
                    />
                </div>
            )}
            {renderDataPackagePanel()}
            {renderDialogContent()}
        </Modal>
    );
};

export default Dialog;
