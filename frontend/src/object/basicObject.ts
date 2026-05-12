import { LaneBoundaryType } from 'src/interface/laneInterFace';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
import { InterActiveType, ThreeElementType } from 'src/interface/commonInterFace';
import { mapElementZ } from 'src/constant/mapElementZ';
import { laneGroudColor } from 'src/constant/color';
import { Line2 } from 'three/examples/jsm/lines/Line2';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial';

export function drawLine2(
    vertexs: THREE.Vector3[],
    color: THREE.Color,
    boundaryType: LaneBoundaryType = LaneBoundaryType.WHITESOLId,
) {
    const line2Positions: number[] = [];
    vertexs.forEach((item) => {
        line2Positions.push(item.x, item.y, 0);
    });
    const geometry2 = new LineGeometry();
    geometry2.setPositions(line2Positions);
    let material2 = null;
    if (boundaryType === LaneBoundaryType.WHITESOLId) {
        material2 = new LineMaterial({
            color: color.getHex(),
            linewidth: 2.5,
            worldUnits: false,
            dashed: false,
            blending: THREE.NoBlending,
        });
    } else {
        material2 = new LineMaterial({
            color: color.getHex(),
            linewidth: 2.5,
            dashed: true,
            dashSize: 0.5,
            gapSize: 0.5,
            blending: THREE.NoBlending,
        });
    }
    material2.resolution.set(window.innerWidth, window.innerHeight);
    const line2 = new Line2(geometry2, material2);
    line2.computeLineDistances();
    return line2;
}
export function drawLine(
    vertexs: THREE.Vector3[],
    color: THREE.Color,
    boundaryType: LaneBoundaryType = LaneBoundaryType.WHITESOLId,
) {
    if (!vertexs || vertexs.length < 2) {
        return null;
    }
    const tempPoints: THREE.Vector3[] = [];
    vertexs.forEach((item) => {
        tempPoints.push(new THREE.Vector3(item.x, item.y, 0));
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(tempPoints);
    let material = null;
    if (boundaryType === LaneBoundaryType.WHITESOLId) {
        material = new THREE.LineBasicMaterial({
            color: color.getHex(),
        });
    } else {
        material = new THREE.LineDashedMaterial({
            color: color.getHex(),
            dashSize: 0.5,
            gapSize: 0.5,
        });
    }
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.geometry.computeBoundingSphere();
    line.frustumCulled = false;
    line.geometry.getAttribute('position').needsUpdate = true;

    return {
        line,
        line2: drawLine2(vertexs, color, boundaryType),
    };
}
export function drawCircle(material: THREE.Material, size: number = 0.2) {
    const circleGeometry = new THREE.CircleGeometry(size);
    const mesh = new THREE.Mesh(circleGeometry, material);
    return mesh;
}

export function drawShape(
    points: THREE.Vector2[],
    color: THREE.Color,
    opacity: number,
    shapeMaterial?: THREE.Material,
) {
    if (!points || points.length < 3) {
        return null;
    }
    const shape = new THREE.Shape(points);
    const shapeGeometry = new THREE.ShapeGeometry(shape);
    const material =
        shapeMaterial ||
        new THREE.MeshBasicMaterial({
            color,
            opacity,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: 0.01,
        });
    return new THREE.Mesh(shapeGeometry, material);
}

export function loadImage(imgUrl: string) {
    const loader = new THREE.TextureLoader();
    return new Promise((resolve) => {
        loader.load(imgUrl, (texture) => {
            resolve(texture as THREE.Texture);
        });
    });
}
export function loadSvg(svgUrl: string): Promise<THREE.Group> {
    const loader = new SVGLoader();
    return new Promise((resolve) => {
        loader.load(svgUrl, (data) => {
            const paths = data.paths;
            const group = new THREE.Group();
            for (let i = 0; i < paths.length; i += 1) {
                const path = paths[i];
                const material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(path.userData.style.fill),
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    transparent: true,
                    opacity: path.userData.style.opacity,
                });
                const shapes = SVGLoader.createShapes(path);

                for (let j = 0; j < shapes.length; j += 1) {
                    const shape = shapes[j];
                    const geometry = new THREE.ShapeGeometry(shape);
                    const mesh = new THREE.Mesh(geometry, material);
                    group.add(mesh);
                }
            }
            resolve(group as THREE.Group);
        });
    });
}
/**
 *
 * @param firstPointId 起点Id
 * @param firstControlPointPosition 第一个控制点坐标
 * @param secondControlPointPosition 第二个控制点坐标
 * @param secondPointId 终点
 */
export function drawBezierCurve3(
    firstPointPosition: THREE.Vector3,
    firstControlPointPosition: THREE.Vector3,
    secondControlPointPosition: THREE.Vector3,
    secondPointPosition: THREE.Vector3,
    color: THREE.Color,
    boundaryType: LaneBoundaryType = LaneBoundaryType.WHITESOLId,
) {
    const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(firstPointPosition.x, firstPointPosition.y, 0),
        firstControlPointPosition,
        secondControlPointPosition,
        new THREE.Vector3(secondPointPosition.x, secondPointPosition.y, 0),
    );
    const points = curve.getPoints(50);
    const positions: THREE.Vector3[] = [];
    const line2Positions: number[] = [];
    points.forEach((point) => {
        positions.push(new THREE.Vector3(point.x, point.y, 0));
        line2Positions.push(point.x, point.y, 0);
    });
    let material = null;
    if (boundaryType === LaneBoundaryType.WHITESOLId) {
        material = new THREE.LineBasicMaterial({
            color: color.getHex(),
        });
    } else {
        material = new THREE.LineDashedMaterial({
            color: color.getHex(),
            dashSize: 0.5,
            gapSize: 0.5,
        });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(positions);
    const line = new THREE.Line(geometry, material);
    line.position.z = mapElementZ[ThreeElementType.LaneCurveBoundary];
    line.computeLineDistances();
    const geometry2 = new LineGeometry();
    geometry2.setPositions(line2Positions);
    let material2 = null;
    if (boundaryType === LaneBoundaryType.WHITESOLId) {
        material2 = new LineMaterial({ color: color.getHex(), linewidth: 2.5 });
    } else {
        material2 = new LineMaterial({
            linewidth: 2.5,
            blending: THREE.NoBlending,
            dashed: true,
            color: color.getHex(),
            dashSize: 0.5,
            gapSize: 0.5,
        });
    }
    material2.resolution.set(window.innerWidth, window.innerHeight);
    const line2 = new Line2(geometry2, material2);
    line2.position.z = mapElementZ[ThreeElementType.LaneCurveBoundary];
    line2.computeLineDistances();

    return {
        line,
        line2,
    };
}

export function drawArc(radius: number, thetaStart: number, thetaLength: number, z: number = 0) {
    const geometry = new THREE.CircleGeometry(radius, 32, thetaStart, thetaLength);
    const material = new THREE.MeshBasicMaterial({
        color: laneGroudColor[InterActiveType.Default],
        opacity: 0.2,
        transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = z;
    return mesh;
}
