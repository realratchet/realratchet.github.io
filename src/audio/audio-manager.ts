import { Vector3 } from "three";

const AL_SOURCE_RADIUS_FALLBACK = 10; // ALAudioSubsystem::PlaySound uses 10 when Radius is zero.
const ROLLOFF = 0.5; // hardcoded from l2.ini
const tmpPosition = new Vector3();

export class AudioManager {
    protected readonly audioContext = new AudioContext();
    protected readonly effectsGainNode: GainNode;
    protected readonly cacheBuffers = new Map<string, Promise<AudioBuffer>>();
    protected isMuted = true;
    protected volume: number;

    public constructor(volume: number = 0.3) {
        this.volume = volume;
        this.effectsGainNode = this.audioContext.createGain();
        this.effectsGainNode.gain.value = 0;
        this.effectsGainNode.connect(this.audioContext.destination);
    }

    public getMuted() { return this.isMuted; }

    public setMuted(isMuted: boolean) {
        this.isMuted = isMuted;
        this.effectsGainNode.gain.value = isMuted ? 0 : this.volume;

        if (!isMuted && this.audioContext.state !== "running") this.resumeOnGesture();
    }

    protected resumeOnGesture() {
        const context = this.audioContext;
        const events = ["pointerdown", "keydown", "touchend"];

        function onGesture() {
            if (context.state !== "running") context.resume();

            events.forEach(event => global.removeEventListener(event, onGesture, true));
        }

        context.resume();
        events.forEach(event => global.addEventListener(event, onGesture, true));
    }

    protected loadBuffer(dataUri: string): Promise<AudioBuffer> {
        if (!this.cacheBuffers.has(dataUri)) this.cacheBuffers.set(dataUri, this.decodeBuffer(dataUri));

        return this.cacheBuffers.get(dataUri);
    }

    protected async decodeBuffer(dataUri: string): Promise<AudioBuffer> {
        const response = await fetch(dataUri);

        return await this.audioContext.decodeAudioData(await response.arrayBuffer());
    }

    public async playOneShotSound(dataUri: string, position: THREE.Vector3, camera: THREE.Camera, volume: number, pitch: number, refDistance: number, maxDistance: number) {
        if (this.isMuted || this.audioContext.state !== "running") return;

        const sourceRadius = refDistance === 0 ? AL_SOURCE_RADIUS_FALLBACK : refDistance;
        const sourceMaxDistance = maxDistance === 0 ? sourceRadius * 100 : maxDistance;
        const buffer = await this.loadBuffer(dataUri);

        tmpPosition.copy(position).applyMatrix4(camera.matrixWorldInverse);

        const gain = this.audioContext.createGain();
        const source = this.audioContext.createBufferSource();
        const panner = this.audioContext.createPanner();

        gain.gain.value = volume;
        source.buffer = buffer;
        source.playbackRate.value = pitch;

        panner.panningModel = "equalpower";
        panner.distanceModel = "inverse";
        panner.refDistance = sourceRadius;
        panner.maxDistance = sourceMaxDistance;
        panner.rolloffFactor = ROLLOFF;
        panner.positionX.value = -tmpPosition.x;
        panner.positionY.value = tmpPosition.y;
        panner.positionZ.value = tmpPosition.z;

        source.connect(gain);
        gain.connect(panner);
        panner.connect(this.effectsGainNode);

        source.onended = () => {
            source.disconnect();
            gain.disconnect();
            panner.disconnect();
        };

        source.start(0);
    }
}

export default AudioManager;
