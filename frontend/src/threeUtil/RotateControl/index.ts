import PubSub from 'pubsub-js';
import { InterActiveType, OperationType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { disposeGroup, getPickupObject, isBoundary, isGroud } from 'src/utils/threeObjectUtil';
import { getAngleFromV1ToV2, transScreenPositionToWorld } from 'src/utils/vectorUtil';
import * as THREE from 'three';
import { useManagerStore } from 'src/store';
import { RotateTrafficLightCommand } from 'src/command/TrafficLightCommand';
import { searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchGroudPointsAndBoundaryFromGroudId } from 'src/utils/search/groudSearch';
import { updateObjectsBecausePointsMove } from 'src/utils/geometryUtil';
import { DragPointCommand } from 'src/command/PointCommand';
import { SetOperationTypeCommand } from 'src/command/OperationTypeCommand';
import { generateRotateHandleCanvasTexture } from 'src/utils/textureUtil';
import { PointElement } from 'src/interface/basicElementInterFace';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchTrafficLightByTrafficLightId } from 'src/utils/search/trafficLightSearch';
import { drawRotateElements, updateRotateElements } from 'src/object/rotateElements';
import { searchPointsRelationObjects } from 'src/utils/search/common';
import { UpdateBoundaryCommand } from 'src/command/BoundaryCommand';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { UpdateArrowCommand } from 'src/command/ArrowCommand';
import CameraControl from '../cameraControl';
import { getPointPositionAfterRotation } from './util';

export default class RotateControl {
    private camera: THREE.PerspectiveCamera;

    private renderer: THREE.WebGL1Renderer;

    private scene: THREE.Scene;

    private beforeMousePosition: THREE.Vector2;

    public rotateStartBasePointGroup: THREE.Sprite; // 第一个旋转基点

    public rotateEndBasePointGroup: THREE.Sprite; // 第二个旋转基点

    public rotateStartHandleGroup: THREE.Sprite; // 第一个旋转手柄

    public rotateEndHandleGroup: THREE.Sprite; // 第二个旋转手柄

    private currentRotateHandle: THREE.Sprite; // 当前操作的手柄

    public rotating: boolean; // 旋转状态

    private cameraControl: CameraControl;

    private rotateObjectInfo: { id: string; type: ThreeElementType; points: PointElement[] };

    private rotateBasePosition: THREE.Vector3;

    /**
     * @param {THREE.PerspectiveCamera} camera - The camera object of threejs.
     * @param {THREE.WebGL1Renderer} renderer - The WebGL renderer object of threejs.
     * @param {THREE.Scene} scene - The ThreeJS scene object.
     */
    constructor(
        camera: THREE.PerspectiveCamera,
        renderer: THREE.WebGL1Renderer,
        scene: THREE.Scene,
        cameraControl: CameraControl,
    ) {
        this.camera = camera;
        this.renderer = renderer;
        this.scene = scene;
        this.cameraControl = cameraControl;
        this.rotating = false;
        this.initEvent();
    }

    mousedownHandle(e: MouseEvent) {
        const state = useManagerStore.getState().mapState;
        if (
            state.operationType !== OperationType.Rotating ||
            !state.currentPickElement ||
            state.currentPickElement.length === 0
        ) {
            return;
        }
        // 选中旋转手柄
        const pickObject = getPickupObject(e, this.camera, this.renderer.domElement, this.scene, [
            ThreeElementType.RotateHandle,
        ]) as THREE.Sprite;
        if (!pickObject) {
            return;
        }
        this.currentRotateHandle = pickObject;
        // 记录选中的旋转手柄的旋转基点center
        this.rotateBasePosition = pickObject.userData.rotateBasePosition;
        this.changeRotateHandleColor(pickObject, InterActiveType.Active);
        // 记录鼠标的旋转起始点的世界坐标，记为p1
        this.beforeMousePosition = transScreenPositionToWorld(e);
        // 记录旋转对象的所有点
        this.rotateObjectInfo = this.getRotateObjectInfo();
        this.cameraControl.disable();
    }

