const devHost =
    typeof window !== 'undefined' && window.location ? `${window.location.hostname}:58000` : 'localhost:58000';

export const baseHttpURL =
    process.env.REACT_APP_MAP_BACKEND || (process.env.NODE_ENV === 'production' ? window.location.host : devHost);
export default {
    baseHttpURL,
    port: '58000',
    timeout: 30000,
    connectionTimeout: 30000,
};
