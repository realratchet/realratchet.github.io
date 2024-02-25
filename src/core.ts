import decodeObject3D, { decodePackage } from "./assets/decoders/object3d-decoder";
import DecodeLibrary from "./assets/unreal/decode-library";
import RenderManager from "./rendering/render-manager";

const TXT_DECODER = new TextDecoder();
const T_NIL = "0".charCodeAt(0);
const T_OBJECT = "O".charCodeAt(0);
const T_BIGINT = "q".charCodeAt(0);
const T_NUMBER = "n".charCodeAt(0);
const T_BOOL = "?".charCodeAt(0);
const T_STRING = "s".charCodeAt(0);
const V_NIL_NULL = 0;
const V_NIL_UNDEFINED = 1;

function _decompileArray(obj: DataView, iter: [number]): any[] {
    const count = obj.getUint32(iter[0], true);
    const arr = new Array(count);
    iter[0] += 4;


    for (let i = 0; i < count; i++) {
        arr[i] = decompile(obj, iter);
    }

    return arr;
}

function _decompileLibrary(obj: DataView, iter: [number]): DecodeLibrary {
    const lib = new DecodeLibrary() as Record<string, any>;
    const count = obj.getUint32(iter[0], true);
    iter[0] += 4;

    for (let i = 0; i < count; i++) {
        const len = obj.getUint32(iter[0], true);
        iter[0] += 4;
        const bName = obj.buffer.slice(iter[0], iter[0] + len);
        const name = TXT_DECODER.decode(bName);
        iter[0] += len;

        const value = decompile(obj, iter);

        lib[name] = value;
    }

    return lib as DecodeLibrary;
}

function _decompileObject(obj: DataView, iter: [number]): Record<string, any> {
    const lib: Record<string, any> = {};
    const count = obj.getUint32(iter[0], true);
    iter[0] += 4;

    for (let i = 0; i < count; i++) {
        const len = obj.getUint32(iter[0], true);
        iter[0] += 4;
        const bName = obj.buffer.slice(iter[0], iter[0] + len);
        const name = TXT_DECODER.decode(bName);
        iter[0] += len;

        const value = decompile(obj, iter);

        lib[name] = value;
    }

    return lib;
}

type NamedArrayTypes = "Int8Array" | "Int16Array" | "Int32Array" | "Uint8Array" | "Uint16Array" | "Uint32Array" | "Float32Array" | "Float64Array";

function _decodePrimitive(Constructor: NamedArrayTypes, obj: DataView, iter: [number]): ArrayLike<number> {
    const byteLength = obj.getUint32(iter[0], true);
    iter[0] += 4;

    const slice = obj.buffer.slice(iter[0], iter[0] + byteLength);
    const arr = new global[Constructor](slice);

    iter[0] += byteLength;

    return arr;
}

function _decodeArrayBuffer(obj: DataView, iter: [number]): ArrayBuffer {
    const byteLength = obj.getUint32(iter[0], true);
    iter[0] += 4;

    const slice = obj.buffer.slice(iter[0], iter[0] + byteLength);

    iter[0] += byteLength;

    return slice;
}

function decompile(obj: DataView, iter: [number]): any {
    const t = obj.getUint8(iter[0]++);
    const tn = String.fromCharCode(t);

    switch (t) {
        case T_STRING: {
            const len = obj.getUint32(iter[0], true);
            iter[0] += 4;
            const bStr = obj.buffer.slice(iter[0], iter[0] + len);
            const str = TXT_DECODER.decode(bStr);
            iter[0] += len;

            return str;
        }
        case T_BIGINT: {
            const len = obj.getUint32(iter[0], true);
            iter[0] += 4;
            const bStr = obj.buffer.slice(iter[0], iter[0] + len);
            const str = TXT_DECODER.decode(bStr);
            iter[0] += len;

            return BigInt(str);
        };
        case T_NUMBER: {
            const num = obj.getFloat64(iter[0], true);
            iter[0] += 8;
            return num;
        }
        case T_NIL: {
            switch (obj.getUint8(iter[0]++)) {
                case V_NIL_NULL: return null;
                case V_NIL_UNDEFINED: return undefined;
                default:
                    debugger;
                    throw new Error("not implemented");
            }
        };
        case T_BOOL: return obj.getUint8(iter[0]++) >= 1;
        case T_OBJECT: {
            const len = obj.getUint32(iter[0], true);
            iter[0] += 4;
            const bName = obj.buffer.slice(iter[0], iter[0] + len);
            const name = TXT_DECODER.decode(bName);
            iter[0] += len;
            switch (name) {
                case "DecodeLibrary": return _decompileLibrary(obj, iter);
                case "Array": return _decompileArray(obj, iter);
                case "Object": return _decompileObject(obj, iter);
                case "Int8Array":
                case "Int16Array":
                case "Int32Array":
                case "Uint8Array":
                case "Uint16Array":
                case "Uint32Array":
                case "Float32Array":
                case "Float64Array":
                    return _decodePrimitive(name, obj, iter);
                case "ArrayBuffer": return _decodeArrayBuffer(obj, iter);
                default:
                    console.log(name);
                    debugger;
                    throw new Error("not implemented")
            }
        }
        default:
            console.log(tn);
            debugger;
            throw new Error("not implemented")
    }
}

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

