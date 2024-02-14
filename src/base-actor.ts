import { Object3D, Vector3 } from "three";
import RenderManager from "./rendering/render-manager";

class BaseActor extends Object3D {
    public readonly isActor = true;
    public readonly isCollidable = true;
    public readonly type: string = "Actor";

    protected characterSpeed = 125;
    protected stepHeight = 10;

    protected canFly = false;
    protected renderManager: RenderManager;
    protected lastUpdate: number;
    protected meshes: THREE.Object3D[] = [];
    protected currAnimations = new WeakMap<THREE.Object3D, THREE.AnimationAction>();
    protected prevAnimations = new WeakMap<THREE.Object3D, THREE.AnimationAction>();
    protected actorAnimations: Record<string, THREE.AnimationClip> = {};


    protected readonly actorState = new ActorState();
    protected readonly basicActorAnimations: BasicActorAnimations = {
        idle: null,
        walking: null,
        running: null,
        dying: null,
        falling: null
    };

    constructor(renderManager: RenderManager) {
        super();

        this.renderManager = renderManager;
    }


    public update(renderManager: RenderManager, currentTime: number, deltaTime: number) {
        this.lastUpdate = currentTime;

        this.checkAnimationState();
    }

    protected checkAnimationState() {
        if (this.actorState.desired.state === this.actorState.state) return;

        this.actorState.state = this.actorState.desired.state;

        switch (this.actorState.state) {
            case "falling": this.playAnimation(this.basicActorAnimations.falling); break;
            case "idle": this.playAnimation(this.basicActorAnimations.idle); break;
            case "dying": this.playAnimation(this.basicActorAnimations.dying); break;
            case "walking": this.playAnimation(this.basicActorAnimations.walking); break;
            case "running": this.playAnimation(this.basicActorAnimations.running); break;
            default: new Error(`Unknown actor state: '${this.actorState.state}'`);
        }
    }


    public setMeshes(meshes: THREE.Mesh[]) {
        this.stopAnimations();

        for (const mesh of this.meshes)
            this.remove(mesh);

        this.meshes = meshes;

        for (const mesh of meshes)
            this.add(mesh);
    }

    public setAnimations(animations: Record<string, THREE.AnimationClip>) {
        this.stopAnimations();
        this.actorState.reset();
        this.actorAnimations = animations;
    }

    public stopAnimations() {
        for (const mesh of this.meshes) {
            if (this.prevAnimations.has(mesh))
                this.prevAnimations.get(mesh).stop();

            if (this.currAnimations.has(mesh))
                this.currAnimations.get(mesh).stop();
        }
    }

    protected setBasicActorAnimation(key: ValidStateNames_T, animationName: string) {
        if (!(animationName in this.actorAnimations))
            throw new Error(`'${animationName}' is not available.`);

        if (!(key in this.basicActorAnimations))
            throw new Error(`'${key}' is not a valid basic actor animation`);

        (this.basicActorAnimations as any)[key] = animationName;
    }

    public setIdleAnimation(animationName: string) { this.setBasicActorAnimation("idle", animationName); }
    public setWalkingAnimation(animationName: string) { this.setBasicActorAnimation("walking", animationName); }
    public setRunningAnimation(animationName: string) { this.setBasicActorAnimation("running", animationName); }
    public setDeathAnimation(animationName: string) { this.setBasicActorAnimation("dying", animationName); }
    public setFallingAnimation(animationName: string) { this.setBasicActorAnimation("falling", animationName); }

    protected isAnimationsInit = false;

    public initAnimations() {
        this.isAnimationsInit = true;
        this.playAnimation(this.basicActorAnimations.idle);
    }

    public playAnimation(animationName: string) {
        if (!this.isAnimationsInit) return;

        if (!(animationName in this.actorAnimations))
            throw new Error(`'${animationName}' is not available.`);

        const clip = this.actorAnimations[animationName];
        const mixer = this.renderManager.mixer;

        for (const mesh of this.meshes) {
            const prevAct = this.prevAnimations.get(mesh) || null;
            const currAct = this.currAnimations.get(mesh) || null;
            const nextAct = mixer.clipAction(clip, mesh);

            this.currAnimations.set(mesh, nextAct);

            if (prevAct) prevAct.stop();
            if (currAct) {
                this.prevAnimations.set(mesh, currAct);
                currAct.crossFadeTo(nextAct, 0.25, false);
            }

            nextAct.play();
        }
    }
}

export default BaseActor;
export { BaseActor };

class ActorState {
    public state: ValidStateNames_T = "idle";
    public locomotion: boolean = false;
    public readonly velocity = new Vector3();
    public readonly desired: DesiredState_T = {
        state: "idle",
        position: new Vector3(),
        direction: new Vector3()
    };

    public reset() {
        this.state = "idle";
        this.desired.state = "idle";
    }
}

type BasicActorAnimations = {
    idle: string;
    walking: string;
    running: string;
    dying: string;
    falling: string;
}

type DesiredState_T = {
    state: ValidStateNames_T;
    position: THREE.Vector3;
    direction: THREE.Vector3;
}

type ValidStateNames_T = "idle" | "walking" | "running" | "dying" | "falling";