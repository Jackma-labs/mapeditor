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
            credentials: 'include',
            ...options,
        });
        const payload = await response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
        return payload;
    }

    async getAuthSession() {
        return this.requestJson('/runtime/auth/session');
    }

    async login(username: string, password: string) {
        return this.requestJson('/runtime/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                username,
                password,
            }),
        });
    }

    async logout() {
        return this.requestJson('/runtime/auth/logout', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async getRuntimeDoctor() {
        return this.requestJson('/runtime/doctor');
    }

    async getRuntimeStatus() {
        return this.requestJson('/runtime/status');
    }

    async diagnoseApolloLiteRuntime() {
        return this.requestJson('/runtime/apollolite/diagnose');
    }

    async getApolloLiteWorkflow() {
        return this.requestJson('/runtime/apollolite/workflow');
    }

    async startApolloLiteRepairJob() {
        return this.requestJson('/runtime/apollolite/repair-job', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async startApolloLiteResetSimulationJob() {
        return this.requestJson('/runtime/apollolite/reset-simulation-job', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async getApolloLiteTrafficLightSimulationStatus() {
        return this.requestJson('/runtime/apollolite/traffic-light-sim');
    }

    async startApolloLiteTrafficLightSimulation(color: string = 'GREEN') {
        return this.requestJson('/runtime/apollolite/traffic-light-sim/start', {
            method: 'POST',
            body: JSON.stringify({ color }),
        });
    }

    async stopApolloLiteTrafficLightSimulation() {
        return this.requestJson('/runtime/apollolite/traffic-light-sim/stop', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async getEditorMapLocks() {
        return this.requestJson('/runtime/editor-map-locks');
    }

    async getEditorMapHistory(mapName: string) {
        return this.requestJson(`/runtime/editor-map-history/${encodeURIComponent(mapName)}`);
    }

    async getReleasedMaps() {
        return this.requestJson('/runtime/released-maps');
    }

    async getAIAssistantStatus() {
        return this.requestJson('/runtime/ai-assistant/status');
    }

    async askMapAssistant(payload: { question: string; context: any }) {
        return this.requestJson('/runtime/ai-assistant', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async importBaseMapZip(file: File, mapName: string, overwrite: boolean = false) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mapName', mapName);
        formData.append('overwrite', overwrite ? 'true' : 'false');
        const response = await fetch(`http://${baseHttpURL}/runtime/import-base-map`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        return response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
    }

    async importPointCloudBaseMap(file: File | File[], mapName: string, overwrite: boolean = false) {
        const formData = new FormData();
        const files = Array.isArray(file) ? file : [file];
        files.forEach((item) => formData.append(files.length === 1 ? 'file' : 'files', item));
        formData.append('mapName', mapName);
        formData.append('overwrite', overwrite ? 'true' : 'false');
        const response = await fetch(`http://${baseHttpURL}/runtime/import-point-cloud-base-map`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        return response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
    }

    async analyzeDataPackage(file: File | File[], packageName: string) {
        const formData = new FormData();
        const files = Array.isArray(file) ? file : [file];
        files.forEach((item) => formData.append(files.length === 1 ? 'file' : 'files', item));
        formData.append('packageName', packageName);
        const response = await fetch(`http://${baseHttpURL}/runtime/analyze-data-package`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        return response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
    }

    async startAnalyzeDataPackageJob(file: File | File[], packageName: string) {
        const formData = new FormData();
        const files = Array.isArray(file) ? file : [file];
        files.forEach((item) => formData.append(files.length === 1 ? 'file' : 'files', item));
        formData.append('packageName', packageName);
        const response = await fetch(`http://${baseHttpURL}/runtime/analyze-data-package-job`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        return response.json().catch(() => ({
            code: response.status,
            message: response.statusText,
        }));
    }

    async getDataPackages(options: { detail?: 'summary' | 'full' } = { detail: 'summary' }) {
        const detail = options.detail || 'summary';
        return this.requestJson(`/runtime/data-packages?detail=${encodeURIComponent(detail)}`);
    }

    async getCaptureSourcePackages() {
        return this.requestJson('/runtime/capture-source-packages');
    }

    async startSyncCaptureSourcePackagesJob(options: any = {}) {
        return this.requestJson('/runtime/sync-capture-source-packages-job', {
            method: 'POST',
            body: JSON.stringify({
                onlyNew: options.onlyNew !== false,
                overwrite: options.overwrite === true,
                limit: options.limit || 50,
                autoGenerateBaseMaps: options.autoGenerateBaseMaps === true,
                maxBaseMapJobs: options.maxBaseMapJobs || 20,
                autoMerge: options.autoMerge === true,
                mergedMapName: options.mergedMapName || 'capture_source_merged',
                overwriteBaseMaps: options.overwriteBaseMaps === true,
                overwriteMergedMap: options.overwriteMergedMap !== false,
            }),
        });
    }

    async renameDataPackage(packageId: string, displayName: string) {
        return this.requestJson(`/runtime/data-packages/${encodeURIComponent(packageId)}`, {
            method: 'PATCH',
            body: JSON.stringify({
                displayName,
            }),
        });
    }

    async deleteDataPackage(packageId: string) {
        return this.requestJson(`/runtime/data-packages/${encodeURIComponent(packageId)}`, {
            method: 'DELETE',
        });
    }

    async startRefreshDataPackageAnalysisJob(packageId: string) {
        return this.requestJson('/runtime/refresh-data-package-analysis-job', {
            method: 'POST',
            body: JSON.stringify({
                packageId,
            }),
        });
    }

    async startRefreshAllDataPackageAnalysisJob(onlyMissing: boolean = true) {
        return this.requestJson('/runtime/refresh-all-data-package-analysis-job', {
            method: 'POST',
            body: JSON.stringify({
                onlyMissing,
            }),
        });
    }

    async getDataPackageStitchPlan(packageIds: string[]) {
        return this.requestJson('/runtime/data-package-stitch-plan', {
            method: 'POST',
            body: JSON.stringify({
                packageIds,
            }),
        });
    }

    async importDataPackageBaseMap(packageId: string, mapName: string, overwrite: boolean = false) {
        return this.requestJson('/runtime/import-data-package-base-map', {
            method: 'POST',
            body: JSON.stringify({
                packageId,
                mapName,
                overwrite,
            }),
        });
    }

    async startDataPackageBaseMapJob(packageId: string, mapName: string, overwrite: boolean = false) {
        return this.requestJson('/runtime/import-data-package-base-map-job', {
            method: 'POST',
            body: JSON.stringify({
                packageId,
                mapName,
                overwrite,
            }),
        });
    }

    async startMergedDataPackagesBaseMapJob(packageIds: string[], mapName: string, overwrite: boolean = false) {
        return this.requestJson('/runtime/import-data-packages-merged-base-map-job', {
            method: 'POST',
            body: JSON.stringify({
                packageIds,
                mapName,
                overwrite,
            }),
        });
    }

    async getAssistDrawingCandidates(mapName: string, options: any = {}) {
        const query = new URLSearchParams();
        Object.keys(options || {}).forEach((key) => {
            const value = options[key];
            if (value !== undefined && value !== null && value !== '') {
                query.set(key, String(value));
            }
        });
        const queryString = query.toString();
        return this.requestJson(
            `/runtime/assist-drawing-candidates/${encodeURIComponent(mapName)}${queryString ? `?${queryString}` : ''}`,
        );
    }

    async getRuntimeJob(jobId: string, includeLogs: boolean = false) {
        const query = includeLogs ? '?logs=true&tail=200' : '';
        return this.requestJson(`/runtime/jobs/${encodeURIComponent(jobId)}${query}`);
    }

    async getRuntimeJobs(limit: number = 50) {
        return this.requestJson(`/runtime/jobs?limit=${encodeURIComponent(String(limit))}`);
    }

    async importMapPackageZip(file: File, mapName: string, overwrite: boolean = false) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mapName', mapName);
        formData.append('overwrite', overwrite ? 'true' : 'false');
        const response = await fetch(`http://${baseHttpURL}/runtime/import-map-package`, {
            method: 'POST',
            credentials: 'include',
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

    async preflightDeploy(mapName: string = '') {
        return this.requestJson('/runtime/preflight-deploy', {
            method: 'POST',
            body: JSON.stringify({ mapName }),
        });
    }

    async discoverEdgeMapRoot(config: any) {
        return this.requestJson('/runtime/discover-edge-map-root', {
            method: 'POST',
            body: JSON.stringify(config),
        });
    }

    async configureEdgeDeploy(config: any) {
        return this.requestJson('/runtime/configure-edge-deploy', {
            method: 'POST',
            body: JSON.stringify(config),
        });
    }

    async getDeployments() {
        return this.requestJson('/runtime/deployments');
    }

    async getApolloLiteStatus() {
        return this.requestJson('/runtime/apollolite/status');
    }

    async startStageLatestMapToApolloLiteJob() {
        return this.requestJson('/runtime/apollolite-stage-latest-job', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async startApolloLiteSimulationSmokeTestJob(mapName: string = '') {
        return this.requestJson('/runtime/apollolite-sim-smoke-test-job', {
            method: 'POST',
            body: JSON.stringify({
                mapName,
            }),
        });
    }

    async startDeployLatestReleasedMapJob() {
        return this.requestJson('/runtime/deploy-latest-job', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async startDeployReleasedMapJob(mapName: string) {
        return this.requestJson('/runtime/deploy-map-job', {
            method: 'POST',
            body: JSON.stringify({ mapName }),
        });
    }

    async deployLatestReleasedMap() {
        return this.requestJson('/runtime/deploy-latest', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    async startRollbackDeploymentJob(deploymentId: string) {
        return this.requestJson('/runtime/rollback-deployment-job', {
            method: 'POST',
            body: JSON.stringify({
                deploymentId,
            }),
        });
    }

    getBaseMapInfo(dir: string, layerId: string = 'enhanced') {
        const layerPath = layerId && layerId !== 'enhanced' ? `/layers/${encodeURIComponent(layerId)}` : '';
        return fetch(`http://${baseHttpURL}/mapcreator/${dir}${layerPath}/tiles.json?mode=0`, {
            credentials: 'include',
        })
            .then((response) => response.json())
            .then((json) => ({
                ...json,
                layerId,
            }))
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
