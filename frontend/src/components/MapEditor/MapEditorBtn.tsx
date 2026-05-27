import { intersectionBy } from 'lodash';
import React, { useEffect, useState } from 'react';
import { combineLaneHandle } from 'src/handle/boundary/combineLaneHandle';
import { connectLane, curveConnectLane } from 'src/handle/lane/LaneConnectHandle';
import { mergeLane } from 'src/handle/lane/mergeLaneHandle';
import { mergeJunctionLane } from 'src/handle/junction/mergeJunctionLaneHandle';
import { OperationType, PickElementInfo, ThreeElementType } from 'src/interface/commonInterFace';
import { Lane, LaneBoundaryType, LaneTrend } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { getLaneEndPointIds, getLaneRelations, getLaneStartPointIds } from 'src/utils/geometryUtil';
import { searchGroudFromBoundaryId } from 'src/utils/search/groudSearch';
import { searchLaneFromGroudId, searchLanesFromBoundaryId } from 'src/utils/search/laneSearch';
import { searchJunctionFromGroudId } from 'src/utils/search/junctionSearch';
import PubSub from 'pubsub-js';
import { splitLaneInCenterHandle } from 'src/handle/lane/splitLaneHandle';
import { searchPointIdsFromBoundaryId, searchPointsFromBoundaryId } from 'src/utils/search/pointSearch';
import { ChangeBoundaryTypeCommand } from 'src/command/BoundaryCommand';
import { findElementIndexInCurrentPickElement } from 'src/handle/interactive/Interaction';
import { Tooltip, Popconfirm, message } from 'antd';
import { isCurrentPickElementHaveAdjacentLane, searchLanesRelationObjectsByCurrentPick } from 'src/utils/search/common';
import { mergeRoadBoundaryHandle } from 'src/handle/boundary/mergeRoadBoundaryHandle';
import {
    connectRoadBoundaryByCurveHandle,
    connectRoadBoundaryByStraightLineHandle,
} from 'src/handle/boundary/connectRoadBoundaryHandle';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { roadBoundaryRalationsHandle } from 'src/handle/boundary/roadBoundaryRalationsHandle';

const isLaneGroudType = (type?: ThreeElementType) =>
    type === ThreeElementType.LaneGroud || type === ThreeElementType.LaneCurveGroud;

const isJunctionLaneSelection = (items: PickElementInfo[] = []) =>
    items.length >= 2 &&
    items.filter((item) => item.type === ThreeElementType.JunctionGroud).length === 1 &&
    items.some((item) => isLaneGroudType(item.type));

