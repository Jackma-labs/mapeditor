import { laneBoundaryColor } from 'src/constant/color';
import { InterActiveType, ThreeElementType } from 'src/interface/commonInterFace';
import { drawLine2 } from 'src/object/basicObject';
import { useManagerStore } from 'src/store';
import { disposeGroup, disposeMesh, getElementMaxIndex, getPickupObject } from 'src/utils/threeObjectUtil';
import { getExtendPoint, transScreenPositionToWorld, vector2TransTpVector3 } from 'src/utils/vectorUtil';
import { LaneBoundaryType } from 'src/interface/laneInterFace';
import * as THREE from 'three';
import Pubsub from 'pubsub-js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { Line2 } from 'three/examples/jsm/lines/Line2';
import { mapElementZ } from 'src/constant/mapElementZ';
import {
    RangingPointStatus,
    drawRangeArc,
    drawRangeRemoveIcon,
    drawRanginPoint,
    getArcLabelPosition,
    getArcRadian,
    showLabel,
} from './util';

interface RangeItem {
    clickedPoints: {
        position: THREE.Vector3;
        object: THREE.Mesh;
        id: string;
    }[];
    clickedArcs: { angle: number; object: THREE.Group; id: string }[];
    clickedLine: Line2;
    removeIcon: THREE.Mesh;
}
export default class RangingCotrol {
    private ranges: { [id: string]: RangeItem };

    private curRangeId: string;

    private mousePromotHTMLId: string;

    private dom: HTMLElement;

    private timer: number;

    private mouseLine: Line2;

    private mousePoint: THREE.Mesh;

    private mouseArc: THREE.Group;

    constructor(dom: HTMLElement) {
        this.dom = dom;
        this.ranges = {};
        this.curRangeId = null;
        this.mousePromotHTMLId = 'mouse-promot';
        this.timer = 0;
        this.mouseLine = null;
        this.mousePoint = null;
        this.mouseArc = null;
        this.registerEvents();
    }

    mousemoveHandle(e: MouseEvent) {
        const { ranging } = useManagerStore.getState().mapState;
        if (!ranging) {
            return;
        }
        if (!this.curRangeId) {
            this.curRangeId = `${getElementMaxIndex(this.ranges) + 1}`;
            this.ranges[this.curRangeId] = {
                clickedPoints: [],
                clickedLine: null,
                clickedArcs: [],
                removeIcon: null,
            };
        }
        const mousePointPosition = vector2TransTpVector3(
            transScreenPositionToWorld(e),
            mapElementZ[ThreeElementType.RangePoint],
        );
        this.updateMousePromot({ left: e.clientX + 10, top: e.clientY - 64 }, mousePointPosition);
        this.updateMousePoint(mousePointPosition);
        this.updateMouseLine();
        this.updateMouseArc();
    }

    clickHandle(e: MouseEvent) {
        const { scene, camera, dom } = useManagerStore.getState().mapState;
        const removeIcon = getPickupObject(e, camera, dom, scene, [ThreeElementType.RangeRemoveIcon]);
        if (removeIcon) {
            const rangeId = removeIcon.userData.rangeId;
            this.removeOneRange(rangeId);
            return;
        }
        const curTime = new Date().getTime();
        if (curTime - this.timer < 250) {
            return;
        }
        this.timer = curTime;

        const worldPosition = vector2TransTpVector3(
            transScreenPositionToWorld(e),
            mapElementZ[ThreeElementType.RangePoint],
        );
        this.updateClickedPoints(worldPosition);
        this.updateClickedLine();
        this.updateClickArc();
        PubSub.publish('render');
    }

    dblclickHandle() {
        const { ranging } = useManagerStore.getState().mapState;
        if (!ranging || !this.curRangeId) {
            return;
        }
        // 清除最后一个点，且设置为非测距状态
        const { clickedPoints } = this.ranges[this.curRangeId];
        if (clickedPoints.length !== 0) {
            const lastPoint = clickedPoints.pop();
            this.removeHasLabelObject(lastPoint.object, lastPoint.id);
            this.updateClickedLine();
            this.removeLastClickedArc(this.curRangeId);
        }
        this.exitRanging();
    }

