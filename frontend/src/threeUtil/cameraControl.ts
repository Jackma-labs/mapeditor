import * as THREE from 'three';
// import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import CameraControls from 'camera-controls';

CameraControls.install({ THREE });

/**
 * 提供移动缩放等功能的控制类
 */

export default class CameraControl {
    public readonly cameraControls: CameraControls;

    private renderer: THREE.WebGL1Renderer;

    private scene: THREE.Scene;

    private camera: THREE.PerspectiveCamera;

    public canRotate: boolean;

    constructor(renderer: THREE.WebGL1Renderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, dom: HTMLElement) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.camera.up.set(0, 0, 1);
        this.cameraControls = new CameraControls(camera, dom);
        this.cameraControls.maxDistance = 3000;
        this.cameraControls.minDistance = 10;

        this.init();
    }

    enable() {
        this.cameraControls.enabled = true;
    }

    disable() {
        this.cameraControls.enabled = false;
    }

    /**
     * 调整相机的投影矩阵，以适应屏幕尺寸和长度。
     *
     * @param length
     */
    adapter(length: number): void {
        const width = this.renderer.domElement.clientWidth;
        const height = this.renderer.domElement.clientHeight;
        const fov = this.camera.fov;

        const cameraZ = length / 2 / Math.tan((fov * Math.PI) / 180 / 2);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.cameraControls.dollyTo(cameraZ);
        // 限制最大最小缩放
        // this.cameraControls.maxDistance = cameraZ;
        this.cameraControls.minDistance = 10;
        this.renderer.render(this.scene, this.camera);
    }

    private init(): void {
        this.cameraControls.dollyToCursor = false;
        this.cameraControls.enabled = false;
        this.cameraControls.mouseButtons.left = CameraControls.ACTION.ROTATE;
        this.cameraControls.mouseButtons.right = CameraControls.ACTION.TRUCK;
        this.cameraControls.minPolarAngle = 0;
        this.cameraControls.maxPolarAngle = 0;
        this.disableRotate();
    }

    public disableRotate() {
        this.canRotate = false;
        this.cameraControls.minAzimuthAngle = this.cameraControls.azimuthAngle;
        this.cameraControls.maxAzimuthAngle = this.cameraControls.azimuthAngle;
    }

    public enableRotate() {
        this.canRotate = true;
        this.cameraControls.minAzimuthAngle = -Infinity;
        this.cameraControls.maxAzimuthAngle = Infinity;
    }

    public dispose() {
        this.cameraControls.dispose();
    }
}
