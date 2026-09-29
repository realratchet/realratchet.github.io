import "./ue2-conventions";
import "../materials/shader-chunks/register-chunks";
import { WebGLRenderer, PerspectiveCamera, Vector2, Scene, Vector3, Frustum, Matrix4, Object3D, AnimationMixer, Fog, Raycaster, DoubleSide } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls";
import GLOBAL_UNIFORMS from "@client/materials/global-uniforms";
import Stats from "./stats";
import { DeviceOrientationControls } from "./device-orientation-controls";
import InstancedSpriteBatcher from "../objects/emitters/instanced-sprite-batcher";
import L2Environment from "./l2-env";
import { ColorByte } from "../utils/color-byte";
import { NUM_ACTOR_LIGHTS } from "../materials/mesh-static-material/mesh-static-material";
import type EnvInfo from "./env-info";
import type DynamicLight from "../objects/dynamic-light";
import type LitSkinnedMesh from "../objects/lit-skinned-mesh";
import type { ZoneObject, SectorObject } from "../objects/zone-object";
import type { IAnimationViewShakeNotifyDecodeInfo } from "@l2js/engine/contracts/anim-notify";

type ViewShakeState_T = {
    type: IAnimationViewShakeNotifyDecodeInfo["shakeType"];
    direction: THREE.Vector3;
    remainingTime: number;
    target: number;
    savedTarget: number;
    phase: number;
    rate: number;
    repeats: number;
    countLimit: number;
    requiresRotationFrequency: boolean;
    requiresPositionFrequency: boolean;
    requiresRotationScale: boolean;
};

const stats = new (Stats as any)(0);

stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
// document.body.appendChild(stats.dom);

const DEFAULT_FAR = 100_000;
const DEFAULT_CLEAR_COLOR = 0x0c0c0c;
const PAWN_LIGHTING_RADIUS = 24;
const CLIPPING_RANGE_ACTOR = 4 * 2048;

const matSwizzle = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const matMirrorX = new Matrix4().makeScale(-1, 1, 1);
const tmpMatrix = new Matrix4();
const tmpScale = new Vector3();
const tmpBillboardUp = new Vector3();
const tmpBillboardFront = new Vector3();
const tmpBillboardRight = new Vector3();
const tmpPawnPosition = new Vector3();
const tmpViewShakeDirection = new Vector3();
const tmpL2EventPosition = new Vector3();
const tmpDown = new Vector3(0, 0, -1);
const raycaster = new Raycaster();
const tmpSunAmbient = new ColorByte();
const arrPawnLights: DynamicLight[] = [];
const arrLightingObjects: THREE.Object3D[] = [];

class RenderManager {
    public readonly renderer: THREE.WebGLRenderer;
    public readonly viewport: HTMLViewportElement;
    public getDomElement() { return this.renderer.domElement; }
    public readonly camera = new PerspectiveCamera(75, 1, 0.1, DEFAULT_FAR);
    public readonly cameraProxy = new PerspectiveCamera();
    public readonly scene = new Scene();
    public readonly objectGroup = new Object3D();
    public readonly lastSize = new Vector2();
    public readonly controls: { fps: PointerLockControls, orient: DeviceOrientationControls } = { fps: null, orient: null };
    public needsUpdate: boolean = true;
    public isPersistentRendering: boolean = true;
    public readonly mixer = new AnimationMixer(this.scene);
    public environment: L2Environment = null;
    public onBeforeUpdate: (currentTime: number, deltaTime: number) => void = null;

    protected readonly sectors = new Map<number, Map<number, SectorObject>>();
    protected readonly pawns = new Set<THREE.Object3D>();
    protected readonly transientEffects = new Set<THREE.Object3D>();
    protected readonly viewShakeStates: ViewShakeState_T[] = [];
    protected viewShakeDelta: number = 0;
    protected readonly particleBatcher = new InstancedSpriteBatcher();
    protected readonly visibleWorldBatchEmitters: any[] = [];
    protected lastRender: number = 0;
    protected pixelRatio: number = global.devicePixelRatio;
    protected readonly frustum = new Frustum();
    protected readonly lastProjectionScreenMatrix = new Matrix4();

    protected hasGyroControls = false;

