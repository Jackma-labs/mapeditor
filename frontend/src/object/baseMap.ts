import * as THREE from 'three';
import { useManagerStore } from 'src/store';
import { PermissionStatus, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import * as turf from '@turf/turf';
import { getPointsBox } from 'src/threeUtil/RotateControl/util';
import { throttle } from 'lodash';
import PubSub from 'pubsub-js';
import { configureTextureForWebGL1 } from 'src/utils/textureUtil';
import CameraControl from '../threeUtil/cameraControl';
import { baseHttpURL } from '../config/index';

export interface TileItem {
    offset_x: string;
    offset_y: string;
}

interface CameraMovePadding {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}

interface CameraMovePayload {
    coordinates: number[][];
    padding?: CameraMovePadding;
    minExtent?: number;
}

function isCameraMovePayload(value: number[][] | CameraMovePayload): value is CameraMovePayload {
    return Boolean(value && !Array.isArray(value) && Array.isArray((value as CameraMovePayload).coordinates));
}

const layerMaterialStyles: { [key: string]: { color: number; opacity: number } } = {
    enhanced: { color: 0xffffff, opacity: 1 },
    raw: { color: 0x82aaff, opacity: 0.92 },
    ground: { color: 0x64d98a, opacity: 0.9 },
    marking: { color: 0xffd45c, opacity: 1 },
    edge: { color: 0x46d7ff, opacity: 1 },
    structure: { color: 0xff9d4d, opacity: 0.95 },
};

export default class BaseMap {
    private render: THREE.WebGL1Renderer;

    private scene: THREE.Scene;

    private camera: THREE.PerspectiveCamera;

    private control: CameraControl;

    private meshs: { [id: string]: THREE.Mesh | THREE.Points } = {};

    public scale: number = 4;

    private position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

    private dir: string;

    private tiles: { [key: string]: TileItem[] } = {};

    private loading: boolean = false;

    private activeLayerId: string = 'enhanced';

    private opacity: number = 1;

    private pointSize: number = 1.2;

    private currentMapExtent: number = 0;

    /**
     * @class RenderHelper
     * @description 渲染辅助类，主要用于实现地图和相机之间的同步操作
     */
    constructor(
        render: THREE.WebGL1Renderer,
        scene: THREE.Scene,
        camera: THREE.PerspectiveCamera,
        control: CameraControl,
    ) {
        this.render = render;
        this.scene = scene;
        this.camera = camera;
        this.control = control;
        this.loading = false;

        this.control.cameraControls.addEventListener(
            'update',
            throttle(() => {
                PubSub.publish('closeRemind');
                if (!this.dir || Object.keys(this.tiles).length === 0 || this.loading) {
                    return;
                }
                const vFOV = THREE.MathUtils.degToRad(camera.fov);
                const height = 2 * Math.tan(vFOV / 2) * camera.position.z;

                let scale = Math.round(this.render.domElement.clientHeight / height);
                if (scale > 4) {
                    scale = 4;
                } else if (scale < 0) {
                    scale = 0;
                }
                const offsetX = Math.abs(camera.position.x - this.position.x);
                const offsetY = Math.abs(camera.position.y - this.position.y);
                const isReresh = offsetX > 32 * scale || offsetY > 32 * scale || this.scale !== scale;
                this.scale = scale;

                // XY轴或者Z轴方向移动偏移在一定范围内重新绘制瓦片
                if (isReresh) {
                    this.rereshRenderMap();
                    this.position.copy(camera.position);
                }
            }, 100),
        );

        PubSub.subscribe('cameraMove', (_name, payload: number[][] | CameraMovePayload) =>
            this.cameraMoveToHdMapcenter(payload),
        );
        PubSub.subscribe('fitBaseMap', () => this.fitCurrentMap());
        PubSub.subscribe('baseMapOpacity', (_name, opacity: number) => {
            this.transparency(opacity);
            this.renderer();
        });
        PubSub.subscribe('baseMapPointSize', (_name, pointSize: number) => {
            this.updatePointSize(pointSize);
            this.renderer();
        });
    }

    get Scene(): THREE.Scene {
        return this.scene;
    }

    public addMesh(mesh: THREE.Mesh | THREE.Points, render: boolean = false) {
        this.scene.add(mesh);

        if (render) {
            this.renderer();
        }
    }

    public removeMesh(mesh: THREE.Mesh | THREE.Group | THREE.Line | THREE.Points, render: boolean = false) {
        if (!mesh) {
            return;
        }

        if (mesh instanceof THREE.Group) {
            mesh.children.forEach((item) => {
                if (item instanceof THREE.Mesh) {
                    item.geometry.dispose();
                    item.material.dispose();
                }
                this.scene.remove(item);
            });
            this.scene.remove(mesh);
        } else if (mesh instanceof THREE.Mesh || mesh instanceof THREE.Line || mesh instanceof THREE.Points) {
            mesh.geometry.dispose();
            (mesh.material as THREE.MeshBasicMaterial).dispose();
            this.scene.remove(mesh);
        }

        if (render) {
            this.renderer();
        }
    }

    public transparency(val: number) {
        this.opacity = Math.max(0, Math.min(1, Number(val)));
        const style = layerMaterialStyles[this.activeLayerId] || layerMaterialStyles.enhanced;
        Object.keys(this.meshs).forEach((id: string) => {
            const mesh = this.meshs[id];
            (mesh.material as THREE.MeshBasicMaterial | THREE.PointsMaterial).opacity = this.opacity * style.opacity;
        });
    }

    public updatePointSize(val: number) {
        this.pointSize = Math.max(0.6, Math.min(3, Number(val) || 1.2));
        Object.keys(this.meshs).forEach((id: string) => {
            const mesh = this.meshs[id];
            if (mesh instanceof THREE.Points) {
                const material = mesh.material as THREE.PointsMaterial;
                material.size = this.pointSize;
                material.needsUpdate = true;
            }
        });
    }

    /**
     * 获取地图渲染
     *
     * @param dir 文件夹路径
     */
    public async renderMap(dir: string, json: any, options: any = {}) {
        this.loading = true;
        this.deleteTile();
        this.activeLayerId = json.layerId || options.layerId || 'enhanced';
        if (json.type === 'point_cloud') {
            this.renderPointCloudMap(dir, json);
            return;
        }
        const tiles = json.tiles[this.scale];
        const { points: allPoints, imageBasemapCenter, hdBasemapCenter } = useManagerStore.getState().mapState;
        useManagerStore.getState().setMapState({
            ...useManagerStore.getState().mapState,
            baseMapDir: dir,
            imageBasemapCenter: new THREE.Vector2(json.center.x, json.center.y),
        });
        const inViewTile = this.getInviewTile(tiles, this.position);
        if (inViewTile.length < tiles.length && this.scale > 0) {
            this.scale -= 1;
            this.renderMap(dir, json, options);
            return;
        }
        this.tiles = json.tiles;
        // 换底图的时候或者底图的中心点和标注地图的中心点不一样，记得去更新标注数据的偏移值
        const needOffset =
            Object.keys(allPoints).length !== 0 &&
            (dir !== this.dir ||
                (hdBasemapCenter && !this.isSameVec(imageBasemapCenter, hdBasemapCenter)) ||
                (!hdBasemapCenter && Object.keys(allPoints).length !== 0));
        this.dir = dir;
        // 设置相机适配屏幕大小
        const size = 1024;
        const resolution = this.getResolution();
        const minX = Math.min(...tiles.map((item: TileItem) => item.offset_x));
        const maxX = Math.max(...tiles.map((item: TileItem) => item.offset_x));
        const minY = Math.min(...tiles.map((item: TileItem) => item.offset_y));
        const maxY = Math.max(...tiles.map((item: TileItem) => item.offset_y));
        const points = [
            new THREE.Vector3(minX * size * resolution, minY * size * resolution),
            new THREE.Vector3((maxX + 1) * size * resolution, minY * size * resolution),
            new THREE.Vector3((maxX + 1) * size * resolution, (maxY + 1) * size * resolution),
            new THREE.Vector3(minX * size * resolution, (maxY + 1) * size * resolution),
        ];
        const coor1 = this.utmTransformThree(points[0]);
        const coor3 = this.utmTransformThree(points[2]);
        const width = coor3.x - coor1.x;
        const height = coor3.y - coor1.y;
        this.currentMapExtent = Math.max(width, height, 20);
        if (!options.keepCamera) {
            this.control.adapter(this.currentMapExtent);
        }
        this.position.copy(this.camera.position);
        await this.drawTile(tiles)
            .then(() => {
                this.renderer();
            })
            .catch((err) => {
                console.error(err);
                this.loading = false;
            });
        // 始终以底图的中心点为原点
        if (needOffset) {
            this.allElementsToOffset();
        }
        // 当切换标注地图的时候，不可以回退和重做了
        if (!options.preserveCommands) {
            useManagerStore.getState().resetCommand();
        }
        this.loading = false;
    }

    private renderPointCloudMap(dir: string, json: any) {
        const cloudPoints = Array.isArray(json.points) ? json.points : [];
        if (cloudPoints.length === 0) {
            this.loading = false;
            return;
        }
        const center = json.center || { x: 0, y: 0, z: 0 };
        const { points: allPoints, imageBasemapCenter, hdBasemapCenter } = useManagerStore.getState().mapState;
        useManagerStore.getState().setMapState({
            ...useManagerStore.getState().mapState,
            baseMapDir: dir,
            imageBasemapCenter: new THREE.Vector2(center.x, center.y),
        });
        const needOffset =
            Object.keys(allPoints).length !== 0 &&
            (dir !== this.dir ||
                (hdBasemapCenter && imageBasemapCenter && !this.isSameVec(imageBasemapCenter, hdBasemapCenter)) ||
                (!hdBasemapCenter && Object.keys(allPoints).length !== 0));
        this.dir = dir;
        this.tiles = {};

        const positions = new Float32Array(cloudPoints.length * 3);
        const colors = new Float32Array(cloudPoints.length * 3);
        const bounds = json.bounds || { minZ: 0, maxZ: 0 };
        const zRange = Math.max(0.0001, Number(bounds.maxZ || 0) - Number(bounds.minZ || 0));
        cloudPoints.forEach((point: number[], index: number) => {
            const x = Number(point[0]);
            const y = Number(point[1]);
            const z = Number(point[2] || 0);
            positions[index * 3] = x - center.x;
            positions[index * 3 + 1] = y - center.y;
            positions[index * 3 + 2] = 0;
            const heightWeight = Math.max(0, Math.min(1, (z - Number(bounds.minZ || 0)) / zRange));
            colors[index * 3] = 0.45 + heightWeight * 0.45;
            colors[index * 3 + 1] = 0.65 + heightWeight * 0.3;
            colors[index * 3 + 2] = 0.75 + heightWeight * 0.25;
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: this.pointSize,
            sizeAttenuation: false,
            vertexColors: true,
            transparent: true,
            opacity: this.opacity,
            depthWrite: false,
        });
        const pointCloud = new THREE.Points(geometry, material);
        pointCloud.name = 'tile';
        pointCloud.userData = {
            id: 'point_cloud',
            type: ThreeElementType.Tile,
        };
        pointCloud.renderOrder = 0;
        this.meshs.point_cloud = pointCloud;
        this.addMesh(pointCloud);

        const { bounds: mapBounds } = json;
        if (mapBounds) {
            const width = Number(mapBounds.maxX) - Number(mapBounds.minX);
            const height = Number(mapBounds.maxY) - Number(mapBounds.minY);
            this.currentMapExtent = Math.max(width, height, 20);
            this.control.adapter(this.currentMapExtent);
            this.control.cameraControls.moveTo(0, 0, 0, false);
        }
        this.position.copy(this.camera.position);
        if (needOffset) {
            this.allElementsToOffset();
        }
        useManagerStore.getState().resetCommand();
        this.renderer();
        this.loading = false;
    }

    private isSameVec(vec1: THREE.Vector3 | THREE.Vector2, vec2: THREE.Vector3 | THREE.Vector2) {
        return vec1.x === vec2.x && vec1.y === vec2.y;
    }

    public cameraMoveToHdMapcenter(payload: number[][] | CameraMovePayload) {
        const coordinates = isCameraMovePayload(payload) ? payload.coordinates : payload;
        if (!Array.isArray(coordinates) || coordinates.length < 3) {
            return;
        }
        const padding = isCameraMovePayload(payload) ? payload.padding || {} : {};
        const minExtent = isCameraMovePayload(payload) ? Number(payload.minExtent) || 0 : 0;
        const polygon = turf.polygon([coordinates.concat([coordinates[0]])]);
        const centroid = turf.centroid(polygon);
        const [minX, minY, maxX, maxY] = getPointsBox(coordinates.concat([coordinates[0]]));
        const width = Math.max(0.001, maxX - minX);
        const height = Math.max(0.001, maxY - minY);

        const canvasWidth = Math.max(1, this.render.domElement.clientWidth);
        const canvasHeight = Math.max(1, this.render.domElement.clientHeight);
        const safeLeft = Math.max(0, Number(padding.left) || 0);
        const safeRight = Math.max(0, Number(padding.right) || 0);
        const safeTop = Math.max(0, Number(padding.top) || 0);
        const safeBottom = Math.max(0, Number(padding.bottom) || 0);
        const safeWidth = Math.max(1, canvasWidth - safeLeft - safeRight);
        const safeHeight = Math.max(1, canvasHeight - safeTop - safeBottom);
        const aspect = canvasWidth / canvasHeight;

        const fitHeightForWidth = (width * canvasWidth) / (Math.max(0.001, aspect) * safeWidth);
        const fitHeightForHeight = (height * canvasHeight) / safeHeight;
        const visibleHeight = Math.max(minExtent, fitHeightForWidth, fitHeightForHeight) * 1.15;
        const visibleWidth = visibleHeight * aspect;
        const safeCenterX = safeLeft + safeWidth / 2;
        const safeCenterY = safeTop + safeHeight / 2;
        const offsetPixelX = safeCenterX - canvasWidth / 2;
        const offsetPixelY = safeCenterY - canvasHeight / 2;
        const centerPosition = new THREE.Vector3(centroid.geometry.coordinates[0], centroid.geometry.coordinates[1], 0);
        const targetX = centerPosition.x - (offsetPixelX / canvasWidth) * visibleWidth;
        const targetY = centerPosition.y + (offsetPixelY / canvasHeight) * visibleHeight;

        this.control.adapter(visibleHeight);
        this.control.cameraControls.moveTo(targetX, targetY, centerPosition.z, false);
        this.renderer();
    }

    public fitCurrentMap() {
        if (!this.currentMapExtent) {
            return;
        }
        this.control.adapter(this.currentMapExtent);
        this.control.cameraControls.moveTo(0, 0, 0, false);
        this.renderer();
    }

    /**
     * 渲染器方法
     * 将当前场景和相机渲染到渲染器上
     */
    public renderer() {
        this.render.render(this.scene, this.camera);
    }

    /**
     * 将渲染地图的方法封装成一个私有方法，在调用时进行必要的参数检查。
     */
    private async rereshRenderMap() {
        const { permissionStatus } = useManagerStore.getState().mapState;
        if (typeof this.scale === 'undefined' || Object.keys(this.tiles).length === 0 || this.loading) {
            return;
        }
        this.loading = true;
        // 随着scale的增大，加载瓦片的范围随之减少，即通过指数函数的方式计算加载范围
        const tiles = this.getInviewTile(this.tiles[this.scale], this.position);

        await this.drawTile(tiles)
            .then(() => {
                this.renderer();
            })
            .catch((err) => {
                console.error(err);
                this.loading = false;
            });
        this.loading = false;
    }

    private addTile(size: number, texture: THREE.Texture, position: THREE.Vector3, id: string) {
        const geometry = new THREE.PlaneGeometry(size, size, 1);
        if (texture) {
            const style = layerMaterialStyles[this.activeLayerId] || layerMaterialStyles.enhanced;
            const material = new THREE.MeshBasicMaterial({
                alphaMap: texture,
                transparent: true,
                opacity: this.opacity * style.opacity,
                color: style.color,
            });

            material.depthWrite = false;
            material.needsUpdate = true;

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = 'tile';
            mesh.userData.id = id;
            mesh.userData.type = ThreeElementType.Tile;
            mesh.renderOrder = 0;
            mesh.position.set(position.x, position.y, position.z);

            if (!this.meshs[id]) {
                this.meshs[id] = mesh;
                this.addMesh(mesh);
            }
        }
    }

    private deleteTile() {
        Object.keys(this.meshs).forEach((id: string) => {
            this.removeMesh(this.meshs[id]);
            delete this.meshs[id];
        });
        this.meshs = {};
        this.tiles = {};
        this.scene.children.forEach((item) => {
            if (item.userData.type === ThreeElementType.Tile) {
                console.log(item.userData.id, 'tile id为删除');
            }
        });
    }

    private loadImageTile(url: string, tileSize: number, point: THREE.Vector3, id: string) {
        const coor = this.utmTransformThree(point);
        const loader = new THREE.TextureLoader();

        return new Promise((resolve, reject) => {
            loader.crossOrigin = '';
            loader.load(
                url,
                (texture) => {
                    configureTextureForWebGL1(texture);
                    this.addTile(
                        tileSize,
                        texture,
                        new THREE.Vector3(coor.x + tileSize / 2, coor.y + tileSize / 2, 0),
                        id,
                    );
                    resolve(url);
                },
                null,
                () => {
                    reject(new Error(`加载图片失败：${url}`));
                },
            );
        });
    }

    private async drawTile(tiles: Array<TileItem>) {
        const resolution = this.getResolution();
        const pixel = 1024;
        const promises = tiles.map((item) => {
            const x = item.offset_x;
            const y = item.offset_y;
            const layerPath =
                this.activeLayerId && this.activeLayerId !== 'enhanced'
                    ? `/layers/${encodeURIComponent(this.activeLayerId)}`
                    : '';
            const url = `http://${baseHttpURL}/mapcreator/${this.dir}${layerPath}/${this.scale}/${y}/${x}.png`;
            const point = new THREE.Vector3(parseInt(x, 10) * pixel * resolution, parseInt(y, 10) * pixel * resolution);
            const id = `tile_${this.scale}_${x}_${y}`;
            if (this.meshs[id]) {
                this.meshs[id].visible = true;
                this.renderer();
                return Promise.resolve(true);
            }
            return this.loadImageTile(url, pixel * resolution, point, id);
        });

        // 只需要有一个瓦片加载成功后即可，让后面开始渲染
        await Promise.any(promises);
        Object.keys(this.meshs).forEach((id) => {
            const findItem = tiles.find((item) => `tile_${this.scale}_${item.offset_x}_${item.offset_y}` === id);
            if (!findItem) {
                this.meshs[id].visible = false;
            }
        });
    }

    private getResolution(): number {
        switch (this.scale) {
            case 0:
                return 0.5;
            case 1:
                return 0.25;
            case 2:
                return 0.125;
            case 3:
                return 0.0625;
            case 4:
                return 0.03125;
            default:
                return 0;
        }
    }

    private isInside(centerX: number, centerY: number, radius: number, squarePoints: Array<Array<number>>) {
        for (let i = 0; i < squarePoints.length; i += 1) {
            const point = squarePoints[i];
            const distance = Math.sqrt((point[0] - centerX) ** 2 + (point[1] - centerY) ** 2);

            if (distance > radius) {
                return false; // 正方形顶点中有一个距离大于圆的半径，说明正方形不在圆内
            }
        }

        return true; // 所有顶点的距离都小于或等于圆的半径，说明正方形在圆内
    }

    private utmTransformThree(point: { x: number; y: number; z: number }): THREE.Vector3 {
        const { imageBasemapCenter } = useManagerStore.getState().mapState;
        const x = Number(point.x);
        const y = Number(point.y);
        const pointX = x - imageBasemapCenter.x;
        const pointY = y - imageBasemapCenter.y;
        const pointZ = 0;
        return new THREE.Vector3(pointX, pointY, pointZ);
    }

    private getInviewTile(tiles: any[], position: THREE.Vector3) {
        const pixel = 1024;
        const resolution = this.getResolution();
        const range = 4 * pixel * resolution * Math.exp(-0.1 * this.scale) + 128;
        const result = tiles.filter((item: TileItem) => {
            const coor1 = this.utmTransformThree({
                x: parseInt(item.offset_x, 10) * pixel * resolution,
                y: parseInt(item.offset_y, 10) * pixel * resolution,
                z: 0,
            });
            const coor2 = this.utmTransformThree({
                x: (parseInt(item.offset_x, 10) + 1) * pixel * resolution,
                y: parseInt(item.offset_y, 10) * pixel * resolution,
                z: 0,
            });
            const coor3 = this.utmTransformThree({
                x: (parseInt(item.offset_x, 10) + 1) * pixel * resolution,
                y: (parseInt(item.offset_y, 10) + 1) * pixel * resolution,
                z: 0,
            });
            const coor4 = this.utmTransformThree({
                x: parseInt(item.offset_x, 10) * pixel * resolution,
                y: (parseInt(item.offset_y, 10) + 1) * pixel * resolution,
                z: 0,
            });
            const squarePoints = [
                [coor1.x, coor1.y],
                [coor2.x, coor2.y],
                [coor3.x, coor3.y],
                [coor4.x, coor4.y],
            ];
            const isInside = this.isInside(position.x, position.y, range, squarePoints);

            return this.scale === 0 ? true : isInside;
        });
        return result;
    }

    // 当在有标注数据时切换底图时，需要根据新的底图中心点重新计算标注数据的位置
    private allElementsToOffset() {
        const newState = useManagerStore.getState().mapState;
        const { imageBasemapCenter, hdBasemapCenter } = newState;
        const offset = new THREE.Vector3(0, 0, 0);
        if (!hdBasemapCenter && imageBasemapCenter) {
            return;
        }

        offset.x = (imageBasemapCenter?.x || 0) - (hdBasemapCenter?.x || 0);
        offset.y = (imageBasemapCenter?.y || 0) - (hdBasemapCenter?.y || 0);
        if (offset.x === 0 && offset.y === 0) {
            return;
        }

        Object.keys(newState.points).forEach((pId) => {
            newState.points[pId].position.x -= offset.x;
            newState.points[pId].position.y -= offset.y;
        });
        Object.keys(newState.boundarys).forEach((bId) => {
            newState.needRenderElements[ThreeObject.Boundary][bId] = newState.boundarys[bId].type;
        });
        Object.keys(newState.points).forEach((pId) => {
            newState.needRenderElements[ThreeObject.Point][pId] = newState.points[pId].type;
        });
        Object.keys(newState.grouds).forEach((gId) => {
            newState.needRenderElements[ThreeObject.Groud][gId] = newState.grouds[gId].type;
        });
        Object.keys(newState.trafficSignals).forEach((tId) => {
            newState.needRenderElements[ThreeObject.TrafficLight][tId] = ThreeElementType.TrafficLight;
        });
        Object.keys(newState.prossibleDrivingDirections).forEach((aId) => {
            newState.needRenderElements[ThreeObject.Arrow][aId] = newState.prossibleDrivingDirections[aId].type;
        });
        Object.keys(newState.signs).forEach((sId) => {
            newState.needRenderElements[ThreeObject.Sign][sId] = ThreeElementType.SignIcon;
        });
        useManagerStore.getState().setMapState({
            ...newState,
            hdBasemapCenter: imageBasemapCenter.clone(),
            needRender: true,
        });
    }
}
