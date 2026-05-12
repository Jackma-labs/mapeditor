import { disposeMesh, getPickupObject, isSameObject } from 'src/utils/threeObjectUtil';
import PubSub from 'pubsub-js';
import { useManagerStore } from 'src/store';
import {
    HandleObjectType,
    elementInteraction,
    getCanInteractiveObject,
    objectIsActive,
} from 'src/handle/interactive/Interaction';
import { InterActiveType, MapElementType, OperationType, ThreeElementType } from 'src/interface/commonInterFace';
import { transScreenPositionToWorld, vector2TransTpVector3 } from 'src/utils/vectorUtil';
import { addPointHoverHandle } from 'src/handle/point/appPointHandle';
import { addLaneMousemoveHandle, getDrawLanePromptData } from 'src/handle/lane/addLaneHandle';
import { addCrosswalkMousemoveHandle, getDrawCrosswalkPromptData } from 'src/handle/corsswalk/addCrosswalkClickHandle';
import { addSpeedBumpMousemoveHandle, getDrawSpeedBumpPromptData } from 'src/handle/speedbump/addSpeedBumpHandle';
import { addStopLineMousemoveHandle, getDrawStopLinePromptData } from 'src/handle/stopLine/addStopLineHandle';
import { addParkingSpaceMousemoveHandle, getDrawParkingSpacePromptData } from 'src/handle/parkingSpace/addParkingSpace';
import { searchJunctionFromGroudId } from 'src/utils/search/junctionSearch';
import { searchCrosswalkByGroudId } from 'src/utils/search/crosswalkSearch';
import { searchSpeedBumpFromGroudId } from 'src/utils/search/speedBumpSearch';
import { searchStopLineFromBoundaryId } from 'src/utils/search/stopLineSearch';
import { searchParkingSpaceByGroudId } from 'src/utils/search/parkingSpaceSearch';
import { searchLaneFromGroudId } from 'src/utils/search/laneSearch';
import { addStraightLineMousemoveHandle, getDrawStraightLinePromptData } from 'src/handle/boundary/addBoundaryHandle';
import { mapElementZ } from 'src/constant/mapElementZ';
import { drawLine } from 'src/object/basicObject';
import { laneBoundaryColor } from 'src/constant/color';
import { SignType } from 'src/interface/SignInterFace';
import { addPolygonMousemoveHandle, getDrawPolygonPromptData } from 'src/handle/polygon/addPolygon';
import { searchAreaFromGroudId } from 'src/utils/search/areaSearch';
import { searchBarrierGateFromGroudId } from 'src/utils/search/barrierGateSearch';

export class MouseMoveControl {
    private mouseMoveGrouds: THREE.Mesh[];

    private mouseMoveLines: THREE.Line[];

    private mousePoints: THREE.Mesh[];

    private hoverElement: THREE.Object3D;

    private dom: HTMLElement;

    private camera: THREE.PerspectiveCamera;

    private scene: THREE.Scene;

    constructor(dom: HTMLElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
        this.mouseMoveGrouds = [];
        this.mouseMoveLines = [];
        this.mousePoints = [];
        this.dom = dom;
        this.camera = camera;
        this.scene = scene;
        const promoteMsgNode = document.createElement('div');
        promoteMsgNode.id = 'prompt-container';
        this.dom.appendChild(promoteMsgNode);
        this.initEvent();
    }

