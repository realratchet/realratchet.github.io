import { WebGLRenderer, PerspectiveCamera, Vector2, Scene, Mesh, BoxBufferGeometry, Raycaster, Vector3, Frustum, Matrix4, Object3D, AnimationMixer } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls";
import GLOBAL_UNIFORMS from "@client/materials/global-uniforms";
import Stats from "./stats";
// import { DeviceOrientationControls } from "./device-orientation-controls";

const stats = new (Stats as any)(0);

stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
// document.body.appendChild(stats.dom);

const DEFAULT_FAR = 100_000;
const DEFAULT_CLEAR_COLOR = 0x0c0c0c;

type ZoneObject = import("../objects/zone-object").ZoneObject;
type SectorObject = import("../objects/zone-object").SectorObject;
type DeviceOrientationControls = import ("./device-orientation-controls").DeviceOrientationControls;

class RenderManager {
    public readonly renderer: THREE.WebGLRenderer;
    public readonly viewport: HTMLViewportElement;
    public readonly supportsDDS: boolean;
    public getDomElement() { return this.renderer.domElement; }
    public readonly camera = new PerspectiveCamera(75, 1, 0.1, DEFAULT_FAR);
    public readonly scene = new Scene();
    public readonly objectGroup = new Object3D();
    public readonly lastSize = new Vector2();
    public readonly controls: { fps: PointerLockControls, orient: DeviceOrientationControls } = { fps: null, orient: null };
    public needsUpdate: boolean = true;
    public isPersistentRendering: boolean = true;
    public readonly raycaster = new Raycaster();
    public speedCameraFPS = 5;
    public readonly mixer = new AnimationMixer(this.scene);

    protected shiftTimeDown: number;
    protected readonly sectors = new Map<number, Map<number, SectorObject>>();
    protected readonly dirKeys = { left: false, right: false, up: false, down: false, shift: false };
    protected lastRender: number = 0;
    protected pixelRatio: number = global.devicePixelRatio;
    protected readonly frustum = new Frustum();
    protected readonly lastProjectionScreenMatrix = new Matrix4();

