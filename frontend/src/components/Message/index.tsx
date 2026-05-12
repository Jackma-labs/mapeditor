// import IcToastFail from '@dreamview/dreamview-core/src/assets/svg/ic_toast_fail';
import React, { FC } from 'react';

import { message as internalmessage, MessageArgsProps } from 'antd';

import ToastFailIcon from '../../assets/images/ic_toast_fail.svg';
import ToastSucceedIcon from '../../assets/images/ic_toast_succeed.svg';
import ToastWarningIcon from '../../assets/images/ic_warning.svg';
import ToastLoadingIcon from '../../assets/images/ic_toast_loading.svg';

import './index.less';

const GLOBAL_PREFIX_CLS = 'dreamview';

interface RenderIconProps {
    url: string;
}

// eslint-disable-next-line react/function-component-definition
const RenderIcon: FC<RenderIconProps> = ({ url }) => (
    <img src={url} alt="Message SVG" style={{ marginRight: '8px', verticalAlign: 'middle' }} />
);

const getPrefixCls = (suffixCls?: string, customizePrefixCls?: string): string => {
    if (customizePrefixCls) return customizePrefixCls;
    return suffixCls ? `${GLOBAL_PREFIX_CLS}-${suffixCls}` : GLOBAL_PREFIX_CLS;
};

export function message(props: MessageArgsProps, topValue = 8) {
    const { type } = props;

    let icon = null;
    let toastIcon = null;
    switch (type) {
        case 'error':
            toastIcon = ToastFailIcon;
            break;
        case 'success':
            toastIcon = ToastSucceedIcon;
            break;
        case 'warning':
            toastIcon = ToastWarningIcon;
            break;
        case 'loading':
            toastIcon = ToastLoadingIcon;
            break;
        default:
            break;
    }

    icon = <RenderIcon url={toastIcon} />;
    internalmessage[type]({ ...props, className: `dreamview-message-notice-${type}`, icon });
    internalmessage.config({ top: topValue });
}

message.destory = (key: string) => {
    internalmessage.destroy(key);
};

internalmessage.config({
    prefixCls: getPrefixCls('message'),
    duration: 3,
    maxCount: 3,
});
