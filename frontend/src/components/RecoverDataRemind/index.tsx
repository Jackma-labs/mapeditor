import React, { useEffect, useRef, useState } from 'react';
import RemindModal from 'src/components/RemindModal/index';
import { PermissionStatus, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import * as THREE from 'three';

export default function Index() {
    const [visible, setVisible] = useState(false);
    const isRegister = useRef(false);
    const autoSaveDataTimer = useRef(new Date().getTime());
    const [viewstate] = useManagerStore((state) => [state.mapState]);

    // 从localStorage中获取上次编辑的内容，并恢复
    const recoverDataHandle = () => {
        const { mapState, setMapState } = useManagerStore.getState();
        const mapEditingData = window.localStorage.getItem('mapEditingData');
        if (!mapEditingData) {
            return;
        }
        try {
            const curLabelData = JSON.parse(mapEditingData);
            mapState.boundarys = curLabelData?.boundarys || {};
            mapState.lanes = curLabelData?.lanes || {};
            mapState.junctions = curLabelData?.junctions || {};
            mapState.crosswalks = curLabelData?.crosswalks || {};
            mapState.speedBumps = curLabelData?.speedBumps || {};
            mapState.areas = curLabelData?.areas || {};
            mapState.points = curLabelData?.points || {};
            delete mapState.points.start;
            mapState.hdBasemapCenter = curLabelData?.hdBasemapCenter || null;
            mapState.imageBasemapCenter = null;
            mapState.stopLines = curLabelData?.stopLines || {};
            mapState.trafficSignals = curLabelData?.trafficSignals || {};
            mapState.parkingSpaces = curLabelData?.parkingSpaces || {};
            mapState.grouds = curLabelData?.grouds || {};
            mapState.signs = curLabelData?.signs || {};
            mapState.barrierGates = curLabelData?.barrierGates || {};
            mapState.prossibleDrivingDirections = curLabelData?.prossibleDrivingDirections || {};
            mapState.needRender = true;
            mapState.onsave = true;
            Object.keys(mapState.points).forEach((key) => {
                mapState.points[key].position = new THREE.Vector3(
                    mapState.points[key].position.x,
                    mapState.points[key].position.y,
                    mapState.points[key].position.z || 0,
                );
            });
            Object.keys(mapState.boundarys).forEach((key) => {
                mapState.boundarys[key].controlsPosition = mapState.boundarys[key].controlsPosition.map(
                    (item) => new THREE.Vector3(item.x, item.y, item.z),
                );
            });
            Object.keys(mapState.boundarys).forEach((bId) => {
                mapState.needRenderElements[ThreeObject.Boundary][bId] = mapState.boundarys[bId].type;
            });
            Object.keys(mapState.points).forEach((pId) => {
                mapState.needRenderElements[ThreeObject.Point][pId] = mapState.points[pId].type;
            });
            Object.keys(mapState.grouds).forEach((gId) => {
                mapState.needRenderElements[ThreeObject.Groud][gId] = mapState.grouds[gId].type;
            });
            Object.keys(mapState.trafficSignals).forEach((tId) => {
                mapState.trafficSignals[tId].center = new THREE.Vector3(
                    mapState.trafficSignals[tId].center.x,
                    mapState.trafficSignals[tId].center.y,
                    mapState.trafficSignals[tId].center.z,
                );
                mapState.needRenderElements[ThreeObject.TrafficLight][tId] = ThreeElementType.TrafficLight;
            });
            Object.keys(mapState.prossibleDrivingDirections).forEach((aId) => {
                mapState.needRenderElements[ThreeObject.Arrow][aId] = mapState.prossibleDrivingDirections[aId].type;
            });
            Object.keys(mapState.signs).forEach((sId) => {
                mapState.needRenderElements[ThreeObject.Sign][sId] = ThreeElementType.SignIcon;
            });
            setMapState(mapState);
            PubSub.publish('closeRemind');
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        let requestAnimationFrameID: number;
        const anim = () => {
            // if (
            //     viewstate.permissionStatus !== PermissionStatus.OnTrial &&
            //     viewstate.permissionStatus !== PermissionStatus.HasPermission
            // ) {
            //     return;
            // }
            // 第一次进入页面时看一下是否有上次编辑的内容，则弹窗提醒是否恢复
            if (!isRegister.current) {
                const mapEditingData = window.localStorage.getItem('mapEditingData');
                if (mapEditingData) {
                    setVisible(true);
                }
                isRegister.current = true;
            }
            // onsave 状态为 true 时，表示有编辑数据没有保存，则每分钟自动保存一次
            const { onsave } = useManagerStore.getState().mapState;
            const curTime = new Date().getTime();
            if (curTime - autoSaveDataTimer.current > 1000 * 10 && onsave) {
                const curMapStateData = useManagerStore.getState().mapState;
                const localData: any = {
                    boundarys: { ...curMapStateData.boundarys },
                    lanes: { ...curMapStateData.lanes },
                    junctions: { ...curMapStateData.junctions },
                    crosswalks: { ...curMapStateData.crosswalks },
                    speedBumps: { ...curMapStateData.speedBumps },
                    points: { ...curMapStateData.points },
                    stopLines: { ...curMapStateData.stopLines },
                    trafficSignals: { ...curMapStateData.trafficSignals },
                    parkingSpaces: { ...curMapStateData.parkingSpaces },
                    grouds: { ...curMapStateData.grouds },
                    prossibleDrivingDirections: { ...curMapStateData.prossibleDrivingDirections },
                    signs: { ...curMapStateData.signs },
                    areas: { ...curMapStateData.areas },
                    barrierGates: { ...curMapStateData.barrierGates },
                };
                Object.keys(localData).forEach((key) => {
                    if (Object.keys(localData[key]).length === 0) {
                        delete localData[key];
                    }
                });
                if (Object.keys(localData).length === 0) {
                    window.localStorage.removeItem('mapEditingData');
                    return;
                }
                localData.hdBasemapCenter = curMapStateData.hdBasemapCenter || null;
                localData.imageBasemapCenter = curMapStateData.imageBasemapCenter || null;
                try {
                    if (JSON.stringify(localData)) {
                        window.localStorage.setItem('mapEditingData', JSON.stringify(localData));
                    }
                } catch (e) {
                    console.error(e);
                }
                autoSaveDataTimer.current = curTime;
            }
            requestAnimationFrameID = requestAnimationFrame(anim);
        };
        anim();
        return () => {
            cancelAnimationFrame(requestAnimationFrameID);
        };
    }, [viewstate.onsave]);
    return (
        visible && (
            <RemindModal
                titledata="是否恢复上次编辑内容?"
                content="检测到您上次退出时未保存已编辑内容"
                onOkCallback={() => {
                    setVisible(false);
                    recoverDataHandle();
                    window.localStorage.removeItem('mapEditingData');
                }}
                onCancelCallback={() => {
                    setVisible(false);
                    window.localStorage.removeItem('mapEditingData');
                }}
            />
        )
    );
}