    registerEvents() {
        this.dom.addEventListener('mousemove', (e) => this.mousemoveHandle(e));
        this.dom.addEventListener('click', (e) => this.clickHandle(e));
        this.dom.addEventListener('dblclick', () => this.dblclickHandle());
        Pubsub.subscribe('exitRanging', () => this.exitRanging());
        Pubsub.subscribe('removeAllRange', () => this.removeAllRange());
    }

    dispose() {
        this.dom.removeEventListener('mousemove', this.mousemoveHandle);
        this.dom.removeEventListener('click', this.clickHandle);
        this.dom.removeEventListener('dblclick', this.dblclickHandle);
    }

    // 更新鼠标移动过程中的文案提示
    updateMousePromot(mousePos: { left: number; top: number }, mousePointPosition: THREE.Vector3) {
        const { ranging } = useManagerStore.getState().mapState;
        let mousePromotDom = document.getElementById(this.mousePromotHTMLId);
        if (!ranging || !this.curRangeId) {
            return;
        }
        let title: string = null;
        let content: string = null;
        const clickedPoints = this.ranges[this.curRangeId]?.clickedPoints || [];
        if (clickedPoints.length === 0) {
            title = '单击确定测量起点';
            content = null;
        } else {
            title = `${mousePointPosition.distanceTo(clickedPoints[clickedPoints.length - 1].position).toFixed(2)}m`;
            content = '单击确定测量节点，双击退出';
        }
        if (!mousePromotDom) {
            const div = document.createElement('div');
            div.id = this.mousePromotHTMLId;
            div.style.position = 'absolute';
            div.style.zIndex = '10';
            div.style.background = '#505866';
            div.style.borderRadius = '8px';
            div.style.padding = '5px 12px';

            const titleDom = document.createElement('div');
            titleDom.style.color = ' #FFFFFF';
            titleDom.style.lineHeight = content ? '22px' : '36px';
            div.appendChild(titleDom);

            const contentDom = document.createElement('div');
            contentDom.style.color = '#A6B5CC';
            contentDom.style.fontSize = '12px';
            div.appendChild(contentDom);
            mousePromotDom = div;

            this.dom.appendChild(div);
        }
        mousePromotDom.style.left = `${mousePos.left}px`;
        mousePromotDom.style.top = `${mousePos.top}px`;
        mousePromotDom.style.display = 'block';
        if (mousePromotDom.firstChild) {
            (mousePromotDom.firstChild as HTMLElement).innerHTML = title;
        }
        if (mousePromotDom.lastChild) {
            (mousePromotDom.lastChild as HTMLElement).innerHTML = content;
        }
    }

    hideMousePromot() {
        const mousePromotDom = document.getElementById(this.mousePromotHTMLId);
        if (mousePromotDom) {
            mousePromotDom.style.display = 'none';
        }
    }

    clearMousePromot() {
        const mousePromotDom = document.getElementById(this.mousePromotHTMLId);
        if (mousePromotDom && mousePromotDom.parentNode) {
            mousePromotDom.parentNode.removeChild(mousePromotDom);
        }
    }

