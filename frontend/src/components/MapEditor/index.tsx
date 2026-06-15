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
import { message } from 'src/components/Message';
import { Button } from 'src/components/ui/button';
import { Slider } from 'src/components/ui/slider';
import { comparePointsWithPreCheck } from 'src/diff/compareWithPreCheck';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { updateElements } from 'src/diff/updateElement';
import { initialMapState } from 'src/constant/initialMapState';
import { applyEditorLayerVisibility, filterPickElementsByEditorLayers } from 'src/utils/editorLayerUtil';
import _ from 'lodash';
import initThree from '../../threeUtil/initThree';
import CameraControl from '../../threeUtil/cameraControl';
import BaseMap from '../../object/baseMap';
import MapEditorBtn from './MapEditorBtn';
import './index.less';
import BezierCurve3Control from '../../threeUtil/BezierCurve3Control';
import noData from '../../assets/images/no_attr.png';
import noPermission from '../../assets/images/no_permission.png';
import LayerPanel from '../LayerPanel';

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
        opacity: 1,
        pointSize: 1.8,
        supportsPointSize: false,
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
            applyEditorLayerVisibility(mapState);
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
        const subscriptionTokens: string[] = [];
        let baseMapInstance: BaseMap | null = null;
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
            baseMapInstance = baseMap;
            subscriptionTokens.push(
                PubSub.subscribe('renderMap', (_name, data: any) => {
                    if (!data.options?.keepCamera) {
                        baseMap.scale = 4;
                    }
                    setBaseMapUi((prev) => ({
                        ...prev,
                        dir: data.dir,
                        supportsPointSize:
                            data.json?.type === 'point_cloud' || data.json?.sourceType === 'point_cloud_stream',
                    }));
                    setShowRemind(false);
                    baseMap.renderMap(data.dir, data.json, data.options || {}).then(() => {
                        applyEditorLayerVisibility(useManagerStore.getState().mapState);
                        render();
                    });
                }),
                PubSub.subscribe('renderHDMap', (_name, data: any) => {
                    // 当切换标注地图的时候，不可以回退和重做了
                    useManagerStore.getState().resetCommand();
                    try {
                        dataImport(data);
                    } catch (error) {
                        // 防止单个损坏的地图文件让编辑器停留在半加载状态
                        console.error('[renderHDMap] 地图导入失败', error);
                        message({ type: 'error', content: '地图文件解析失败，可能已损坏或格式不兼容，请检查后重试' });
                    }
                }),
                PubSub.subscribe('addObject', (_name, mesh: THREE.Object3D) => {
                    if (mesh) {
                        scene.current?.add(mesh);
                    }
                }),
                PubSub.subscribe('removeObject', (_name, object: THREE.Object3D) => {
                    if (object) {
                        disposeGroup(object, scene.current);
                    }
                }),
                PubSub.subscribe('render', () => {
                    render();
                }),
                PubSub.subscribe('closeRemind', () => {
                    setShowRemind(false);
                }),
            );
        }
        return () => {
            // 卸载时解绑订阅与 baseMap 监听，避免重复挂载（含 React StrictMode）造成事件叠加与泄漏。
            subscriptionTokens.forEach((token) => PubSub.unsubscribe(token));
            baseMapInstance?.dispose();
        };
    }, []);
    useEffect(() => {
        const filteredPickElements = filterPickElementsByEditorLayers(mapState, mapState.currentPickElement);
        if (filteredPickElements.length !== mapState.currentPickElement.length) {
            setMapState({
                ...mapState,
                currentPickElement: filteredPickElements,
                needRender: true,
            });
            return;
        }
        applyEditorLayerVisibility(mapState);
        render();
    }, [mapState.editorLayers]);
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
            pickObjectsControl?.current?.dispose();
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

    const handleOpacityChange = (value: number) => {
        setBaseMapUi((prev) => ({
            ...prev,
            opacity: value,
        }));
        PubSub.publish('baseMapOpacity', value);
    };

    const handlePointSizeChange = (value: number) => {
        setBaseMapUi((prev) => ({
            ...prev,
            pointSize: value,
        }));
        PubSub.publish('baseMapPointSize', value);
    };

    return (
        <div id="map-editor-container" onClick={handleClick} onMouseUp={handleMouseup} onDoubleClick={handleDbclick}>
            <div id="webgl" />
            <MapEditorBtn />
            <LayerPanel />
            {baseMapUi.dir && (
                <div
                    className="basemap-layer-panel"
                    onClick={(event) => event.stopPropagation()}
                    onMouseUp={(event) => event.stopPropagation()}
                >
                    <div className="basemap-layer-header">
                        <div>
                            <div className="basemap-layer-title">底图显示</div>
                            <div className="basemap-layer-subtitle">只影响查看效果，不修改地图数据。</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => PubSub.publish('fitBaseMap')}>
                            回到底图
                        </Button>
                    </div>
                    <div className="basemap-layer-actions">
                        <div className="basemap-control-copy">
                            <span>底图透明度</span>
                            <small>降低透明度可以更清楚地检查标注线。</small>
                        </div>
                        <Slider
                            min={0.35}
                            max={1}
                            step={0.05}
                            value={[baseMapUi.opacity]}
                            onValueChange={(value) => handleOpacityChange(value[0] || 0.35)}
                        />
                        <span className="basemap-control-value">{`${Math.round(baseMapUi.opacity * 100)}%`}</span>
                    </div>
                    <div className={`basemap-layer-actions ${baseMapUi.supportsPointSize ? '' : 'is-disabled'}`}>
                        <div className="basemap-control-copy">
                            <span>点云点大小</span>
                            <small>
                                {baseMapUi.supportsPointSize ? '用于看清稀疏点云。' : 'PNG 瓦片底图暂不支持实时调整。'}
                            </small>
                        </div>
                        <Slider
                            min={0.4}
                            max={8}
                            step={0.1}
                            value={[baseMapUi.pointSize]}
                            disabled={!baseMapUi.supportsPointSize}
                            onValueChange={(value) => handlePointSizeChange(value[0] || 0.6)}
                        />
                        <span className="basemap-control-value">
                            {baseMapUi.supportsPointSize ? baseMapUi.pointSize.toFixed(1) : '固定'}
                        </span>
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
