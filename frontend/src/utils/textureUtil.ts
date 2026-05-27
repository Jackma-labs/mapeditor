import * as THREE from 'three';
import PubSub from 'pubsub-js';
import {
    addSvgColor,
    parkingSpaceGroudColor,
    parkingSpaceGroudOpacity,
    pointColor,
    rotateHandleSvgColor,
    trafficLightSvgColor,
    trafficLightSvgOpacity,
} from 'src/constant/color';
import { InterActiveType } from 'src/interface/commonInterFace';
import { ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { colorTraslateRgba } from './common';
import { searchParkingSpaceByGroudId } from './search/parkingSpaceSearch';

export function updateTexture(obj: THREE.Mesh | THREE.Line, texture: THREE.Texture) {
    if (!obj || !texture) {
        return;
    }
    const curTexture = texture.clone();
    // @ts-ignore
    (obj.material as THREE.Material).map = curTexture;
    // @ts-ignore
    (obj.material as THREE.Material).color = new THREE.Color(0xffffff);
    // @ts-ignore
    (obj.material as THREE.Material).map.colorSpace = 'srgb';
    (obj.material as THREE.Material).opacity = 1;
    (obj.material as THREE.Material).needsUpdate = true;
    PubSub.publish('render');
}

export function configureTextureForWebGL1<T extends THREE.Texture>(texture: T): T {
    const configuredTexture = texture;
    configuredTexture.generateMipmaps = false;
    configuredTexture.minFilter = THREE.LinearFilter;
    configuredTexture.magFilter = THREE.LinearFilter;
    configuredTexture.wrapS = THREE.ClampToEdgeWrapping;
    configuredTexture.wrapT = THREE.ClampToEdgeWrapping;
    configuredTexture.needsUpdate = true;
    return configuredTexture;
}

function createCanvasTexture(canvas: HTMLCanvasElement) {
    return configureTextureForWebGL1(new THREE.CanvasTexture(canvas));
}

export function generatePointCanvasTexture(pointInfo: {
    strokeColor: THREE.Color;
    fillColor: THREE.Color;
    lineWidth: number;
    fillOpacity: number;
}) {
    const { fillColor, strokeColor, lineWidth, fillOpacity } = pointInfo;
    const canvas = document.createElement('canvas');

    canvas.width = 200;
    canvas.height = 200;

    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(100, 100, 100, 0, 2 * Math.PI);
    ctx.fillStyle = colorTraslateRgba(fillColor, fillOpacity); // 填充实体颜色
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeColor.getStyle(); // 填充边框颜色
    ctx.stroke();

    return createCanvasTexture(canvas);
}

export function generateControlPointCanvasTexture(type: InterActiveType) {
    const canvas = document.createElement('canvas');

    canvas.width = 100;
    canvas.height = 100;

    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.rect(0, 0, 100, 100);
    ctx.fillStyle = 'white'; // 填充实体颜色
    ctx.fill();
    ctx.lineWidth = 50;
    ctx.strokeStyle = pointColor[type].getStyle(); // 填充边框颜色
    ctx.stroke();

    return createCanvasTexture(canvas);
}

export function generateParkingSpaceCanvasTexture(type: InterActiveType, width: number, height: number) {
    const canvas = document.createElement('canvas');

    canvas.width = width || 200;
    canvas.height = height || 200;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colorTraslateRgba(parkingSpaceGroudColor[type], parkingSpaceGroudOpacity);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = width / 25;
    ctx.strokeStyle = colorTraslateRgba(parkingSpaceGroudColor[type], 1);
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    const texture = createCanvasTexture(canvas);
    return texture;
}
export function updateParkingSpaceCanvasTexture(obj: THREE.Mesh, interActiveType: InterActiveType) {
    if (!obj) {
        return;
    }
    if (!obj.userData.id) {
        return;
    }
    const parkingSpace = searchParkingSpaceByGroudId(obj.userData.id);
    if (!parkingSpace?.length || !parkingSpace?.width) {
        return;
    }
    const texture = generateParkingSpaceCanvasTexture(
        interActiveType,
        parkingSpace.length * 100,
        parkingSpace.width * 100,
    );
    // @ts-ignore
    obj.material.map = texture;
    // @ts-ignore
    obj.material.map.colorSpace = 'srgb';
    (obj.material as THREE.Material).needsUpdate = true;
}
/**
 * 绘制圆角矩形的path
 */
export function drawRoundRectPath(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
    ctx.beginPath();
    // 从右下角顺时针绘制，弧度从0到1/2PI
    ctx.arc(width - radius, height - radius, radius, 0, Math.PI / 2);
    // 矩形下边线
    ctx.lineTo(radius, height);
    // 左下角圆弧，弧度从1/2PI到PI
    ctx.arc(radius, height - radius, radius, Math.PI / 2, Math.PI);
    // 矩形左边线
    ctx.lineTo(0, radius);
    // 左上角圆弧，弧度从PI到3/2PI
    ctx.arc(radius, radius, radius, Math.PI, (Math.PI * 3) / 2);
    // 上边线
    ctx.lineTo(width - radius, 0);
    // 右上角圆弧
    ctx.arc(width - radius, radius, radius, (Math.PI * 3) / 2, Math.PI * 2);
    // 右边线
    ctx.lineTo(width, height - radius);
    ctx.closePath();
}
/**
 * @param x 左上角x轴坐标
 * @param y 左上角y轴坐标
 * @param width 矩形的宽度
 * @param height 矩形的高度
 * @param radius 圆的半径
 */
export function fillRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fillColor: string,
) {
    ctx.save();
    ctx.translate(x, y);
    drawRoundRectPath(ctx, width, height, radius);
    ctx.fillStyle = fillColor || '#000';
    ctx.fill();
    ctx.restore();
}
export function strokeRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    strokeColor: string,
    lineWidth: number,
) {
    ctx.save();
    ctx.translate(x, y);
    // 绘制圆角矩形的各个边
    drawRoundRectPath(ctx, width, height, radius);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
    ctx.restore();
}
export function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fillColor: string) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.closePath();
}
export function strokeCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    strokeColor: string,
    lineWidth: number,
) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
}
export function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fillColor: string) {
    ctx.beginPath();
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, w, h);
    ctx.fill();
    ctx.closePath();
    ctx.restore();
}
export function generateTrafficLight3CanvasTexture(type: InterActiveType = InterActiveType.Default) {
    const canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');

    fillRoundRect(ctx, 0, 0, canvas.width, canvas.height, 110, '#979797');
    fillRoundRect(ctx, 20, 20, canvas.width - 40, canvas.height - 40, 90, '#1A1D24');
    fillCircle(ctx, 130, 110, 60, '#F75660');
    fillCircle(ctx, 270, 110, 60, '#F3D631');
    fillCircle(ctx, 410, 110, 60, '#1FCC4D');
    fillRoundRect(
        ctx,
        0,
        0,
        canvas.width,
        canvas.height,
        110,
        colorTraslateRgba(trafficLightSvgColor[type], trafficLightSvgOpacity[type]),
    );
    const texture = createCanvasTexture(canvas);
    texture.center.set(0.5, 0.5);
    return texture;
}
export function generateTrafficLight2CanvasTexture(type: InterActiveType = InterActiveType.Default) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');

    fillRoundRect(ctx, 0, 0, canvas.width, canvas.height, 110, '#979797');
    fillRoundRect(ctx, 20, 20, canvas.width - 40, canvas.height - 40, 90, '#1A1D24');
    fillCircle(ctx, 130, 110, 60, '#F75660');
    fillCircle(ctx, 270, 110, 60, '#F3D631');
    fillRoundRect(
        ctx,
        0,
        0,
        canvas.width,
        canvas.height,
        110,
        colorTraslateRgba(trafficLightSvgColor[type], trafficLightSvgOpacity[type]),
    );

    const texture = createCanvasTexture(canvas);
    texture.center.set(0.5, 0.5);
    return texture;
}
export function generateTrafficLight1CanvasTexture(type: InterActiveType = InterActiveType.Default) {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');

    fillRoundRect(ctx, 0, 0, canvas.width, canvas.height, 80, '#979797');
    fillRoundRect(ctx, 20, 20, canvas.width - 40, canvas.height - 40, 60, '#1A1D24');
    fillCircle(ctx, 110, 110, 60, '#F75660');
    fillRoundRect(
        ctx,
        0,
        0,
        canvas.width,
        canvas.height,
        80,
        colorTraslateRgba(trafficLightSvgColor[type], trafficLightSvgOpacity[type]),
    );

    const texture = createCanvasTexture(canvas);
    texture.center.set(0.5, 0.5);
    return texture;
}

