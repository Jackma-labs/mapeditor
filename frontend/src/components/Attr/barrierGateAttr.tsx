import React, { useEffect, useState } from 'react';
import { Select, Input } from 'antd';
import { useManagerStore } from 'src/store';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { BarrierGateAttr, BarrierGateType } from 'src/interface/barrierGateInterFace';
import { searchBarrierGateFromGroudId } from 'src/utils/search/barrierGateSearch';
import { updateBarrierGateSize } from 'src/handle/barrierGate/updateBarrierGateHandle';
import { UpdateBarrierGateTypeCommand } from 'src/command/BarrierGateCommand';
import { barrierGateSize, initBarrierGateAttr } from './constData';

const { minSize, maxSize } = barrierGateSize;
const errorText = `请输入${minSize}-${maxSize}的数字`;
export default function Index() {
    const { mapState, setMapState, addCommand } = useManagerStore.getState();
    const [attrData, setAttrData] = useState<BarrierGateAttr>(null);
    const [lengthErrorShow, setLengthErrorShow] = useState(false);
    const [widthErrorShow, setWidthErrorShow] = useState(false);
    const [heightErrorShow, setHeightErrorShow] = useState(false);

    const changeType = (type: BarrierGateType) => {
        setAttrData({
            ...attrData,
            type,
        });
        const { currentDrawData, currentPickElement } = mapState;
        if (currentDrawData.currentDrawingElementId) {
            mapState.barrierGates[currentDrawData.currentDrawingElementId].type = type;
        } else if (currentPickElement[0]?.id) {
            const groudId = mapState.currentPickElement[0]?.id;
            const linkBarrierGate = searchBarrierGateFromGroudId(groudId);
            if (!linkBarrierGate) {
                return;
            }
            addCommand([new UpdateBarrierGateTypeCommand(linkBarrierGate.id, type)]);
            mapState.needRender = true;
        } else {
            mapState.currentDrawData.barrierGateAttr.type = type;
        }
        mapState.onsave = true;
        setMapState(mapState);
    };

    useEffect(() => {
        const { currentDrawingElementId, drawElementType } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.BarrierGate) {
            return;
        }
        if (currentDrawingElementId) {
            const barrierGate = mapState.barrierGates[currentDrawingElementId];
            if (!barrierGate) {
                return;
            }
            const { type, width, length, height } = barrierGate;
            setAttrData({
                id: currentDrawingElementId,
                type,
                width,
                height,
                length,
            });
        } else {
            setAttrData({
                ...initBarrierGateAttr,
            });
        }
    }, [mapState.currentDrawData]);
    useEffect(() => {
        // 如果是选中阶段
        if (
            mapState.currentPickElement.length === 0 ||
            mapState.currentPickElement[0]?.type !== ThreeElementType.BarrierGateGroud
        ) {
            return;
        }
        const barrierGate = searchBarrierGateFromGroudId(mapState.currentPickElement[0]?.id);
        if (!barrierGate) {
            return;
        }
        setAttrData({
            id: barrierGate.id,
            type: barrierGate.type,
            width: barrierGate.width,
            length: barrierGate.length,
            height: barrierGate.height,
        });
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);
    // 在绘制时，初始化参数
    useEffect(() => {
        if (mapState.currentDrawData.drawElementType === MapElementType.BarrierGate) {
            useManagerStore.getState().setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    barrierGateAttr: { ...initBarrierGateAttr },
                },
            });
        }
    }, [mapState.currentDrawData.drawElementType]);

    const checkSize = (
        e: any,
        maxValue: number,
        minValue: number,
        attrName: string,
        callBack: (error: boolean) => void,
    ) => {
        const value = e.target.value;
        // 符合要求了之后再更新高度数据
        const isError =
            !/^(([1-9][0-9]*(\.)?[0-9]*)|(0(\.)([0-9]*))|(0))$/.test(`${value}`) ||
            Number(value) < minValue ||
            Number(value) > maxValue;
        setAttrData({
            ...attrData,
            [attrName]: value,
        });
        callBack(isError);
    };
    const changeSize = (e: any, attrName: 'length' | 'width' | 'height', isError: boolean) => {
        let value = e.target.value;
        const barrierGateGroudId =
            mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]?.id;
        const barrierGate = searchBarrierGateFromGroudId(barrierGateGroudId);
        if (isError) {
            setAttrData({
                ...attrData,
                [attrName]: barrierGate[attrName],
            });
        } else if (barrierGate) {
            value = Number(Number(value).toFixed(2));
            const newAttrData = {
                ...attrData,
                [attrName]: value,
            };
            setAttrData({
                ...newAttrData,
            });
            if (value !== barrierGate[attrName]) {
                updateBarrierGateSize(barrierGate.id, newAttrData.width, newAttrData.length);
                PubSub.publish('render');
            }
            if (attrName === 'height') {
                barrierGate.height = value;
                useManagerStore.getState().setMapState(mapState);
            }
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            setAttrData({ ...attrData, [attrName]: value });
        }
    };
    return (
        (mapState.currentDrawData.drawElementType === MapElementType.BarrierGate ||
            mapState.currentPickElement[0]?.type === ThreeElementType.BarrierGateGroud) && (
            <>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`BarrierGate ${attrData?.id || ''}`}</span>
                </div>
                <div className="attr-item">
                    <span className="text">类型：</span>
                    <Select
                        value={attrData?.type}
                        style={{ width: 180 }}
                        onChange={(type) => changeType(type)}
                        popupClassName="my-select-popup"
                        options={[
                            { label: 'Rod', value: BarrierGateType.Rod },
                            { label: 'Advertising', value: BarrierGateType.Advertising },
                            { label: 'Fence', value: BarrierGateType.Fence },
                            { label: 'Telescopic', value: BarrierGateType.Telescopic },
                            { label: 'Other', value: BarrierGateType.Other },
                        ]}
                    />
                </div>

                <div className="attr-item">
                    <span className="text">width：</span>
                    <Input
                        className="attr-input"
                        suffix="m"
                        style={{ width: 180 }}
                        defaultValue={attrData?.width}
                        value={attrData?.width}
                        onChange={(e) => checkSize(e, maxSize, minSize, 'width', setWidthErrorShow)}
                        onBlur={(e) => {
                            changeSize(e, 'width', widthErrorShow);
                            setWidthErrorShow(false);
                            window.getSelection().empty();
                        }}
                    />
                    <br />
                </div>
                {widthErrorShow && <span className="error-text">{errorText}</span>}
                <div className="attr-item">
                    <span className="text">length：</span>
                    <Input
                        className="attr-input"
                        suffix="m"
                        style={{ width: 180 }}
                        defaultValue={attrData?.length}
                        value={attrData?.length}
                        onChange={(e) => checkSize(e, maxSize, minSize, 'length', setLengthErrorShow)}
                        onBlur={(e) => {
                            changeSize(e, 'length', lengthErrorShow);
                            setLengthErrorShow(false);
                            window.getSelection().empty();
                        }}
                    />
                    <br />
                </div>
                {lengthErrorShow && <span className="error-text">{errorText}</span>}
                <div className="attr-item">
                    <span className="text">heigh：</span>
                    <Input
                        className="attr-input"
                        suffix="m"
                        style={{ width: 180 }}
                        defaultValue={attrData?.height}
                        value={attrData?.height}
                        onChange={(e) => checkSize(e, maxSize, minSize, 'height', setHeightErrorShow)}
                        onBlur={(e) => {
                            changeSize(e, 'height', heightErrorShow);
                            setHeightErrorShow(false);
                            window.getSelection().empty();
                        }}
                    />
                    <br />
                </div>
                {heightErrorShow && <span className="error-text">{errorText}</span>}
            </>
        )
    );
}
