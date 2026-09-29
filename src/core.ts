import { Matrix4, Quaternion, Vector3 } from "three";
import { decodePackage } from "./assets/decoders/object3d-decoder";
import { deserializeLibraryAsync } from "./assets/decode-worker/library-serializer";
import decodeEnv from "./assets/decoders/env-decoder";
import RenderManager from "./rendering/render-manager";
import AudioManager from "./audio/audio-manager";
import AntharasActor from "./objects/antharas-actor";

const ANTHARAS_POSITION = new Vector3(181425.90940428418, -7702.370465083446, 114852.49754089414);
const ANTHARAS_ROTATION = [0, -0.7071067805519559, 0, 0.7071067818211395];

const STORAGE_KEY_MUTED = "l2js.muted";

const matSwizzle =new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const tmpPosition = new Vector3();
const tmpQuaternion = new Quaternion();

class Tracker {
    public trackers = new Array<number>();
    public element: HTMLDivElement;
    protected minTrackers: number;

    public constructor(elem: HTMLDivElement, min: number = 0) {
        this.element = elem;
        this.minTrackers = min;

        global.addEventListener("resize", this.onHandleResize.bind(this));
    }

    public add() {
        this.trackers.push(0);
        this.redraw();
        return this.trackers.length - 1;
    }

    public update(idx: number, prog: number) {
        this.trackers[idx] = prog;
        this.redraw();
    }

    protected redraw() {
        const prog = this.trackers.length === 0
            ? 0
            : (this.trackers.reduce((acc, v) => acc + v, 0) / Math.max(this.trackers.length, this.minTrackers) * 100);

        this.element.style.clipPath = `rect(0px ${prog}% 100% 0px)`;
    }

    protected onHandleResize() { this.redraw(); }
}

async function fetchTrackable(uri: string, tracker: Tracker): Promise<Response> {
    const response = await fetch(uri);

    if (!response.ok) throw new Error(response.statusText);

    const pbar = tracker.add();

    const total = parseInt(response.headers.get("content-length"))
    let loaded = 0;

    const res = new Response(new ReadableStream({
        async start(controller) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                loaded += value.byteLength;
                tracker.update(pbar, loaded / total);
                controller.enqueue(value);
            }
            controller.close();
        }
    }));

    return res;
}

async function fetchLibrary(uri: string, tracker: Tracker, renderManager: RenderManager) {
    const response = await fetchTrackable(uri, tracker);
    const buffer = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const library = await deserializeLibraryAsync(buffer);

    if (library.soundBlobCache)
        for (const entry of library.soundBlobCache.values())
            entry.uri = URL.createObjectURL(new Blob([entry.data], { type: entry.mimeType }));

    library.anisotropy = renderManager.renderer.capabilities.getMaxAnisotropy();

    return library;
}

async function addLair(renderManager: RenderManager, tracker: Tracker, audioManager: AudioManager) {
    const library = await fetchLibrary("assets/lair.l2dc.gz", tracker, renderManager);
    const sector = decodePackage(library);

    renderManager.addSector(sector);

    renderManager.onEmitterSound = (uri, sound) => {
        if (!uri) return;

        const position = Array.isArray(sound.position) ? tmpPosition.fromArray(sound.position) : tmpPosition.copy(sound.position);

        audioManager.playOneShotSound(uri, position, renderManager.camera, sound.volume, sound.pitch, sound.refDistance, sound.maxDistance);
    };
}

async function addAntharas(renderManager: RenderManager, tracker: Tracker, audioManager: AudioManager) {
    const library = await fetchLibrary("assets/antharas.l2dc.gz", tracker, renderManager);
    const antharas = new AntharasActor(renderManager, audioManager, library);
    const rotation = new Matrix4().makeRotationFromQuaternion(tmpQuaternion.fromArray(ANTHARAS_ROTATION));

    antharas.position.copy(ANTHARAS_POSITION).applyMatrix4(matSwizzle);
    antharas.quaternion.setFromRotationMatrix(rotation.premultiply(matSwizzle).multiply(matSwizzle));

    renderManager.addPawn(antharas);

    return antharas;
}

function initAudioButton(audioManager: AudioManager) {
    const icoMuted = "volume_off";
    const icoUnmuted = "volume_up";
    const btnMute = document.querySelector(".audio") as HTMLDivElement;

    function setMuted(isMuted: boolean) {
        audioManager.setMuted(isMuted);
        btnMute.innerHTML = isMuted ? icoMuted : icoUnmuted;
        triggerResize();

        try { localStorage.setItem(STORAGE_KEY_MUTED, String(isMuted)); } catch { }
    }

    function toggleAudio(e: PointerEvent) {
        setMuted(!audioManager.getMuted());

        e.preventDefault();
    }

    let isMuted = true;

    try { isMuted = localStorage.getItem(STORAGE_KEY_MUTED) !== "false"; } catch { }

    setMuted(isMuted);

    btnMute.addEventListener("click", toggleAudio);
    btnMute.addEventListener("touchend", toggleAudio);
}

async function startCore() {
    const viewport = document.querySelector("viewport") as HTMLViewportElement;
    const renderManager = new RenderManager(viewport);
    const audioManager = new AudioManager(0.3);
    const tracker = new Tracker(document.querySelector("div.logo.dynamic"));

    global.renderManager = renderManager;

    initAudioButton(audioManager);

    const envLibrary = await fetchLibrary("assets/env.l2dc.gz", tracker, renderManager);

    renderManager.setEnv(decodeEnv(envLibrary));

    const [, antharas] = await Promise.all([
        addLair(renderManager, tracker, audioManager),
        addAntharas(renderManager, tracker, audioManager)
    ]);

    antharas.beginPlay();

    renderManager.onBeforeUpdate = (_currentTime, deltaTime) => antharas.update(deltaTime);

    (global as any).antharas = antharas;

    document.body.setAttribute("loading", "false");

    renderManager.startRendering();

    console.info("System has loaded!");
}

export default startCore;
export { startCore };
