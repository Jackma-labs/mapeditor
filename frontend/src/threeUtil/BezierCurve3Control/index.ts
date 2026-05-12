import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { searchPointByPointId } from 'src/utils/search/pointSearch';
import * as THREE from 'three';
import { InterActiveType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { controlLineColor } from 'src/constant/color';
import { disposeMesh } from 'src/utils/threeObjectUtil';
import PubSub from 'pubsub-js';
import { DragPointCommand } from 'src/command/PointCommand';
import { generateControlPointCanvasTexture } from 'src/utils/textureUtil';
import { drawLine } from 'src/object/basicObject';
import { drawControlPoint } from 'src/object/point';
import { UpdateBoundaryCommand, UpdateBoundarycontrolsCommand } from 'src/command/BoundaryCommand';
import { searchLanesFromBoundaryId } from 'src/utils/search/laneSearch';
import { updateGroud } from 'src/object/groud';
import { updateBoundary } from 'src/object/boundary';
import { updateArrow } from 'src/object/arrow';
import { searchPointsRelationObjects } from 'src/utils/search/common';
import { UpdateGroudCommand } from 'src/command/GroudCommand';
import { UpdateArrowCommand } from 'src/command/ArrowCommand';
import { mapElementZ } from 'src/constant/mapElementZ';
import { Line2 } from 'three/examples/jsm/lines/Line2';
import CameraControl from '../cameraControl';

export default class BezierCurve3Control {
    private controlMeshs: {
        [id: string]: {
            firstControlPoint: THREE.Mesh;
            firstControlLine: THREE.Line;
            firstControlLine2: Line2;
            secondControlPoint: THREE.Mesh;
            secondControlLine: THREE.Line;
            secondControlLine2: Line2;
        };
    };

    private curveId: string;

    public currentDragElement: THREE.Object3D;

    private cameraControl: CameraControl;

    constructor(cameraControl: CameraControl) {
        this.controlMeshs = {};
        this.initEvent();
        this.cameraControl = cameraControl;
    }

    initEvent() {
        PubSub.subscribe('disableModify', (_name, id) => {
            this.disableModify(id);
        });
        PubSub.subscribe('enableModify', (_name, id) => {
            this.enableModify(id);
        });
        PubSub.subscribe('dragControlPoint', (_name, object) => {
            this.dragControlPoint(object);
        });
        PubSub.subscribe('dragEndControlPoint', () => {
            this.dragEnd();
        });
        PubSub.subscribe('controlPointInteractive', (_name, info: { mesh: THREE.Mesh; type: InterActiveType }) => {
            this.controlPointInteractive(info.mesh, info.type);
        });
    }

    enableModify(curveId: string) {
        const { scene } = useManagerStore.getState().mapState;
        const curve = searchBoundaryByBoundaryId(curveId);
        const { controlsPosition, pointIds } = curve;
        const startPoint = searchPointByPointId(pointIds[0]);
        const endPoint = searchPointByPointId(pointIds[1]);

        const startControlPointMesh = drawControlPoint(
            controlsPosition[0],
            generateControlPointCanvasTexture(InterActiveType.Default),
        );
        startControlPointMesh.userData = {
            type: ThreeElementType.CurveControlPoint,
            curveId,
            linkPointId: pointIds[0],
            isFirst: true,
        };

        const endControlPointMesh = drawControlPoint(
            controlsPosition[1],
            generateControlPointCanvasTexture(InterActiveType.Default),
        );
        endControlPointMesh.userData = {
            type: ThreeElementType.CurveControlPoint,
            curveId,
            linkPointId: pointIds[1],
            isFirst: false,
        };
        const { line: firstLine, line2: firstLine2 } =
            drawLine([startPoint.position, controlsPosition[0]], controlLineColor) || {};
        firstLine.userData = { ...firstLine.userData, start: startPoint.position };
        firstLine.position.z = mapElementZ[ThreeElementType.CurveControlLine];
        if (firstLine2) {
            firstLine2.userData = { ...firstLine.userData, start: startPoint.position };
            firstLine2.position.z = mapElementZ[ThreeElementType.CurveControlLine];
        }
        const { line: secondLine, line2: secondLine2 } =
            drawLine([endPoint.position, controlsPosition[1]], controlLineColor) || {};
        secondLine.userData = { ...secondLine.userData, start: endPoint.position };
        secondLine.position.z = mapElementZ[ThreeElementType.CurveControlLine];
        if (secondLine2) {
            secondLine2.userData = { ...firstLine.userData, start: endPoint.position };
            secondLine2.position.z = mapElementZ[ThreeElementType.CurveControlLine];
        }
        this.controlMeshs[curveId] = {
            firstControlPoint: startControlPointMesh,
            firstControlLine: firstLine,
            firstControlLine2: firstLine2,
            secondControlPoint: endControlPointMesh,
            secondControlLine: secondLine,
            secondControlLine2: secondLine2,
        };
        [startControlPointMesh, endControlPointMesh, firstLine, secondLine, firstLine2, secondLine2].forEach((mesh) =>
            scene.add(mesh),
        );
        PubSub.publish('render');
    }

    disableModify(curveId: string) {
        if (!this.controlMeshs[curveId]) {
            return;
        }
        const { scene } = useManagerStore.getState().mapState;
        const {
            firstControlPoint,
            secondControlPoint,
            firstControlLine,
            secondControlLine,
            firstControlLine2,
            secondControlLine2,
        } = this.controlMeshs[curveId];
        [
            firstControlPoint,
            secondControlPoint,
            firstControlLine,
            secondControlLine,
            firstControlLine2,
            secondControlLine2,
        ].forEach((mesh) => disposeMesh(mesh, scene));
        delete this.controlMeshs[curveId];
    }

    dragControlPoint(mesh: THREE.Mesh) {
        if (!mesh || !this.currentDragElement) {
            return;
        }
        const { curveId, isFirst } = mesh.userData;
        this.curveId = curveId;
        if (!this.curveId) {
            return;
        }
        this.cameraControl.disable();
        const updateLine1 = this.controlMeshs[curveId][isFirst ? 'firstControlLine' : 'secondControlLine'];
        const updateLine2 = this.controlMeshs[curveId][isFirst ? 'firstControlLine2' : 'secondControlLine2'];
        this.updateControlLine(updateLine1, updateLine2, updateLine1.userData.start, mesh.position.clone());
        const curve = searchBoundaryByBoundaryId(curveId);
        if (curve.type === ThreeElementType.LaneCurveBoundary) {
            const linkLanes = searchLanesFromBoundaryId(curveId);
            linkLanes.forEach((lane) => {
                updateBoundary(lane.leftBoundaryId);
                updateBoundary(lane.rightBoundaryId);
                updateArrow(lane.arrowId);
                updateGroud(lane.groudId);
            });
        } else {
            updateBoundary(curveId);
        }
    }

    dragEnd() {
        this.cameraControl.enable();
        if (!this.curveId || !this.currentDragElement) {
            return;
        }
        const curve = searchBoundaryByBoundaryId(this.curveId);
        if (!curve) {
            return;
        }
        const actions: any = [];
        actions.push(new UpdateBoundarycontrolsCommand(this.curveId));
        curve.pointIds.forEach((pId) => actions.push(new DragPointCommand(pId)));
        const { boundarys, grouds, arrows } = searchPointsRelationObjects(curve.pointIds);
        boundarys.forEach((item) => actions.push(new UpdateBoundaryCommand(item.id)));
        grouds.forEach((item) => actions.push(new UpdateGroudCommand(item.id)));
        arrows.forEach((item) => actions.push(new UpdateArrowCommand(item.id)));

        useManagerStore.getState().addCommand(actions);
        this.curveId = null;
        this.currentDragElement = null;
    }

    controlPointInteractive(mesh: THREE.Mesh, type: InterActiveType) {
        Object.keys(this.controlMeshs).forEach((id) => {
            const { firstControlPoint, secondControlPoint } = this.controlMeshs[id];
            this.updateControlPointTexture(firstControlPoint, InterActiveType.Default);
            this.updateControlPointTexture(secondControlPoint, InterActiveType.Default);
        });
        this.updateControlPointTexture(mesh, type);
    }

    updateControlPointTexture(mesh: THREE.Mesh, type: InterActiveType) {
        const texture: THREE.CanvasTexture = generateControlPointCanvasTexture(type);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
        });
        (mesh.material as THREE.Material).needsUpdate = true;
        material.map.colorSpace = 'srgb';
        mesh.material = material;
        PubSub.publish('render');
        if (type === InterActiveType.Active) {
            this.currentDragElement = mesh;
        }
    }

    updateControlLine(line: THREE.Line, line2: Line2, start: THREE.Vector3, end: THREE.Vector3) {
        if (!line || !start || !end) {
            return;
        }
        const { line: meshLine, line2: meshLine2 } = drawLine([start, end], controlLineColor);
        line.geometry = meshLine.geometry;
        line.geometry.getAttribute('position').needsUpdate = true;
        line.geometry.computeBoundingSphere();

        line2.geometry = meshLine2.geometry;
        line2.geometry.getAttribute('position').needsUpdate = true;
        line2.geometry.computeBoundingSphere();
    }
}