    public constructor(viewport: HTMLViewportElement) {
        this.viewport = viewport;
        this.renderer = new WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            premultipliedAlpha: false,
            logarithmicDepthBuffer: true,
            alpha: true,
        });

        this.renderer.autoClear = false;
        this.hasGyroControls = false;

        this.renderer.setClearColor(DEFAULT_CLEAR_COLOR);
        this.controls.fps = new PointerLockControls(this.cameraProxy, this.renderer.domElement);
        this.controls.orient = new DeviceOrientationControls(this.cameraProxy, Math.PI, () => {
            this.hasGyroControls = true;
            this.controls.fps.unlock();
        });
        this.controls.orient.alphaOffset = Math.PI;

        this.cameraProxy.up.set(0, 1, 0);

        this.objectGroup.name = "SectorGroup"
        this.scene.add(this.objectGroup);
        this.objectGroup.add(this.particleBatcher.root);

        this.cameraProxy.position.set(179000, -7680, 114852.49754089414);
        this.cameraProxy.lookAt(181425.90940428418, -7702.370465083446, 114852.49754089414);
        this.updateCameraFromProxy();

        viewport.appendChild(this.renderer.domElement);

        viewport.addEventListener("mousedown", this.onHandleMouseDown.bind(this));
        viewport.addEventListener("pointerdown", this.onHandleMouseDown.bind(this));
        viewport.addEventListener("touchstart", this.onHandleMouseDown.bind(this));

        addResizeListeners.call(this);
    }

    public setEnv(env: EnvInfo): this {
        this.environment = new L2Environment(env);

        return this;
    }

    public onHandleMouseDown(event: MouseEvent) {
        if (!this.hasGyroControls)
            this.controls.fps?.lock();
    }

    public setSize(width: number, height: number, updateStyle?: boolean) {
        this.pixelRatio = global.devicePixelRatio;

        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(width, height, updateStyle);

        this.lastSize.set(width, height);
    }

    protected onHandleResize(): void {
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

    public getSector(position: THREE.Vector3) {
        const sectorSize = 256 * 128;
        const sectorX = Math.floor(position.x / sectorSize) + 20;
        const sectorY = Math.floor(position.y / sectorSize) + 18;

        if (!this.sectors.has(sectorX))
            return null;

        const xsect = this.sectors.get(sectorX);

        if (!xsect.has(sectorY))
            return null;

        return xsect.get(sectorY);
    }

    public updateCameraFromProxy() {
        this.cameraProxy.updateMatrix();

        tmpMatrix.multiplyMatrices(matSwizzle, this.cameraProxy.matrix).multiply(matMirrorX);
        tmpMatrix.decompose(this.camera.position, this.camera.quaternion, tmpScale);

        this.camera.updateMatrixWorld();
    }

    public addViewShake(actor: THREE.Object3D, info: IAnimationViewShakeNotifyDecodeInfo) {
        const direction = new Vector3().fromArray(info.shakeVector);

        if (direction.lengthSq() === 0) direction.set(Math.random(), Math.random(), 0);
        direction.normalize();
        direction.z = 0;
        direction.normalize();

        const sourcePosition = actor.getWorldPosition(new Vector3());
        const distance = this.camera.position.distanceTo(sourcePosition);
        const intensity = sourcePosition.lengthSq() !== 0 && info.shakeRange !== 0 ? info.shakeIntensity / Math.cosh(distance / info.shakeRange) : info.shakeIntensity;
        const frameRate = 1 / this.viewShakeDelta;
        const frameScale = frameRate < 30 ? frameRate / 30 : 1;
        const repeats = info.shakeCount * frameScale;
        const target = info.shakeType === "upDown" ? 1 : intensity;

        this.viewShakeStates.push({
            type: info.shakeType,
            direction,
            remainingTime: 5 + info.shakeCount * this.viewShakeDelta,
            target,
            savedTarget: intensity,
            phase: 0,
            rate: info.shakeIntensity * 50,
            repeats,
            countLimit: Math.trunc(Math.max(direction.x * frameScale, direction.y * frameScale, direction.z * frameScale, repeats) + 2),
            requiresRotationFrequency: false,
            requiresPositionFrequency: false,
            requiresRotationScale: false
        });
    }

    // ALineagePlayerController::AddViewShakeState (0x809d10), VST_DAMAGE/VST_UPDOWN.
    public addViewShakeState(duration: number, rotationScale: number, rotationFrequency: number, positionFrequency: number, rotationAmplitude: THREE.Vector3, rotationVelocity: THREE.Vector3, positionAmplitude: THREE.Vector3, position: THREE.Vector3, strength: number, range: number, type: "damage" | "upDown" = "damage") {
        const intensity = position.lengthSq() !== 0 && range !== 0 ? strength / Math.cosh(this.camera.position.distanceTo(position) / range) : strength;
        const frameRate = 1 / this.viewShakeDelta;
        const frameScale = frameRate < 30 ? frameRate / 30 : 1;
        const repeats = positionFrequency * frameScale;

        // FVector::SafeNormal (Core.dll 0x1014fc40) zeros squared lengths below 1e-8.
        this.viewShakeStates.unshift({
            type,
            direction: rotationAmplitude.lengthSq() < 1e-8 ? new Vector3() : rotationAmplitude.clone().normalize(),
            remainingTime: duration,
            // Engine.dll 0x809f4d..0x809f5c: VST_UPDOWN saves the attenuated threshold and starts at 1.
            target: type === "upDown" ? 1 : rotationScale * intensity,
            savedTarget: rotationScale * intensity,
            phase: 0,
            rate: rotationFrequency,
            repeats,
            countLimit: Math.trunc(Math.max(positionAmplitude.x * frameScale, positionAmplitude.y * frameScale, positionAmplitude.z * frameScale, repeats) + 2),
            requiresRotationFrequency: rotationVelocity.x === 0 && rotationVelocity.y === 0 && rotationVelocity.z === 0,
            requiresPositionFrequency: positionAmplitude.x * frameScale === 0 && positionAmplitude.y * frameScale === 0 && positionAmplitude.z * frameScale === 0,
            requiresRotationScale: rotationAmplitude.x * intensity === 0 && rotationAmplitude.y * intensity === 0 && rotationAmplitude.z * intensity === 0
        });
    }

    protected applyViewShake() {
        if (this.viewShakeStates.length === 0) return;

        let pitch = 0, yaw = 0;

        for (let i = this.viewShakeStates.length - 1; i >= 0; i--) {
            const state = this.viewShakeStates[i];

            if (!updateViewShake(state, this.viewShakeDelta)) {
                this.viewShakeStates.splice(i, 1);
                continue;
            }

            // FNViewShake::Update 0x7bf8a4 bypasses rotation output when its frequency is zero.
            if (state.rate === 0) continue;

            pitch += Math.trunc(Math.abs(state.direction.y) * state.phase);
            yaw += Math.trunc(Math.abs(state.direction.x) * state.phase);
        }

        tmpViewShakeDirection.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

        const currentYaw = Math.atan2(tmpViewShakeDirection.y, tmpViewShakeDirection.x);
        const currentPitch = Math.atan2(tmpViewShakeDirection.z, Math.hypot(tmpViewShakeDirection.x, tmpViewShakeDirection.y));
        const nextYaw = currentYaw + yaw / 32768 * Math.PI;
        const nextPitch = currentPitch + pitch / 32768 * Math.PI;
        const cosPitch = Math.cos(nextPitch);

        tmpViewShakeDirection.set(Math.cos(nextYaw) * cosPitch, Math.sin(nextYaw) * cosPitch, Math.sin(nextPitch)).add(this.camera.position);
        this.camera.lookAt(tmpViewShakeDirection);

        this.camera.updateMatrixWorld();
    }

    public addPawn(pawn: THREE.Object3D) {
        this.pawns.add(pawn);
        this.scene.add(pawn);
    }

    public traceFloor(position: THREE.Vector3, maxDistance: number): number {
        const sector = this.getSector(position);

        if (!sector) return null;

        const targets: THREE.Mesh[] = [];

        sector.traverse((object: any) => {
            if (object.isMesh && !object.particlePool && !object.isInstancedMesh && (object.isTerrainBatch || object.isTerrain || object.parent === sector.bspGroup || object.parent === sector.staticMeshGroup))
                targets.push(object);
        });

        const sides = targets.map(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
            const side = material.side;

            material.side = DoubleSide;

            return side;
        }));

        sector.updateMatrixWorld(true);
        raycaster.set(position, tmpDown);
        raycaster.far = maxDistance;

        const hit = raycaster.intersectObjects(targets, false)[0];

        targets.forEach((mesh, i) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material, j) => material.side = sides[i][j]));

        return hit ? hit.point.z : null;
    }

    // ULevel::ExecL2EventActors (0x8727a0..0x87296d).
    public triggerL2Event(name: string, position: THREE.Vector3, radius: number) {
        name = name.toLowerCase();

        this.sectors.forEach(row => row.forEach(sector => sector.traverse((actor: any) => {
            const tag = actor.scriptProperties instanceof Map ? actor.scriptProperties.get("Tag") : null;

            if (typeof tag !== "string" || tag.toLowerCase() !== name || !actor.isEmitterActor) return;

            if (name === "antarascave_smoke" && radius !== 0) {
                const distance = actor.getWorldPosition(tmpL2EventPosition).distanceTo(position);

                if (Math.random() >= 1 / Math.cosh(distance / radius)) return;

                // 0x8728f3 clears AEmitter.FirstSpawnParticle (+0x450, bit0).
                actor.scriptProperties.set("FirstSpawnParticle", false);
            }

            // Emitter.uc Trigger: Emitters[i].Trigger()
            for (const emitter of actor.scriptProperties.get("Emitters")) emitter.trigger();
        })));
    }

    public addTransientEffect(effect: THREE.Object3D) {
        this.transientEffects.add(effect);
        this.scene.add(effect);
    }

    public removeTransientEffect(effect: THREE.Object3D) {
        const skeleton = (effect as any).attachedSkeleton;

        this.transientEffects.delete(effect);

        if (skeleton) skeleton.detachObject(effect);
        else effect.removeFromParent();

        effect.traverse((object: any) => {
            if (object.isMesh && object.material) {
                const materials = Array.isArray(object.material) ? object.material : [object.material];

                for (const material of materials) material.dispose();
            }
        });
    }

    protected updateTransientEffects(deltaTime: number) {
        for (const effect of this.transientEffects as Set<any>) {
            const properties = effect.scriptProperties as Map<string, any>;
            const lifeSpan = properties?.get("LifeSpan");

            if (lifeSpan !== undefined && lifeSpan !== 0) {
                const remaining = lifeSpan - deltaTime * 0.001;

                properties.set("LifeSpan", remaining);

                if (remaining <= 0.0001) {
                    this.removeTransientEffect(effect);
                    continue;
                }
            }

            if (effect.onEffectTick && effect.onEffectTick(deltaTime) === false) {
                this.removeTransientEffect(effect);
                continue;
            }

            if (isEffectFinished(effect)) this.removeTransientEffect(effect);
        }
    }

    protected updatePawnLighting() {
        const sunAmbient = this.environment.getAmbientPlaneActorLightHalved(tmpSunAmbient);

        for (const pawn of this.pawns) {
            pawn.getWorldPosition(tmpPawnPosition);

            const sector = this.getSector(tmpPawnPosition);

            if (!sector) continue;

            const zoneIndex = sector.findPositionZone(tmpPawnPosition);
            const zoneInfo = zoneIndex === null ? null : sector.bspZones[zoneIndex]?.zoneInfo;

            sector.getRelevantLights(tmpPawnPosition, PAWN_LIGHTING_RADIUS, arrPawnLights, NUM_ACTOR_LIGHTS, !!zoneInfo?.isSunAffected);

            arrLightingObjects.length = 0;
            arrLightingObjects.push(pawn);

            while (arrLightingObjects.length > 0) {
                const object = arrLightingObjects.pop();

                for (const child of object.children) arrLightingObjects.push(child);

                if ((object as LitSkinnedMesh).isLitSkinnedMesh)
                    (object as LitSkinnedMesh).updateActorLighting(zoneInfo, arrPawnLights, sunAmbient);
            }
        }
    }

    protected updateFog() {
        const sector = this.getSector(this.camera.position);
        let fog: THREE.Fog = null;

        if (sector) {
            const zoneIndex = sector.findPositionZone(this.camera.position);
            const zone = sector.zones.children[zoneIndex] as ZoneObject;

            fog = zone?.fog;
        }

        if (!this.scene.fog) this.scene.fog = new Fog(DEFAULT_CLEAR_COLOR, DEFAULT_FAR * 10, DEFAULT_FAR * 10 + 1);

        const sceneFog = this.scene.fog as Fog;
        const oldFar = this.camera.far;

        if (fog) {
            sceneFog.color.copy(fog.color);
            sceneFog.near = fog.near;
            sceneFog.far = fog.far;

            this.camera.far = fog.far * 1.2;
        } else {
            sceneFog.color.set(DEFAULT_CLEAR_COLOR);
            sceneFog.near = DEFAULT_FAR * 10;
            sceneFog.far = DEFAULT_FAR * 10 + 1;

            this.camera.far = DEFAULT_FAR;
        }

        this.renderer.setClearColor(sceneFog.color);

        GLOBAL_UNIFORMS.fogColor.value.copy(sceneFog.color);
        GLOBAL_UNIFORMS.fogNear.value = sceneFog.near;
        GLOBAL_UNIFORMS.fogFar.value = sceneFog.far;

        if (this.camera.far !== oldFar) this.camera.updateProjectionMatrix();
    }

    protected _updateObjects(currentTime: number, deltaTime: number) {
        this.visibleWorldBatchEmitters.length = 0;

        GLOBAL_UNIFORMS.globalTimeSeconds.value = currentTime / 1000;

        const env = this.environment;
        const ambientSun = env.getAmbientPlaneStaticMeshSunLightHalved(tmpSunAmbient);
        const sunR = ambientSun.r, sunG = ambientSun.g, sunB = ambientSun.b;
        const sunColor = env.getBaseColorPlaneStaticMeshSunLightScaled(tmpSunAmbient);

        (GLOBAL_UNIFORMS.staticMeshSunAmbient.value as Vector3).set((sunR + sunColor.r) / 255, (sunG + sunColor.g) / 255, (sunB + sunColor.b) / 255);

        {
            const projUp = tmpBillboardUp.copy(this.camera.up).normalize();
            const projFront = tmpBillboardFront.set(0, 0, 1).applyQuaternion(this.camera.quaternion).normalize();
            const projRight = tmpBillboardRight.crossVectors(projFront, projUp).normalize();

            projUp.crossVectors(projRight, projFront).normalize();
            (GLOBAL_UNIFORMS.cameraBillboardRight.value as Vector3).copy(projRight);
            (GLOBAL_UNIFORMS.cameraBillboardUp.value as Vector3).copy(projUp);
        }

        this.updateFog();

        const fogFar = (this.scene.fog as Fog).far;
        const staticMeshCullDistSq = fogFar * fogFar;
        const emitterCullDistSq = CLIPPING_RANGE_ACTOR * CLIPPING_RANGE_ACTOR;
        const activeSector = this.getSector(this.camera.position);

        this.sectors.forEach(row => row.forEach(sector => {
            sector.visible = true;
            sector.updateVisibility(env, this.camera.position, this.frustum, true, sector !== activeSector, staticMeshCullDistSq, emitterCullDistSq);
        }));

        this.updatePawnLighting();
        this.updateTransientEffects(deltaTime);

        this.scene.traverseVisible(child => {
            if ((child as any).isUpdatable) {
                let sector: SectorObject = null;
                let parent = child.parent;

                while (parent) {
                    if ((parent as any).isSectorObject) {
                        sector = parent as SectorObject;
                        break;
                    }

                    parent = parent.parent;
                }

                if ((child as any).particlePool) {
                    const emitterUuid = (child as any).emitterActorUuid;
                    const isVisible = (child as any).isActorAttachedEmitter || (!!sector && emitterUuid !== undefined && sector.visibleEmitterUuids.has(emitterUuid));

                    if (!isVisible) return;

                    (child as any).update(currentTime);

                    const mesh = (child as any).instancedMesh;

                    if (mesh?.visible && mesh.isWorldBatchCandidate)
                        this.visibleWorldBatchEmitters.push(child);

                    const pendingSounds = (child as any).pendingSounds;

                    if (pendingSounds.length) {
                        for (const snd of pendingSounds)
                            if (this.onEmitterSound) this.onEmitterSound(snd.dataUri || sector?.getSoundUri(snd.soundName), snd);

                        pendingSounds.length = 0;
                    }
                } else if (sector && "computeLighting" in child) (child as any).update(sector, env);
                else (child as any).update(currentTime);
            }

            if ((child as THREE.Mesh).isMesh) {
                const mat = (child as THREE.Mesh).material;

                if (mat) {
                    const materials = (mat as any).isMaterial ? [mat] : (mat as any);

                    (materials as THREE.Material[]).forEach(m => {
                        if (m && (m as any).isUpdatable) (m as any).update(currentTime);
                    });
                }
            }
        });

        this.particleBatcher.update(this.visibleWorldBatchEmitters, this.camera);
    }

    public onEmitterSound: (uri: string, sound: any) => void = null;

    protected _preRender(currentTime: number, deltaTime: number) {
        if (this.onBeforeUpdate) this.onBeforeUpdate(currentTime, deltaTime);

        this.viewShakeDelta = deltaTime / 1000;

        this.mixer.update(deltaTime / 1000);

        if (this.hasGyroControls)
            this.controls.orient?.update();

        this.updateCameraFromProxy();
        this.applyViewShake();

        this.lastProjectionScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.lastProjectionScreenMatrix);

        this._updateObjects(currentTime, deltaTime);

        this.renderer.clear();
    }

    protected _doRender(currentTime: number, deltaTime: number) {
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

        sector.worldBounds.setFromObject(sector);

        this.objectGroup.add(sector);
    }
}

