import React, { useEffect, useState } from 'react';
import { JunctionType } from 'src/interface/junctionInterFace';
import { Select } from 'antd';
import { useManagerStore } from 'src/store';
import { searchJunctionFromGroudId } from 'src/utils/search/junctionSearch';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { initJunctionType } from './constData';

interface AttrData {
    id: string;
    junctionType: JunctionType;
}
/**
 *attrData回显的逻辑如下
  1. 绘制阶段且还没开始绘制，则直接从mapState.currentDrawData.junctionAttr中取
  2. 绘制阶段且已经开始绘制，则从mapState.junctions[currentDrawData.currentDrawingElementId].attr中取
  3. 选中阶段，则从mapState.currentPickElement[0].id获取到junction数据，去回显
 */

/**
 *attrData修改逻辑
    任何情况都修改attrDat
  1. 绘制阶段且还没开始绘制，需要修改 mapState.currentDrawData.junctionAttr数据，
  记得在下次绘制时把这个数据重置为初始数据，不要影响下次绘制的元素的初始值
  2. 绘制阶段且已经开始绘制，需要修改当前绘制junction
  3. 选中阶段，需要修改当前选中元素
 */
export default function Index() {
    const { mapState, setMapState } = useManagerStore.getState();
    const [attrData, setAttrData] = useState<AttrData>(null);

    const changeJunction = (junctionType: JunctionType) => {
        setAttrData({
            ...attrData,
            junctionType,
        });
        const { currentDrawData, currentPickElement } = mapState;
        if (currentDrawData.currentDrawingElementId) {
            mapState.junctions[currentDrawData.currentDrawingElementId].attr.type = junctionType;
        } else if (currentPickElement[0]?.id) {
            const groudId = mapState.currentPickElement[0]?.id;
            const linkJunction = searchJunctionFromGroudId(groudId);
            if (!linkJunction) {
                return;
            }
            mapState.junctions[linkJunction.id].attr.type = junctionType;
        } else {
            mapState.currentDrawData.junctionAttr = { type: junctionType };
        }
        mapState.onsave = true;
        setMapState(mapState);
    };

    useEffect(() => {
        const { currentDrawingElementId, drawElementType } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.Junction) {
            return;
        }
        if (currentDrawingElementId) {
            const junction = mapState.junctions[currentDrawingElementId];
            if (!junction) {
                return;
            }
            setAttrData({
                id: currentDrawingElementId,
                junctionType: junction.attr.type,
            });
        } else {
            setAttrData({
                id: null,
                junctionType: initJunctionType,
            });
        }
    }, [mapState.currentDrawData]);
    useEffect(() => {
        // 如果是绘制阶段
        if (
            mapState.currentPickElement.length === 0 ||
            mapState.currentPickElement[0]?.type !== ThreeElementType.JunctionGroud
        ) {
            return;
        }
        const junction = searchJunctionFromGroudId(mapState.currentPickElement[0]?.id);
        if (!junction) {
            return;
        }
        setAttrData({
            id: junction.id,
            junctionType: junction.attr.type,
        });
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);
    // 在绘制junction时，初始化参数
    useEffect(() => {
        if (mapState.currentDrawData.drawElementType === MapElementType.Junction) {
            useManagerStore.getState().setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    junctionAttr: { type: initJunctionType },
                },
            });
        }
    }, [mapState.currentDrawData.drawElementType]);
    return (
        (mapState.currentDrawData.drawElementType === MapElementType.Junction ||
            mapState.currentPickElement[0]?.type === ThreeElementType.JunctionGroud) && (
            <>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`Junction ${attrData?.id || ''}`}</span>
                </div>
                <div className="attr-item">
                    <span className="text">路口类型：</span>
                    <Select
                        value={attrData?.junctionType}
                        style={{ width: 180 }}
                        onChange={(junctionType) => changeJunction(junctionType)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: JunctionType.CROSS, label: '十字路口' },
                            { value: JunctionType.T, label: '丁字路口' },
                        ]}
                    />
                </div>
            </>
        )
    );
}
