import { getSignIconPositionAndDeg } from 'src/handle/sign/util';
import { InterActiveType, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { objectSearch } from 'src/utils/search/objectSearch';
import { searchSignBySignId } from 'src/utils/search/signSearch';
import * as THREE from 'three';
import stopSignIcon from 'src/assets/images/ic_scutcheon.png';
import stopSignIconHover from 'src/assets/images/ic_scutcheon_hover.png';
import stopSignIconActive from 'src/assets/images/ic_scutcheon_selected.png';

import yieldSignIcon from 'src/assets/images/ic_to_give_way.png';
import yieldSignIconHover from 'src/assets/images/ic_to_give_way_hover.png';
import yieldSignIconActive from 'src/assets/images/ic_to_give_way_selected.png';
import { SignType } from 'src/interface/SignInterFace';
import { loadImage } from './basicObject';

const signTexure: {
    [id: number]: { [id: number]: { imgUrl: string; texture: THREE.Texture } };
} = {
    [SignType.StopSign]: {
        [InterActiveType.Default]: {
            imgUrl: stopSignIcon,
            texture: null,
        },
        [InterActiveType.Hover]: {
            imgUrl: stopSignIconHover,
            texture: null,
        },
        [InterActiveType.Active]: {
            imgUrl: stopSignIconActive,
            texture: null,
        },
    },
    [SignType.YieldSign]: {
        [InterActiveType.Default]: {
            imgUrl: yieldSignIcon,
            texture: null,
        },
        [InterActiveType.Hover]: {
            imgUrl: yieldSignIconHover,
            texture: null,
        },
        [InterActiveType.Active]: {
            imgUrl: yieldSignIconActive,
            texture: null,
        },
    },
};

export async function getSignTexure(signType: SignType, interActiveType: InterActiveType) {
    if (signTexure[signType][interActiveType].texture) {
        return signTexure[signType][interActiveType].texture;
    }
    const img = await loadImage(signTexure[signType][interActiveType].imgUrl);
    signTexure[signType][interActiveType].texture = img as THREE.Texture;
    return img;
}

export async function drawSignIcon(signId: string, interActiveType: InterActiveType) {
    const sign = searchSignBySignId(signId);
    const incoInfo = getSignIconPositionAndDeg(signId);
    if (!incoInfo) {
        return null;
    }
    const planGeometry = new THREE.PlaneGeometry(2, 2);
    const imgTexure = (await getSignTexure(sign.type, interActiveType)) as THREE.Texture;
    if (!imgTexure) {
        return null;
    }
    const material = new THREE.MeshBasicMaterial({ map: imgTexure, color: 0xffffff, transparent: true });
    const mesh = new THREE.Mesh(planGeometry, material);
    mesh.position.copy(incoInfo.position);
    mesh.material.map.colorSpace = 'srgb';
    // mesh.rotateZ(incoInfo.deg);
    mesh.userData.type = ThreeElementType.SignIcon;
    mesh.userData.id = signId;
    mesh.userData.signType = sign.type;
    mesh.userData.interActiveType = interActiveType;
    mesh.name = `${ThreeObject.Sign}`;

    return mesh;
}
export function updateSignIcon(signId: string) {
    const sign = searchSignBySignId(signId);
    const iconInfo = getSignIconPositionAndDeg(signId);
    if (!sign || !iconInfo) {
        return;
    }
    const signIconMesh = objectSearch(ThreeObject.Sign, signId);
    if (!signIconMesh) {
        return;
    }

    // const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), iconInfo.deg);
    // signIconMesh.quaternion.copy(quaternion);
    signIconMesh.position.x = iconInfo.position.x;
    signIconMesh.position.y = iconInfo.position.y;
}

export async function updateSignIconTexure(object: THREE.Object3D, interActiveType: InterActiveType) {
    if (!object) {
        return;
    }
    const { id } = object.userData;
    if (!id) {
        return;
    }
    const sign = searchSignBySignId(id);
    if (!sign) {
        return;
    }
    const texture = await getSignTexure(sign.type, interActiveType);
    if (!texture) {
        return;
    }
    // @ts-ignore
    object.material.map = texture;
    // @ts-ignore
    object.material.map.colorSpace = 'srgb';
    // @ts-ignore
    object.material.needsUpdate = true;
    object.userData.signType = sign.type;
    object.userData.type = ThreeElementType.SignIcon;
    object.userData.interActiveType = interActiveType;
}