export default function Index() {
    const [canInsertPointToBoundary, setCanInsertPointToBoundary] = useState(false);
    const [canStragihtConnect, setCanStragihtConnect] = useState(false);
    const [canCurveConnect, setCanCurveConnect] = useState(false);
    const [canMerge, setCanMerge] = useState(false);
    const [canMergeJunctionLane, setCanMergeJunctionLane] = useState(false);
    const [canModifyLane, setCanModifyLane] = useState(false);
    const [canSplitLaneInVertical, setCanSplitLaneInVertical] = useState(false);
    const [splitLaneInVerticalDisable, setSplitLaneInVerticalDisable] = useState(false);
    const [canChangeBoundaryType, setCanChangeBoundaryType] = useState(false);
    const [canCombineLane, setCanCombineLane] = useState(false);
    const [canCopyParkingSpace, setCanCopyParkingSpace] = useState(false);
    const [mapState, setMapState] = useManagerStore((state) => [state.mapState, state.setMapState, state.addCommand]);
    const [hoverSplitCenterBtn, setHoverSplitCenterBtn] = useState(false);
    const [canMergeRoadBoundary, setCanMergeRoadBoundary] = useState(false);
    const [canConnectRoadBoundary, setCanConnectRoadBoundary] = useState(false);
    // 处理roadBoundary的绑定关系
    const [canHandleRoadBoundaryRelations, setCanHandleRoadBoundaryRelations] = useState(false);
    const [roadBoundaryAndLaneBoundaryRelatived, setRoadBoundaryAndLaneBoundaryRelatived] = useState(false);
    const [coverConfirmOpen, setCoverConfirmOpen] = useState(false);
    const [confirmTitle, setConfirmTitle] = useState('');

    const handleLaneMerge = () => {
        const groudId1 = mapState.currentPickElement[0]?.id;
        const groudId2 = mapState.currentPickElement[1]?.id;
        const lane1 = searchLaneFromGroudId(groudId1);
        const lane2 = searchLaneFromGroudId(groudId2);
        if (!lane1) {
            console.warn('handleLaneMerge时第一个lane没有获取到');
            return;
        }
        if (!lane2) {
            console.warn('handleLaneMerge时第二个lane没有获取到');
            return;
        }
        mergeLane(lane1, lane2);
    };
    const handleJunctionLaneMerge = () => {
        const junctionPick = mapState.currentPickElement.find((item) => item.type === ThreeElementType.JunctionGroud);
        const junction = searchJunctionFromGroudId(junctionPick?.id);
        const lanes = mapState.currentPickElement
            .filter((item) => isLaneGroudType(item.type))
            .map((item) => searchLaneFromGroudId(item.id))
            .filter((lane): lane is Lane => Boolean(lane));
        if (!junction || lanes.length === 0) {
            console.warn('handleJunctionLaneMerge: junction or lane not found');
            return;
        }
        lanes.forEach((lane) => mergeJunctionLane(junction, lane));
    };
    const enableAddLaneBaseOneLane = () => {
        if (mapState.operationType !== OperationType.CopyLane) {
            mapState.operationType = OperationType.CopyLane;
            setMapState(mapState);
        } else {
            mapState.operationType = null;
            setMapState(mapState);
        }
    };
    const changeBoundaryType = () => {
        const { id, type } = mapState.currentPickElement[0] || {};
        if (!id || !type || (type !== ThreeElementType.LaneBoundary && type !== ThreeElementType.LaneCurveBoundary)) {
            return;
        }
        useManagerStore.getState().addCommand([new ChangeBoundaryTypeCommand(id)]);
        PubSub.publish('render');
    };
    const enableInsertPointToBoundary = () => {
        if (mapState.operationType !== OperationType.InsertPointToBoundary) {
            mapState.operationType = OperationType.InsertPointToBoundary;
            setMapState(mapState);
        } else {
            mapState.operationType = null;
            setMapState(mapState);
        }
    };
    const handleLaneConnect = (isCurveConnect: boolean = false) => {
        const groudId1 = mapState.currentPickElement[0]?.id;
        const groudId2 = mapState.currentPickElement[1]?.id;
        if (!groudId1) {
            console.warn('handleLaneConnect时第一个lanegroud的id没有获取到');
            return;
        }
        if (!groudId2) {
            console.warn('handleLaneConnect时第二个lanegroud的id没有获取到');
            return;
        }
        const lane1 = searchLaneFromGroudId(groudId1);
        const lane2 = searchLaneFromGroudId(groudId2);
        if (!lane1) {
            console.warn('handleLaneConnect时第一个lane没有获取到');
            return;
        }
        if (!lane2) {
            console.warn('handleLaneConnect时第二个lane没有获取到');
            return;
        }
        if (isCurveConnect) {
            const result = curveConnectLane(lane1, lane2);
            if (!result.connected) {
                message.warning(
                    result.message || '无法生成稳定的弯道连接，请检查车道方向、端点距离，或先手动调整端点后重试',
                );
                return;
            }
        } else {
            connectLane(lane1, lane2);
        }
        PubSub.publish('render');
    };
    const combineLane = () => {
        mapState.operationType = null;
        setMapState(mapState);
        combineLaneHandle(mapState.currentPickElement[0].id, mapState.currentPickElement[1].id);
    };
    const splitInVerticalDirection = () => {
        if (splitLaneInVerticalDisable) {
            return;
        }
        const operationType =
            mapState.operationType === OperationType.SplitLaneInVertical ? null : OperationType.SplitLaneInVertical;
        mapState.operationType = operationType;
        setMapState(mapState);
    };
    const copyParkingSpace = () => {
        if (mapState.operationType !== OperationType.CopyParkingSpace) {
            mapState.operationType = OperationType.CopyParkingSpace;
            setMapState(mapState);
        } else {
            mapState.operationType = null;
            setMapState(mapState);
        }
    };
    const splitLaneInCenter = () => {
        if (mapState.operationType) {
            mapState.operationType = null;
            setMapState(mapState);
        }
        const laneGroudId = mapState.currentPickElement[0]?.id;
        if (!laneGroudId) {
            return;
        }
        const lane = searchLaneFromGroudId(laneGroudId);
        splitLaneInCenterHandle(lane.id);
        PubSub.publish('render');
    };
    // 合并roadBoundary
    const mergeRoadBoundary = () => {
        mergeRoadBoundaryHandle();
    };
    // 直线连接
    const connectRoadBoundaryByStraightLine = () => {
        connectRoadBoundaryByStraightLineHandle();
    };
    // 曲线连接
    const connectRoadBoundaryByCurve = () => {
        connectRoadBoundaryByCurveHandle();
    };
    const handleRoadBoundaryRelatives = () => {
        if (mapState.currentPickElement?.length !== 2) {
            return;
        }
        const boundary1 = searchBoundaryByBoundaryId(mapState.currentPickElement[0].id);
        const boundary2 = searchBoundaryByBoundaryId(mapState.currentPickElement[1].id);
        // 如果两个边界线是关联的，则取消关联
        if (roadBoundaryAndLaneBoundaryRelatived) {
            roadBoundaryRalationsHandle(false);
            setCoverConfirmOpen(false);
            return;
        }
        if (
            (boundary1.type === ThreeElementType.LaneBoundary ||
                boundary1.type === ThreeElementType.LaneCurveBoundary) &&
            boundary1.relativeRoadBoundaryIds.length !== 0
        ) {
            setConfirmTitle(`该车道线已与道路边界线${boundary1.relativeRoadBoundaryIds[0]}关联，是否覆盖？`);
            setCoverConfirmOpen(true);
        } else if (
            (boundary2.type === ThreeElementType.LaneBoundary ||
                boundary2.type === ThreeElementType.LaneCurveBoundary) &&
            boundary2.relativeRoadBoundaryIds.length !== 0
        ) {
            setConfirmTitle(`该车道线已与道路边界线${boundary2.relativeRoadBoundaryIds[0]}关联，是否覆盖？`);
            setCoverConfirmOpen(true);
        } else {
            roadBoundaryRalationsHandle(true);
            setCoverConfirmOpen(false);
        }
    };
    useEffect(() => {
        const { currentPickElement } = mapState;
        setCanStragihtConnect(false);
        setCanCurveConnect(false);
        setCanMerge(false);
        setCanCombineLane(false);
        setCanMergeJunctionLane(isJunctionLaneSelection(currentPickElement));
        setCanInsertPointToBoundary(
            currentPickElement?.length === 1 &&
                (currentPickElement[0].type === ThreeElementType.LaneBoundary ||
                    currentPickElement[0].type === ThreeElementType.RoadBoundary),
        );
        setCanMergeRoadBoundary(
            currentPickElement?.length === 2 &&
                currentPickElement[0].type === ThreeElementType.RoadBoundary &&
                currentPickElement[1].type === ThreeElementType.RoadBoundary,
        );
        setCanConnectRoadBoundary(
            currentPickElement?.length === 2 &&
                currentPickElement[0].type === ThreeElementType.RoadBoundary &&
                currentPickElement[1].type === ThreeElementType.RoadBoundary,
        );
        setRoadBoundaryAndLaneBoundaryRelatived(false);
        // 选中两个元素，且第一个为roadBoundary，第二个为laneBoundary，或者第一个为laneBoundary，第二个为roadBoundary时可以处理绑定关系
        setCanHandleRoadBoundaryRelations(false);
        setConfirmTitle('');
        setCoverConfirmOpen(false);
        setCanChangeBoundaryType(
            currentPickElement?.length === 1 &&
                (currentPickElement[0].type === ThreeElementType.LaneBoundary ||
                    currentPickElement[0].type === ThreeElementType.LaneCurveBoundary),
        );
        setCanModifyLane(
            currentPickElement?.length === 1 &&
                (currentPickElement[0].type === ThreeElementType.LaneGroud ||
                    currentPickElement[0].type === ThreeElementType.LaneCurveGroud),
        );
        setCanCopyParkingSpace(
            currentPickElement?.length === 1 && currentPickElement[0].type === ThreeElementType.ParkingSpaceGroud,
        );
        if (!currentPickElement || currentPickElement.length === 0) {
            setCanStragihtConnect(false);
            setCanCurveConnect(false);
            setCanMerge(false);
            setCanCombineLane(false);
        } else if (currentPickElement.length === 1) {
            setCanStragihtConnect(false);
            setCanCurveConnect(false);
            setCanMerge(false);
            setCanCombineLane(false);
            if (currentPickElement[0].type === ThreeElementType.RoadBoundary) {
                const roadBoundary = searchBoundaryByBoundaryId(currentPickElement[0].id);
                if (roadBoundary.controlsPosition?.length !== 0) {
                    setCanInsertPointToBoundary(false);
                }
            }
        } else if (currentPickElement.length === 2) {
            if (
                isLaneGroudType(mapState.currentPickElement[0].type) &&
                isLaneGroudType(mapState.currentPickElement[1].type)
            ) {
                setCanCombineLane(false);
                const groudId1 = mapState.currentPickElement[0]?.id;
                const groudId2 = mapState.currentPickElement[1]?.id;
                // 如果选中的两个元素已经连接了，则不可以连接了
                const lane1 = searchLaneFromGroudId(groudId1);
                const lane2 = searchLaneFromGroudId(groudId2);
                if (!lane1 || !lane2) {
                    console.warn(
                        'mapEditor组件中，currentPickElement[0]和currentPickElement[1]的元素没有找到对应的lane',
                    );
                    return;
                }

                // 如果已经连接了，则不可以二次连接
                const [pre, suc] = getLaneRelations(lane1.id);
                const startPointIds = getLaneStartPointIds(lane2);
                const endPointIds = getLaneEndPointIds(lane1);
                if (pre.includes(lane2.id) || suc.includes(lane2.id)) {
                    setCanStragihtConnect(false);
                    setCanCurveConnect(false);
                } else if (startPointIds[0] === endPointIds[0] && startPointIds[1] === endPointIds[1]) {
                    setCanStragihtConnect(false);
                    setCanCurveConnect(false);
                } else if (startPointIds[0] === endPointIds[0] || startPointIds[1] === endPointIds[1]) {
                    setCanStragihtConnect(true);
                    setCanCurveConnect(false);
                } else {
                    setCanStragihtConnect(true);
                    setCanCurveConnect(true);
                }
                setCanMerge(true);
                if (lane1.type !== lane2.type || (lane1.type === lane2.type && lane1.type === LaneTrend.Curve)) {
                    setCanMerge(false);
                } else {
                    [lane1.leftBoundaryId, lane2.leftBoundaryId, lane1.rightBoundaryId, lane2.rightBoundaryId].forEach(
                        (id) => {
                            const grouds = searchGroudFromBoundaryId(id);
                            if (grouds.length >= 2) {
                                setCanMerge(false);
                            }
                        },
                    );
                }
            }
            if (
                mapState.currentPickElement[0].type === ThreeElementType.LaneBoundary &&
                mapState.currentPickElement[1].type === ThreeElementType.LaneBoundary
            ) {
                const linkLanes1 = searchLanesFromBoundaryId(mapState.currentPickElement[0].id);
                const linkLanes2 = searchLanesFromBoundaryId(mapState.currentPickElement[1].id);
                const points1 = searchPointsFromBoundaryId(mapState.currentPickElement[0].id);
                const points2 = searchPointsFromBoundaryId(mapState.currentPickElement[1].id);
                // 如果两根车道已经属于一个lane，且，两个车道有相同的点，则不可以合并为lane
                if (
                    intersectionBy(linkLanes1, linkLanes2, 'id').length !== 0 ||
                    intersectionBy(points1, points2, 'id').length !== 0
                ) {
                    setCanCombineLane(false);
                } else {
                    setCanCombineLane(true);
                }
            }
        } else {
            setCanStragihtConnect(false);
            setCanCurveConnect(false);
            setCanMerge(false);
            setCanCombineLane(false);
        }

        if (currentPickElement.length > 0 && currentPickElement.every((item) => isLaneGroudType(item.type))) {
            setSplitLaneInVerticalDisable(false);
            setCanSplitLaneInVertical(true);
            const allRelation = isCurrentPickElementHaveAdjacentLane();
            if (!allRelation) {
                // 需要选中相中所有的车道后能找到与之相邻的车道
                setSplitLaneInVerticalDisable(true);
            } else {
                const linkGrouds = searchLanesRelationObjectsByCurrentPick().grouds;
                for (let i = 0; i < linkGrouds.length; i += 1) {
                    const groud = linkGrouds[i];
                    if (findElementIndexInCurrentPickElement({ id: groud.id, type: groud.type }) === -1) {
                        setSplitLaneInVerticalDisable(true);
                    }
                }
            }
        } else {
            setCanSplitLaneInVertical(false);
        }
        // 如果选中连个元素都为roadBoundary,但是两个roadBoundary已经有连接关系了，则不可以connect
        if (
            currentPickElement.length === 2 &&
            currentPickElement[0]?.type === ThreeElementType.RoadBoundary &&
            currentPickElement[1]?.type === ThreeElementType.RoadBoundary
        ) {
            const roadBoundary1PointIds = searchPointIdsFromBoundaryId(currentPickElement[0].id);
            const roadBoundary2PointIds = searchPointIdsFromBoundaryId(currentPickElement[1].id);
            if (
                roadBoundary1PointIds[0] === roadBoundary2PointIds[0] ||
                roadBoundary1PointIds[0] === roadBoundary2PointIds[roadBoundary2PointIds.length - 1] ||
                roadBoundary1PointIds[roadBoundary1PointIds.length - 1] === roadBoundary2PointIds[0] ||
                roadBoundary1PointIds[roadBoundary1PointIds.length - 1] ===
                    roadBoundary2PointIds[roadBoundary2PointIds.length - 1]
            ) {
                setCanConnectRoadBoundary(false);
            }
        }
        if (
            currentPickElement?.length === 2 &&
            ((currentPickElement[0].type === ThreeElementType.RoadBoundary &&
                (currentPickElement[1].type === ThreeElementType.LaneBoundary ||
                    currentPickElement[1].type === ThreeElementType.LaneCurveBoundary)) ||
                ((currentPickElement[0].type === ThreeElementType.LaneBoundary ||
                    currentPickElement[0].type === ThreeElementType.LaneCurveBoundary) &&
                    currentPickElement[1].type === ThreeElementType.RoadBoundary))
        ) {
            const boundary1 = searchBoundaryByBoundaryId(mapState.currentPickElement[0].id);
            const boundary2 = searchBoundaryByBoundaryId(mapState.currentPickElement[1].id);
            if (boundary1 && boundary2) {
                // 这个LaneBoundary如果相关联多个车道时不能和roadBoundary绑定
                const laneBoundary =
                    boundary1.type === ThreeElementType.LaneBoundary ||
                    boundary1.type === ThreeElementType.LaneCurveBoundary
                        ? boundary1
                        : boundary2;
                const roadBoundary = boundary1.type === ThreeElementType.RoadBoundary ? boundary1 : boundary2;
                const linkLanes = searchLanesFromBoundaryId(laneBoundary.id);
                if (linkLanes.length === 1) {
                    setCanHandleRoadBoundaryRelations(true);
                    if (laneBoundary.relativeRoadBoundaryIds.includes(roadBoundary.id)) {
                        setRoadBoundaryAndLaneBoundaryRelatived(true);
                    } else {
                        setRoadBoundaryAndLaneBoundaryRelatived(false);
                    }
                } else {
                    setCanHandleRoadBoundaryRelations(false);
                    setRoadBoundaryAndLaneBoundaryRelatived(false);
                }
            }
        }
        PubSub.publish('render');
    }, [mapState.currentPickElement, mapState.currentPickElement.length]);
    return (
        <div className="lane-handle-container">
            {canStragihtConnect && (
                <div className="lane-handle-btn" onClick={() => handleLaneConnect()}>
                    直道连接
                </div>
            )}
            {canCurveConnect && (
                <div className="lane-handle-btn" onClick={() => handleLaneConnect(true)}>
                    弯道连接
                </div>
            )}
            {canMerge && (
                <div className="lane-handle-btn" onClick={handleLaneMerge}>
                    合并
                </div>
            )}
            {canMergeJunctionLane && (
                <div className="lane-handle-btn" onClick={handleJunctionLaneMerge}>
                    路口吸附车道
                </div>
            )}
            {canModifyLane && (
                <div
                    className={`lane-handle-btn ${mapState.operationType === OperationType.CopyLane ? 'active' : ''}`}
                    onClick={enableAddLaneBaseOneLane}
                >
                    增加车道
                </div>
            )}
            {canModifyLane && (
                <div className="lane-handle-btn" onClick={splitLaneInCenter}>
                    沿车道方向拆分
                </div>
            )}
            {canSplitLaneInVertical && (
                <Tooltip
                    title="需同时选中与之相邻的所有车道"
                    trigger="hover"
                    placement="bottom"
                    color="rgba(61,67,78,0.80)"
                    open={splitLaneInVerticalDisable && hoverSplitCenterBtn}
                    style={{
                        background: 'rgba(61,67,78,0.80)',
                        borderRadius: '6px',
                    }}
                >
                    <div
                        className={`lane-handle-btn ${
                            mapState.operationType === OperationType.SplitLaneInVertical ? 'active' : ''
                        }${splitLaneInVerticalDisable ? 'disable' : ''}`}
                        onClick={splitInVerticalDirection}
                        onMouseEnter={() => setHoverSplitCenterBtn(true)}
                        onMouseLeave={() => setHoverSplitCenterBtn(false)}
                    >
                        垂直车道方向拆分
                    </div>
                </Tooltip>
            )}
            {canCombineLane && (
                <div className="lane-handle-btn" onClick={combineLane}>
                    生成车道
                </div>
            )}
            {canChangeBoundaryType && (
                <div className="lane-handle-btn" onClick={changeBoundaryType}>
                    {mapState.boundarys[mapState.currentPickElement?.[0]?.id]?.attr?.type ===
                    LaneBoundaryType.WHITESOLId
                        ? '更改为虚线'
                        : '更改为实线'}
                </div>
            )}

            {canInsertPointToBoundary && (
                <div
                    className={`lane-handle-btn ${
                        mapState.operationType === OperationType.InsertPointToBoundary ? 'active' : ''
                    }`}
                    onClick={enableInsertPointToBoundary}
                >
                    添加点
                </div>
            )}
            {canMergeRoadBoundary && (
                <div className="lane-handle-btn" onClick={mergeRoadBoundary}>
                    合并
                </div>
            )}
            {canConnectRoadBoundary && (
                <>
                    <div className="lane-handle-btn" onClick={connectRoadBoundaryByStraightLine}>
                        直线连接
                    </div>
                    <div className="lane-handle-btn" onClick={connectRoadBoundaryByCurve}>
                        曲线连接
                    </div>
                </>
            )}

            {canCopyParkingSpace && (
                <div
                    className={`lane-handle-btn ${
                        mapState.operationType === OperationType.CopyParkingSpace ? 'active' : ''
                    }`}
                    onClick={copyParkingSpace}
                >
                    增加车位
                </div>
            )}
            {canHandleRoadBoundaryRelations && (
                <Popconfirm
                    title={confirmTitle}
                    open={coverConfirmOpen}
                    onConfirm={() => {
                        roadBoundaryRalationsHandle(!roadBoundaryAndLaneBoundaryRelatived);
                        setCoverConfirmOpen(false);
                        setConfirmTitle('');
                    }}
                    onCancel={() => setCoverConfirmOpen(false)}
                    okText="覆盖"
                    cancelText="取消"
                >
                    <div className="lane-handle-btn" onClick={() => handleRoadBoundaryRelatives()}>
                        {roadBoundaryAndLaneBoundaryRelatived ? '解除关联' : '关联'}
                    </div>
                </Popconfirm>
            )}
        </div>
    );
}
