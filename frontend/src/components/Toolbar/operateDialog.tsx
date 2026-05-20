/*
 * @Author: v_zhangyi10 v_zhangyi10@baidu.com
 * @Date: 2023-09-20 16:50:29
 * @LastEditors: v_zhangyi10 v_zhangyi10@baidu.com
 * @LastEditTime: 2023-10-08 13:21:03
 * @FilePath: /apollo-private/modules/map_editor_frontend/src/components/Toolbar/operateDialog.tsx
 * @Description: 头部注释-文件说明：
 */
import React, { ReactNode, useState, useEffect, useRef } from 'react';
import { Modal, Button, Form, Input, message } from 'antd';
import { ModalProps } from 'antd/lib/modal';
import FileService from 'src/service/index';
import { useManagerStore } from 'src/store';
import { inspectMapQuality, MapQualityIssue } from 'src/quality/mapQuality';
import CloseIcon from '../../assets/images/ic_close.svg';
import { message as messageFunc } from '../Message/index';

interface DialogProps extends Omit<ModalProps, 'visible'> {
    items?: ReactNode;
    open: boolean;
    onCancel?: () => void;
    messageApi: any;
}

interface FieldData {
    name: string | number | (string | number)[];
    value?: any;
    touched?: boolean;
    validating?: boolean;
    errors?: string[];
}

interface CustomValid {
    status?: '' | 'error' | 'success' | 'warning' | 'validating';
    message: string;
}

function showPublishPreflightError(issues: MapQualityIssue[]) {
    const topIssues = issues.slice(0, 8);
    Modal.error({
        icon: null,
        closable: true,
        title: '发布预检未通过',
        content: (
            <div className="publish-preflight-error">
                <p>{`当前地图仍有 ${issues.length} 个红色错误，发布前需要先修复。`}</p>
                {topIssues.map((issue) => (
                    <div key={issue.id} className="publish-preflight-item">
                        <strong>{issue.title}</strong>
                        <span>{issue.suggestion}</span>
                    </div>
                ))}
                {issues.length > topIssues.length && <p>其余问题可在左下角“地图质量检查”面板中继续定位。</p>}
            </div>
        ),
    });
}

