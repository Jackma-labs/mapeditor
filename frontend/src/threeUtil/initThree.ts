import * as THREE from 'three';
import { useManagerStore } from 'src/store';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import CameraControl from './cameraControl';
import DragControl from './dragControl';
import RotateControl from './RotateControl';
import BezierCurve3Control from './BezierCurve3Control';

/**
 * 初始化three.js
 *
 * @param dom - DOM元素
 * @returns 返回初始化后的对象，包括场景、相机、渲染器和控制类
 */
export default function initThree(dom: HTMLElement) {
    const { clientWidth, clientHeight } = dom;
    const scene = useManagerStore.getState().mapState.scene;
    scene.background = new THREE.Color(0x000000);
    scene.matrixWorldAutoUpdate = true;

    const camera = new THREE.PerspectiveCamera(50, clientWidth / clientHeight, 0.01, 3000);
    camera.position.set(0, 0, 50);
    scene.add(camera);

    const renderer = new THREE.WebGL1Renderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(clientWidth, clientHeight);
    dom.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(clientWidth, clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    dom.appendChild(labelRenderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040);
    ambientLight.intensity = 0.1;
    scene.add(ambientLight);

    const gridHelper = new THREE.GridHelper(clientWidth * 100, clientWidth * 100, 0x31384a, 0x31384a);
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.5;
    gridHelper.rotateX(Math.PI / 2);
    gridHelper.renderOrder = -1;
    gridHelper.material.needsUpdate = true;
    gridHelper.material.depthWrite = false;
    scene.add(gridHelper);

    const control = new CameraControl(renderer, scene, camera, renderer.domElement);
    const dragControl = new DragControl([], camera, renderer, scene, control);
    const rotateControl = new RotateControl(camera, renderer, scene, control);
    const bezierCurve3Control = new BezierCurve3Control(control);

    const resizeObserver = new ResizeObserver(() => {
        const width = dom?.clientWidth;
        const height = dom.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        renderer.render(scene, camera);
        labelRenderer.setSize(width, height);

        useManagerStore.getState().setMapState({
            ...useManagerStore.getState().mapState,
            camera,
            dom,
        });
    });
    resizeObserver.observe(dom);

    const clock = new THREE.Clock();
    let requestAnimationId: number = null;
    const anim = () => {
        const delta = clock.getDelta();
        const hasControlsUpdated = control.cameraControls.update(delta);

        if (hasControlsUpdated) {
            renderer.render(scene, camera);
            labelRenderer.render(scene, camera);
        }
        requestAnimationId = requestAnimationFrame(anim);
    };
    anim();

    const destroyRequestAnimationFrame = () => {
        if (requestAnimationId) {
            cancelAnimationFrame(requestAnimationId);
            clock.stop();
            resizeObserver.unobserve(dom);
        }
    };
    return {
        scene,
        camera,
        renderer,
        control,
        dragControl,
        rotateControl,
        bezierCurve3Control,
        labelRenderer,
        destroyRequestAnimationFrame,
    };
}