    mousemoveHandle(e: MouseEvent) {
        const state = useManagerStore.getState().mapState;
        const { currentPickElement } = state;
        if (
            !this.beforeMousePosition ||
            !this.rotateBasePosition ||
            !currentPickElement ||
            currentPickElement.length === 0 ||
            state.operationType !== OperationType.Rotating ||
            !this.currentRotateHandle
        ) {
            return;
        }
        this.rotating = true;
        const { type } = currentPickElement[0];
        // 记录鼠标的旋转过程点的世界坐标，记为p2
        const currentMousePosition = transScreenPositionToWorld(e);
        // 记录center到p1的向量v1
        const v1 = new THREE.Vector3(
            this.beforeMousePosition.x - this.rotateBasePosition.x,
            this.beforeMousePosition.y - this.rotateBasePosition.y,
        );
        // 记录center到p2的向量v2
        const v2 = new THREE.Vector3(
            currentMousePosition.x - this.rotateBasePosition.x,
            currentMousePosition.y - this.rotateBasePosition.y,
        );
        // 计算v1和v2的夹角，即绕旋转基点的旋转角度
        const angle = getAngleFromV1ToV2(v1, v2);
        if (this.rotateObjectInfo?.points) {
            this.rotateObjectInfo.points.forEach((point) => {
                // 更新旋转对象的所有点
                const newPointPosition = getPointPositionAfterRotation(point.position, angle, this.rotateBasePosition);
                // 更新旋转对象mesh的位置
                const pointMesh = objectSearch(ThreeObject.Point, point.id);
                pointMesh.position.copy(newPointPosition);
            });
            if (type !== ThreeElementType.TrafficLight) {
                updateObjectsBecausePointsMove(this.rotateObjectInfo.points.map((point) => point.id));
            } else {
                const trafficLight = searchTrafficLightByTrafficLightId(this.rotateObjectInfo.id);
                const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, this.rotateObjectInfo.id);
                if (!trafficLightMesh || !trafficLight) {
                    return;
                }
                trafficLightMesh.rotation.z = trafficLight.heading + angle;
            }
        }
        this.drawOrUpdateRotateElements();
        this.render();
    }

    mouseupHandle() {
        this.cameraControl.enable();
        const state = useManagerStore.getState().mapState;
        const { currentPickElement, operationType } = state;
        if (
            !this.rotating ||
            !currentPickElement ||
            currentPickElement.length === 0 ||
            operationType !== OperationType.Rotating
        ) {
            this.resetRotateStatus();
            return;
        }
        this.changeRotateHandleColor(this.currentRotateHandle, InterActiveType.Default);
        const { id, type } = currentPickElement[0];
        const pointIds = this.rotateObjectInfo?.points.map((point) => point.id) || [];
        if (type === ThreeElementType.TrafficLight) {
            useManagerStore.getState().addCommand([new RotateTrafficLightCommand(id)]);
        } else {
            const actions: any = [];
            const { boundarys, grouds, arrows } = searchPointsRelationObjects(pointIds);
            // 下发指令更新拖拽点的位置
            pointIds.forEach((pId: string) => {
                actions.push(new DragPointCommand(pId));
            });
            // 下发指令更新线、面、箭头
            boundarys.forEach((item) => actions.push(new UpdateBoundaryCommand(item.id)));
            grouds.forEach((item) => actions.push(new UpdateGroudCommand(item.id)));
            arrows.forEach((item) => actions.push(new UpdateArrowCommand(item.id)));
            useManagerStore.getState().addCommand(actions);
        }
        this.resetRotateStatus();
        this.render();
    }

    dblclickHandle() {
        if (useManagerStore.getState().mapState.operationType !== OperationType.Rotating) {
            return;
        }
        this.disableRotate();
    }

    /**
     * 初始化事件处理函数
     */
    initEvent() {
        this.renderer.domElement.addEventListener('mousedown', (e) => this.mousedownHandle(e));

        this.renderer.domElement.addEventListener('mousemove', (e) => this.mousemoveHandle(e));

        this.renderer.domElement.addEventListener('mouseup', () => this.mouseupHandle());

        // 结束旋转
        this.renderer.domElement.addEventListener('dblclick', () => this.dblclickHandle());
        this.cameraControl.cameraControls.addEventListener('update', () => {
            if (useManagerStore.getState().mapState.operationType !== OperationType.Rotating) {
                return;
            }
            this.drawOrUpdateRotateElements();
        });

        PubSub.subscribe('enableObjectRotate', () => {
            this.enableObjectRotate();
        });
        PubSub.subscribe('disableRotate', () => {
            this.disableRotate();
        });
        PubSub.subscribe('drawOrUpdateRotateElements', () => {
            this.drawOrUpdateRotateElements();
        });
        PubSub.subscribe('setRotateElementsInteractive', (_name, info) => {
            this.setRotateElementsInteractive(info.type, info.object);
        });
        PubSub.subscribe('removeRotateElements', () => {
            this.removeRotateElements();
        });
    }

    dispose() {
        this.renderer.domElement.removeEventListener('mousedown', this.mousedownHandle);
        this.renderer.domElement.removeEventListener('mousemove', this.mousemoveHandle);
        this.renderer.domElement.removeEventListener('mouseup', this.mouseupHandle);
        this.renderer.domElement.removeEventListener('dblclick', this.dblclickHandle);
    }

    /**
     * @description 启用旋转功能
     */
    drawOrUpdateRotateElements() {
        const { scene } = useManagerStore.getState().mapState;
        if (this.rotateStartBasePointGroup) {
            updateRotateElements([
                this.rotateStartBasePointGroup,
                this.rotateEndBasePointGroup,
                this.rotateStartHandleGroup,
                this.rotateEndHandleGroup,
            ]);
        } else {
            const elements = drawRotateElements();
            this.rotateStartBasePointGroup = elements[0];
            this.rotateEndBasePointGroup = elements[1];
            this.rotateStartHandleGroup = elements[2];
            this.rotateEndHandleGroup = elements[3];
            elements.forEach((item) => {
                scene.add(item);
            });
        }
        this.render();
    }

    enableObjectRotate() {
        const { addCommand } = useManagerStore.getState();
        addCommand([new SetOperationTypeCommand(OperationType.Rotating)]);
    }

    getRotateObjectInfo() {
        const { currentPickElement } = useManagerStore.getState().mapState;
        const { id, type } = currentPickElement[0];
        if (!id || !type) {
            return null;
        }
        if (isGroud(type)) {
            const { points } = searchGroudPointsAndBoundaryFromGroudId(id);
            return { id, type, points };
        }
        if (isBoundary(type) && (type === ThreeElementType.LaneBoundary || type === ThreeElementType.RoadBoundary)) {
            const points = searchPointsFromBoundaryId(id);
            return { id, type, points };
        }
        if (type === ThreeElementType.TrafficLight) {
            return { id, type, points: [] };
        }
        return null;
    }

    removeRotateElements() {
        if (!this.rotateStartBasePointGroup) {
            return;
        }
        const state = useManagerStore.getState().mapState;

        disposeGroup(this.rotateStartBasePointGroup, state.scene);
        disposeGroup(this.rotateEndBasePointGroup, state.scene);
        disposeGroup(this.rotateStartHandleGroup, state.scene);
        disposeGroup(this.rotateEndHandleGroup, state.scene);
        this.rotateStartBasePointGroup = null;
        this.rotateEndBasePointGroup = null;
        this.rotateStartHandleGroup = null;
        this.rotateEndHandleGroup = null;
        this.render();
    }

    resetRotateStatus() {
        this.beforeMousePosition = null;
        this.rotateBasePosition = null;
        this.rotateObjectInfo = null;
        this.rotating = false;
    }

    setRotateElementsInteractive(type: InterActiveType, object: THREE.Sprite) {
        [this.rotateStartHandleGroup, this.rotateEndHandleGroup].forEach((item) => {
            this.changeRotateHandleColor(item, InterActiveType.Default);
        });
        this.changeRotateHandleColor(object, type);
    }

    disableRotate() {
        useManagerStore.getState().addCommand([new SetOperationTypeCommand(null)]);
    }

    render() {
        this.renderer?.render(this.scene, this.camera);
    }

    changeRotateHandleColor(sprite: THREE.Sprite, type: InterActiveType) {
        if (!sprite || !type) {
            return;
        }
        const originRotate = sprite.material.rotation;
        sprite.material.map = generateRotateHandleCanvasTexture(sprite.userData.start, type);
        sprite.material.map.center.set(0.5, 0.5);
        sprite.material.rotation = originRotate;
        sprite.material.needsUpdate = true;
        sprite.material.map.colorSpace = 'srgb';
    }
}
