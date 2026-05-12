import React, { useEffect, useRef, useState } from 'react';
import { Input, Select, Button, Modal } from 'antd';
import { LeftCircleOutlined, RightCircleOutlined } from '@ant-design/icons';
import { TrafficSignal, TrafficSubSignal, TrafficSubSignalType, Type } from 'src/interface/trafficSignal';
import { useManagerStore } from 'src/store';
import { MapElementType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import PubSub from 'pubsub-js';
import { searchTrafficLightByTrafficLightId } from 'src/utils/search/trafficLightSearch';
import { vector3TransTpVector2 } from 'src/utils/vectorUtil';
import { ChangeTrafficLightTypeCommand } from 'src/command/TrafficLightCommand';
import { baseHttpURL } from '../../config';
import { clone } from '../../utils/common';
import { trafficSubSignalTypes, trafficSignalTypes, initTrafficLightAttr } from './constData';
import CloseIcon from '../../assets/images/ic_close.svg';
import FileService from '../../service';
import { message as messageFunc } from '../Message/index';

function TrafficLightType(props: {
    type: Type;
    size: number;
    active: boolean;
    attrData: TrafficSignal;
    subSignals: TrafficSubSignal[];
    changeAttrData: (data: TrafficSignal) => void;
}) {
    const { type, size, active, attrData, subSignals, changeAttrData } = props;
    const changeTrafficType = (value: Type) => {
        changeAttrData({
            ...attrData,
            subSignals,
            type: value,
        });
        const { mapState, setMapState, addCommand } = useManagerStore.getState();
        mapState.onsave = true;
        const { currentDrawData, currentPickElement } = mapState;
        if (currentDrawData.currentDrawingElementId) {
            const trafficSignal = mapState.trafficSignals[currentDrawData.currentDrawingElementId];
            if (!trafficSignal) {
                return;
            }
            trafficSignal.type = value;
            trafficSignal.subSignals = subSignals;
            mapState.trafficSignals[currentDrawData.currentDrawingElementId].type = value;
            setMapState(mapState);
        } else if (currentPickElement[0]?.id) {
            if (!mapState.trafficSignals[currentPickElement[0].id]) {
                return;
            }
            const trafficSignal = mapState.trafficSignals[mapState.currentPickElement[0].id];
            if (!trafficSignal) {
                return;
            }
            addCommand([new ChangeTrafficLightTypeCommand(currentPickElement[0].id, value, subSignals)]);
        }

        // 已经绘制了，则更改当前绘制元素数据
        if (mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]) {
            const id = mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement[0]?.id;
            const trafficSignal =
                mapState.trafficSignals[mapState.currentDrawData.currentDrawingElementId] ||
                mapState.trafficSignals[mapState.currentPickElement[0]?.id];
            trafficSignal.type = value;
            trafficSignal.subSignals = subSignals;
            mapState.needRender = true;
            mapState.needRenderElements[ThreeObject.TrafficLight][id] = ThreeElementType.TrafficLight;
            setMapState({ ...mapState });
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            const trafficLightAttr = mapState.currentDrawData.trafficLightAttr;
            trafficLightAttr.type = value;
            trafficLightAttr.subSignals = subSignals;
            setMapState({ ...mapState });
        }
        changeAttrData({
            ...attrData,
            subSignals,
            type: value,
        });
    };
    return (
        <div
            onClick={() => changeTrafficType(type)}
            className={`diaplay-item-btn ${active ? 'active' : ''}`}
            style={{
                flexDirection: type === Type.MIX_3_VERTICAL || type === Type.MIX_2_VERTICAL ? 'column' : 'row',
            }}
        >
            {Array.from(Array(size), (item) => (
                <div key={`${item}${Math.random()}`} className="circle" />
            ))}
        </div>
    );
}

function dropdownRender(props: {
    attrData: TrafficSignal;
    changeAttrData: (data: TrafficSignal) => void;
    subsignalIndex: number;
}) {
    const { changeAttrData, attrData, subsignalIndex } = props;
    const changeSubSignalType = (value: TrafficSubSignalType) => {
        // 如果是绘制阶段
        const { mapState, setMapState } = useManagerStore.getState();
        // 已经绘制了，则更改当前绘制元素数据
        if (mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]) {
            const trafficSignal =
                mapState.trafficSignals[mapState.currentDrawData.currentDrawingElementId] ||
                mapState.trafficSignals[mapState.currentPickElement[0]?.id];
            trafficSignal.subSignals.splice(subsignalIndex, 1, {
                id: attrData.subSignals[subsignalIndex].id,
                type: value,
            });
            setMapState({ ...mapState });
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            const trafficLightAttr = mapState.currentDrawData.trafficLightAttr;
            trafficLightAttr.subSignals.splice(subsignalIndex, 1, {
                id: attrData.subSignals[subsignalIndex].id,
                type: value,
            });
            setMapState({ ...mapState });
        }
        attrData.subSignals.splice(subsignalIndex, 1, {
            id: attrData.subSignals[subsignalIndex].id,
            type: value,
        });
        changeAttrData({ ...attrData });
    };
    return (
        <>
            {trafficSubSignalTypes.map((item) => (
                <div key={item.value} className="my-select-option-item" onClick={() => changeSubSignalType(item.value)}>
                    <img src={item.iconUrl} alt="img" />
                    <span>{item.label}</span>
                </div>
            ))}
        </>
    );
}

