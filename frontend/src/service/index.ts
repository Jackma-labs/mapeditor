import shortUUID from 'short-uuid';
import Socket from 'websocket-as-promised';
import { baseHttpURL } from '../config/index';

interface SocketMessageData {
    info: string;
    requestId: string;
    source: string;
    targetType: string;
}

interface SocketMessage {
    type: string;
    action: string;
    data: SocketMessageData;
}

const TIMEOUT = 120000;

class FileService {
    socket: Socket;

    private promiseHandler: any;

    private isOpen: boolean = false;

    static instance: any;

    /**
     * @class WebSocketWrapper
     * @description 用于创建WebSocket连接的类。
     */
    constructor() {
        this.promiseHandler = {};

        this.init();
    }

    private init() {
        const option = {};
        const url = `ws://${baseHttpURL}/plugins/map`;

        this.isOpen = false;

        try {
            this.socket = new Socket(url, option);
            this.socket.onOpen.addListener(() => {
                this.isOpen = true;
            });
            this.socket.onClose.addListener(() => {
                // 如果连接已经关闭，则重新创建连接
                this.isOpen = false;
            });
            this.socket.onError.addListener((error) => {
                console.log(error);
            });
            this.socket.onMessage.addListener((message: string) => {
                const data = JSON.parse(message) as SocketMessage;

                if (!data.action || data.action !== 'response' || !data.data.requestId) {
                    return;
                }

                const requestId = data.data.requestId;
                if (this.promiseHandler[requestId]) {
                    this.promiseHandler[requestId].resolve(data.data);
                    delete this.promiseHandler[requestId];
                }
            });
        } catch (error) {
            console.log(error);
        }
    }

    private promiseWithTimeout = (promise: any, requestId: string) => {
        let timeoutId;
        const timeoutPromise = new Promise((resolve) => {
            timeoutId = setTimeout(async () => {
                if (this.promiseHandler[requestId]) {
                    delete this.promiseHandler[requestId];
                }
                resolve({
                    info: {
                        code: 99999,
                        message: '发布超时',
                    },
                });
            }, TIMEOUT);
        });

        return {
            promiseOrTimeout: Promise.race([promise, timeoutPromise]),
            timeoutId,
        };
    };

    private genereateRequestId = (type: string) => {
        const replaceUid = type.replace(/!.*$/, '');
        return `${replaceUid}!${shortUUID.generate()}`;
    };

    /**
     * 获取FileService实例。
     * 如果实例不存在，则创建一个新的实例并将其保存在静态变量`this.instance`。
     * 返回当前已创建的FileService实例。
     *
     * @returns {FileService} - 新创建或已有的FileService实例。
     */
    static async getInstance() {
        if (!this.instance) {
            this.instance = new FileService();
            await this.instance.socket.open().catch((error: any) => {
                console.log(error);
            });
        }

        return this.instance;
    }

