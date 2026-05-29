import React, { useEffect, useState } from 'react';
import { Input, Select } from 'antd';
import {
    LaneBoundaryType,
    LaneDireaciotn,
    LaneTrend,
    LaneType,
    ProssibleDrivingDirection,
} from 'src/interface/laneInterFace';
import { MapState } from 'src/interface/mapStateInterface';
import { useManagerStore } from 'src/store';
import { getLaneRelations } from 'src/utils/geometryUtil';
import { searchLaneBoundaries, searchLaneFromGroudId } from 'src/utils/search/laneSearch';
import { MapElementType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import PubSub from 'pubsub-js';
import { ChangeBoundaryTypeCommand } from 'src/command/BoundaryCommand';
import { ChangeLaneProssibleDrivingDirectionCommand, UpdateLaneAttrCommand } from 'src/command/LaneCommand';
import { UpdateArrowCommand } from 'src/command/ArrowCommand';
import { initLaneAttrData } from './constData';

interface AttrData {
    id: string;
    speed: number | string;
    direction: LaneDireaciotn;
    prossibleDrivingDirection: ProssibleDrivingDirection;
    leftBoundaryType: LaneBoundaryType;
    rightBoundaryType: LaneBoundaryType;
    preLaneIds: string[];
    sucLaneIds: string[];
    leftNeighbors: string[];
    rightNeighbors: string[];
    laneType: LaneType;
}

const formatSpeedMps = (speed: number | string | undefined) => {
    const speedKph = Number(speed);
    if (!Number.isFinite(speedKph) || speedKph <= 0) {
        return '-';
    }
    return (speedKph / 3.6).toFixed(2);
};

const getRequiredStatusClass = (pass: boolean) => (pass ? 'is-pass' : 'is-warn');

const isValidSpeedValue = (value: number | string) =>
    /^(([1-9][0-9]*(\.)?[0-9]*)|(0(\.)([0-9]*))|(0))$/.test(`${value}`) && Number(value) <= 999 && Number(value) >= 1;

const normalizeSpeedKph = (value: number | string) => Number(Number(value).toFixed(2));

function getBoundaryCoordinates(mapState: MapState, boundaryId: string) {
    const boundary = mapState.boundarys[boundaryId];
    if (!boundary) {
        return [];
    }
    return (boundary.pointIds || []).flatMap((pointId) => {
        const point = mapState.points[pointId]?.position;
        return point ? [[point.x, point.y]] : [];
    });
}

function fitLaneInView(mapState: MapState, laneId: string) {
    const lane = mapState.lanes[laneId];
    if (!lane) {
        return;
    }
    const coordinates = [
        ...getBoundaryCoordinates(mapState, lane.leftBoundaryId),
        ...getBoundaryCoordinates(mapState, lane.rightBoundaryId),
    ];
    if (coordinates.length < 2) {
        return;
    }
    PubSub.publishSync('cameraMove', {
        coordinates,
        minExtent: 30,
        padding: {
            top: 104,
            right: 430,
            bottom: 44,
            left: 132,
        },
    });
}

function RelationChips({
    ids,
    emptyText,
    onLocate,
}: {
    ids: string[];
    emptyText: string;
    onLocate?: (id: string) => void;
}) {
    if (!ids || ids.length === 0) {
        return <span className="relation-empty">{emptyText}</span>;
    }
    return (
        <span className="relation-chip-list">
            {ids.map((id) => {
                if (onLocate) {
                    return (
                        <button
                            type="button"
                            className="relation-chip"
                            key={id}
                            title="点击定位车道"
                            aria-label={`定位车道 ${id}`}
                            onClick={() => onLocate(id)}
                        >
                            {id}
                        </button>
                    );
                }
                return (
                    <span className="relation-chip" key={id}>
                        {id}
                    </span>
                );
            })}
        </span>
    );
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
    const [disableChange, setDisableChange] = useState(false);
    const [errorShow, setErrorShow] = useState(false);

    const locateLane = (laneId: string) => {
        const currentMapState = useManagerStore.getState().mapState;
        const lane = currentMapState.lanes[laneId];
        if (!lane) {
            return;
        }
        fitLaneInView(currentMapState, laneId);
        if (!lane.groudId) {
            PubSub.publish('render');
            return;
        }
        const laneGroudType =
            lane.type === LaneTrend.Curve ? ThreeElementType.LaneCurveGroud : ThreeElementType.LaneGroud;
        setMapState({
            ...currentMapState,
            currentPickElement: [
                {
                    id: lane.groudId,
                    type: laneGroudType,
                    threeObject: ThreeObject.Groud,
                },
            ],
            needRender: true,
        });
        PubSub.publish('render');
    };

    const changeLaneBoundary = (boundaryType: LaneBoundaryType, isLeftBoundary: boolean) => {
        if (isLeftBoundary) {
            setAttrData({
                ...attrData,
                leftBoundaryType: boundaryType,
            });
        } else {
            setAttrData({
                ...attrData,
                rightBoundaryType: boundaryType,
            });
        }
        const { currentDrawData, currentPickElement } = mapState;
        const { currentDrawingElementId } = currentDrawData;

        if (currentDrawingElementId || currentPickElement[0]?.id) {
            const lane = mapState.lanes[currentDrawingElementId] || searchLaneFromGroudId(currentPickElement[0]?.id);
            if (!lane) {
                return;
            }
            const [leftBoundary, rightBoundary] = searchLaneBoundaries(lane.id);
            if (!leftBoundary || !rightBoundary) {
                return;
            }
            if (isLeftBoundary) {
                useManagerStore.getState().addCommand([new ChangeBoundaryTypeCommand(leftBoundary.id)]);
            } else {
                useManagerStore.getState().addCommand([new ChangeBoundaryTypeCommand(rightBoundary.id)]);
            }
            PubSub.publish('render');
        } else if (isLeftBoundary) {
            mapState.currentDrawData.leftBoundaryAttr.type = boundaryType;
            useManagerStore.getState().setMapState(mapState);
        } else {
            mapState.currentDrawData.rightBoundaryAttr.type = boundaryType;
            useManagerStore.getState().setMapState(mapState);
        }
    };
    const checkSpeed = (e: any) => {
        const value = e.target.value;
        setErrorShow(!isValidSpeedValue(value));
        setAttrData({
            ...attrData,
            speed: value,
        });
    };
    const changeSpeed = (e: any) => {
        const value = e.target.value;
        const { currentDrawData, currentPickElement } = mapState;
        const { currentDrawingElementId } = currentDrawData;
        const lane = mapState.lanes[currentDrawingElementId] || searchLaneFromGroudId(currentPickElement[0]?.id);
        if (!isValidSpeedValue(value)) {
            const fallbackSpeed = lane?.attr.speed ?? currentDrawData.laneAttr.speed;
            setAttrData({ ...attrData, speed: fallbackSpeed });
            setErrorShow(false);
            return;
        }
        const speedKph = normalizeSpeedKph(value);
        setAttrData({ ...attrData, speed: speedKph });
        if (lane) {
            useManagerStore.getState().addCommand([new UpdateLaneAttrCommand(lane.id, { speed: speedKph, speedKph })]);
        } else {
            mapState.currentDrawData.laneAttr.speed = speedKph;
            mapState.currentDrawData.laneAttr.speedKph = speedKph;
            setMapState({
                ...mapState,
                currentDrawData: { ...mapState.currentDrawData },
            });
        }
        setErrorShow(false);
    };
    const changeDirection = (direction: LaneDireaciotn) => {
        const { currentDrawData, currentPickElement } = mapState;
        const { currentDrawingElementId } = currentDrawData;
        setAttrData({
            ...attrData,
            direction,
        });
        // 处于绘制阶段，但是没有开始绘制时只用修改 state.currentDrawData相关属性
        if (currentDrawingElementId || currentPickElement[0]?.id) {
            const lane =
                mapState.lanes[currentDrawData.currentDrawingElementId] ||
                searchLaneFromGroudId(currentPickElement[0]?.id);
            if (!lane) {
                return;
            }
            useManagerStore.getState().addCommand([new UpdateLaneAttrCommand(lane.id, { direction })]);
        } else {
            mapState.currentDrawData.laneAttr.direction = direction;
            mapState.onsave = true;
            setMapState({
                ...mapState,
                currentDrawData: { ...mapState.currentDrawData },
            });
        }
    };

    const changeProssibleDrivingDirection = (prossibleDrivingDirection: ProssibleDrivingDirection) => {
        const { currentDrawData, currentPickElement } = mapState;
        const { currentDrawingElementId } = currentDrawData;
        setAttrData({
            ...attrData,
            prossibleDrivingDirection,
        });
        if (currentDrawingElementId) {
            useManagerStore
                .getState()
                .addCommand([
                    new ChangeLaneProssibleDrivingDirectionCommand(currentDrawingElementId, prossibleDrivingDirection),
                ]);
        } else if (currentPickElement[0]?.id) {
            const lane = searchLaneFromGroudId(currentPickElement[0]?.id);
            if (!lane) {
                return;
            }
            useManagerStore
                .getState()
                .addCommand([
                    new ChangeLaneProssibleDrivingDirectionCommand(lane.id, prossibleDrivingDirection),
                    new UpdateArrowCommand(lane.arrowId),
                ]);
        } else {
            mapState.currentDrawData.laneAttr.prossibleDrivingDirection = prossibleDrivingDirection;
            useManagerStore.getState().setMapState(mapState);
        }
        PubSub.publish('render');
    };

    const changeLaneType = (laneType: LaneType) => {
        const { currentDrawData, currentPickElement } = mapState;
        const { currentDrawingElementId } = currentDrawData;
        const lane = mapState.lanes[currentDrawingElementId] || searchLaneFromGroudId(currentPickElement[0]?.id);
        setAttrData({ ...attrData, laneType });
        if (lane) {
            useManagerStore.getState().addCommand([new UpdateLaneAttrCommand(lane.id, { laneType })]);
        } else {
            mapState.currentDrawData.laneAttr.laneType = laneType;
            setMapState({
                ...mapState,
                currentDrawData: { ...mapState.currentDrawData },
            });
        }
    };

    useEffect(() => {
        const { drawElementType, currentDrawingElementId } = mapState.currentDrawData;
        if (!drawElementType || drawElementType !== MapElementType.Lane) {
            return;
        }
        setDisableChange(false);
        if (!currentDrawingElementId) {
            setAttrData({
                id: null,
                speed: mapState.currentDrawData.laneAttr.speed,
                direction: mapState.currentDrawData.laneAttr.direction,
                prossibleDrivingDirection: mapState.currentDrawData.laneAttr.prossibleDrivingDirection,
                leftBoundaryType: mapState.currentDrawData.leftBoundaryAttr.type,
                rightBoundaryType: mapState.currentDrawData.rightBoundaryAttr.type,
                preLaneIds: [],
                sucLaneIds: [],
                leftNeighbors: [],
                rightNeighbors: [],
                laneType: mapState.currentDrawData.laneAttr.laneType,
            });
        } else {
            const lane = mapState.lanes[currentDrawingElementId];
            if (!lane) {
                return;
            }
            const [leftBoundary, rightBoundary] = searchLaneBoundaries(lane.id);
            if (!leftBoundary || !rightBoundary) {
                return;
            }
            setAttrData({
                id: lane.id,
                speed: lane.attr.speed,
                direction: lane.attr.direction,
                prossibleDrivingDirection: lane.attr.prossibleDrivingDirection,
                leftBoundaryType: leftBoundary.attr.type,
                rightBoundaryType: rightBoundary.attr.type,
                preLaneIds: [],
                sucLaneIds: [],
                leftNeighbors: [],
                rightNeighbors: [],
                laneType: lane.attr.laneType,
            });
        }
    }, [mapState.currentDrawData]);
    useEffect(() => {
        const { currentPickElement } = mapState;
        if (
            currentPickElement.length === 0 ||
            (currentPickElement[0].type !== ThreeElementType.LaneGroud &&
                currentPickElement[0].type !== ThreeElementType.LaneCurveGroud)
        ) {
            return;
        }
        setDisableChange(currentPickElement?.length === 2);
        if (currentPickElement.length === 1) {
            const lane = searchLaneFromGroudId(currentPickElement[0].id);
            if (!lane) {
                return;
            }
            const [leftBoundary, rightBoundary] = searchLaneBoundaries(lane.id);
            if (!leftBoundary || !rightBoundary) {
                return;
            }
            const [preLaneIds, sucLaneIds, leftNeighbors, rightNeighbors] = getLaneRelations(lane.id);
            setAttrData({
                id: lane.id,
                speed: lane.attr.speed,
                direction: lane.attr.direction,
                prossibleDrivingDirection: lane.attr.prossibleDrivingDirection,
                leftBoundaryType: leftBoundary.attr.type,
                rightBoundaryType: rightBoundary.attr.type,
                preLaneIds,
                sucLaneIds,
                leftNeighbors,
                rightNeighbors,
                laneType: lane.attr.laneType,
            });
        }
        if (
            currentPickElement.length === 2 &&
            currentPickElement[0].type === ThreeElementType.LaneGroud &&
            currentPickElement[1].type === ThreeElementType.LaneGroud
        ) {
            const lane1 = searchLaneFromGroudId(currentPickElement[0].id);
            const lane2 = searchLaneFromGroudId(currentPickElement[1].id);
            if (!lane1 || !lane2) {
                return;
            }
            setAttrData({
                ...attrData,
                id: `${lane1.id}，${lane2.id}`,
            });
        }
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);

    // 这个是为了在第一次点击车道元素按钮的时候，将属性面板中的数据初始化
    useEffect(() => {
        if (mapState.currentDrawData.drawElementType === MapElementType.Lane) {
            setMapState({
                ...mapState,
                currentDrawData: {
                    ...mapState.currentDrawData,
                    laneAttr: {
                        speed: initLaneAttrData.speed,
                        speedKph: initLaneAttrData.speedKph,
                        direction: initLaneAttrData.direction,
                        prossibleDrivingDirection: initLaneAttrData.prossibleDrivingDirection,
                        laneType: initLaneAttrData.laneType,
                    },
                    leftBoundaryAttr: { type: initLaneAttrData.leftBoundaryType },
                    rightBoundaryAttr: { type: initLaneAttrData.rightBoundaryType },
                },
            });
        }
    }, [mapState.currentDrawData.drawElementType]);

    return (
        (mapState.currentDrawData.drawElementType === MapElementType.Lane ||
            mapState.currentPickElement[0]?.type === ThreeElementType.LaneGroud ||
            mapState.currentPickElement[0]?.type === ThreeElementType.LaneCurveGroud) && (
            <>
                <div className="title">
                    <div className="text">属性</div>
                </div>
                <div className="type">
                    <span className="line" />
                    <span className="text">{`Lane ${attrData?.id || ''}`}</span>
                </div>
                <div className="lane-attr-guide">
                    <div className="lane-attr-guide-title">发布必填</div>
                    <div className="lane-required-grid">
                        <span className={getRequiredStatusClass(Number(attrData?.speed) >= 1)}>
                            {`限速 ${attrData?.speed || '-'} km/h`}
                        </span>
                        <span className={getRequiredStatusClass(Boolean(attrData?.direction))}>方向已设置</span>
                        <span className={getRequiredStatusClass(Boolean(attrData?.laneType))}>类型已设置</span>
                        <span
                            className={getRequiredStatusClass(
                                Boolean(attrData?.leftBoundaryType && attrData?.rightBoundaryType),
                            )}
                        >
                            边界已设置
                        </span>
                    </div>
                    <div className="lane-attr-guide-note">
                        {`限速输入固定按 km/h 处理，导出 Apollo 时写入 ${formatSpeedMps(attrData?.speed)} m/s。`}
                    </div>
                </div>
                <div className="attr-item">
                    <span className="text">车道编号：</span>
                    <span>{attrData?.id}</span>
                </div>

                <div className="attr-item">
                    <span className="text">车道左边界：</span>
                    <Select
                        value={attrData?.leftBoundaryType}
                        style={{ width: 180 }}
                        disabled={disableChange}
                        onChange={(boundaryType) => changeLaneBoundary(boundaryType, true)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: LaneBoundaryType.WHITESOLId, label: '实线' },
                            { value: LaneBoundaryType.WHITEDOTTED, label: '虚线' },
                        ]}
                    />
                </div>

                <div className="attr-item">
                    <span className="text">车道右边界：</span>
                    <Select
                        value={attrData?.rightBoundaryType}
                        disabled={disableChange}
                        style={{ width: 180 }}
                        onChange={(boundaryType) => changeLaneBoundary(boundaryType, false)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: LaneBoundaryType.WHITESOLId, label: '实线' },
                            { value: LaneBoundaryType.WHITEDOTTED, label: '虚线' },
                        ]}
                    />
                </div>
                <div className="attr-item">
                    <span className="text">车道方向：</span>
                    <Select
                        value={attrData?.direction}
                        disabled={
                            disableChange ||
                            attrData?.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION
                        }
                        style={{ width: 180 }}
                        onChange={(direction: LaneDireaciotn) => changeDirection(direction)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: LaneDireaciotn.STRAIGHT, label: '直行' },
                            { value: LaneDireaciotn.TURN_LEFT, label: '左转' },
                            { value: LaneDireaciotn.TURN_RIGHT, label: '右转' },
                            { value: LaneDireaciotn.TURN_AROUND, label: '调头' },
                        ]}
                    />
                </div>
                <div className="attr-item">
                    <span className="text">相对方向：</span>
                    <Select
                        value={attrData?.prossibleDrivingDirection}
                        disabled={disableChange}
                        style={{ width: 180 }}
                        onChange={(direction) => changeProssibleDrivingDirection(direction)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: ProssibleDrivingDirection.RELATIVEDIRECTION, label: '双向' },
                            { value: ProssibleDrivingDirection.BACKWARD, label: '反向' },
                            { value: ProssibleDrivingDirection.FORWARD, label: '同向' },
                        ]}
                    />
                </div>
                <div className="attr-item">
                    <span className="text">车道类型：</span>
                    <Select
                        value={attrData?.laneType}
                        style={{ width: 180 }}
                        onChange={(laneType: LaneType) => changeLaneType(laneType)}
                        popupClassName="my-select-popup"
                        options={[
                            { value: LaneType.CityDriving, label: '机动车道' },
                            { value: LaneType.Biking, label: '非机动车道' },
                            { value: LaneType.Shared, label: '混合车道' },
                        ]}
                    />
                </div>
                <div className="attr-item">
                    <span className="text">限速：</span>
                    <span className="attr-input-wrap">
                        <Input
                            className="attr-input"
                            suffix="km/h"
                            defaultValue={attrData?.speed}
                            value={attrData?.speed}
                            disabled={disableChange}
                            onChange={(e) => checkSpeed(e)}
                            onBlur={(e) => {
                                changeSpeed(e);
                                window.getSelection()?.empty?.();
                            }}
                        />
                        <span className="attr-input-help">{`Apollo ${formatSpeedMps(attrData?.speed)} m/s`}</span>
                    </span>
                    <br />
                </div>
                {errorShow && <span className="error-text">请输入1-999数字</span>}

                {attrData?.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION && (
                    <>
                        <div className="attr-section-title">拓扑关系</div>
                        <div className="attr-item attr-relation-item">
                            <span className="text">前驱车道编号：</span>
                            <RelationChips
                                ids={attrData?.preLaneIds}
                                emptyText="暂无，若不是入口请连接上一段车道"
                                onLocate={locateLane}
                            />
                        </div>
                        <div className="attr-item attr-relation-item">
                            <span className="text">后继车道编号：</span>
                            <RelationChips
                                ids={attrData?.sucLaneIds}
                                emptyText="暂无，若不是出口请连接下一段车道"
                                onLocate={locateLane}
                            />
                        </div>
                        <div className="attr-item attr-relation-item">
                            <span className="text">相邻车道编号：</span>
                            <span className="relation-neighbor">
                                左
                                <RelationChips ids={attrData?.leftNeighbors} emptyText="-" onLocate={locateLane} />
                                右
                                <RelationChips ids={attrData?.rightNeighbors} emptyText="-" onLocate={locateLane} />
                            </span>
                        </div>
                    </>
                )}
            </>
        )
    );
}
