import { DragControls } from 'three/examples/jsm/controls/DragControls';
import * as THREE from 'three';
import { DragPointCommand } from 'src/command/PointCommand';
import { deepCloneLineOrMesh, updateObjectsBecausePointsMove } from 'src/utils/geometryUtil';
import { OperationType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import PubSub from 'pubsub-js';
import { isBoundary, isGroud, isPoint, disposeGroup } from 'src/utils/threeObjectUtil';
import { searchControlPointPositionFromBoundaryId, searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { searchGroudPointsAndBoundaryFromGroudId } from 'src/utils/search/groudSearch';
import { DragTrafficeLightCommand } from 'src/command/TrafficLightCommand';
import { contrlPointSearch, objectSearch } from 'src/utils/search/objectSearch';
import { searchTrafficLightByTrafficLightId } from 'src/utils/search/trafficLightSearch';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { searchPointsRelationObjects } from 'src/utils/search/common';
import { UpdateBoundaryCommand } from 'src/command/BoundaryCommand';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { UpdateArrowCommand } from 'src/command/ArrowCommand';
import { mapElementZ } from 'src/constant/mapElementZ';
import {
    dragResizeBarrierGateSize,
    getBarrierGateCurrentWidthAndLength,
} from 'src/handle/barrierGate/updateBarrierGateHandle';
import { searchBarrierGateFromPointId } from 'src/utils/search/barrierGateSearch';
import { UpdateBarrierSizeCommand } from 'src/command/BarrierGateCommand';
import { barrierGateSize } from 'src/components/Attr/constData';
import CameraControl from './cameraControl';

/**
 * 整体拖拽思路：无论拖哪种元素，都将受影响的点，放入group中,然后更新点影响的线、groud的
 * 注意：拖拽了点后，要用点的世界坐标去更新线和groud
 */
export default class DragControl {
    private camera: THREE.PerspectiveCamera;

    private renderer: THREE.WebGL1Renderer | CSS2DRenderer;

    public controls: DragControls;

    private scene: THREE.Scene;

    private group: THREE.Group;

    private cameraControl: CameraControl;

    constructor(
        objects: THREE.Object3D[],
        camera: THREE.PerspectiveCamera,
        renderer: THREE.WebGL1Renderer | CSS2DRenderer,
        scene: THREE.Scene,
        cameraControl: CameraControl,
    ) {
        this.camera = camera;
        this.renderer = renderer;
        this.scene = scene;
        this.controls = new DragControls(objects, camera, renderer.domElement);
        this.controls.getRaycaster().params.Points.threshold = 1;
        this.controls.getRaycaster().params.Line.threshold = 1;
        this.group = new THREE.Group();
        this.group.name = 'dragControlGroup';
        this.cameraControl = cameraControl;
        this.controls.transformGroup = true;
        this.scene.add(this.group);
        this.initEvent();
    }

    /**
     * 初始化事件监听函数
     */
    initEvent() {
        this.controls.addEventListener('dragstart', () => {
            this.cameraControl.disable();
        });
        this.controls.addEventListener('drag', (e: THREE.Event) => {
            const state = useManagerStore.getState().mapState;
            const { operationType, points } = state;
            if (operationType === OperationType.Drawing || operationType === OperationType.Rotating) {
                return;
            }
            const { object } = e;
            if (!object) {
                return;
            }
            if (state.operationType !== OperationType.Draging) {
                const newState = { ...state };
                newState.operationType = OperationType.Draging;
                useManagerStore.getState().setMapState(newState);
            }
            const dragPointIds = object.userData.pointIds;
            if (object.userData.type === ThreeElementType.TrafficLight) {
                const trafficLightMesh = objectSearch(ThreeObject.TrafficLight, object.userData.id);
                const trafficLight = searchTrafficLightByTrafficLightId(object.userData.id);
                if (trafficLightMesh && trafficLight) {
                    const newPosition = trafficLight.center.clone().applyMatrix4(this.group.matrix);
                    trafficLightMesh.position.copy(
                        new THREE.Vector3(newPosition.x, newPosition.y, mapElementZ[ThreeElementType.TrafficLight]),
                    );
                    PubSub.publishSync('dragTrafficLight', trafficLightMesh);
                }
            } else if (object.userData.type === ThreeElementType.CurveControlPoint) {
                const controlPointMesh = contrlPointSearch(
                    ThreeObject.ControlPoint,
                    object.userData.curveId,
                    object.userData.isFirst,
                );
                if (controlPointMesh) {
                    const originControlPointPosition = searchControlPointPositionFromBoundaryId(
                        object.userData.curveId,
                        object.userData.isFirst,
                    );
                    if (originControlPointPosition) {
                        const newPosition = originControlPointPosition.clone().applyMatrix4(this.group.matrix);
                        controlPointMesh.position.copy(newPosition);
                        PubSub.publishSync('dragControlPoint', controlPointMesh);
                    }
                }
            } else if (object.userData.type === ThreeElementType.LaneCurveGroud) {
                updateObjectsBecausePointsMove(dragPointIds);
            } else {
                dragPointIds.forEach((pId: string) => {
                    // mapState中存储的点
                    const point = points[pId];
                    // 三维世界中对应mapState中存储的点的mesh
                    const pointMesh = objectSearch(ThreeObject.Point, pId);
                    if (pointMesh) {
                        pointMesh.matrixWorldNeedsUpdate = true;
                        const position = point.position.clone().applyMatrix4(this.group.matrixWorld);
                        if (object.userData.type === ThreeElementType.BarrierGatePoint) {
                            const { width, length } = getBarrierGateCurrentWidthAndLength(pId, position);
                            if (
                                width > barrierGateSize.maxSize ||
                                width < barrierGateSize.minSize ||
                                length > barrierGateSize.maxSize ||
                                length < barrierGateSize.minSize
                            ) {
                                return;
                            }
                        }
                        pointMesh.position.copy(position);
                    }
                });
                if (object.userData.type === ThreeElementType.BarrierGatePoint) {
                    // 需要根据拖动的点的最新坐标，去计算新的四个点的坐标
                    dragResizeBarrierGateSize(object.userData.id, object);
                }
                updateObjectsBecausePointsMove(dragPointIds);
            }
            this.render();
        });
        this.controls.addEventListener('dragend', (e: THREE.Event) => {
            this.cameraControl.enable();
            if (useManagerStore.getState().mapState.operationType !== OperationType.Draging) {
                return;
            }
            useManagerStore.getState().mapState.operationType = null;
            const { object } = e;
            if (!object) {
                return;
            }
            const pointIds = object.userData.pointIds;
            if (object.userData.type === ThreeElementType.CurveControlPoint) {
                PubSub.publish('dragEndControlPoint');
            } else if (object.userData.type === ThreeElementType.TrafficLight) {
                useManagerStore.getState().addCommand([new DragTrafficeLightCommand(object.userData.id)]);
            } else {
                const actions: any = [];
                // 获取pointId对应的boundary和groud，去更新
                const { boundarys, grouds, arrows } = searchPointsRelationObjects(pointIds);
                pointIds.forEach((pId: string) => {
                    actions.push(new DragPointCommand(pId));
                });
                boundarys.forEach((item) => actions.push(new UpdateBoundaryCommand(item.id)));
                grouds.forEach((item) => actions.push(new UpdateGroudCommand(item.id)));
                arrows.forEach((item) => actions.push(new UpdateArrowCommand(item.id)));
                if (object.userData.type === ThreeElementType.BarrierGatePoint) {
                    const barrierGate = searchBarrierGateFromPointId(pointIds[0]);
                    const boundaryPoints = searchPointsFromBoundaryId(barrierGate.boundaryId);
                    const point1Mesh = objectSearch(ThreeObject.Point, boundaryPoints[0].id);
                    const point2Mesh = objectSearch(ThreeObject.Point, boundaryPoints[1].id);
                    const point3Mesh = objectSearch(ThreeObject.Point, boundaryPoints[2].id);

                    const width = Number(point1Mesh.position.distanceTo(point2Mesh.position).toFixed(2));
                    const length = Number(point2Mesh.position.distanceTo(point3Mesh.position).toFixed(2));
                    actions.push(new UpdateBarrierSizeCommand(barrierGate.id, width, length));
                }
                useManagerStore.getState().addCommand(actions);
            }
            this.render();
        });
        this.controls.addEventListener('hoveron', () => {
            const state = useManagerStore.getState().mapState;
            if (state.operationType === OperationType.SplitLaneInVertical) {
                this.renderer.domElement.className = 'split-cursor';
            }
            if (state.operationType === OperationType.InsertPointToBoundary) {
                this.renderer.domElement.className = 'add-cursor';
            }
        });
        this.controls.addEventListener('hoveroff', () => {
            this.renderer.domElement.classList.remove('split-cursor');
            this.renderer.domElement.style.cursor = 'auto';
        });
        // 根据相机的高度，去调整拾取的精度
        this.cameraControl.cameraControls.addEventListener('update', () => {
            const cameraZ = this.cameraControl.cameraControls.camera.position.z;
            let threshold = 0.5;
            if (cameraZ < 30) {
                threshold = 0.5;
            } else if (cameraZ < 50) {
                threshold = 1;
            } else {
                threshold = 5;
            }
            this.controls.getRaycaster().params.Points.threshold = threshold;
            this.controls.getRaycaster().params.Line.threshold = threshold;
        });
        PubSub.subscribe('resetDragGroup', () => this.resetDragGroup());
        PubSub.subscribe('enableObjectDarg', (_name, object) => this.enableObjectDarg(object));
    }

    dispose() {
        this.controls.deactivate();
        this.controls.dispose();
    }

    render() {
        this.renderer?.render(this.scene, this.camera);
    }

    resetDragGroup() {
        const draggableObjects = this.controls.getObjects();
        draggableObjects.length = 0;
        while (this.group.children.length) {
            disposeGroup(this.group.children[0], this.scene);
        }
        this.group.position.set(0, 0, 0);
        this.group.matrixWorld.setPosition(new THREE.Vector3());
    }

    enableObjectDarg(object: THREE.Object3D) {
        this.resetDragGroup();
        if (!object) {
            return;
        }
        const { type, id } = object.userData;
        const objectClone = deepCloneLineOrMesh(object as THREE.Mesh, { opacity: 0.01 }) as THREE.Mesh;
        // LaneCurveGroud不支持拖拽
        if (
            type === ThreeElementType.LaneCurveGroud ||
            type === ThreeElementType.ParkingSpacePoint ||
            type === ThreeElementType.LaneCurveBoundary ||
            type === ThreeElementType.SignIcon ||
            type === ThreeElementType.BarrierGateBoundary
        ) {
            return;
        }
        // 当拖拽的是弯道的groud时，由于groud也需要更新，所以我们只将点放到groud中，点动了后需要更新groud
        this.group.attach(objectClone);
        this.group.userData = { ...object.userData };
        if (isPoint(type)) {
            this.group.userData = { ...this.group.userData, pointIds: [id], type };
        }
        if (isBoundary(type)) {
            const points = searchPointsFromBoundaryId(id);
            this.group.userData = { ...this.group.userData, pointIds: points.map((item) => item.id), type };
        }
        if (isGroud(type)) {
            const { points } = searchGroudPointsAndBoundaryFromGroudId(id);
            this.group.userData = { ...this.group.userData, pointIds: points.map((item) => item.id), type };
        }
        const draggableObjects = this.controls.getObjects();
        draggableObjects.push(this.group);
    }
}
