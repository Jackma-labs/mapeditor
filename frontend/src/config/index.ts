const devHost =
    typeof window !== 'undefined' && window.location ? `${window.location.hostname}:58000` : 'localhost:58000';

const getProductionHost = () => {
    if (typeof window === 'undefined' || !window.location) {
        return '';
    }
    const firstPathSegment = window.location.pathname.split('/').filter(Boolean)[0] || '';
    const appPrefix = firstPathSegment === 'mapeditor' ? '/mapeditor' : '';
    return `${window.location.host}${appPrefix}`;
};

export const baseHttpURL =
    process.env.REACT_APP_MAP_BACKEND || (process.env.NODE_ENV === 'production' ? getProductionHost() : devHost);

const getPageHttpProtocol = () => {
    if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
        return 'https';
    }
    return 'http';
};

const withHttpProtocol = (value: string) => {
    const normalized = String(value || '').replace(/\/+$/, '');
    if (/^https?:\/\//i.test(normalized)) {
        return normalized;
    }
    return `${getPageHttpProtocol()}://${normalized}`;
};

export const baseApiURL = withHttpProtocol(baseHttpURL);
export const baseWsURL = baseApiURL.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');

export default {
    baseHttpURL,
    baseApiURL,
    baseWsURL,
    port: '58000',
    timeout: 30000,
    connectionTimeout: 30000,
};
