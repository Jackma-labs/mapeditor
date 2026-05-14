import * as THREE from 'three';
import React, { useEffect, useRef, useState } from 'react';
import PubSub from 'pubsub-js';
import DragControl from 'src/threeUtil/dragControl';
import RotateControl from 'src/threeUtil/RotateControl';
import { clickHandle } from 'src/handle/interactive/clickHandle';
import { deleteHandle } from 'src/handle/deleteHandle';
import { escKeyHandle } from 'src/handle/escKeyHandle';
import { isMac } from 'src/utils/common';
import { useManagerStore } from 'src/store';
import AddIconControl from 'src/threeUtil/AddIconControl';
import { MouseMoveControl } from 'src/threeUtil/MouseMoveControl';
import { MapElementType, OperationType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { disposeGroup } from 'src/utils/threeObjectUtil';
import { findElementByIdAndType } from 'src/utils/search/common';
import { objectSearch } from 'src/utils/search/objectSearch';
import { addIconUpdate } from 'src/threeUtil/AddIconControl/util';
import { rotateElementsUpdate } from 'src/threeUtil/RotateControl/util';
import { PickObjectsControl } from 'src/threeUtil/PickObjectsControl';
import RangingControl from 'src/threeUtil/ RangingControl';
import RecoverDataRemind from 'src/components/RecoverDataRemind';
import { comparePointsWithPreCheck } from 'src/diff/compareWithPreCheck';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { updateElements } from 'src/diff/updateElement';
import { initialMapState } from 'src/constant/initialMapState';
import FileService from 'src/service/index';
import _ from 'lodash';
import initThree from '../../threeUtil/initThree';
import CameraControl from '../../threeUtil/cameraControl';
import BaseMap from '../../object/baseMap';
import MapEditorBtn from './MapEditorBtn';
import './index.less';
import BezierCurve3Control from '../../threeUtil/BezierCurve3Control';
import noData from '../../assets/images/no_attr.png';
import noPermission from '../../assets/images/no_permission.png';

const layerDisplayName: { [key: string]: string } = {
    enhanced: '增强',
    raw: '原始',
    ground: '地面',
    marking: '标线',
    edge: '边界',
    structure: '立物',
};

export default function MapEditor() {
    const [mapState, setMapState, undo, redo, dataImport] = useManagerStore((state) => [
        state.mapState,
        state.setMapState,
        state.undo,
        state.redo,
        state.import,
    ]);
    // registed 防止useEffect二次调用
    const registed = useRef(false);
    const dom = useRef<HTMLElement>(null);
    const scene = useRef<THREE.Scene>(null);
    const renderer = useRef<THREE.WebGL1Renderer>(null);
    const labelRender = useRef<CSS2DRenderer>(null);
    const camera = useRef<THREE.PerspectiveCamera>(null);
    const cameraControl = useRef<CameraControl>(null);
    const dragControl = useRef<DragControl>(null);
    const rotateControl = useRef<RotateControl>(null);
    const bezierCurve3Control = useRef<BezierCurve3Control>(null);
    const pickObjectsControl = useRef<PickObjectsControl>(null);
    const addIconControl = useRef<AddIconControl>(null);
    const mouseMoveControl = useRef<MouseMoveControl>(null);
    const rangingControl = useRef<RangingControl>(null);
    const timer = useRef(new Date().getTime());
    const setTimer = useRef(null);
    const destroyRequestAnimationHandle = useRef(null);
    const oldMapState = useRef(initialMapState);
    const [showRemind, setShowRemind] = useState(true);
    const [baseMapUi, setBaseMapUi] = useState({
        dir: '',
        layers: [] as any[],
        activeLayerId: 'enhanced',
        opacity: 1,
    });
    const render = () => {
        renderer.current?.render(scene.current, camera.current);
        labelRender.current?.render(scene.current, camera.current);
    };

    const visibilitychangeHandle = () => {
        if (document.hidden) {
            useManagerStore.getState().setMapState({
                ...useManagerStore.getState().mapState,
                holdCtrl: false,
                holdShift: false,
            });
            mouseMoveControl.current?.removeMouseMoveElements();
            render();
        }
    };
    const keydownHandle = (e: KeyboardEvent) => {
        useManagerStore.getState().setMapState({
            ...useManagerStore.getState().mapState,
            holdCtrl: e.ctrlKey && e.key !== 'Z',
            holdShift: e.shiftKey,
            operationType:
                e.ctrlKey &&
                e.key !== 'Z' &&
                (useManagerStore.getState().mapState.currentPickElement[0]?.type === ThreeElementType.LaneBoundary ||
                    useManagerStore.getState().mapState.currentPickElement[0]?.type === ThreeElementType.RoadBoundary)
                    ? OperationType.InsertPointToBoundary
                    : useManagerStore.getState().mapState.operationType,
        });
        // 撤销上一步
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyZ') {
            redo();
            mouseMoveControl.current?.removeMouseMoveElements();
            render();
        }
        if (e.ctrlKey && e.code === 'KeyZ' && !e.shiftKey) {
            undo();
            mouseMoveControl.current?.removeMouseMoveElements();
            render();
        }
        // 删除要素
        if (e.code === 'Delete') {
            deleteHandle();
            render();
        }
        if (isMac() && e.code === 'Backspace') {
            // @ts-ignore
            const className = window.getSelection()?.focusNode?.className;
            if (
                className?.indexOf('attr-input') > -1 ||
                className?.indexOf('ant-form-item-control-input-content') > -1
            ) {
                return;
            }
            deleteHandle();
            render();
        }
        if (e.code === 'Escape' || e.code === 'Enter') {
            // 如果在选中中，按esc键不生效，只有旋转结束后才可以退出旋转模式
            if (rotateControl.current?.rotating) {
                return;
            }
            escKeyHandle();
        }
        if (e.altKey && useManagerStore.getState().mapState.operationType !== OperationType.Drawing) {
            cameraControl.current?.enableRotate();
        }
    };
    const contextmenuHandle = (e: any) => {
        e.preventDefault();
    };
    const keyupHandle = () => {
        if (cameraControl.current?.canRotate) {
            cameraControl.current?.disableRotate();
        }
        useManagerStore.getState().setMapState({
            ...useManagerStore.getState().mapState,
            holdCtrl: false,
            holdShift: false,
            operationType:
                useManagerStore.getState().mapState.operationType === OperationType.InsertPointToBoundary
                    ? null
                    : useManagerStore.getState().mapState.operationType,
        });
        mouseMoveControl.current?.removeMouseMoveElements();
        render();
    };
    // 获取权限状态
    // useEffect(() => {
    //     if (
    //         mapState.permissionStatus === PermissionStatus.NoPermission ||
    //         mapState.permissionStatus === PermissionStatus.Expired
    //     ) {
    //         setShowRemind(false);
    //     }
    // }, [mapState.permissionStatus]);
    // 元素旋转绘制交互操作
    useEffect(() => {
        if (mapState.needRender) {
            updateElements();
            render();
            setMapState({
                ...mapState,
                needRender: false,
                needRenderElements: {
                    [ThreeObject.Point]: {},
                    [ThreeObject.Boundary]: {},
                    [ThreeObject.Groud]: {},
                    [ThreeObject.Arrow]: {},
                    [ThreeObject.TrafficLight]: {},
                    [ThreeObject.ControlPoint]: {},
                    [ThreeObject.Sign]: {},
                },
            });
            pickObjectsControl.current?.updatePickObjects();
            if (mapState.operationType === OperationType.Rotating) {
                rotateElementsUpdate();
            }
        }
    }, [mapState]);
    // 初始化操作
    useEffect(() => {
        if (!renderer.current) {
            // 初始化three相关的元素
            dom.current = document.getElementById('webgl');
            const {
                scene: initedScene,
                renderer: initedRenderer,
                camera: initedCamera,
                control: initedControl,
                dragControl: initedDragControl,
                rotateControl: initedRotateControl,
                bezierCurve3Control: initedBezierCurve3Control,
                labelRenderer: initLabelRenderer,
                destroyRequestAnimationFrame,
            } = initThree(dom.current);

            scene.current = initedScene;
            renderer.current = initedRenderer;
            labelRender.current = initLabelRenderer;
            camera.current = initedCamera;
            cameraControl.current = initedControl;
            dragControl.current = initedDragControl;
            rotateControl.current = initedRotateControl;
            destroyRequestAnimationHandle.current = destroyRequestAnimationFrame;
            addIconControl.current = new AddIconControl(renderer.current.domElement, cameraControl.current);
            mouseMoveControl.current = new MouseMoveControl(dom.current, scene.current, camera.current);
            pickObjectsControl.current = new PickObjectsControl();
            bezierCurve3Control.current = initedBezierCurve3Control;
            rangingControl.current = new RangingControl(dom.current);

            setMapState({
                ...mapState,
                scene: initedScene,
                camera: initedCamera,
                renderer: initedRenderer,
                dom: dom.current,
            });

            // 监听一些事件
            const baseMap = new BaseMap(renderer.current, scene.current, camera.current, cameraControl.current);
            PubSub.subscribe('renderMap', (_name, data: any) => {
                if (!data.options?.keepCamera) {
                    baseMap.scale = 4;
                }
                const layers = Array.isArray(data.json?.layers) ? data.json.layers : [];
                setBaseMapUi((prev) => ({
                    ...prev,
                    dir: data.dir,
                    layers,
                    activeLayerId: data.json?.layerId || data.layerId || 'enhanced',
                }));
                setShowRemind(false);
                baseMap.renderMap(data.dir, data.json, data.options || {});
            });
            PubSub.subscribe('renderHDMap', (_name, data: any) => {
                // 当切换标注地图的时候，不可以回退和重做了
                useManagerStore.getState().resetCommand();
                dataImport(data);
            });
            PubSub.subscribe('addObject', (_name, mesh: THREE.Object3D) => {
                scene.current?.add(mesh);
            });
            PubSub.subscribe('removeObject', (_name, object: THREE.Object3D) => {
                disposeGroup(object, scene.current);
            });
            PubSub.subscribe('render', () => {
                render();
            });
            PubSub.subscribe('closeRemind', () => {
                setShowRemind(false);
            });
        }
    }, []);
    // 监听键盘交互
    useEffect(() => {
        if (!registed.current) {
            registed.current = true;
            dom.current?.addEventListener('contextmenu', contextmenuHandle);
            window.addEventListener('keydown', keydownHandle);
            window.addEventListener('keyup', keyupHandle);
            document.addEventListener('visibilitychange', visibilitychangeHandle);
        }
        return () => {
            if (dom.current) {
                dom.current.removeEventListener('contextmenu', contextmenuHandle);
                document.removeEventListener('visibilitychange', visibilitychangeHandle);
            }
            window.removeEventListener('keydown', keydownHandle);
            window.removeEventListener('keyup', keyupHandle);
            // 清除定时器
            clearTimeout(setTimer.current);
            destroyRequestAnimationHandle.current?.();
            cameraControl.current?.dispose();
            dragControl?.current?.dispose();
            mouseMoveControl?.current?.dispose();
            rangingControl?.current?.dispose();
            rotateControl?.current?.dispose();
        };
    }, []);

    // 选中后设置为可拖拽元素
    useEffect(() => {
        const { currentPickElement } = mapState;
        if (currentPickElement && currentPickElement.length !== 0) {
            const activeobject = findElementByIdAndType(currentPickElement[0]);
            if (!activeobject) {
                return;
            }
            const activeMesh = objectSearch(currentPickElement[0].threeObject, activeobject.id);
            if (activeMesh) {
                dragControl?.current.enableObjectDarg(activeMesh);
            }
        } else {
            dragControl?.current?.resetDragGroup();
        }
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);

    // useEffect(() => {
    //     addIconUpdate();
    //     render();
    // }, [mapState.currentPickElement, mapState.currentPickElement.length, mapState.operationType, mapState.points]);

    useEffect(() => {
        const renderAddIcon = () => {
            addIconUpdate();
            render();
        };

        const preCheckFn = () => {
            if (
                oldMapState.current.currentPickElement !== mapState.currentPickElement ||
                oldMapState.current.operationType !== mapState.operationType
            ) {
                return false;
            }
            return true;
        };

        const comparePointsResult = comparePointsWithPreCheck(oldMapState.current.points, mapState.points, preCheckFn);

        if (!comparePointsResult) {
            renderAddIcon();
            oldMapState.current = { ...mapState, points: _.cloneDeep(mapState.points) };
        }
    }, [mapState]);

    useEffect(() => {
        const { operationType, ranging } = mapState;
        if (operationType === OperationType.Drawing) {
            if (ranging) {
                useManagerStore.getState().setMapState({
                    ...useManagerStore.getState().mapState,
                    ranging: false,
                });
            }
        }
        if (mapState.operationType && operationType !== OperationType.Draging && dragControl.current) {
            dragControl.current.controls.enabled = false;
        } else if (dragControl.current) {
            dragControl.current.controls.enabled = true;
        }
        rotateControl.current?.resetRotateStatus();
        rotateElementsUpdate();
    }, [mapState.operationType]);

    const handleClick = (e: React.MouseEvent) => {
        const curTime = new Date().getTime();
        const { currentDrawData, operationType } = useManagerStore.getState().mapState;
        if (setTimer.current) {
            clearTimeout(setTimer.current);
        }
        if (
            currentDrawData.drawElementType === MapElementType.TrafficSignal ||
            currentDrawData.drawElementType === MapElementType.SpeedBump ||
            currentDrawData.drawElementType === MapElementType.Crosswalk ||
            currentDrawData.drawElementType === MapElementType.ParkingSpace ||
            currentDrawData.drawElementType === MapElementType.Sign
        ) {
            setTimer.current = setTimeout(() => {
                clickHandle(e, dom.current, camera.current, scene.current);
                render();
            }, 250);
        } else {
            if (curTime - timer.current < 400) {
                return;
            }
            timer.current = curTime;
            clickHandle(e, dom.current, camera.current, scene.current);
            render();
        }
    };
    const handleMouseup = (e: React.MouseEvent) => {
        // 这里主要是当按住ctrl键时，click事件不触发，点击时触发的是mouseup
        if (useManagerStore.getState().mapState.holdCtrl) {
            clickHandle(e, dom.current, camera.current, scene.current);
            render();
        }
        cameraControl.current.cameraControls.enabled = true;
        document.getElementById('webgl').getElementsByTagName('canvas')[0].style.cursor = 'pointer';
    };

    const handleDbclick = () => {
        if (setTimer.current) {
            clearTimeout(setTimer.current);
        }
        escKeyHandle(true);
        render();
    };

    const handleLayerChange = async (layerId: string) => {
        if (!baseMapUi.dir || layerId === baseMapUi.activeLayerId) {
            return;
        }
        const response = await FileService.getBaseMapInfo(baseMapUi.dir, layerId);
        if (!response || response.code) {
            return;
        }
        PubSub.publish('renderMap', {
            dir: baseMapUi.dir,
            json: response,
            layerId,
            options: {
                keepCamera: true,
                preserveCommands: true,
            },
        });
    };

    const handleOpacityChange = (value: number) => {
        setBaseMapUi((prev) => ({
            ...prev,
            opacity: value,
        }));
        PubSub.publish('baseMapOpacity', value);
    };

    return (
        <div id="map-editor-container" onClick={handleClick} onMouseUp={handleMouseup} onDoubleClick={handleDbclick}>
            <div id="webgl" />
            <MapEditorBtn />
            {baseMapUi.layers.length > 1 && (
                <div
                    className="basemap-layer-panel"
                    onClick={(event) => event.stopPropagation()}
                    onMouseUp={(event) => event.stopPropagation()}
                >
                    <div className="basemap-layer-buttons">
                        {baseMapUi.layers.map((layer) => (
                            <button
                                key={layer.id}
                                type="button"
                                className={layer.id === baseMapUi.activeLayerId ? 'active' : ''}
                                onClick={() => handleLayerChange(layer.id)}
                            >
                                {layerDisplayName[layer.id] || layer.name || layer.id}
                            </button>
                        ))}
                    </div>
                    <div className="basemap-layer-actions">
                        <input
                            type="range"
                            min="0.35"
                            max="1"
                            step="0.05"
                            value={baseMapUi.opacity}
                            onChange={(event) => handleOpacityChange(Number(event.target.value))}
                        />
                        <button type="button" onClick={() => PubSub.publish('fitBaseMap')}>
                            居中
                        </button>
                    </div>
                </div>
            )}
            {showRemind && (
                <div className="text-remind">
                    <img src={noData} alt="" className="no-data-img" />
                    <div className="no-data-txt">选中工具后绘制内容</div>
                </div>
            )}
            {/*{(mapState.permissionStatus === PermissionStatus.NoPermission ||*/}
            {/*    mapState.permissionStatus === PermissionStatus.Expired) && (*/}
            {/*    <div className="text-remind" style={{ marginTop: '-25px' }}>*/}
            {/*        <img*/}
            {/*            src={noPermission}*/}
            {/*            alt=""*/}
            {/*            className="no-data-img"*/}
            {/*            style={{ width: '160px', height: '100px' }}*/}
            {/*        />*/}
            {/*        <div className="no-data-txt">*/}
            {/*            {mapState.permissionStatus === PermissionStatus.NoPermission ? '服务未开通!' : '服务已到期'}*/}
            {/*        </div>*/}
            {/*        <div*/}
            {/*            className="remind-btn"*/}
            {/*            onClick={() => window.open(`${process.env.ACCOUNT_APPLY_URL}`, '', 'fullscreen=1')}*/}
            {/*        >*/}
            {/*            申请服务*/}
            {/*        </div>*/}
            {/*    </div>*/}
            {/*)}*/}
            <RecoverDataRemind />
        </div>
    );
}