    mousemoveHandle(e: MouseEvent) {
        this.dom.classList.remove('add-cursor');
        const state = useManagerStore.getState().mapState;
        const { operationType, currentDrawData, points, currentPickElement, ranging } = state;
        if (ranging) {
            this.dom.className = 'ranging-cursor';
        } else {
            this.dom.classList.remove('ranging-cursor');
        }
        if (operationType === OperationType.Draging) {
            this.hidePromoteMsg();
            return;
        }
        // @ts-ignore
        if (e.target.className === 'lane-handle-btn') {
            return;
        }
        this.updatePromoteNode(e);
        if (operationType === OperationType.SplitLaneInVertical) {
            if (points.start) {
                this.removeMouseMoveElements();
                const curWorldPosition = transScreenPositionToWorld(e);
                const { line } =
                    drawLine(
                        [points.start.position, vector2TransTpVector3(curWorldPosition)],
                        laneBoundaryColor[InterActiveType.Default],
                    ) || {};
                this.addMouseMoveLine(line);
                PubSub.publish('render');
            }
            return;
        }
        // 如果hover的是旋转手柄，则改变手柄的颜色
        const rotateObject = getPickupObject(
            e,
            this.camera,
            this.dom,
            this.scene,
            getCanInteractiveObject(HandleObjectType.Rotate),
        );
        if (rotateObject) {
            PubSub.publish('setRotateElementsInteractive', { type: InterActiveType.Hover, object: rotateObject });
            PubSub.publish('render');
            return;
        }
        // 延长lane和添加lane的图标hover
        const object = getPickupObject(e, this.camera, this.dom, this.scene, [
            ThreeElementType.ExtendLaneSvg,
            ThreeElementType.ExtendBoundarySvg,
            ThreeElementType.AddLaneSvg,
            ThreeElementType.CopyParkingSpaceSvg,
        ]);

        if (object) {
            PubSub.publishSync('changeAddSvgColor', { sprite: object, type: InterActiveType.Active });
            PubSub.publish('render');
            return;
        }
        PubSub.publish('resetSvgGroupsDefault');
        if (!currentDrawData.drawElementType) {
            const hoverMapElement = getPickupObject(
                e,
                this.camera,
                this.dom,
                this.scene,
                getCanInteractiveObject(HandleObjectType.MapElement),
            );
            if (!hoverMapElement) {
                if (this.hoverElement && !objectIsActive(this.hoverElement)) {
                    elementInteraction(this.hoverElement, InterActiveType.Default);
                }
                this.removeMouseMoveElements();
                this.hoverElement = null;
                PubSub.publish('render');
                return;
            }
            // 添加点操作，去处理添加点hover事件
            if (operationType === OperationType.InsertPointToBoundary) {
                if (
                    (hoverMapElement?.userData.type === ThreeElementType.LaneBoundary ||
                        hoverMapElement?.userData.type === ThreeElementType.RoadBoundary) &&
                    hoverMapElement?.userData.id === currentPickElement[0]?.id
                ) {
                    addPointHoverHandle(e, this.dom);
                    this.dom.className = 'add-cursor';
                } else {
                    this.removeMouseMoveElements();
                }
            }

            if (
                this.hoverElement &&
                !isSameObject(this.hoverElement, hoverMapElement) &&
                !objectIsActive(this.hoverElement)
            ) {
                elementInteraction(this.hoverElement, InterActiveType.Default);
            }
            if (!objectIsActive(hoverMapElement)) {
                elementInteraction(hoverMapElement, InterActiveType.Hover);
                this.hoverElement = hoverMapElement;
            }
        } else {
            this.drawMouseMovePreviewMesh(e);
        }
        PubSub.publish('render');
    }

    initEvent() {
        PubSub.subscribe('removeMouseMoveElements', () => {
            this.removeMouseMoveElements();
        });
        PubSub.subscribe('addMouseMoveGroud', (_name, groud: THREE.Mesh) => {
            this.addMouseMoveGroud(groud);
        });
        PubSub.subscribe('addMouseMoveLine', (_name, line: THREE.Line) => {
            this.addMouseMoveLine(line);
        });
        PubSub.subscribe('addMouseMovePoint', (_name, point: THREE.Mesh) => {
            this.addMouseMovePoint(point);
        });
        PubSub.subscribe('resetHoverElement', () => {
            this.resetHoverElement();
        });
        this.dom.addEventListener('mousemove', (e) => this.mousemoveHandle(e));
    }

    public removeMouseMoveElements() {
        [...this.mouseMoveGrouds, ...this.mouseMoveLines, ...this.mousePoints].forEach((item) => {
            disposeMesh(item, useManagerStore.getState().mapState.scene);
        });
        this.mouseMoveGrouds = [];
        this.mouseMoveLines = [];
        this.mousePoints = [];
    }

    public addMouseMoveGroud(groud: THREE.Mesh) {
        this.mouseMoveGrouds.push(groud);
        useManagerStore.getState().mapState.scene.add(groud);
    }

    public addMouseMoveLine(line: THREE.Line) {
        this.mouseMoveLines.push(line);
        useManagerStore.getState().mapState.scene.add(line);
    }

    public addMouseMovePoint(point: THREE.Mesh) {
        this.mousePoints.push(point);
        useManagerStore.getState().mapState.scene.add(point);
    }