    constructor(viewport: HTMLViewportElement) {
        this.viewport = viewport;
        this.renderer = new WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            premultipliedAlpha: false,
            logarithmicDepthBuffer: true,
            alpha: true,
        });

        this.renderer.autoClear = false;
        this.supportsDDS = this.renderer.extensions.has("WEBGL_compressed_texture_s3tc");

        this.renderer.setClearColor(DEFAULT_CLEAR_COLOR);
        // this.controls.orient = new DeviceOrientationControls(this.camera);
        // if (!this.controls.orient.enabled)
        this.controls.fps = new PointerLockControls(this.camera, this.renderer.domElement);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 0, 0);
        this.scene.add(new Mesh(new BoxBufferGeometry()));

        this.objectGroup.name = "SectorGroup"
        this.scene.add(this.objectGroup);

        const lookAt = new Vector3(181425.90940428418, -7702.370465083446, 114852.49754089414);

        this.camera.position.set(179000, -7680, 114852.49754089414);

        this.camera.lookAt(lookAt);

        viewport.appendChild(this.renderer.domElement);

        viewport.addEventListener("mouseup", this.onHandleMouseUp.bind(this));
        viewport.addEventListener("mousedown", this.onHandleMouseDown.bind(this));
        viewport.addEventListener("pointerdown", this.onHandleMouseDown.bind(this));
        viewport.addEventListener("touchstart", this.onHandleMouseDown.bind(this));
        window.addEventListener("keydown", this.onHandleKeyDown.bind(this));
        window.addEventListener("keyup", this.onHandleKeyUp.bind(this));
        this.controls.fps?.addEventListener("lock", this.onPointerControlsLocked.bind(this));
        this.controls.fps?.addEventListener("unlock", this.onPointerControlsUnlocked.bind(this));

        addResizeListeners.call(this);
    }

    public onPointerControlsLocked() {
        Object.keys(this.dirKeys).forEach((k: "up" | "left" | "right" | "down" | "shift") => this.dirKeys[k] = false);

    }

    public onPointerControlsUnlocked() {
        Object.keys(this.dirKeys).forEach((k: "up" | "left" | "right" | "down" | "shift") => this.dirKeys[k] = false);
    }

    public toScreenSpaceCoords(point: Vector2) {
        const { width, height } = this.renderer.getSize(new Vector2());

        return new Vector2(
            point.x / width * 2 - 1,
            1 - point.y / height * 2
        );
    }

    public onHandleKeyDown(event: KeyboardEvent) {
        // switch (event.key.toLowerCase()) {
        //     case "1":
        //         this.camera.position.set(14620.304790735074, -3252.6686447271395, 113939.32109701027);
        //         this.controls.orbit.target.set(19313.26359342052, -1077.117687144737, 114494.24459571407);
        //         this.controls.orbit.update();
        //         break;
        //     case "2":
        //         this.camera.position.set(17635.20575146492, -11784.939422516854, 116150.5713219522);
        //         this.controls.orbit.target.set(18067.654677822546, -10987.479065394222, 113781.22799780089);
        //         this.controls.orbit.update();
        //         break;
        //     case "3":
        //         this.camera.position.set(15072.881710902564, -11862.167696361777, 110387.91067628124);
        //         this.controls.orbit.target.set(14711.102749053878, -11434.303788147914, 110872.50292405237);
        //         this.controls.orbit.update();
        //         break;
        //     case "4":
        //         this.camera.position.set(12918.803737500606, -11769.26992456535, 109998.28664096774);
        //         this.controls.orbit.target.set(12961.940094338941, -11789.664021556502, 110631.6332572824);
        //         this.controls.orbit.update();
        //         break;
        //     case "5":
        //         this.camera.position.set(23756.20212599347, -8869.681711370744, 116491.99214326135);
        //         this.controls.orbit.target.set(23706.65317650355, -9178.136467533635, 118330.62193563695);
        //         this.controls.orbit.update();
        //         break;
        //     case "6":
        //         this.camera.position.set(17436.46445202629, -6351.127037466889, 109469.23150265992);
        //         this.controls.orbit.target.set(18965.828211115713, -6064.126549127763, 106770.89206042158);
        //         this.controls.orbit.update();
        //         break;
        //     case "w": if (!this.isOrbitControls) this.dirKeys.up = true; break;
        //     case "a": if (!this.isOrbitControls) this.dirKeys.left = true; break;
        //     case "d": if (!this.isOrbitControls) this.dirKeys.right = true; break;
        //     case "s": if (!this.isOrbitControls) this.dirKeys.down = true; break;
        //     case "shift": if (!this.isOrbitControls) {
        //         this.shiftTimeDown = Date.now();
        //         this.dirKeys.shift = true;
        //     } break;
        // }
    }

    public onHandleKeyUp(event: KeyboardEvent) {
        // switch (event.key.toLowerCase()) {
        //     case "c":
        //         if (this.isOrbitControls) this.controls.fps.lock();
        //         else this.controls.fps.unlock();
        //         break;
        //     case "w": if (!this.isOrbitControls) this.dirKeys.up = false; break;
        //     case "a": if (!this.isOrbitControls) this.dirKeys.left = false; break;
        //     case "d": if (!this.isOrbitControls) this.dirKeys.right = false; break;
        //     case "s": if (!this.isOrbitControls) this.dirKeys.down = false; break;
        //     case "shift": if (!this.isOrbitControls) this.dirKeys.shift = false; break;
        // }
    }

    public onHandleMouseUp(event: MouseEvent) { }
    public onHandleMouseDown(event: MouseEvent) { this.controls.fps?.lock(); }

    public setSize(width: number, height: number, updateStyle?: boolean) {
        this.pixelRatio = global.devicePixelRatio;

        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(width, height, updateStyle);

        this.lastSize.set(width, height);
    }

    protected async onHandleResize(): Promise<void> {
        const oldStyle = this.getDomElement().style.display;
        this.getDomElement().style.display = "none";
        const { width, height } = this.viewport.getBoundingClientRect();

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.setSize(width, height);
        this.getDomElement().style.display = oldStyle;
        this.needsUpdate = true;
    }

    protected onHandleRender(currentTime: number): void {
        const deltaTime = currentTime - this.lastRender;
        const isFrameDirty = this.isPersistentRendering || this.needsUpdate;

        if (isFrameDirty) {
            stats.begin();
            this._preRender(currentTime, deltaTime);
            this._doRender(currentTime, deltaTime);
            this._postRender(currentTime, deltaTime);
            stats.end();
            this.needsUpdate = false;
        }

        this.lastRender = currentTime;

        requestAnimationFrame(this.onHandleRender.bind(this));
    }

    public enableZoneCulling = true;

    public getSector(position: THREE.Vector3) {
        const sectorSize = 256 * 128;
        const sectorX = Math.floor(position.x / sectorSize) + 20;
        const sectorY = Math.floor(position.z / sectorSize) + 18;

        if (!this.sectors.has(sectorX))
            return null;

        const xsect = this.sectors.get(sectorX);

        if (!xsect.has(sectorY))
            return null;

        return xsect.get(sectorY);
    }

    protected _updateObjects(currentTime: number, deltaTime: number) {
        const globalTime = currentTime / 600;

        this.scene.traverse((object: THREE.Object3D) => {

            if ((object as ZoneObject).isZoneObject) {
                (object as THREE.Object3D).traverseVisible(object => {
                    if ((object as any).isUpdatable)
                        (object as any).update(currentTime);

                    if ((object as THREE.Mesh).isMesh)
                        (((((object as THREE.Mesh).material as THREE.Material).isMaterial)
                            ? [(object as THREE.Mesh).material]
                            : (object as THREE.Mesh).material) as THREE.Material[])
                            .forEach(mat => {
                                if (mat && (mat as any).isUpdatable)
                                    (mat as any).update(currentTime);
                            });
                });
            }
        });

        let fog: THREE.Fog;

        const sector = this.getSector(this.camera.position);

        if (sector) {
            const zoneIndex = sector.findPositionZone(this.camera.position);
            const zone = sector.zones.children[zoneIndex] as ZoneObject;
            fog = zone.fog;
        }

        GLOBAL_UNIFORMS.globalTime.value = globalTime;

        const oldFar = this.camera.far;

        if (fog) {
            GLOBAL_UNIFORMS.fogColor.value.copy(fog.color);
            GLOBAL_UNIFORMS.fogNear.value = fog.near;
            GLOBAL_UNIFORMS.fogFar.value = fog.far;

            this.renderer.setClearColor(fog.color);
            this.camera.far = fog.far * 1.2;
        } else {
            GLOBAL_UNIFORMS.fogColor.value.setHex(DEFAULT_CLEAR_COLOR);
            GLOBAL_UNIFORMS.fogNear.value = DEFAULT_FAR * 10;
            GLOBAL_UNIFORMS.fogFar.value = DEFAULT_FAR * 10 + 1;

            this.renderer.setClearColor(DEFAULT_CLEAR_COLOR);
            this.camera.far = DEFAULT_FAR;
        }

        if (this.camera.far !== oldFar) this.camera.updateProjectionMatrix();
    }

    protected _preRender(currentTime: number, deltaTime: number) {
        this.mixer.update(deltaTime / 1000);

        this.lastProjectionScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.lastProjectionScreenMatrix);


        // let forwardVelocity = 0, sidewaysVelocity = 0;
        // const camSpeed = this.speedCameraFPS * (this.dirKeys.shift ? (
        //     Math.min(500, Math.max(Math.pow(2, Math.log10((Date.now() - this.shiftTimeDown) * 0.25)), 2))
        // ) : 1);

        // if (this.dirKeys.shift)
        //     console.log("Camspeed:", camSpeed, Date.now() - this.shiftTimeDown)

        // if (this.dirKeys.left) sidewaysVelocity -= 1;
        // if (this.dirKeys.right) sidewaysVelocity += 1;

        // if (this.dirKeys.up) forwardVelocity += 1;
        // if (this.dirKeys.down) forwardVelocity -= 1;

        // dirForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(forwardVelocity);
        // dirRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).multiplyScalar(sidewaysVelocity);

        // cameraVelocity.addVectors(dirForward, dirRight).setLength(camSpeed);

        // this.camera.position.add(cameraVelocity);

        this._updateObjects(currentTime, deltaTime);

        this.renderer.clear();
    }

    protected _doRender(currentTime: number, deltaTime: number) {
        // this.renderer.render(this.sun, this.camera);
        this.renderer.render(this.scene, this.camera);
    }

    protected _postRender(currentTime: number, deltaTime: number) { }

    public startRendering() {
        this.scene.updateMatrixWorld(true);

        this.onHandleRender(0);
    }

    public addSector(sector: SectorObject) {
        if (sector.index) {
            if (!this.sectors.has(sector.index.x))
                this.sectors.set(sector.index.x, new Map());

            this.sectors.get(sector.index.x).set(sector.index.y, sector);
        }

        this.objectGroup.add(sector);
    }
}

export default RenderManager;
export { RenderManager }

function addResizeListeners(this: RenderManager) {
    global.addEventListener("resize", this.onHandleResize.bind(this));
    this.onHandleResize();
}