    private async requestJson(path: string, options: RequestInit = {}) {
        const response = await fetch(`http://${baseHttpURL}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
            ...options,
        });
        const payload = await response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
        return payload;
    }

    async getRuntimeDoctor() {
        return this.requestJson('/runtime/doctor');
    }

    async getRuntimeStatus() {
        return this.requestJson('/runtime/status');
    }

    async getReleasedMaps() {
        return this.requestJson('/runtime/released-maps');
    }

    async importBaseMapZip(file: File, mapName: string, overwrite: boolean = false) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mapName', mapName);
        formData.append('overwrite', overwrite ? 'true' : 'false');
        const response = await fetch(`http://${baseHttpURL}/runtime/import-base-map`, {
            method: 'POST',
            body: formData,
        });
        return response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
    }

    async importMapPackageZip(file: File, mapName: string, overwrite: boolean = false) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mapName', mapName);
        formData.append('overwrite', overwrite ? 'true' : 'false');
        const response = await fetch(`http://${baseHttpURL}/runtime/import-map-package`, {
            method: 'POST',
            body: formData,
        });
        return response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
    }

    async getDeployConfig() {
        return this.requestJson('/runtime/deploy-config');
    }

    async preflightDeploy() {
        return this.requestJson('/runtime/preflight-deploy', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async deployLatestReleasedMap() {
        return this.requestJson('/runtime/deploy-latest', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    getBaseMapInfo(dir: string) {
        return fetch(`http://${baseHttpURL}/mapcreator/${dir}/tiles.json?mode=0`)
            .then((response) => response.json())
            .catch((error) => {
                console.log(error);
            });
    }

    /**
     * 获取地图列表
     *
     * @returns 返回一个Promise对象，该Promise会在获取到地图列表后被resolved。
     */
    async getBaseMapList() {
        const requestId = this.genereateRequestId('GetBaseMapDir');
        const params = {
            type: 'GetBaseMapDir',
            action: 'request',
            data: {
                info: 'null',
                requestId,
                source: 'dreamview',
                targetType: 'module',
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }

    /**
     * 获取基础地图目录
     *
     * @returns 返回一个Promise对象，当获取到基础地图目录时会通过resolve函数传递，否则会通过reject函数传递
     */
    async getHDMapList() {
        const requestId = this.genereateRequestId('GetMapFileList');
        const params = {
            type: 'GetMapFileList',
            action: 'request',
            data: {
                requestId,
                source: 'dreamview',
                targetType: 'module',
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }

    async getHDMap(name: string) {
        const requestId = this.genereateRequestId('OpenMapFile');
        const params = {
            type: 'OpenMapFile',
            action: 'request',
            data: {
                requestId,
                info: {
                    mapName: name,
                },
                source: 'dreamview',
                targetType: 'module',
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }

    /**
     * 保存地图文件
     *
     * @param name - 文件名
     * @param data - 数据对象
     * @returns 返回Promise对象
     */
    async save(name: string, data: object, overWrite: boolean = false) {
        const requestId = this.genereateRequestId('SaveMapFile');
        (data as any).header.version = name;
        const params = {
            type: 'SaveMapFile',
            action: 'request',
            data: {
                requestId,
                source: 'dreamview',
                targetType: 'module',
                info: {
                    mapName: name,
                    map: data,
                    ifCheckFileDuplicated: overWrite,
                },
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }

    /**
     * 发布地图文件
     *
     * @param name - 文件名
     * @param data - 数据对象
     * @returns 返回一个Promise对象，用于处理发布请求的结果
     */
    async publish(name: string, data: object, overWrite: boolean = false) {
        const requestId = this.genereateRequestId('ReleaseMapFile');
        (data as any).header.version = name;
        const params = {
            type: 'ReleaseMapFile',
            action: 'request',
            data: {
                requestId,
                source: 'dreamview',
                targetType: 'module',
                info: {
                    mapName: name,
                    map: data,
                    ifCheckFileDuplicated: overWrite,
                },
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }

    /**
     * 获取地图编辑的权限
     */
    async getAccountMapToolInfo() {
        const requestId = this.genereateRequestId('GetAccountMapToolInfo');
        const params = {
            type: 'GetAccountMapToolInfo',
            action: 'request',
            data: {
                info: '',
                name: 'GetAccountMapToolInfo',
                requestId,
                source: 'dreamview',
                target: 'studio_connector',
                sourceType: 'module',
                targetType: 'plugins',
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }

    /**
     * 获取地图编辑的权限
     */
    async getSignalProjectImage(basemapCenter: { x: number; y: number; z: number }, mapData: object) {
        const requestId = this.genereateRequestId('GetSignalProjectImage');
        const params = {
            type: 'FindSignalProjectImage',
            action: 'request',
            data: {
                info: {
                    signalMap: {
                        basemapCenter,
                        ...mapData,
                    },
                },
                name: 'FindSignalProjectImage',
                requestId,
                source: 'dreamview',
                target: 'teleop',
                targetType: 'teleop',
            },
        };

        if (!this.isOpen) {
            this.init();
            try {
                await this.socket.open();
            } catch (e) {
                return Promise.resolve(e);
            }
        }

        const fetch = new Promise((resolve, reject) => {
            this.promiseHandler[requestId] = {
                resolve,
                reject,
            };

            this.socket.send(JSON.stringify(params));
        });
        const { promiseOrTimeout } = this.promiseWithTimeout(fetch, requestId);

        return promiseOrTimeout;
    }
}

export default await FileService.getInstance();
