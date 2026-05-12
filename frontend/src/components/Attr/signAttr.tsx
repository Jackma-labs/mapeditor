import React, { useEffect, useState } from 'react';
import { Select } from 'antd';
import { SignType } from 'src/interface/SignInterFace';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchSignBySignId } from 'src/utils/search/signSearch';
import { ChangeSignTypeCommand } from 'src/command/SignCommand';

interface AttrData {
    id: string;
    stopLineId: string;
    type: SignType;
}

export default function Index() {
    const { mapState, setMapState, addCommand } = useManagerStore.getState();
    const [attrData, setAttrData] = useState<AttrData>(null);

    useEffect(() => {
        const { currentDrawingElementId, drawElementType } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.Sign) {
            return;
        }
        if (currentDrawingElementId) {
            const sign = mapState.signs[currentDrawingElementId];
            setAttrData({
                ...sign,
            });
        } else {
            setAttrData({
                id: null,
                stopLineId: null,
                type: mapState.currentDrawData.signType,
            });
        }
    }, [mapState.currentDrawData]);
    useEffect(() => {
        if (
            mapState.currentPickElement.length === 0 ||
            mapState.currentPickElement[0]?.type !== ThreeElementType.SignIcon
        ) {
            return;
        }
        const sign = searchSignBySignId(mapState.currentPickElement[0]?.id);
        if (!sign) {
            return;
        }
        setAttrData({
            ...sign,
        });
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);
    // 在绘制junction时，初始化参数
    useEffect(() => {
        if (mapState.currentDrawData.drawElementType === MapElementType.Sign) {
            useManagerStore.getState().setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    signType: SignType.StopSign,
                },
            });
        }
    }, [mapState.currentDrawData.drawElementType]);

    const changeSignType = (signType: SignType) => {
        setAttrData({
            ...attrData,
            type: signType,
        });
        mapState.onsave = true;
        const { currentDrawData, currentPickElement } = mapState;
        if (currentDrawData.currentDrawingElementId) {
            mapState.signs[currentDrawData.currentDrawingElementId].type = signType;
            setMapState(mapState);
        } else if (currentPickElement[0]?.id) {
            if (!mapState.signs[currentPickElement[0].id]) {
                return;
            }
            addCommand([new ChangeSignTypeCommand(currentPickElement[0]?.id, signType)]);
        } else {
            mapState.currentDrawData.signType = signType;
            setMapState(mapState);
        }
    };
    return (
        (mapState.currentDrawData.drawElementType === MapElementType.Sign ||
            mapState.currentPickElement[0]?.type === ThreeElementType.SignIcon) && (
            <>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`标志牌 ${attrData?.id || ''}`}</span>
                </div>
                <div className="attr-item">
                    <span className="text">关联停止线：</span>
                    {attrData?.stopLineId || '-'}
                </div>
                <div className="attr-item">
                    <span className="text">标志牌类型：</span>
                    <Select
                        value={attrData?.type}
                        style={{ width: 180 }}
                        onChange={(type) => changeSignType(type)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: SignType.StopSign, label: '停止' },
                            { value: SignType.YieldSign, label: '让行' },
                        ]}
                    />
                </div>
            </>
        )
    );
}