    /**
     * 将hover元素重置为默认状态
     */
    public resetHoverElement() {
        elementInteraction(this.hoverElement, InterActiveType.Default);
        this.hoverElement = null;
    }

    public drawMouseMovePreviewMesh(e: MouseEvent) {
        const { currentDrawData } = useManagerStore.getState().mapState;
        const { drawElementType } = currentDrawData;
        const worldVector = transScreenPositionToWorld(e);
        if (drawElementType === MapElementType.StraightLine || drawElementType === MapElementType.RoadBoundary) {
            addStraightLineMousemoveHandle(worldVector);
        } else if (drawElementType === MapElementType.Lane && currentDrawData.currentDrawingElementId) {
            addLaneMousemoveHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.LanePoint]));
        } else if (
            (drawElementType === MapElementType.Junction || drawElementType === MapElementType.Area) &&
            currentDrawData.currentDrawingElementId
        ) {
            addPolygonMousemoveHandle(worldVector, drawElementType);
        } else if (drawElementType === MapElementType.Crosswalk && currentDrawData.currentDrawingElementId) {
            addCrosswalkMousemoveHandle(
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.CrosswalkPoint]),
            );
        } else if (drawElementType === MapElementType.SpeedBump && currentDrawData.currentDrawingElementId) {
            addSpeedBumpMousemoveHandle(
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.SpeedBumpPoint]),
            );
        } else if (
            (drawElementType === MapElementType.StopLine ||
                drawElementType === MapElementType.TrafficSignal ||
                drawElementType === MapElementType.Sign ||
                drawElementType === MapElementType.BarrierGate) &&
            currentDrawData.currentDrawingElementId
        ) {
            addStopLineMousemoveHandle(vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.StopLinePoint]));
        } else if (drawElementType === MapElementType.ParkingSpace) {
            addParkingSpaceMousemoveHandle(
                vector2TransTpVector3(worldVector, mapElementZ[ThreeElementType.ParkingSpacePoint]),
            );
        } else if (drawElementType === MapElementType.StopLine) {
            // addStopLineMousemoveHandle(worldVector);
        }
    }

    /**
     * 处理鼠标移动过程中的提示信息
     */
    private updatePromoteNode(e: MouseEvent) {
        const state = useManagerStore.getState().mapState;
        let promptData = {
            text: '',
            left: -10,
            top: -10,
        };
        if (state.operationType === OperationType.Drawing) {
            promptData = this.getPromptData(e, this.dom, this.camera, this.scene);
        } else if (state.operationType === OperationType.SplitLaneInVertical) {
            promptData = this.getSplitLaneIncenterPromptData(e, this.dom);
        } else {
            promptData = this.getHoverElementPromptData(e, this.camera, this.dom, this.scene);
        }
        const promoteMsgNode = document.getElementById('prompt-container');
        promoteMsgNode.innerHTML = promptData.text;
        promoteMsgNode.style.left = `${promptData.left}px`;
        promoteMsgNode.style.top = `${promptData.top}px`;
    }

    private hidePromoteMsg() {
        const promoteMsgNode = document.getElementById('prompt-container');
        promoteMsgNode.innerHTML = '';
        promoteMsgNode.style.left = '-10px';
        promoteMsgNode.style.top = '-10px';
    }

    private getHoverElementPromptData(
        e: MouseEvent,
        camera: THREE.PerspectiveCamera,
        dom: HTMLElement,
        scene: THREE.Scene,
    ) {
        const result = {
            text: '',
            left: -10,
            top: -10,
        };
        // @ts-ignore
        if (e.target.className.indexOf('lane-handle-btn') !== -1) {
            return result;
        }
        const object = getPickupObject(e, camera, dom, scene, getCanInteractiveObject(HandleObjectType.Promote));
        const rect = dom.getBoundingClientRect();
        const state = useManagerStore.getState().mapState;
        if (object) {
            const { type, id } = object.userData;
            if (type === ThreeElementType.LaneGroud || type === ThreeElementType.LaneCurveGroud) {
                const linkLane = searchLaneFromGroudId(id);
                result.text = `Lane ${linkLane?.id}`;
            } else if (type === ThreeElementType.JunctionGroud) {
                const linkJunction = searchJunctionFromGroudId(id);
                result.text = `Junction ${linkJunction?.id}`;
            } else if (type === ThreeElementType.AreaGroud) {
                const linkArea = searchAreaFromGroudId(id);
                result.text = `Area ${linkArea?.id}`;
            } else if (type === ThreeElementType.BarrierGateGroud) {
                const linkBarrierGate = searchBarrierGateFromGroudId(id);
                result.text = `BarrierGate ${linkBarrierGate?.id}`;
            } else if (type === ThreeElementType.CrosswalkGroud) {
                const linkCrosswalk = searchCrosswalkByGroudId(id);
                result.text = `Crosswalk ${linkCrosswalk?.id}`;
            } else if (type === ThreeElementType.SpeedBumpGroud) {
                const linkSpeedBump = searchSpeedBumpFromGroudId(id);
                result.text = `SpeedBump ${linkSpeedBump?.id}`;
            } else if (type === ThreeElementType.StopLineBoundary) {
                const linkStopLine = searchStopLineFromBoundaryId(id);
                result.text = `StopLine ${linkStopLine?.id}`;
            } else if (type === ThreeElementType.TrafficLight) {
                result.text = `TrafficLight ${id}`;
            } else if (type === ThreeElementType.ParkingSpaceGroud) {
                const linkParkingSpace = searchParkingSpaceByGroudId(id);
                result.text = `ParkingSpace ${linkParkingSpace.id}`;
            } else if (type === ThreeElementType.SignIcon) {
                const signType = object.userData.signType;
                result.text = `${signType === SignType.StopSign ? 'stopSign' : 'yieldSign'} ${id}`;
            } else if (type === ThreeElementType.LaneBoundary || type === ThreeElementType.LaneCurveBoundary) {
                result.text = `lane boundary ${id}`;
            } else if (type === ThreeElementType.RoadBoundary) {
                result.text = `Road boundary ${id}`;
            }
            result.left = e.clientX - rect.left + 10;
            result.top = e.clientY - rect.top + 10;
            if (type === ThreeElementType.LaneGroud && state.operationType === OperationType.SplitLaneInVertical) {
                result.left += 20;
            }
        }
        return result;

        useManagerStore.getState().setMapState(state);
    }

    private getPromptData(e: MouseEvent, dom: HTMLElement, camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
        const state = useManagerStore.getState().mapState;
        const drawElementType = state.currentDrawData.drawElementType;
        let data = null;
        if (drawElementType === MapElementType.Lane) {
            data = getDrawLanePromptData(e, dom);
        } else if (drawElementType === MapElementType.Junction || drawElementType === MapElementType.Area) {
            data = getDrawPolygonPromptData(e, dom, camera, scene);
        } else if (drawElementType === MapElementType.Crosswalk) {
            data = getDrawCrosswalkPromptData(e, dom);
        } else if (drawElementType === MapElementType.SpeedBump) {
            data = getDrawSpeedBumpPromptData(e, dom);
        } else if (
            drawElementType === MapElementType.StopLine ||
            drawElementType === MapElementType.TrafficSignal ||
            drawElementType === MapElementType.Sign ||
            drawElementType === MapElementType.BarrierGate
        ) {
            data = getDrawStopLinePromptData(e, dom);
        } else if (drawElementType === MapElementType.ParkingSpace) {
            data = getDrawParkingSpacePromptData(e, dom);
        } else if (drawElementType === MapElementType.StraightLine || drawElementType === MapElementType.RoadBoundary) {
            data = getDrawStraightLinePromptData(e, dom, camera, scene);
        } else {
            data = {
                text: '',
                left: -10,
                top: -10,
            };
        }

        return data;
    }

    private getSplitLaneIncenterPromptData(e: MouseEvent, dom: HTMLElement) {
        const result = {
            text: '',
            left: -10,
            top: -10,
        };
        const state = useManagerStore.getState().mapState;
        const { points, operationType } = state;
        if (operationType !== OperationType.SplitLaneInVertical) {
            return result;
        }
        const rect = dom.getBoundingClientRect();
        result.left = e.clientX - rect.left + 10;
        result.top = e.clientY - rect.top + 10;

        if (!points.start) {
            result.text = '单击确定拆分线起点';
        } else {
            result.text = '单击确定拆分线终点';
        }
        return result;
    }

    public dispose() {
        this.dom.removeEventListener('mousemove', this.mousemoveHandle);
    }
}
