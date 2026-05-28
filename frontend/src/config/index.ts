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
export default {
    baseHttpURL,
    port: '58000',
    timeout: 30000,
    connectionTimeout: 30000,
};
