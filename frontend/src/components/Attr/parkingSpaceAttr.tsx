import React, { useEffect, useState } from 'react';
import { Input } from 'antd';
import { useManagerStore } from 'src/store';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { updateParkingSpaceLength, updateParkingSpaceWidth } from 'src/handle/parkingSpace/updateParkingSpace';
import { searchParkingSpaceByGroudId } from 'src/utils/search/parkingSpaceSearch';

interface ParkingSpaceAttr {
    id: string;
    length: number;
    width: number;
}
export default function Index() {
    const [mapState] = useManagerStore((state) => [state.mapState, state.setMapState]);
    const [lengthErrorShow, setLengthErrorShow] = useState(false);
    const [widthErrorShow, setWidthErrorShow] = useState(false);
    const [attrData, setAttrData] = useState<ParkingSpaceAttr>({ id: null, length: null, width: null });
    const [inputDisable, setInputDisable] = useState(false);

    const checkWidth = (e: any) => {
        const value = e.target.value;
        // 符合要求了之后再更新高度数据
        const isError =
            !/^(([1-9][0-9]*(\.)?[0-9]*)|(0(\.)([0-9]*))|(0))$/.test(`${value}`) ||
            Number(value) < 0.5 ||
            Number(value) > 10.0;
        setAttrData({
            ...attrData,
            width: value,
        });
        setWidthErrorShow(isError);
    };
    const changeWidth = (e: any) => {
        let value = e.target.value;
        const parkingSpaceGroudId =
            mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]?.id;
        const parkingSpace = searchParkingSpaceByGroudId(parkingSpaceGroudId);
        if (!parkingSpace) {
            return;
        }
        if (widthErrorShow) {
            setAttrData({
                ...attrData,
                width: parkingSpace.width,
            });
        } else if (parkingSpace) {
            value = Number(Number(value).toFixed(2));
            setAttrData({
                ...attrData,
                width: value,
            });
            if (value !== parkingSpace.width) {
                updateParkingSpaceWidth(parkingSpace.id, value);
                PubSub.publish('render');
            }
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            setAttrData({
                id: null,
                width: null,
                length: null,
            });
        }
        setWidthErrorShow(false);
    };
    const checkLength = (e: any) => {
        const value = e.target.value;
        // 符合要求了之后再更新高度数据
        const isError =
            !/^(([1-9][0-9]*(\.)?[0-9]*)|(0(\.)([0-9]*))|(0))$/.test(`${value}`) ||
            Number(value) < 0.5 ||
            Number(value) > 10;
        setAttrData({
            ...attrData,
            length: value,
        });
        setLengthErrorShow(isError);
    };
    const changeLength = (e: any) => {
        let value = e.target.value;
        const parkingSpaceGroudId =
            mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]?.id;
        const parkingSpace = searchParkingSpaceByGroudId(parkingSpaceGroudId);
        if (lengthErrorShow) {
            setAttrData({
                ...attrData,
                length: parkingSpace.length,
            });
        } else if (parkingSpace) {
            value = Number(Number(value).toFixed(2));
            setAttrData({
                ...attrData,
                length: value,
            });
            if (value !== parkingSpace.length) {
                updateParkingSpaceLength(parkingSpace.id, value);
                PubSub.publish('render');
            }
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            setAttrData({
                id: null,
                width: null,
                length: null,
            });
        }
        setLengthErrorShow(false);
    };

    useEffect(() => {
        const { drawElementType, currentDrawingElementId } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.ParkingSpace) {
            return;
        }

        // 绘制阶段时不可以修改长和宽
        setInputDisable(!currentDrawingElementId);

        if (currentDrawingElementId) {
            const parkingSpace = mapState.parkingSpaces[currentDrawingElementId];
            if (!parkingSpace) {
                return;
            }
            setAttrData({ id: parkingSpace.id, width: parkingSpace.width, length: parkingSpace.length });
        } else {
            setAttrData({ id: null, width: null, length: null });
        }
    }, [mapState.currentDrawData]);

    useEffect(() => {
        const { currentPickElement } = mapState;
        if (currentPickElement.length === 0 || currentPickElement[0].type !== ThreeElementType.ParkingSpaceGroud) {
            return;
        }
        const parkingSpace = searchParkingSpaceByGroudId(currentPickElement[0].id);
        if (!parkingSpace) {
            return;
        }
        setAttrData({ id: parkingSpace.id, width: parkingSpace.width, length: parkingSpace.length });
    }, [mapState.currentPickElement]);

    return (
        (mapState.currentDrawData.drawElementType === MapElementType.ParkingSpace ||
            mapState.currentPickElement[0]?.type === ThreeElementType.ParkingSpaceGroud) && (
            <div>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`ParkingSpace ${attrData.id || ''}`}</span>
                </div>
                <div className="attr-item">
                    <span className="text">长度：</span>
                    <Input
                        disabled={inputDisable}
                        className="attr-input"
                        suffix="m"
                        style={{ width: 180 }}
                        defaultValue={attrData.length}
                        value={attrData.length}
                        onChange={(e) => checkLength(e)}
                        onBlur={(e) => {
                            changeLength(e);
                            window.getSelection().empty();
                        }}
                    />
                    <br />
                </div>
                {lengthErrorShow && <span className="error-text">请输入0.5-10.0的数字</span>}
                <div className="attr-item">
                    <span className="text">宽度：</span>
                    <Input
                        disabled={inputDisable}
                        className="attr-input"
                        suffix="m"
                        style={{ width: 180 }}
                        defaultValue={attrData.width}
                        value={attrData.width}
                        onChange={(e) => checkWidth(e)}
                        onBlur={(e) => {
                            changeWidth(e);
                            window.getSelection().empty();
                        }}
                    />
                    <br />
                </div>
                {widthErrorShow && <span className="error-text">请输入0.5-10.0的数字</span>}
            </div>
        )
    );
}
