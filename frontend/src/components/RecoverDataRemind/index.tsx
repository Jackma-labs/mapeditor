import React, { useEffect, useRef, useState } from 'react';
import RemindModal from 'src/components/RemindModal/index';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { message } from 'src/components/Message';
import FileService from 'src/service/index';
import * as THREE from 'three';

const AUTO_SAVE_INTERVAL_MS = 1000 * 10;
// 服务端草稿保存频率低于本地备份，避免频繁网络请求；仅作磁盘级兜底。
const SERVER_DRAFT_INTERVAL_MS = 1000 * 60;

export default function Index() {
    const [visible, setVisible] = useState(false);
    const isRegister = useRef(false);
    const autoSaveDataTimer = useRef(new Date().getTime());
    const serverDraftTimer = useRef(0);
    const quotaWarned = useRef(false);

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
            // 恢复坐标元数据，否则恢复出的地图会丢失 CRS/anchor 信息，导致发布坐标错误
            if (curLabelData?.coordinateFrame) {
                mapState.coordinateFrame = curLabelData.coordinateFrame;
            }
            if (curLabelData?.targetCrs) {
                mapState.targetCrs = curLabelData.targetCrs;
            }
            if (curLabelData?.apolloOrigin !== undefined) {
                mapState.apolloOrigin = curLabelData.apolloOrigin;
            }
            if (curLabelData?.coordinateAnchor !== undefined) {
                mapState.coordinateAnchor = curLabelData.coordinateAnchor;
            }
            if (curLabelData?.baseMapDir !== undefined) {
                mapState.baseMapDir = curLabelData.baseMapDir;
            }
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
        // 第一次进入页面时看一下是否有上次编辑的内容，则弹窗提醒是否恢复
        if (!isRegister.current) {
            const mapEditingData = window.localStorage.getItem('mapEditingData');
            if (mapEditingData) {
                setVisible(true);
            }
            isRegister.current = true;
        }

        // 用定时器替代 requestAnimationFrame：原实现以 60fps 空转只为检查一个 10s
        // 计时器，浪费 CPU。这里改为按固定间隔检查 onsave 并写入本地备份。
        const tick = () => {
            const { onsave } = useManagerStore.getState().mapState;
            const curTime = new Date().getTime();
            if (curTime - autoSaveDataTimer.current <= AUTO_SAVE_INTERVAL_MS || !onsave) {
                return;
            }
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
            // 一并保存坐标元数据，恢复时才能保持同一坐标体系
            localData.coordinateFrame = curMapStateData.coordinateFrame || null;
            localData.targetCrs = curMapStateData.targetCrs || null;
            localData.apolloOrigin = curMapStateData.apolloOrigin || null;
            localData.coordinateAnchor = curMapStateData.coordinateAnchor || null;
            localData.baseMapDir = curMapStateData.baseMapDir || '';
            try {
                window.localStorage.setItem('mapEditingData', JSON.stringify(localData));
                quotaWarned.current = false;
            } catch (e) {
                console.error('[autosave] 本地自动备份失败', e);
                // 静默吞掉配额错误会让用户误以为有恢复点。明确告警，提示尽快手动保存。
                if (!quotaWarned.current) {
                    quotaWarned.current = true;
                    message({
                        type: 'warning',
                        content:
                            '本地自动备份失败（地图数据过大或浏览器存储已满），请尽快点击“保存”手动保存到服务器，避免丢失。',
                    });
                }
            }
            autoSaveDataTimer.current = curTime;

            // 服务端草稿兜底：低频、非阻塞、失败静默。即使本地备份失败或换机器，
            // 也能从服务器 .autosave 目录恢复最近草稿。
            const mapName = String(curMapStateData.hdMapFile || '').trim();
            if (mapName && curTime - serverDraftTimer.current > SERVER_DRAFT_INTERVAL_MS) {
                serverDraftTimer.current = curTime;
                try {
                    const exportData = useManagerStore.getState().export();
                    FileService.autosaveEditorMapDraft(mapName, exportData).catch(() => {
                        // 草稿保存失败不影响编辑，本地备份仍在
                    });
                } catch (e) {
                    console.error('[autosave] 服务端草稿构建失败', e);
                }
            }
        };

        const intervalId = window.setInterval(tick, AUTO_SAVE_INTERVAL_MS);
        return () => {
            window.clearInterval(intervalId);
        };
    }, []);
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