    updateClickedLine() {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!this.ranges[this.curRangeId] || !ranging) {
            return;
        }
        const { clickedPoints, clickedLine } = this.ranges[this.curRangeId];
        if (clickedLine) {
            disposeMesh(clickedLine, scene);
        }
        if (clickedPoints.length >= 2) {
            const lineMesh = drawLine2(
                clickedPoints.map((item) => item.position),
                laneBoundaryColor[InterActiveType.Active],
            );
            lineMesh.position.z = mapElementZ[ThreeElementType.RangeLine];
            this.ranges[this.curRangeId].clickedLine = lineMesh;
            scene.add(lineMesh);
        }
    }

    updateClickedPoints(clickPos: THREE.Vector3) {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!ranging || !this.curRangeId) {
            return;
        }
        this.removeMousePoint();
        const { clickedPoints } = this.ranges[this.curRangeId];
        const pointMesh = drawRanginPoint(clickPos, RangingPointStatus.Click);
        const pId = `${this.curRangeId}_${clickedPoints.length}`;
        if (clickedPoints && clickedPoints.length >= 1) {
            const beforePoint = clickedPoints[clickedPoints.length - 1];
            const distance = beforePoint.position.distanceTo(clickPos);
            const labelText = `${distance.toFixed(2)}m`;
            const labelPosition = new THREE.Vector3()
                .subVectors(beforePoint.position, clickPos)
                .normalize()
                .multiplyScalar(distance / 2);
            showLabel(pointMesh, labelText, pId, labelPosition, new THREE.Vector2(0.5, 0.5));
        }
        scene.add(pointMesh);
        clickedPoints.push({ position: clickPos, object: pointMesh, id: pId });
    }

    updateMouseLine() {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!ranging || !this.curRangeId) {
            return;
        }
        const { clickedPoints } = this.ranges[this.curRangeId];
        this.removeMouseLine();
        if (this.mousePoint && clickedPoints.length !== 0) {
            const mouseLineMesh = drawLine2(
                [clickedPoints[clickedPoints.length - 1].position, this.mousePoint.position],
                laneBoundaryColor[InterActiveType.Active],
                LaneBoundaryType.WHITEDOTTED,
            );
            mouseLineMesh.position.z = mapElementZ[ThreeElementType.RangeLine];
            scene.add(mouseLineMesh);
            this.mouseLine = mouseLineMesh;
        }
    }

    removeMouseLine() {
        if (!this.mouseLine) {
            return;
        }
        disposeMesh(this.mouseLine, useManagerStore.getState().mapState.scene);
        this.mouseLine = null;
    }

    updateMousePoint(mousePos?: THREE.Vector3) {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!this.curRangeId || !ranging) {
            return;
        }
        if (!this.mousePoint) {
            const mousePointMesh = drawRanginPoint(mousePos, RangingPointStatus.Mouse);
            scene.add(mousePointMesh);
            this.mousePoint = mousePointMesh;
        } else {
            this.mousePoint.position.copy(mousePos);
        }
    }

    removeMousePoint() {
        if (!this.mousePoint) {
            return;
        }
        disposeMesh(this.mousePoint, useManagerStore.getState().mapState.scene);
        this.mousePoint = null;
    }

    updateClickArc() {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!this.curRangeId || !ranging) {
            return;
        }
        const { clickedPoints, clickedArcs } = this.ranges[this.curRangeId];
        if (clickedPoints.length < 3) {
            return;
        }
        const arcRelationPoints = clickedPoints.slice(clickedPoints.length - 3);
        if (arcRelationPoints.length < 3) {
            return;
        }

        this.removeMouseArc();
        const group = drawRangeArc(
            arcRelationPoints.map((item) => item.position),
            RangingPointStatus.Click,
        );
        group.position.z = mapElementZ[ThreeElementType.RangeArc];
        scene.add(group);
        const arcId = `${this.curRangeId}_${clickedArcs.length}`;
        const radian = getArcRadian(arcRelationPoints.map((item) => item.position));
        const angle = Math.floor((radian * 180) / Math.PI);
        this.ranges[this.curRangeId].clickedArcs.push({
            angle,
            object: group,
            id: arcId,
        });
        const lablePosition = getArcLabelPosition(
            arcRelationPoints.map((item) => item.position),
            radian,
        );
        showLabel(group, `${Math.abs(angle)}°`, arcId, lablePosition, new THREE.Vector2(0.5, 0.5));
    }

    updateMouseArc() {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!ranging || !this.curRangeId || !this.mousePoint || !this.mouseLine) {
            return;
        }
        const { clickedPoints } = this.ranges[this.curRangeId];
        if (clickedPoints.length < 2) {
            return;
        }
        const lastTwoPoints = clickedPoints.slice(clickedPoints.length - 2);
        const arcRelationPoints = lastTwoPoints.map((item) => item.position).concat([this.mousePoint.position.clone()]);
        const mouseArc = drawRangeArc(arcRelationPoints, RangingPointStatus.Mouse);
        mouseArc.position.z = mapElementZ[ThreeElementType.RangeArc];
        if (this.mouseArc) {
            (this.mouseArc.children[0] as THREE.Mesh).geometry = (mouseArc.children[0] as THREE.Mesh).geometry;
            (this.mouseArc.children[1] as THREE.Mesh).geometry = (mouseArc.children[1] as THREE.Mesh).geometry;
        } else {
            scene.add(mouseArc);
            this.mouseArc = mouseArc;
        }

        const radian = getArcRadian(arcRelationPoints);
        const lablePosition = getArcLabelPosition(arcRelationPoints, radian);
        const angle = Math.floor((radian * 180) / Math.PI);
        const labelDiv = document.getElementsByClassName('label-container-mouseArc')?.[0];
        if (!labelDiv) {
            showLabel(mouseArc, `${Math.abs(angle)}°`, 'mouseArc', lablePosition, new THREE.Vector2(0.5, 0.5));
        } else {
            labelDiv.innerHTML = `${Math.abs(angle)}°`;
            (this.mouseArc.children[2] as CSS2DObject).position.copy(lablePosition);
        }
    }

    removeLastClickedArc(rangeId: string) {
        const clickedArcs = this.ranges[rangeId]?.clickedArcs;
        if (!clickedArcs || clickedArcs.length === 0) {
            return;
        }
        const lastclickedArc = clickedArcs.pop();
        this.removeHasLabelObject(lastclickedArc.object, lastclickedArc.id);
    }

    removeMouseArc() {
        if (!this.mouseArc) {
            return;
        }
        this.removeHasLabelObject(this.mouseArc, 'mouseArc');
        this.mouseArc = null;
    }

    updateRangeRemoveIcon() {
        const { ranging, scene } = useManagerStore.getState().mapState;
        if (!ranging || !this.curRangeId) {
            return;
        }
        const { clickedPoints } = this.ranges[this.curRangeId];
        if (clickedPoints.length < 2) {
            return;
        }
        const lastTwoPoints = clickedPoints.slice(clickedPoints.length - 2);
        const inconPosition = getExtendPoint(
            lastTwoPoints[0].position,
            lastTwoPoints[1].position,
            lastTwoPoints[0].position.distanceTo(lastTwoPoints[1].position) + 1,
        );
        const iconMesh = drawRangeRemoveIcon(inconPosition);
        iconMesh.userData = {
            rangeId: this.curRangeId,
            type: ThreeElementType.RangeRemoveIcon,
        };
        scene.add(iconMesh);
        this.ranges[this.curRangeId].removeIcon = iconMesh;
    }

    removeOneRange(rangeId: string) {
        if (!this.ranges[rangeId]) {
            return;
        }
        const { clickedArcs, clickedPoints, clickedLine, removeIcon } = this.ranges[rangeId];
        [...clickedPoints, ...clickedArcs].forEach((item) => this.removeHasLabelObject(item.object, item.id));
        [clickedLine, removeIcon].forEach((item) => {
            disposeGroup(item, useManagerStore.getState().mapState.scene);
        });
        delete this.ranges[rangeId];
    }

    removeAllRange() {
        Object.keys(this.ranges).forEach((id) => this.removeOneRange(id));
        this.ranges = {};
    }

    removeHasLabelObject(object: THREE.Object3D, id: string) {
        const { scene } = useManagerStore.getState().mapState;
        const labels = object.children;
        labels.forEach((item: any) => disposeGroup(item, scene));
        disposeGroup(object, scene);

        // 清除lable的div
        const htmlEle = document.getElementsByClassName(`label-container-${id}`);
        for (let i = 0; i < htmlEle.length; i += 1) {
            htmlEle[i].parentNode.removeChild(htmlEle[i]);
            i -= 1;
        }
    }

    showSumDistance(rangeId: string) {
        if (!this.ranges[rangeId]) {
            return;
        }
        const { clickedPoints } = this.ranges[rangeId];
        let sumDistance = 0;
        for (let i = 1; i < clickedPoints.length; i += 1) {
            sumDistance += clickedPoints[i].position.distanceTo(clickedPoints[i - 1].position);
        }
        showLabel(
            clickedPoints[clickedPoints.length - 1].object,
            `总长度 ${sumDistance.toFixed(2)}m`,
            clickedPoints[clickedPoints.length - 1].id,
            new THREE.Vector3(0, -2, 0),
            new THREE.Vector2(0.5, 0.5),
        );
    }

    exitRanging() {
        if (!this.curRangeId) {
            return;
        }
        const { clickedPoints } = this.ranges[this.curRangeId];
        this.removeMouseLine();
        this.removeMousePoint();
        this.removeMouseArc();
        this.clearMousePromot();
        if (clickedPoints.length < 2) {
            this.removeOneRange(this.curRangeId);
        } else {
            this.updateRangeRemoveIcon();
            this.showSumDistance(this.curRangeId);
        }
        this.curRangeId = null;
        useManagerStore.getState().setMapState({ ...useManagerStore.getState().mapState, ranging: false });
    }
}
