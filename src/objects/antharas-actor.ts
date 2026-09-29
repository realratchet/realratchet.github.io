import { LoopOnce, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { decodeObject3D, decodeSkinnedMesh } from "../assets/decoders/object3d-decoder";
import Rotator from "../utils/rotator";
import type RenderManager from "../rendering/render-manager";
import type AudioManager from "../audio/audio-manager";
import type LitSkinnedMesh from "./lit-skinned-mesh";
import type LocalSpaceSkeleton from "./local-space-skeleton";
import type { DecodeLibrary, Vector3Arr } from "@l2js/engine";
import type { IAnimationNotifyDecodeInfo, IAnimationEffectNotifyDecodeInfo, IAnimationSoundNotifyDecodeInfo, IAnimationViewShakeNotifyDecodeInfo } from "@l2js/engine/contracts/anim-notify";
import type { NpcSkillAttack_T } from "@l2js/engine/contracts/pawn";

const tmpRotator = new Rotator();
const tmpOffset = new Vector3();
const tmpPosition = new Vector3();
const tmpDirection = new Vector3();
const tmpRotation = new Quaternion();
const tmpBoneMatrix = new Matrix4();
const unitX = new Vector3(1, 0, 0);
const unitZ = new Vector3(0, 0, 1);

const IDLE_ANIMATION = "Wait";
const SOCIAL_ANIMATIONS = ["social01", "social02"];
const SOCIAL_CHANCE = 0.3;
const BREATH_SKILL_ID = 4111;
const BREATH_INTERVAL = [15, 30];
const CROSSFADE_TIME = 0.2;
const TARGET_STANDOFF = 300;
const WALK_ANIMATION = "Walk";
const WALK_SPEED = 81;
const WALK_FLOOR_SAMPLES = 64;
const WALK_FLOOR_TRACE = 1000;
const WALK_SHAKE_INTENSITY = 250;
const WALK_SHAKE_RANGE = 6000;
const WALK_SMOKE_RADIUS = 3000;
const WALK_SMOKE_COOLDOWN = 3;

const PIT_POSITION = new Vector3(185452, 114835, -8221);

const EYE_EFFECTS: [string, Vector3Arr][] = [["LineageEffect.e_u045_l", [65, 20, 44]], ["LineageEffect.e_u045_r", [65, 20, -44]]];

type PlayingAnimation_T = { name: string, action: THREE.AnimationAction, clip: THREE.AnimationClip, lastTime: number };
type BreathCast_T = { attack: NpcSkillAttack_T, startedAt: number, shotTime: number, hasShot: boolean };
type Walk_T = { from: THREE.Vector3, to: THREE.Vector3, heights: Float32Array, length: number, travelled: number, rotation: THREE.Quaternion, restRotation: THREE.Quaternion };

export class AntharasActor extends Object3D {
    public readonly isActor = true;

    protected readonly renderManager: RenderManager;
    protected readonly audioManager: AudioManager;
    protected readonly library: DecodeLibrary;
    protected readonly mesh: LitSkinnedMesh;
    protected readonly skeleton: LocalSpaceSkeleton;
    protected readonly animations: Record<string, THREE.AnimationClip>;

    protected current: PlayingAnimation_T = null;
    protected breath: BreathCast_T = null;
    protected walk: Walk_T = null;
    protected lastWalkSmoke: number = -Infinity;
    protected nextBreathAt: number;
    protected elapsed: number = 0;

    public constructor(renderManager: RenderManager, audioManager: AudioManager, library: DecodeLibrary) {
        super();

        this.renderManager = renderManager;
        this.audioManager = audioManager;
        this.library = library;

        this.mesh = decodeSkinnedMesh(library, library.pawnActors[0]) as LitSkinnedMesh;
        this.skeleton = this.mesh.skeleton as LocalSpaceSkeleton;
        this.animations = (this.mesh as any).meshAnimations;
        this.name = library.name;

        this.add(this.mesh);

        this.nextBreathAt = randRange(BREATH_INTERVAL[0], BREATH_INTERVAL[1]);
    }

    public beginPlay() {
        this.updateMatrixWorld(true);

        for (const [classId, location] of EYE_EFFECTS) {
            const effect = this.createEffect(classId);

            this.skeleton.attachObject(effect, "Bone02");
            effect.position.fromArray(location);
        }

        this.walkFrom(PIT_POSITION);
    }

    public walkFrom(start: THREE.Vector3) {
        const from = start.clone();
        const to = this.position.clone();
        const heights = new Float32Array(WALK_FLOOR_SAMPLES + 1);
        const direction = tmpDirection.subVectors(to, from).setZ(0);
        const length = direction.length();

        for (let i = 0; i <= WALK_FLOOR_SAMPLES; i++) {
            const t = i / WALK_FLOOR_SAMPLES;

            tmpPosition.lerpVectors(from, to, t);
            tmpPosition.z += WALK_FLOOR_TRACE * 0.5;

            const floor = this.renderManager.traceFloor(tmpPosition, WALK_FLOOR_TRACE);

            heights[i] = floor === null ? tmpPosition.z - WALK_FLOOR_TRACE * 0.5 : floor;
        }

        const offset = to.z - heights[WALK_FLOOR_SAMPLES];

        for (let i = 0; i <= WALK_FLOOR_SAMPLES; i++) heights[i] += offset;

        const yaw = Math.atan2(direction.y, direction.x) - Math.PI;
        const rotation = new Quaternion().setFromAxisAngle(unitZ, yaw).multiply(this.quaternion);

        this.walk = { from, to, heights, length, travelled: 0, rotation, restRotation: this.quaternion.clone() };
        this.updateWalk(0);
        this.playAnimation(WALK_ANIMATION);
    }

    protected updateWalk(dt: number) {
        const walk = this.walk;

        walk.travelled = Math.min(walk.length, walk.travelled + WALK_SPEED * dt);

        const t = walk.length === 0 ? 1 : walk.travelled / walk.length;
        const sample = t * WALK_FLOOR_SAMPLES;
        const index = Math.min(Math.floor(sample), WALK_FLOOR_SAMPLES - 1);

        this.position.lerpVectors(walk.from, walk.to, t);
        this.position.z = walk.heights[index] + (walk.heights[index + 1] - walk.heights[index]) * (sample - index);

        if (t < 1) {
            this.quaternion.copy(walk.rotation);
            return;
        }

        this.quaternion.copy(walk.restRotation);
        this.walk = null;
        this.nextBreathAt = this.elapsed;
        this.playAnimation(SOCIAL_ANIMATIONS[Math.floor(Math.random() * SOCIAL_ANIMATIONS.length)]);
    }

    public getBreathTarget(target: THREE.Vector3): THREE.Vector3 {
        const camera = this.renderManager.camera;

        this.getWorldPosition(tmpPosition);

        return target.copy(tmpPosition).sub(camera.position).setLength(TARGET_STANDOFF).add(camera.position);
    }

    public update(deltaTime: number) {
        const dt = deltaTime / 1000;

        this.elapsed += dt;

        if (this.walk) this.updateWalk(dt);
        if (this.breath) this.updateBreath();
        if (this.current) this.updateNotifies();
    }

    public castBreath(): boolean {
        if (this.breath) return false;

        const attack = this.library.npcSkillAttacks.find(attack => attack.id === BREATH_SKILL_ID);

        if (!attack) throw new Error(`'${this.name}' has no breath skill '${BREATH_SKILL_ID}'.`);

        const clip = this.animations[attack.animation];
        const shot = findAttackShot(clip);

        // Engine.dll InitSkillProcess 0x798998..0x798bb2: castStyle 7 without visual, epsilon 0.15, tween 0.2
        const hitTime = attack.hitTime - 0.15;
        const notifyTime = shot * clip.duration;
        const rate = notifyTime / (hitTime - 0.2);
        const shotTime = 0.2 + notifyTime / rate;

        this.breath = { attack, startedAt: this.elapsed, shotTime, hasShot: false };

        this.playAnimation(attack.animation, rate);
        this.playSkillSounds(attack, "casting", this.getWorldPosition(tmpPosition));

        const casting = this.createEffect("LineageEffect.e_u046_a");

        // s_antaras_breath casting: Engine.dll 0x79e838..0x79e8b3
        casting.scriptProperties.set("SpeedRate", 1);
        casting.scriptProperties.set("LifeSpan", shotTime);
        this.renderManager.addTransientEffect(casting);
        this.attachToBone(casting, "bone01");
        casting.position.set(245, -120, 0);
        tmpRotator.set(0, 16384, 0).toQuaternion(casting.quaternion);

        return true;
    }

    protected updateBreath() {
        const breath = this.breath;
        const time = this.elapsed - breath.startedAt;

        if (!breath.hasShot && time >= breath.shotTime) {
            breath.hasShot = true;
            this.fireBreathProjectile(breath.attack);
        }
    }

    protected fireBreathProjectile(attack: NpcSkillAttack_T) {
        const projectile = this.createEffect("LineageEffect.e_u046_b");
        const properties = projectile.scriptProperties;
        const boneIndex = this.skeleton.matchRefBone("bone01");
        const target = new Vector3();

        // Engine.dll 0x7ab19e..0x7ab234: (245,-120,0) rotated by the bone, added to the bone origin
        this.skeleton.getBoneWorldPosition(boneIndex, projectile.position, tmpOffset.set(245, -120, 0));
        this.getWorldQuaternion(projectile.quaternion);
        properties.set("SpeedRate", 1);

        this.playSkillSounds(attack, "shot", projectile.position);

        let speed = properties.get("Speed") as number;
        const acceleration = properties.get("AccSpeed") as number;

        projectile.onEffectTick = (deltaTime: number) => {
            const dt = deltaTime / 1000;

            this.getBreathTarget(target);

            tmpDirection.subVectors(target, projectile.position);

            const distance = tmpDirection.length();
            const step = speed * dt;

            speed += acceleration * dt;

            projectile.quaternion.setFromUnitVectors(unitX, tmpDirection.normalize());

            if (distance > step) {
                projectile.position.addScaledVector(tmpDirection, step);
                return true;
            }

            this.explodeBreath(attack, target);

            return false;
        };

        this.renderManager.addTransientEffect(projectile);
    }

    protected explodeBreath(attack: NpcSkillAttack_T, target: THREE.Vector3) {
        const explosion = this.createEffect("LineageEffect.e_u046_c");

        explosion.position.copy(target);
        explosion.quaternion.identity();
        explosion.scriptProperties.set("SpeedRate", 1);

        this.renderManager.addTransientEffect(explosion);
        // s_antaras_breath: Engine.dll 0x78fa09..0x78fa80 native view-shake arguments after each impact
        this.renderManager.addViewShakeState(6, 1, 10000, 120, tmpDirection.set(Math.random(), Math.random(), 0).multiplyScalar(100), tmpOffset.set(400, 400, 0), tmpPosition.set(120, 120, 0), target, 200, 2000);
        this.renderManager.triggerL2Event("antarascave_smoke", target, 2000);
        this.playSkillSounds(attack, "explosion", target);
    }

    protected onAnimationFinished() {
        if (this.walk) {
            this.playAnimation(WALK_ANIMATION);
            return;
        }

        const wasBreath = this.breath !== null && this.current.name === this.breath.attack.animation;

        if (wasBreath) {
            this.breath = null;
            this.nextBreathAt = this.elapsed + randRange(BREATH_INTERVAL[0], BREATH_INTERVAL[1]);
        }

        if (!this.breath && this.elapsed >= this.nextBreathAt && this.castBreath()) return;

        const name = !wasBreath && Math.random() < SOCIAL_CHANCE
            ? SOCIAL_ANIMATIONS[Math.floor(Math.random() * SOCIAL_ANIMATIONS.length)]
            : IDLE_ANIMATION;

        this.playAnimation(name);
    }

    public playAnimation(name: string, rate: number = 1) {
        const clip = this.animations[name];

        if (!clip) throw new Error(`'${this.name}' has no animation '${name}'.`);

        const mixer = this.renderManager.mixer;
        const previous = this.current;
        const action = mixer.clipAction(clip, this.mesh);

        if (previous && previous.action === action) action.stop();

        action.reset();
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        action.timeScale = rate;

        if (previous && previous.action !== action) previous.action.crossFadeTo(action, CROSSFADE_TIME / rate, false);

        action.play();

        this.current = { name, action, clip, lastTime: -1 };
    }

    protected updateNotifies() {
        const current = this.current;
        const time = current.action.time / current.clip.duration;
        const notifies = (current.clip as any).animationNotifies as IAnimationNotifyDecodeInfo[];

        for (const notify of notifies)
            if (notify.time > current.lastTime && notify.time <= time)
                this.onAnimationNotify(notify);

        current.lastTime = time;

        if (!current.action.isRunning() && time >= 1 - 1e-6) this.onAnimationFinished();
    }

    protected onAnimationNotify(notify: IAnimationNotifyDecodeInfo) {
        const info = notify.object;

        if (!info) return;

        switch (info.type) {
            case "sound": this.onAnimationSound(info as IAnimationSoundNotifyDecodeInfo); break;
            case "effect": this.onAnimationEffect(info as IAnimationEffectNotifyDecodeInfo); break;
            case "viewShake": this.onAnimationViewShake(info as IAnimationViewShakeNotifyDecodeInfo); break;
        }
    }

    protected onAnimationViewShake(info: IAnimationViewShakeNotifyDecodeInfo) {
        if (!this.walk) {
            this.renderManager.addViewShake(this, info);
            return;
        }

        this.renderManager.addViewShake(this, { ...info, shakeIntensity: WALK_SHAKE_INTENSITY, shakeRange: WALK_SHAKE_RANGE });

        if (this.elapsed - this.lastWalkSmoke < WALK_SMOKE_COOLDOWN) return;

        this.lastWalkSmoke = this.elapsed;
        this.renderManager.triggerL2Event("antarascave_smoke", this.getWorldPosition(tmpPosition), WALK_SMOKE_RADIUS);
    }

    protected onAnimationSound(info: IAnimationSoundNotifyDecodeInfo) {
        if (!info.sound || info.sound.toLowerCase() === "none") return;
        if (Math.random() * 100 >= info.random) return;

        this.playSound(info.sound, info.volume / 255, info.radius, this.getWorldPosition(tmpPosition));
    }

    protected onAnimationEffect(info: IAnimationEffectNotifyDecodeInfo) {
        if (!info.effectClass) return;

        const effect = this.createEffect(info.effectClass);
        const hasBone = info.bone.toLowerCase() !== "none";

        this.getWorldPosition(effect.position);
        this.getWorldQuaternion(effect.quaternion);
        tmpOffset.fromArray(info.offsetLocation);

        if (!info.attach || !hasBone) {
            tmpRotation.copy(effect.quaternion);

            if (hasBone) {
                this.skeleton.getBoneWorldMatrix(this.skeleton.matchRefBone(info.bone), tmpBoneMatrix);
                effect.position.setFromMatrixPosition(tmpBoneMatrix);
                tmpRotation.setFromRotationMatrix(tmpBoneMatrix.extractRotation(tmpBoneMatrix));
            }

            effect.position.add(tmpOffset.applyQuaternion(tmpRotation));

            if (!info.independentRotation) effect.quaternion.copy(tmpRotation).multiply(tmpRotator.set(...info.offsetRotation).toQuaternion(tmpRotation));
        }

        this.renderManager.addTransientEffect(effect);

        if (info.tag.toLowerCase() !== "none") effect.scriptProperties.set("Tag", info.tag);

        effect.scale.fromArray(info.drawScale3D).multiplyScalar(info.drawScale);
        effect.scriptProperties.set("DrawScale", info.drawScale);
        effect.scriptProperties.set("DrawScale3D", info.drawScale3D.slice());
        effect.traverse((emitter: any) => {
            if (!emitter.particlePool) return;

            emitter.scale.setScalar(info.drawScale > 0 ? 1 / info.drawScale : 1);
            emitter.setSizeScale(info.effectScale);
        });

        if (info.attach && hasBone && this.attachToBone(effect, info.bone)) {
            effect.position.fromArray(info.offsetLocation);
            tmpRotator.set(...info.offsetRotation).toQuaternion(effect.quaternion);
        }
    }

    protected attachToBone(effect: THREE.Object3D, bone: string): boolean {
        if (!this.skeleton.attachObject(effect, bone)) return false;

        (effect as any).attachedSkeleton = this.skeleton;

        return true;
    }

    protected playSkillSounds(attack: NpcSkillAttack_T, phase: string, position: THREE.Vector3) {
        const played = new Set<string>();

        for (const sound of attack.sounds) {
            if (sound.phase !== phase || played.has(sound.sound)) continue;

            played.add(sound.sound);
            this.playSound(this.library.sounds[sound.sound], sound.volume / 255, sound.radius, position);
        }
    }

    protected playSound(soundName: string, volume: number, radius: number, position: THREE.Vector3) {
        const sound = this.library.soundBlobCache.get(soundName);

        if (!sound?.uri) throw new Error(`'${this.name}' has no decoded sound '${soundName}'.`);

        this.audioManager.playOneShotSound(sound.uri, position, this.renderManager.camera, volume, 1, radius, radius * 100);
    }

    protected createEffect(classId: string): any {
        const info = this.library.effectTemplates[classId] || this.library.effectTemplates[classId.toLowerCase()];

        if (!info) throw new Error(`Effect template '${classId}' is not in '${this.library.name}'.`);

        const effect = decodeObject3D(this.library, info) as any;

        effect.children.forEach((emitter: any) => emitter.isActorAttachedEmitter = true);

        return effect;
    }
}

export default AntharasActor;

function findAttackShot(clip: THREE.AnimationClip): number {
    const notifies = (clip as any).animationNotifies as IAnimationNotifyDecodeInfo[];

    for (let i = notifies.length - 1; i >= 0; i--) {
        const object = notifies[i].object;

        if (object?.type === "native" && object.className.toLowerCase() === "animnotify_attackshot")
            return notifies[i].time;
    }

    throw new Error(`Animation '${clip.name}' has no AnimNotify_AttackShot.`);
}

function randRange(min: number, max: number) { return Math.random() * (max - min) + min; }