function TrafficImageModel(props: { images: { url: string }[]; visible: boolean; close: () => void }) {
    const { images, visible, close } = props;
    const [currentIndex, setCurrentIndex] = useState(0);
    useEffect(() => {
        setCurrentIndex(0);
    }, [props.visible]);
    return (
        <Modal
            destroyOnClose
            closeIcon={<img src={CloseIcon} alt="close" />}
            width="756px"
            className="traffic-image-modal"
            open={visible}
            footer={null}
            onCancel={close}
            closable
        >
            <div className="traffic-image-modal-container">
                <LeftCircleOutlined
                    style={{
                        color: currentIndex === 0 ? '#383D47' : '#808B9D',
                        fontSize: '32px',
                        cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
                    }}
                    onClick={() => currentIndex !== 0 && setCurrentIndex(currentIndex - 1)}
                />
                <img src={images[currentIndex]?.url} key={images[currentIndex]?.url} alt="" />
                <RightCircleOutlined
                    style={{
                        color: currentIndex === images.length - 1 ? '#383D47' : '#808B9D',
                        fontSize: '32px',
                        cursor: currentIndex === images.length - 1 ? 'not-allowed' : 'pointer',
                    }}
                    onClick={() => currentIndex !== images.length - 1 && setCurrentIndex(currentIndex + 1)}
                />
            </div>
        </Modal>
    );
}
export default function Index() {
    const [mapState, setMapState] = useManagerStore((state) => [state.mapState, state.setMapState]);
    const [errorShow, setErrorShow] = useState(false);
    const [attrData, setAttrData] = useState<TrafficSignal>(clone(initTrafficLightAttr));
    const [requestImgLoading, setRequestImgLoading] = useState(false);
    const [images, setImages] = useState<{ url: string }[]>([]);
    const [imageVisble, setImageVisible] = useState(false);
    const timer = useRef(null);

    const toDestroy = () => {
        setRequestImgLoading(false);
        setImages([]);
        setImageVisible(false);
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    };

    const loadImg = async () => {
        // if (images.length !== 0) {
        //     setImageVisible(true);
        //     return;
        // }
        setRequestImgLoading(true);

        let initHdData: any = useManagerStore.getState().export();
        initHdData = {
            ...initHdData,
            trafficSignal: initHdData.trafficSignal?.filter((item: TrafficSignal) => item.id === attrData.id) || [],
        };
        console.log(initHdData);
        const data = await FileService.getSignalProjectImage(mapState.imageBasemapCenter, initHdData);
        setRequestImgLoading(false);
        if (data?.info?.code === 0 && data?.info?.data?.projDir && data?.info?.data?.projDir.length !== 0) {
            setImages(
                data.info.data.projDir.map((item: string) => ({
                    url: `http://${baseHttpURL}/mapcreator/${mapState.baseMapDir}/${item}/proj.png?${Date.now()}`,
                })),
            );
            setImageVisible(true);
        } else if (data?.info?.data?.projDir && data?.info?.data?.projDir.length === 0) {
            messageFunc(
                {
                    type: 'success',
                    content: '没有找到图片资源',
                },
                100,
            );
        } else if (data?.info?.code !== 0) {
            setImageVisible(false);
            messageFunc(
                {
                    type: 'error',
                    content: data?.info?.message || '请求失败',
                },
                100,
            );
        }
    };
    const changeAttrData = (data: TrafficSignal) => {
        setAttrData(data);
    };
    const checkTrafficLightHeight = (e: any) => {
        const value = e.target.value;
        // 符合要求了之后再更新高度数据
        const isError =
            !/^(([1-9][0-9]*(\.)?[0-9]*)|(0(\.)([0-9]*))|(0))$/.test(`${value}`) ||
            Number(value) > 10 ||
            Number(value) < 0;
        setErrorShow(isError);
        setAttrData({
            ...attrData,
            height: value,
        });
    };
    const changeTrafficLightHeight = (e: any) => {
        let value = e.target.value;
        const trafficLightId = mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]?.id;
        const trafficLight = searchTrafficLightByTrafficLightId(trafficLightId);
        if (errorShow) {
            setAttrData({
                ...attrData,
                height: trafficLight?.height || 5,
            });
            setErrorShow(false);
            return;
        }
        if (trafficLight) {
            value = Number(Number(value).toFixed(2));
            setAttrData({
                ...attrData,
                height: value,
            });
            if (value !== mapState.trafficSignals[trafficLightId].height) {
                mapState.trafficSignals[trafficLightId].height = value;
                setMapState(mapState);
            }
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            setAttrData({
                ...attrData,
                height: 5,
            });
        }
        setErrorShow(false);
    };

    useEffect(() => {
        const { currentDrawingElementId, drawElementType } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.TrafficSignal) {
            return;
        }
        if (currentDrawingElementId) {
            const trafficLight = mapState.trafficSignals[currentDrawingElementId];
            if (!trafficLight) {
                return;
            }
            setAttrData(clone(trafficLight));
        } else {
            setAttrData(clone(initTrafficLightAttr));
        }
    }, [mapState.currentDrawData]);

    useEffect(() => {
        toDestroy();
        const { currentPickElement } = mapState;
        if (currentPickElement.length === 0 || currentPickElement[0].type !== ThreeElementType.TrafficLight) {
            return;
        }
        const trafficLight = mapState.trafficSignals[currentPickElement[0].id];
        if (!trafficLight) {
            return;
        }
        setAttrData(clone(trafficLight));
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);

    useEffect(() => {
        if (mapState.currentDrawData.drawElementType === MapElementType.TrafficSignal) {
            useManagerStore.getState().setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    trafficLightAttr: clone(initTrafficLightAttr),
                },
            });
        }
    }, [mapState.currentDrawData.drawElementType]);

    useEffect(() => {
        PubSub.subscribe('dragTrafficLight', (_name, object) => {
            const trafficLightId = (object as THREE.Mesh).userData.id;
            const trafficLight = searchTrafficLightByTrafficLightId(trafficLightId);
            const curAttrData = trafficLight ? clone(trafficLight) : attrData;
            setAttrData({
                ...curAttrData,
                center: vector3TransTpVector2(object.position),
            });
        });
    }, []);
    return (
        (mapState.currentDrawData.drawElementType === MapElementType.TrafficSignal ||
            mapState.currentPickElement[0]?.type === ThreeElementType.TrafficLight) && (
            <div>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`TrafficLight ${attrData.id || ''}`}</span>
                </div>
                <div className="attr-item">
                    <span className="text">灯杆高度：</span>
                    <Input
                        className="attr-input"
                        suffix="m"
                        style={{ width: 180 }}
                        defaultValue={attrData.height}
                        value={attrData.height}
                        onChange={(e) => checkTrafficLightHeight(e)}
                        onBlur={(e) => {
                            changeTrafficLightHeight(e);
                            window.getSelection().empty();
                        }}
                    />
                    <br />
                </div>
                {errorShow && <span className="error-text">请输入0.0-10.0的数字</span>}
                <div className="horizontal-line" />
                <div className="traffic-display-title">布局和类型</div>
                <div className="traffic-display-contant">
                    {trafficSignalTypes.map((item) => (
                        <TrafficLightType
                            attrData={attrData}
                            changeAttrData={changeAttrData}
                            type={item.type}
                            size={item.size}
                            subSignals={item.subSignals}
                            key={item.type}
                            active={item.type === attrData.type}
                        />
                    ))}
                </div>
                {attrData.subSignals.map((item, index) => (
                    <div key={`${item.id}`} className="subsignal-container">
                        <span className="subsignal-title">灯</span>
                        <span className="subsignal-title">{index + 1}</span>
                        <span className="subsignal-title">：</span>
                        <Select
                            value={item.type}
                            defaultValue={TrafficSubSignalType.CIRCLE}
                            popupClassName="my-select-popup"
                            style={{ width: 180 }}
                            options={trafficSubSignalTypes}
                            dropdownRender={() => dropdownRender({ attrData, changeAttrData, subsignalIndex: index })}
                        />
                    </div>
                ))}
                <div className="horizontal-line" />
                <div className="attr-item">
                    <span className="text">关联停止线：</span>
                    {attrData?.stopLineId || '-'}
                </div>
                <div className="horizontal-line" />
                <div className="attr-item" style={{ marginTop: 0 }}>
                    <span className="text">中心点坐标：</span>
                    {`(x：${attrData.center?.x?.toFixed(2) || '-'}，y： ${attrData.center?.y?.toFixed(2) || '-'})`}
                </div>
                <div className="horizontal-line" />
                <div className="attr-item" style={{ marginLeft: '96px' }}>
                    <Button type="primary" loading={requestImgLoading} onClick={loadImg}>
                        对照标记图像
                    </Button>
                </div>
                <TrafficImageModel images={images} visible={imageVisble} close={() => setImageVisible(false)} />
            </div>
        )
    );
}