// eslint-disable-next-line react/function-component-definition
const Dialog: React.FC<DialogProps> = ({ title, open, onCancel, items, ...rest }) => {
    message.config({
        top: 100,
    });
    const [mapExport, mapState, setMapState] = useManagerStore((state) => [
        state.export,
        state.mapState,
        state.setMapState,
    ]);
    const [loading, setLoading] = useState(false);
    const [canSubmit, setCanSubmit] = useState(true);
    const [fileNameDuplicate, setFileNameDuplicate] = useState(false);
    const closeNode = <img src={CloseIcon} alt="close" />;
    const [form] = Form.useForm();
    const isPublish = title === '发布地图' || title === '发布地图包';
    const name = isPublish ? '/apollo/modules/map/data' : '/apollo/data/editor_map';
    const [fields, setFields] = useState<FieldData[]>([
        { name: 'name', value: '' },
        { name: 'address', value: name },
    ]);
    const domRef = useRef(null);
    const inputRef = useRef(null);
    const cursorTimer = useRef(null);
    const serviceTimer = useRef(null);
    const [customValid, setCustomValid] = useState<CustomValid>({
        status: null,
        message: null,
    });

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        const updatedFields = [...fields];
        updatedFields[0].value = value;
        setFields(updatedFields);
    };

    // 取消按钮
    const handleCancel = () => {
        onCancel();
    };

    // 保存 或 发布按钮
    const handleSubmit = async () => {
        const values = await form.validateFields().catch((errorInfo) => {
            setCustomValid({
                status: 'error',
                message: errorInfo.errorFields[0].errors[0],
            });
        });

        if (!values) {
            return;
        }

        // 处理提交逻辑
        let response: any;
        if (isPublish) {
            const report = inspectMapQuality(mapState);
            const blockingIssues = report.issues.filter((issue) => issue.severity === 'error');
            if (blockingIssues.length > 0) {
                showPublishPreflightError(blockingIssues);
                return;
            }
        }
        const params = mapExport();
        if (isPublish) {
            setLoading(true);
            response = await FileService.publish(values.name, params, !fileNameDuplicate);
        } else {
            setLoading(true);
            response = await FileService.save(values.name, params, !fileNameDuplicate);
        }
        setLoading(false);
        if (response?.info?.code === 0) {
            messageFunc({
                type: 'success',
                content: (
                    <span>
                        {title}
                        成功
                    </span>
                ),
            });
            setMapState({
                ...mapState,
                hdMapFile: values.name,
                onsave: false,
            });
            window.localStorage.removeItem('mapEditingData');
            handleCancel();

            console.log('save:', mapState.hdMapFile);
        } else if (response?.info?.code === 15007) {
            setFileNameDuplicate(true);
        } else if (response?.info?.code === 15017) {
            setFileNameDuplicate(true);
        } else if (response?.info?.code === 99999) {
            messageFunc({
                type: 'warning',
                content: <span>{response.info.message}</span>,
            });
            handleCancel();
        } else if (response?.info?.message) {
            const errorMsgArr = response.info?.data?.errorMessage?.map(
                (item: any) => `code:${response.info?.code}，元素ID：${item.elementId}，原因：${item.title}`,
            );
            handleCancel();
            Modal.error({
                icon: null,
                footer: null,
                closable: true,
                content: (
                    <>
                        {errorMsgArr &&
                            errorMsgArr.length !== 0 &&
                            errorMsgArr.map((item: any) => <p key={item}>{item}</p>)}
                        {(!errorMsgArr || errorMsgArr.length === 0) && response.info.message}
                    </>
                ),
            });
        } else {
            messageFunc({
                type: 'error',
                content: <span>网络请求失败</span>,
            });
            handleCancel();
        }
    };

    useEffect(() => {
        if (open) {
            const currentDatetime = new Date();
            const year = currentDatetime.getFullYear();
            const month = `0${currentDatetime.getMonth() + 1}`.slice(-2);
            const date = `0${currentDatetime.getDate()}`.slice(-2);
            const hours = `0${currentDatetime.getHours()}`.slice(-2);
            const minutes = `0${currentDatetime.getMinutes()}`.slice(-2);
            const formattedDate = year + month + date + hours + minutes;
            const defaultVal = title === '发布地图' ? `ReleaseMap_${formattedDate}` : `AnnotatedMap_${formattedDate}`;
            const val = mapState.hdMapFile || defaultVal;
            const address = title === '发布地图' ? '/apollo/data/released_map' : '/apollo/data/editor_map';
            const updatedFields = [...fields];
            updatedFields[0] = {
                ...updatedFields[0],
                value: val,
            };
            updatedFields[1] = {
                ...updatedFields[1],
                value: address,
            };
            setFields([...updatedFields]);

            console.log('open:', mapState.hdMapFile);
            if (mapState.hdMapFile && title !== '发布地图') {
                serviceTimer.current = window.setTimeout(() => {
                    domRef.current.querySelector('input').select();
                }, 100);
                setCustomValid({
                    status: 'warning',
                    message: '保存将覆盖原有文件',
                });
            }
        }
    }, [open]);

    useEffect(() => {
        if (fileNameDuplicate) {
            setCustomValid({
                status: 'warning',
                message: '文件名已存在，保存将覆盖原有文件',
            });
        }
    }, [fileNameDuplicate]);

    useEffect(() => {
        setCustomValid({
            status: '',
            message: '',
        });
        setCanSubmit(true);
        if (fields[0].value?.indexOf('/') !== -1) {
            setCustomValid({
                status: 'error',
                message: '请输入除/以外的所有字符',
            });
            setCanSubmit(false);
        } else if (!fields[0].value) {
            setCustomValid({
                status: 'error',
                message: '文件名不能为空',
            });
            setCanSubmit(false);
        } else if (fields[0].value?.length > 86) {
            setCustomValid({
                status: 'error',
                message: '最多输入86字符',
            });
            setCanSubmit(false);
        }
    }, [fields]);

    useEffect(() => {
        if (inputRef.current) {
            cursorTimer.current = setTimeout(() => {
                inputRef.current.focus({
                    cursor: 'all',
                });
            }, 200);
        }
        return () => {
            if (cursorTimer.current) {
                clearTimeout(cursorTimer.current);
            }
            if (serviceTimer.current) {
                clearTimeout(serviceTimer.current);
            }
        };
    }, []);

    return (
        <Modal
            title={title}
            open={open}
            className="file-model-dialog"
            closeIcon={closeNode}
            onCancel={handleCancel}
            footer={null}
            width={522}
            {...rest}
        >
            {items}
            <div ref={domRef} className="dialog-body-form">
                <Form
                    name="basic"
                    labelCol={{ span: 6 }}
                    wrapperCol={{ span: 16 }}
                    style={{ maxWidth: 600 }}
                    form={form}
                    fields={fields}
                    autoComplete="off"
                    className="form-model"
                    onFieldsChange={(_, allFields) => {
                        setFields(allFields);
                    }}
                >
                    <Form.Item
                        label="文件名称"
                        name="name"
                        validateStatus={customValid.status}
                        help={customValid.message}
                    >
                        <Input ref={inputRef} onChange={handleInputChange} style={{ height: '40px' }} />
                    </Form.Item>
                    <Form.Item label="文件地址" name="address">
                        <Input className="input-fixed" disabled bordered={false} style={{ paddingLeft: '0px' }} />
                    </Form.Item>

                    <Form.Item className="footer-button">
                        <Button key="cancel" onClick={handleCancel} className="button-cancel">
                            取消
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            disabled={!canSubmit}
                            onClick={handleSubmit}
                            loading={loading}
                        >
                            保存
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </Modal>
    );
};

export default Dialog;
