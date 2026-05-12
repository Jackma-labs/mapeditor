import React, { useEffect, useState } from 'react';
import { Select, Input } from 'antd';
import { useManagerStore } from 'src/store';
import { MapElementType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { searchAreaFromGroudId } from 'src/utils/search/areaSearch';
import { AreaAttr, AreaType } from 'src/interface/areaInterFace';
import { initAreaAttr, initAreaName } from './constData';

export default function Index() {
    const { mapState, setMapState } = useManagerStore.getState();
    const [attrData, setAttrData] = useState<AreaAttr>(null);
    const [nameIsError, setNameIsError] = useState(false);

    const changeType = (type: AreaType) => {
        setAttrData({
            ...attrData,
            type,
        });
        const { currentDrawData, currentPickElement } = mapState;
        if (currentDrawData.currentDrawingElementId) {
            mapState.areas[currentDrawData.currentDrawingElementId].type = type;
            if (type !== AreaType.Custom) {
                delete mapState.areas[currentDrawData.currentDrawingElementId].name;
            }
        } else if (currentPickElement[0]?.id) {
            const groudId = mapState.currentPickElement[0]?.id;
            const linkArea = searchAreaFromGroudId(groudId);
            if (!linkArea) {
                return;
            }
            if (linkArea.type === AreaType.UnDriveable || type === AreaType.UnDriveable) {
                mapState.needRender = true;
                mapState.needRenderElements[ThreeObject.Groud][linkArea.groudId] = ThreeElementType.AreaGroud;
            }
            mapState.areas[linkArea.id].type = type;
            if (type !== AreaType.Custom) {
                delete mapState.areas[linkArea.id].name;
            }
        } else {
            mapState.currentDrawData.areaAttr = { ...attrData, type };
        }
        mapState.onsave = true;
        setMapState(mapState);
    };

    useEffect(() => {
        const { currentDrawingElementId, drawElementType } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.Area) {
            return;
        }
        if (currentDrawingElementId) {
            const area = mapState.areas[currentDrawingElementId];
            if (!area) {
                return;
            }
            setAttrData({
                id: currentDrawingElementId,
                type: area.type,
                name: area.name || initAreaName,
            });
        } else {
            setAttrData({ ...initAreaAttr });
        }
    }, [mapState.currentDrawData]);
    useEffect(() => {
        // 如果是选中阶段
        if (
            mapState.currentPickElement.length === 0 ||
            mapState.currentPickElement[0]?.type !== ThreeElementType.AreaGroud
        ) {
            return;
        }
        const area = searchAreaFromGroudId(mapState.currentPickElement[0]?.id);
        if (!area) {
            return;
        }
        setAttrData({
            id: area.id,
            type: area.type,
            name: area.name || initAreaName,
        });
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);
    // 在绘制area时，初始化参数
    useEffect(() => {
        if (mapState.currentDrawData.drawElementType === MapElementType.Area) {
            useManagerStore.getState().setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    areaAttr: { ...initAreaAttr },
                },
            });
        }
    }, [mapState.currentDrawData.drawElementType]);

    const onKeyDown = (e: any) => {
        e.stopPropagation();
    };

    const checkName = (e: any) => {
        const value = e.target.value;
        // 符合要求了之后再更新高度数据
        const isError = !/^[a-zA-Z]{1,10}$/.test(value);
        setAttrData({
            ...attrData,
            name: value,
        });
        setNameIsError(isError);
    };
    const changeName = (e: any) => {
        const value = e.target.value;
        const areaGroudId = mapState.currentDrawData.currentDrawingElementId || mapState.currentPickElement?.[0]?.id;
        const area = searchAreaFromGroudId(areaGroudId);
        if (nameIsError) {
            setAttrData({
                ...attrData,
                name: area.name || initAreaName,
            });
        } else if (area) {
            setAttrData({
                ...attrData,
                name: value,
            });
            if (value !== area.name) {
                area.name = value;
                useManagerStore.getState().setMapState({
                    ...mapState,
                });
            }
        } else if (mapState.currentDrawData.drawElementType) {
            // 点击了绘制按钮，还没开始绘制呢，则更改mapState中的当前绘制元素的attrData
            setAttrData({
                ...attrData,
                name: value,
            });
            useManagerStore.getState().setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    areaAttr: {
                        ...mapState.currentDrawData.areaAttr,
                        name: value,
                    },
                },
            });
        }
        setNameIsError(false);
    };
    return (
        (mapState.currentDrawData.drawElementType === MapElementType.Area ||
            mapState.currentPickElement[0]?.type === ThreeElementType.AreaGroud) && (
            <>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`Area ${attrData?.id || ''}`}</span>
                </div>
                <div className="attr-item">
                    <span className="text">区域类型：</span>
                    <Select
                        value={attrData?.type}
                        style={{ width: 180 }}
                        onChange={(type) => changeType(type)}
                        popupClassName="my-select-popup"
                        options={[
                            { label: '可行驶区域', value: AreaType.Driveable },
                            { label: '不可行驶区域', value: AreaType.UnDriveable },
                            { label: '自定义', value: AreaType.Custom },
                        ]}
                    />
                </div>
                {attrData?.type === AreaType.Custom && (
                    <div className="attr-item">
                        <span className="text">name：</span>
                        <Input
                            className="attr-input"
                            style={{ width: 180 }}
                            defaultValue={initAreaName}
                            value={attrData?.name}
                            onChange={(e) => checkName(e)}
                            onBlur={(e) => {
                                changeName(e);
                                window.getSelection().empty();
                            }}
                            onKeyDown={(e) => onKeyDown(e)}
                        />
                    </div>
                )}
                {nameIsError && <span className="error-text">请输入1-10位的字母</span>}
            </>
        )
    );
}