export function generateAddIconCanvasTexture(type: InterActiveType) {
    const color = colorTraslateRgba(addSvgColor[type], 1);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    strokeCircle(ctx, 150, 150, 120, color, 20);
    fillRoundRect(ctx, 70, 142, 160, 16, 8, color);
    fillRoundRect(ctx, 142, 70, 16, 160, 8, color);
    const texture = createCanvasTexture(canvas);
    return texture;
}

export function generateRangeRemoveTexture() {
    const fillColor = '#F75660';
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    fillCircle(ctx, 150, 150, 150, fillColor);
    fillRoundRect(ctx, 70, 142, 160, 16, 8, '#ffffff');
    fillRoundRect(ctx, 142, 70, 16, 160, 8, '#ffffff');
    const texture = createCanvasTexture(canvas);
    texture.center.set(0.5, 0.5);
    texture.rotation = Math.PI / 4;
    return texture;
}
export function fillTriangle(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    fillColor: string,
) {
    ctx.beginPath();
    ctx.fillStyle = fillColor;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.fill();
    ctx.closePath();
    ctx.restore();
}

export function generateRotateHandleCanvasTexture(start: boolean, type: InterActiveType = InterActiveType.Default) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (start) {
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
    }
    // 绘制三角形
    fillTriangle(ctx, 205, 22, 150, 34, 192, 76, colorTraslateRgba(rotateHandleSvgColor[type]));
    // 绘制曲线
    ctx.beginPath();
    ctx.moveTo(172, 54);
    ctx.lineWidth = 18;
    ctx.strokeStyle = colorTraslateRgba(rotateHandleSvgColor[type]);
    ctx.quadraticCurveTo(92, 164, 172, 260);
    ctx.stroke();
    fillTriangle(ctx, 150, 280, 206, 290, 192, 240, colorTraslateRgba(rotateHandleSvgColor[type]));
    const texture = createCanvasTexture(canvas);
    return texture;
}

export function generateRotateBasePointCanvasTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    fillCircle(ctx, 80, 44, 9, '#ffffff');
    fillCircle(ctx, 44, 82, 9, '#ffffff');
    fillCircle(ctx, 116, 82, 9, '#ffffff');
    fillCircle(ctx, 80, 116, 9, '#ffffff');
    fillCircle(ctx, 80, 80, 36, '#ffffff');
    strokeCircle(ctx, 80, 80, 24, '#000000', 10);
    fillRoundRect(ctx, 39, 75, 82, 12, 6, '#000000');
    fillRoundRect(ctx, 74, 39, 12, 82, 6, '#000000');

    const texture = createCanvasTexture(canvas);
    return texture;
}
export function generateArrowCanvasTexture(type: ProssibleDrivingDirection) {
    const canvas = document.createElement('canvas');
    canvas.width = 250;
    canvas.height = 250;
    const ctx = canvas.getContext('2d');
    canvas.style.background = 'rgba(0, 0, 0, 0)';
    if (type === ProssibleDrivingDirection.RELATIVEDIRECTION) {
        canvas.width = 500;
        canvas.height = 500;
        fillRect(ctx, 0, 85, 160, 80, colorTraslateRgba(new THREE.Color(0xffffff), 0.65));
        fillTriangle(ctx, 160, 55, 250, 125, 160, 195, colorTraslateRgba(new THREE.Color(0xffffff), 0.65));
        fillTriangle(ctx, 0, 375, 90, 305, 90, 445, colorTraslateRgba(new THREE.Color(0xffffff), 0.65));
        fillRect(ctx, 90, 335, 160, 80, colorTraslateRgba(new THREE.Color(0xffffff), 0.65));
    } else {
        fillRect(ctx, 0, 85, 160, 80, colorTraslateRgba(new THREE.Color(0xffffff), 0.65));
        fillTriangle(ctx, 160, 55, 250, 125, 160, 195, colorTraslateRgba(new THREE.Color(0xffffff), 0.65));
    }

    const texture = createCanvasTexture(canvas);
    return texture;
}

export function generateYieldSignIconCanvasTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 260;
    canvas.height = 260;
    canvas.style.background = 'rgba(0, 0, 0, 0)';
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    // 从右下角顺时针绘制，弧度从0到1/2PI
    ctx.arc(40, 40, 8, (Math.PI * 3) / 2 - Math.PI / 6, (Math.PI * 3) / 2 + Math.PI / 6);
    // 矩形下边线
    ctx.lineTo(118, 198);
    // 左下角圆弧，弧度从1/2PI到PI
    ctx.arc(118, 198, 8, Math.PI / 2 + Math.PI / 6, Math.PI / 2 - Math.PI / 6);
    // 矩形左边线
    ctx.lineTo(220, 40);
    ctx.arc(220, 40, 8, Math.PI / 2 + Math.PI / 6, Math.PI / 2 - Math.PI / 6);
    ctx.lineTo(40, 40);

    const texture = createCanvasTexture(canvas);
    return texture;
}
