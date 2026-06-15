import { AreaType } from 'src/interface/areaInterFace';
import { InterActiveType, OperationType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { drawArrow, updateArrow } from 'src/object/arrow';
import { drawBoundary, updateBoundary } from 'src/object/boundary';
import { drawGroud, updateGroud, updateGroudTexture } from 'src/object/groud';
import { drawPoint, updatePoint } from 'src/object/point';
import { drawSignIcon, updateSignIcon, updateSignIconTexure } from 'src/object/sign';
import { drawTrafficLight, updateTrafficLight } from 'src/object/trafficLight';
import { useManagerStore } from 'src/store';
import { searchAreaFromGroudId } from 'src/utils/search/areaSearch';
import { searchGroudShapePositions } from 'src/utils/search/groudSearch';
import { searchSignPoints } from 'src/utils/search/signSearch';
import { Object3D } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2';

export function updateElements() {
    const { mapState } = useManagerStore.getState();
    const {
        scene,
        needRenderElements,
        points,
        boundarys,
        grouds,
        prossibleDrivingDirections,
        trafficSignals,
        operationType,
        signs,
    } = mapState;
    // 单次遍历场景按类型分桶，替代原先每次渲染 8 次 getObjectsByProperty 全场景遍历。
    // 大图下这是渲染热路径的主要开销来源。
    const scenePoints: { [id: string]: Object3D } = {};
    const sceneBoundarys: {
        [id: string]: {
            line: THREE.Object3D;
            line2: Line2;
        };
    } = {};
    const sceneGrouds: { [id: string]: THREE.Object3D } = {};
    const sceneArrows: { [id: string]: THREE.Object3D } = {};
    const sceneTrafficLights: { [id: string]: Object3D } = {};
    const sceneSigns: { [id: string]: Object3D } = {};

    const NAME_POINT = `${ThreeObject.Point}`;
    const NAME_BOUNDARY = `${ThreeObject.Boundary}`;
    const NAME_LINE2 = `${ThreeObject.Line2}`;
    const NAME_GROUD = `${ThreeObject.Groud}`;
    const NAME_ARROW = `${ThreeObject.Arrow}`;
    const NAME_TRAFFIC_LIGHT = `${ThreeObject.TrafficLight}`;
    const NAME_SIGN = `${ThreeObject.Sign}`;

    const ensureBoundaryEntry = (id: string) => {
        if (!sceneBoundarys[id]) {
            sceneBoundarys[id] = { line: null, line2: null };
        }
        return sceneBoundarys[id];
    };

    scene.traverse((obj) => {
        const { name } = obj;
        if (!name) {
            return;
        }
        const { id } = obj.userData;
        switch (name) {
            case NAME_POINT:
                scenePoints[id] = obj;
                break;
            case NAME_BOUNDARY:
                ensureBoundaryEntry(id).line = obj;
                break;
            case NAME_LINE2:
                ensureBoundaryEntry(id).line2 = obj as Line2;
                break;
            case NAME_GROUD:
                sceneGrouds[id] = obj;
                break;
            case NAME_ARROW:
                sceneArrows[id] = obj;
                break;
            case NAME_TRAFFIC_LIGHT:
                sceneTrafficLights[id] = obj;
                break;
            case NAME_SIGN:
                sceneSigns[id] = obj;
                break;
            default:
                break;
        }
    });

    Object.keys(needRenderElements[ThreeObject.Point]).forEach((id: string) => {
        // 更新
        if (points[id] && scenePoints[id]) {
            updatePoint(scenePoints[id] as THREE.Mesh, points[id]);
        } else if (points[id] && !scenePoints[id]) {
            // 添加
            const pointMesh = drawPoint(id);
            PubSub.publishSync('addObject', pointMesh);
        } else {
            const deleteScenePoint = scenePoints[id];
            PubSub.publishSync('removeObject', deleteScenePoint);
        }
    });

    Object.keys(needRenderElements[ThreeObject.Boundary]).forEach((id: string) => {
        // 更新
        if (boundarys[id] && sceneBoundarys[id]) {
            const boundary = boundarys[id];
            if (!boundary) {
                return;
            }
            if (boundary.pointIds.length < 2) {
                PubSub.publishSync('removeObject', sceneBoundarys[id].line);
                PubSub.publishSync('removeObject', sceneBoundarys[id].line2);
            } else {
                updateBoundary(id);
            }
        } else if (boundarys[id] && !sceneBoundarys[id]) {
            // 添加
            const { line: boundaryMesh, line2: line2Mesh } = drawBoundary(id) || {};
            if (boundaryMesh) {
                PubSub.publishSync('addObject', boundaryMesh);
            }
            if (line2Mesh) {
                PubSub.publishSync('addObject', line2Mesh);
            }
        } else {
            const deleteSceneBoundary = sceneBoundarys[id];
            if (deleteSceneBoundary?.line) {
                PubSub.publishSync('removeObject', deleteSceneBoundary.line);
            }
            if (deleteSceneBoundary?.line2) {
                PubSub.publishSync('removeObject', deleteSceneBoundary.line2);
            }
        }
    });

    Object.keys(needRenderElements[ThreeObject.Groud]).forEach(async (id: string) => {
        // 更新
        if (grouds[id] && sceneGrouds[id]) {
            const shapePositions = searchGroudShapePositions(id);
            if (shapePositions.length < 3) {
                PubSub.publishSync('removeObject', sceneGrouds[id]);
            } else {
                updateGroud(id);
            }
        } else if (grouds[id] && !sceneGrouds[id]) {
            // 添加
            const groudMesh = drawGroud(id);
            if (groudMesh) {
                PubSub.publishSync('addObject', groudMesh);
                if (
                    grouds[id].type === ThreeElementType.CrosswalkGroud ||
                    grouds[id].type === ThreeElementType.SpeedBumpGroud
                ) {
                    updateGroudTexture(grouds[id].type, InterActiveType.Default, groudMesh);
                }
                if (grouds[id].type === ThreeElementType.AreaGroud) {
                    const area = searchAreaFromGroudId(id);
                    if (area && area.type === AreaType.UnDriveable) {
                        updateGroudTexture(grouds[id].type, InterActiveType.Default, groudMesh);
                    }
                }
            }
        } else {
            const deleteSceneGroud = sceneGrouds[id];
            if (deleteSceneGroud) {
                PubSub.publishSync('removeObject', deleteSceneGroud);
            }
        }
    });

    Object.keys(needRenderElements[ThreeObject.Arrow]).forEach((id: string) => {
        // 更新
        if (prossibleDrivingDirections[id] && sceneArrows[id]) {
            updateArrow(id);
        } else if (prossibleDrivingDirections[id] && !sceneArrows[id]) {
            // 添加
            const arrowMesh = drawArrow(id);
            if (arrowMesh) {
                PubSub.publishSync('addObject', arrowMesh);
                PubSub.publishSync('render');
            }
        } else {
            const deleteSceneArrow = sceneArrows[id];
            if (deleteSceneArrow) {
                PubSub.publishSync('removeObject', deleteSceneArrow);
            }
        }
    });

    Object.keys(needRenderElements[ThreeObject.TrafficLight]).forEach(async (id: string) => {
        // 更新
        if (trafficSignals[id] && sceneTrafficLights[id]) {
            const trafficLight = trafficSignals[id];
            const center = trafficLight.center;
            if (!center) {
                PubSub.publishSync('removeObject', sceneTrafficLights[id]);
                return;
            }
            updateTrafficLight(id);
        } else if (trafficSignals[id] && !sceneTrafficLights[id]) {
            // 添加
            const trafficLightMesh = drawTrafficLight(id);
            if (trafficLightMesh) {
                PubSub.publishSync('addObject', trafficLightMesh);
            }
        } else {
            const deleteSceneTrafficLight = sceneTrafficLights[id];
            if (deleteSceneTrafficLight) {
                PubSub.publishSync('removeObject', deleteSceneTrafficLight);
            }
        }
    });

    Object.keys(needRenderElements[ThreeObject.Sign]).forEach(async (id: string) => {
        // 更新
        if (signs[id] && sceneSigns[id]) {
            const sign = signs[id];
            const pointIds = searchSignPoints(id);
            if (pointIds.length < 2) {
                const deleteSceneSign = sceneSigns[id];
                PubSub.publishSync('removeObject', deleteSceneSign);
                return;
            }

            if (sign.type !== sceneSigns[id].userData.signType) {
                await updateSignIconTexure(sceneSigns[id], sceneSigns[id].userData.interActiveType);
                PubSub.publishSync('render');
                return;
            }
            updateSignIcon(id);
        } else if (signs[id] && !sceneSigns[id]) {
            // 添加
            const signIconMesh = await drawSignIcon(id, InterActiveType.Default);
            if (signIconMesh) {
                PubSub.publishSync('addObject', signIconMesh);
            }
        } else {
            const deleteSceneSign = sceneSigns[id];
            if (deleteSceneSign) {
                PubSub.publishSync('removeObject', deleteSceneSign);
            }
        }
    });

    if (operationType !== OperationType.SplitLaneInVertical) {
        if (points.start) {
            const deleteScenePoint = scenePoints.start;
            delete points.start;
            useManagerStore.getState().setMapState(mapState);
            PubSub.publishSync('removeObject', deleteScenePoint);
            PubSub.publish('removeMouseMoveElements');
        }
    }
}