export default RenderManager;
export { RenderManager }

function checkViewShake(state: ViewShakeState_T): void {
    const crossed = state.target > 0 ? state.phase >= state.target : state.phase <= state.target;

    if (!crossed) return;

    state.phase = state.target;

    if (state.repeats <= 1) {
        state.target = 0;
        state.phase = 0;
        state.rate = 0;
        return;
    }

    if (state.target <= 0) state.target *= -1;
    else switch (state.type) {
        case "damage": state.target *= 1 / (state.countLimit - state.repeats) - 1; break;
        case "down": state.target *= 1 / state.repeats - 1; break;
        case "up":
        case "upDown": state.target *= -1.1; break;
    }

    state.repeats -= 1;
    state.rate *= -1;
}

function updateViewShake(state: ViewShakeState_T, deltaTime: number): boolean {
    if (deltaTime === 0 || state.remainingTime === 0) return false;

    state.remainingTime -= deltaTime;

    if (state.remainingTime <= 0.0001) return false;

    // FNViewShake::Update (0x7bf7e9..0x7bf893) rejects zero vector channels with zero scalar rates.
    if ((state.requiresRotationFrequency && state.rate === 0) || (state.requiresPositionFrequency && state.repeats === 0) || (state.requiresRotationScale && state.target === 0)) return false;

    if (state.rate !== 0) {
        state.phase = (Math.trunc(state.phase) + Math.trunc(deltaTime * state.rate)) & 0xffff;
        // FNViewShake::Update 0x7bf8d4..0x7bf8ed retains exactly 32768; only greater values wrap.
        if (state.phase > 0x8000) state.phase -= 0x10000;

        if (state.type === "upDown" && state.target > state.savedTarget) {
            // FNViewShake::Update 0x7bf922..0x7bf956: VST_UPDOWN becomes VST_DOWN at the saved threshold.
            state.type = "down";
            state.target = state.savedTarget;
            state.countLimit = Math.trunc(state.repeats + 2);
        }

        if (state.type === "damage" || state.type === "up" || state.type === "down" || state.type === "upDown") checkViewShake(state);
    }

    return true;
}

function isEffectFinished(effect: THREE.Object3D): boolean {
    let hasEmitter = false;
    let isFinished = true;

    effect.traverse(child => {
        const emitter = child as any;

        if (!emitter.particlePool) return;

        hasEmitter = true;
        if (!emitter.isFinished()) isFinished = false;
    });

    return hasEmitter && isFinished;
}

function addResizeListeners(this: RenderManager) {
    global.addEventListener("resize", this.onHandleResize.bind(this));
    this.onHandleResize();
}