async function addLair(renderManager: RenderManager, tracker: Tracker) {
    const resLair = await fetchTrackable(renderManager.supportsDDS ? "assets/lair.blob" : "assets/lair_png.blob", tracker);
    const sector = decompile(new DataView(await (resLair).arrayBuffer()), [0]);

    sector.supportsDDS = renderManager.supportsDDS;
    sector.anisotropy = renderManager.renderer.capabilities.getMaxAnisotropy();

    renderManager.addSector(decodePackage(sector));
}

async function addAntharas(renderManager: RenderManager, tracker: Tracker) {
    const resAntharas = await fetchTrackable(renderManager.supportsDDS ? "assets/antharas.blob" : "assets/antharas_png.blob", tracker);

    if (!resAntharas.ok) throw new Error(resAntharas.statusText);

    const antharas = decompile(new DataView(await (resAntharas).arrayBuffer()), [0]);

    antharas.lib.supportsDDS = renderManager.supportsDDS;
    antharas.lib.anisotropy = renderManager.renderer.capabilities.getMaxAnisotropy();

    const char = decodeObject3D(antharas.lib, antharas.info) as THREE.SkinnedMesh;
    const trans = antharas.trans;

    // char.position.set(-87063.33997244012, -3700, 239964.66910649382);           // ti test
    char.position.fromArray(trans.pos); // lair
    char.quaternion.fromArray(trans.rot);

    renderManager.scene.add(char);
    renderManager.scene.updateMatrixWorld(true);

    const clip = char.userData.animations["Wait"];
    const action = renderManager.mixer.clipAction(clip);
    const audios = [new Audio("assets/cry1.wav"), new Audio("assets/cry2.wav"), new Audio("assets/cry3.wav")];
    const idleSound = new Audio("assets/idle.wav");

    const icoMuted = "volume_off";
    const icoUnmuted = "volume_up";
    const volume = 0.1;

    const btnMute = document.querySelector(".audio") as HTMLDivElement;
    let isMuted = true;

    function mute() {
        audios.forEach(a => a.volume = 0);
        idleSound.volume = 0;
        btnMute.innerHTML = icoMuted;
        triggerResize();
    }

    function unmute() {
        audios.forEach(a => a.volume = volume);
        btnMute.innerHTML = icoUnmuted;
        idleSound.volume = volume;
        triggerResize();
    }

    mute();

    function toggleAudio(e: PointerEvent) {
        isMuted = !isMuted;

        if (isMuted) mute();
        else unmute();

        e.preventDefault();
    }

    btnMute.addEventListener("click", toggleAudio);
    btnMute.addEventListener("touchend", toggleAudio);

    function playRandom() {
        setTimeout(function () {
            if (!isMuted) idleSound.play();
        }, Math.random() * 500);
        setTimeout(function () {
            idleSound.pause();
            idleSound.currentTime = 0;

            const idx = Math.floor(Math.random() * audios.length);
            const sound = audios[idx]

            audios.forEach(sound => {
                sound.pause();
                sound.currentTime = 0;
            });

            if (!isMuted) sound.play();
        }, 2000);
    }

    playRandom();

    renderManager.mixer.addEventListener("loop", function () {
        playRandom();
    });

    action.play();
}

async function startCore() {
    const viewport = document.querySelector("viewport") as HTMLViewportElement;
    const renderManager = new RenderManager(viewport);
    const objectGroup = renderManager.objectGroup;

    global.renderManager = renderManager;

    const tracker = new Tracker(document.querySelector("div.logo.dynamic"));

    Promise
        .allSettled([addLair(renderManager, tracker), addAntharas(renderManager, tracker)])
        .then(() => document.body.setAttribute("loading", "false"));

    renderManager.scene.add(objectGroup);
    renderManager.startRendering();

    console.info("System has loaded!");
}

export default startCore;
export { startCore };