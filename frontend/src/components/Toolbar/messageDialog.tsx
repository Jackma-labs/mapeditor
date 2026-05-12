/*
 * @Author: v_zhangyi10 v_zhangyi10@baidu.com
 * @Date: 2023-09-21 20:54:32
 * @LastEditors: v_zhangyi10 v_zhangyi10@baidu.com
 * @LastEditTime: 2023-09-27 01:34:04
 * @FilePath: /apollo-private/modules/map_editor_frontend/src/components/Toolbar/messageDialog.tsx
 * @Description: 头部注释-文件说明：
 */
import React, { ReactNode } from 'react';
import { Modal, Button } from 'antd';
import { ModalProps } from 'antd/lib/modal';
import FailIcon from '../../assets/images/ic_fail.svg';

interface DialogProps extends Omit<ModalProps, 'visible'> {
    title: string;
    items?: ReactNode;
    open: boolean;
    onCancel?: () => void;
    messageApi?: any;
}

// eslint-disable-next-line react/function-component-definition
const Dialog: React.FC<DialogProps> = ({ title, open, onCancel, items, messageApi, ...rest }) => {
    const handleCancel = () => {
        messageApi.open({
            type: 'error',
            content: 'This is an error message',
        });
        onCancel();
    };

    return (
        <Modal
            open={open}
            className="message-model-dialog"
            closeIcon={null}
            onCancel={handleCancel}
            width={400}
            footer={null}
            {...rest}
        >
            {items}
            {title === '错误' && (
                <div className="message-content">
                    <p className="message-body">
                        继续打开将替换现在的文件，确认继续吗?
                        <br />
                        (确认现有文件已保存)
                    </p>
                    <p className="message-footer">
                        <Button onClick={handleCancel} className="button-cancel">
                            取消
                        </Button>
                        <Button type="primary" onClick={handleCancel} className="button-cancel">
                            确认
                        </Button>
                    </p>
                </div>
            )}
            {title === '重复' && (
                <div className="message-content">
                    <div className="message-body">
                        <img src={FailIcon} alt="" />
                        <p>展示由后端返回的具体失败原因文案，展示由后端返回的具体失败原因文案</p>
                    </div>
                    <p className="message-footer">
                        <Button type="primary" onClick={handleCancel} className="button-cancel">
                            知道了
                        </Button>
                    </p>
                </div>
            )}
        </Modal>
    );
};

export default Dialog;
