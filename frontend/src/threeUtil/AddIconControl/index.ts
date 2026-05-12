import { mapElementZ } from 'src/constant/mapElementZ';
import { InterActiveType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { disposeGroup } from 'src/utils/threeObjectUtil';
import PubSub from 'pubsub-js';
import { searchParkingSpaceByParkingSpaceId } from 'src/utils/search/parkingSpaceSearch';
import * as THREE from 'three';
import { generateAddIconCanvasTexture } from 'src/utils/textureUtil';
import {
    getCopyLaneSvgPositions,
    getCopyParkingSpaceIconPositions,
    getExtendBoundarySvgPositionAndDeg,
    getExtendLaneSvgPositionAndDeg,
    setAddIconPositionAndDeg,
    setAddIconUserData,
} from './util';
import CameraControl from '../cameraControl';

export default class AddIconControl {
    private addSvgGroups: THREE.Sprite[];

    private dom: HTMLElement;

    private cameraControl: CameraControl;

    constructor(dom: HTMLElement, cameraControl: CameraControl) {
        this.dom = dom;
        this.addSvgGroups = [];
        this.cameraControl = cameraControl;
        this.initEvent();
    }

    drawAddSprite(type: InterActiveType = InterActiveType.Default) {
        const texture = generateAddIconCanvasTexture(type);
        const material = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false });
        material.map.colorSpace = 'srgb';
        const sprite = new THREE.Sprite(material);
        const { fov } = this.cameraControl.cameraControls.camera as THREE.PerspectiveCamera;
        // let scale = 32 / this.dom.clientHeight;
        // scale *= Math.tan((fov / 2 / 180) * Math.PI) / Math.tan((27 / 180) * Math.PI);
        const scale = (32 * (2 * Math.tan((fov / 2 / 180) * Math.PI))) / this.dom.clientHeight;
        sprite.scale.set(scale, scale, 1);
        return sprite;
    }

    initEvent() {
        PubSub.subscribe('drawExtendLaneGroup', (_name, id: string) => this.drawExtendLaneGroup(id));
        PubSub.subscribe('removeSvgGroups', () => this.removeSvgGroups());
        PubSub.subscribe('drawCopyLaneGroup', (_name, id: string) => this.drawCopyLaneGroup(id));
        PubSub.subscribe('drawExtendBoundaryGroup', (_name, id: string) => this.drawExtendBoundaryGroup(id));
        PubSub.subscribe('resetSvgGroupsDefault', () => this.resetSvgGroupsDefault());
        PubSub.subscribe('drawCopyParkingSpaceGroup', (_name, id) => this.drawCopyParkingSpaceGroup(id));
        PubSub.subscribe('changeAddSvgColor', (_name, { sprite, type }) => this.changeAddSvgColor(sprite, type));
        this.cameraControl.cameraControls.addEventListener('update', () => {
            // 这里主要是为了让图标的偏移距离维持在固定值，不会随着相机移动而改变
            if (this.addSvgGroups.length > 0) {
                this.addSvgGroups.forEach((group) => {
                    const { laneId, type, inLeft, isStart, boundaryId, num, parkingSpaceId } = group.userData;
                    if (type) {
                        let posInfo = null;
                        if (type === ThreeElementType.ExtendLaneSvg && laneId) {
                            posInfo = getExtendLaneSvgPositionAndDeg(laneId);
                        } else if (type === ThreeElementType.AddLaneSvg && inLeft && laneId) {
                            posInfo = getCopyLaneSvgPositions(laneId)?.[0];
                        } else if (type === ThreeElementType.AddLaneSvg && !inLeft && laneId) {
                            posInfo = getCopyLaneSvgPositions(laneId)?.[1];
                        } else if (type === ThreeElementType.ExtendBoundarySvg && isStart && boundaryId) {
                            posInfo = getExtendBoundarySvgPositionAndDeg(boundaryId)?.[0];
                        } else if (type === ThreeElementType.ExtendBoundarySvg && !isStart && boundaryId) {
                            posInfo = getExtendBoundarySvgPositionAndDeg(boundaryId)?.[1];
                        } else if (type === ThreeElementType.CopyParkingSpaceSvg && num && parkingSpaceId) {
                            const parkingSpace = searchParkingSpaceByParkingSpaceId(parkingSpaceId);
                            posInfo = getCopyParkingSpaceIconPositions(parkingSpace)?.[num - 1];
                        }
                        if (posInfo && posInfo.position) {
                            group.position.set(
                                posInfo.position.x,
                                posInfo.position.y,
                                mapElementZ[ThreeElementType.AddLaneSvg],
                            );
                            group.material.rotation = posInfo.deg;
                        }
                    }
                });
            }
        });
    }

    drawExtendLaneGroup(laneId: string) {
        this.removeSvgGroups();
        const { position, deg } = getExtendLaneSvgPositionAndDeg(laneId);
        const { scene } = useManagerStore.getState().mapState;
        const group = this.drawAddSprite();
        if (!position || !group) {
            return;
        }
        scene.add(group);

        setAddIconPositionAndDeg(group, position, deg);
        setAddIconUserData(group, { type: ThreeElementType.ExtendLaneSvg, laneId });
        this.addSvgGroups.push(group);
        PubSub.publish('render');
    }

    drawCopyLaneGroup(laneId: string) {
        this.removeSvgGroups();
        const [leftDetail, rightDetail] = getCopyLaneSvgPositions(laneId);
        if (!leftDetail || !rightDetail) {
            return;
        }
        const { scene } = useManagerStore.getState().mapState;
        const leftIcon = this.drawAddSprite();
        const rightIcon = this.drawAddSprite();

        setAddIconPositionAndDeg(leftIcon, leftDetail.position, leftDetail.deg);
        setAddIconPositionAndDeg(rightIcon, rightDetail.position, rightDetail.deg);
        setAddIconUserData(leftIcon, { type: ThreeElementType.AddLaneSvg, laneId, inLeft: true });
        setAddIconUserData(rightIcon, { type: ThreeElementType.AddLaneSvg, laneId, inLeft: false });
        scene.add(leftIcon);
        scene.add(rightIcon);
        this.addSvgGroups.push(leftIcon);
        this.addSvgGroups.push(rightIcon);
        PubSub.publish('render');
    }

    drawExtendBoundaryGroup(boundaryId: string) {
        this.removeSvgGroups();
        const { scene } = useManagerStore.getState().mapState;
        const [startSvg, endSvg] = getExtendBoundarySvgPositionAndDeg(boundaryId);

        const startIcon = this.drawAddSprite();
        const endIcon = this.drawAddSprite();

        setAddIconPositionAndDeg(startIcon, startSvg.position, startSvg.deg);
        setAddIconPositionAndDeg(endIcon, endSvg.position, endSvg.deg);

        setAddIconUserData(startIcon, { boundaryId, isStart: true, type: ThreeElementType.ExtendBoundarySvg });
        setAddIconUserData(endIcon, { boundaryId, isStart: false, type: ThreeElementType.ExtendBoundarySvg });

        scene.add(startIcon);
        scene.add(endIcon);
        this.addSvgGroups.push(startIcon);
        this.addSvgGroups.push(endIcon);
        PubSub.publish('render');
    }

    drawCopyParkingSpaceGroup(parkingSpaceId: string) {
        if (!parkingSpaceId) {
            return;
        }
        this.removeSvgGroups();
        const { scene } = useManagerStore.getState().mapState;
        const parkingSpace = searchParkingSpaceByParkingSpaceId(parkingSpaceId);
        const [first, second, three, four] = getCopyParkingSpaceIconPositions(parkingSpace);
        if (!first || !second || !three || !four) {
            return;
        }

        const firstIcon = this.drawAddSprite();
        const secondIcon = this.drawAddSprite();
        const threeIcon = this.drawAddSprite();
        const fourIcon = this.drawAddSprite();

        setAddIconPositionAndDeg(firstIcon, first.position, first.deg);
        setAddIconPositionAndDeg(secondIcon, second.position, second.deg);
        setAddIconPositionAndDeg(threeIcon, three.position, three.deg);
        setAddIconPositionAndDeg(fourIcon, four.position, four.deg);

        setAddIconUserData(firstIcon, { parkingSpaceId, type: ThreeElementType.CopyParkingSpaceSvg, num: 1 });
        setAddIconUserData(secondIcon, { parkingSpaceId, type: ThreeElementType.CopyParkingSpaceSvg, num: 2 });
        setAddIconUserData(threeIcon, { parkingSpaceId, type: ThreeElementType.CopyParkingSpaceSvg, num: 3 });
        setAddIconUserData(fourIcon, { parkingSpaceId, type: ThreeElementType.CopyParkingSpaceSvg, num: 4 });

        [firstIcon, secondIcon, threeIcon, fourIcon].forEach((item) => {
            this.addSvgGroups.push(item);
            scene.add(item);
        });

        PubSub.publish('render');
    }

    removeSvgGroups() {
        const { mapState } = useManagerStore.getState();
        this.addSvgGroups.forEach((group) => {
            disposeGroup(group, mapState.scene);
        });
        this.addSvgGroups = [];
        PubSub.publish('render');
    }

    resetSvgGroupsDefault() {
        this.addSvgGroups.forEach((group) => {
            this.changeAddSvgColor(group, InterActiveType.Default);
        });
        PubSub.publish('render');
    }

    changeAddSvgColor(sprite: THREE.Sprite, type: InterActiveType) {
        if (!sprite || !type) {
            return;
        }
        const originRotate = sprite.material.rotation;
        sprite.material.map = generateAddIconCanvasTexture(type);
        sprite.material.map.center.set(0.5, 0.5);
        sprite.material.rotation = originRotate;
        sprite.material.needsUpdate = true;
        sprite.material.map.colorSpace = 'srgb';
    }
}
