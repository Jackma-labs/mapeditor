/* eslint-disable react/jsx-wrap-multilines */
import { Modal } from 'antd';
import React from 'react';
import './index.less';
import WarningIcon from '../../assets/images/ic_warning.svg';

export default function Index(props: {
    titledata: string;
    content: string;
    onCancelCallback: () => void;
    onOkCallback: () => void;
}) {
    const { titledata, content, onCancelCallback, onOkCallback } = props;
    return (
        <Modal
            className="warning-model-dialog"
            centered
            title={
                <div>
                    <img
                        src={WarningIcon}
                        alt="warning"
                        style={{ color: 'rgb(252,121,30)', marginRight: '14px', verticalAlign: 'middle' }}
                    />
                    {titledata}
                </div>
            }
            open
            width={400}
            closeIcon={null}
            okText="确认"
            cancelText="取消"
            onCancel={onCancelCallback}
            onOk={onOkCallback}
        >
            <p>{content}</p>
        </Modal>
    );
}
