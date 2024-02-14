import * as dat from "dat.gui";
import RenderManager from "./rendering/render-manager";
import AssetLoader from "./assets/asset-loader";
// import UTerrainInfo from "./assets/unreal/un-terrain-info";
// import UTerrainSector from "./assets/unreal/un-terrain-sector";
// import UTexture from "./assets/unreal/un-texture";
// import UStaticMesh from "./assets/unreal/static-mesh/un-static-mesh";
import { Box3, Vector3, Object3D, BoxHelper, PlaneBufferGeometry, Mesh, SphereBufferGeometry, MeshBasicMaterial, Box3Helper, Color, BoxBufferGeometry, AxesHelper, DirectionalLight, PointLight, DirectionalLightHelper, PointLightHelper, Euler, SpotLight, SpotLightHelper, AmbientLight, SkeletonHelper } from "three";
import BufferValue from "./assets/buffer-value";
// import UStaticMeshInstance from "./assets/unreal/static-mesh/un-static-mesh-instance";
// import UModel from "./assets/unreal/model/un-model";
// import UExport from "./assets/unreal/un-export";
// import UBrush from "./assets/unreal/un-brush";
// import ULevel from "./assets/unreal/un-level";
// import UStaticMeshActor from "./assets/unreal/static-mesh/un-static-mesh-actor";
import decodeTexture from "./assets/decoders/texture-decoder";
import decodeMaterial from "./assets/decoders/material-decoder";
import MeshStaticMaterial from "./materials/mesh-static-material/mesh-static-material";
import decodeObject3D, { decodePackage } from "./assets/decoders/object3d-decoder";
import ULight from "./assets/unreal/un-light";
import findPattern from "./utils/pattern-finder";
import DecodeLibrary from "./assets/unreal/decode-library";
import UEncodedFile from "@unreal/un-encoded-file";
import UDataFile from "./assets/unreal/datafile/un-datafile";
import { generateUUID } from "three/src/math/MathUtils";
import UFunction from "./assets/unreal/un-function";
import UClassRegistry from "./assets/unreal/scripts/un-class-registry";
import UEmitter from "./assets/unreal/un-emitter";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";

function _compileDecodeLibrary(obj: DecodeLibrary | any, buf: ArrayBuffer[]): any {
    buf.push(new Uint32Array([Object.keys(obj).length]).buffer);

    for (const [k, v] of Object.entries(obj)) {
        const vk = TXT_ENCODER.encode(k.toString());
        buf.push(new Uint32Array([vk.length]).buffer, vk.buffer);

        const compiled = compile(v, []);
        // const len = compiled.reduce((acc, v) => acc + v.byteLength, 0);

        // buf.push(new Uint32Array([len]).buffer);
        for (const c of compiled) buf.push(c);
    }
}

function _compileArray(obj: any[], buf: ArrayBuffer[]): any {
    buf.push(new Uint32Array([obj.length]).buffer);

    for (const o of obj) {
        const compiled = compile(o, []);
        // const len = compiled.reduce((acc, v) => acc + v.byteLength, 0);

        // buf.push(new Uint32Array([len]).buffer);
        for (const c of compiled) buf.push(c);
    }
}

const TXT_ENCODER = new TextEncoder();
const TXT_DECODER = new TextDecoder();
const T_NIL = "0".charCodeAt(0);
const T_OBJECT = "O".charCodeAt(0);
const T_BIGINT = "q".charCodeAt(0);
const T_NUMBER = "n".charCodeAt(0);
const T_BOOL = "?".charCodeAt(0);
const T_STRING = "s".charCodeAt(0);
const V_NIL_NULL = 0;
const V_NIL_UNDEFINED = 1;
const V_BOOL_FALSE = 0;
const V_BOOL_TRUE = 1;

function compile(obj: any, buf: ArrayBuffer[]): ArrayBuffer[] {
    if (obj === null) {
        buf.push(new Uint8Array([T_NIL, V_NIL_NULL]).buffer);
        return buf;
    }

    switch (typeof obj) {
        case "bigint": {
            const v = TXT_ENCODER.encode(obj.toString());
            buf.push(new Uint8Array([T_BIGINT]).buffer, new Uint32Array([v.length]).buffer);
            buf.push(v.buffer);
            return buf;
        }
        case "boolean": {
            buf.push(new Uint8Array([T_BOOL, obj ? V_BOOL_TRUE : V_BOOL_FALSE]).buffer);
            return buf;
        }
        case "number": {
            buf.push(new Uint8Array([T_NUMBER]).buffer);
            buf.push(new Float64Array([obj]).buffer);
            return buf;
        }
        case "undefined": {
            buf.push(new Uint8Array([T_NIL, V_NIL_UNDEFINED]).buffer);
            return buf;
        }
        case "string": {
            const v = TXT_ENCODER.encode(obj.toString());
            buf.push(new Uint8Array([T_STRING]).buffer, new Uint32Array([v.length]).buffer);
            buf.push(v.buffer);
            return buf;
        }
        case "object":
            const name = obj.constructor.name;
            const vName = TXT_ENCODER.encode(name.toString());
            buf.push(new Uint8Array([T_OBJECT]).buffer, new Uint32Array([vName.length]).buffer);
            buf.push(vName.buffer);

            switch (name) {
                case "Object":
                case "DecodeLibrary":
                    _compileDecodeLibrary(obj, buf);
                    break;
                case "Array": _compileArray(obj, buf); break;
                case "Int8Array":
                case "Int16Array":
                case "Int32Array":
                case "Int64Array":
                case "Uint8Array":
                case "Uint16Array":
                case "Uint32Array":
                case "Uint64Array":
                case "Float32Array":
                case "Float64Array":
                    buf.push(new Uint32Array([obj.buffer.byteLength]).buffer);
                    buf.push(obj.buffer);
                    break;
                case "ArrayBuffer":
                    buf.push(new Uint32Array([obj.byteLength]).buffer);
                    buf.push(obj);
                    break;
                default:
                    debugger;
                    throw new Error("not implemented");
            }
            break;
        default:
            debugger;
            throw new Error("not implemented");
    }

    return buf;
}

// function _decompileLibrary(obj: Record<keyof DecodeLibrary, any>): DecodeLibrary {
//     const lib = new DecodeLibrary() as Record<string, any>;

//     Object.entries(obj).forEach(([k, v]) => {
//         lib[k] = decompile(v);
//     });

//     return lib as DecodeLibrary;
// }

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

function _decodePrimitive(Constructor: string, obj: DataView, iter: [number]): ArrayLike<number> {
    const byteLength = obj.getUint32(iter[0], true);
    iter[0] += 4;

    const slice = obj.buffer.slice(iter[0], iter[0] + byteLength);
    const arr = new (global as any)[Constructor](slice);

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
                case "Int64Array":
                case "Uint8Array":
                case "Uint16Array":
                case "Uint32Array":
                case "Uint64Array":
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

// function decompile(obj: any): any {
//     switch (obj.t) {
//         case "o":
//             switch (obj.n) {
//                 case "DecodeLibrary": return _decompileLibrary(obj.v);
//                 case "Array": return (obj.v as any[]).map(v => decompile(v));
//                 case "Object": return _decompileObject(obj.v);
//                 case "Int8Array":
//                 case "Int16Array":
//                 case "Int32Array":
//                 case "Int64Array":
//                 case "Uint8Array":
//                 case "Uint16Array":
//                 case "Uint32Array":
//                 case "Uint64Array":
//                 case "Float32Array":
//                 case "Float64Array":
//                     return new (global as any)[obj.n](obj.v);
//                 case "ArrayBuffer": return new Uint8Array(obj.v).buffer;
//                 default:
//                     debugger;
//                     throw new Error("not implemented")
//             }
//         case "s":
//         case "?":
//         case "n":
//             return obj.v;
//         case "q": return BigInt(obj.v);
//         case "0":
//             switch (obj.v) {
//                 case "undefined": return undefined;
//                 case "null": return null;
//                 default:
//                     debugger;
//                     throw new Error("not implemented")
//             }
//         default:
//             debugger;
//             throw new Error("not implemented")
//     }
// }

async function _decodePackage(renderManager: RenderManager, assetLoader: AssetLoader, pkg: string | UPackage | UPackage, settings: LoadSettings_T) {
    if (typeof (pkg) === "string") pkg = assetLoader.getPackage(pkg, "Level");

    const decodeLibrary = await DecodeLibrary.fromPackage(await assetLoader.load(pkg), settings);

    // debugger;

    decodeLibrary.anisotropy = renderManager.renderer.capabilities.getMaxAnisotropy();

    console.log(`Decode library '${decodeLibrary.name}' created, building scene.`);

    let compiled = compile(decodeLibrary, []);

    const blob = new Blob(compiled, { type: "application/octet-stream" });
    const f = URL.createObjectURL(blob);

    // let serialized = JSON.stringify(compiled);
    // let packed = deflate(serialized, {level: 9});

    // console.log(serialized);

    debugger;

    return decodePackage(decodeLibrary);
}

async function _decodeCharacter(renderManager: RenderManager, assetLoader: AssetLoader, pkg: string | UPackage, pkgTex: string | UPackage) {

    if (typeof (pkg) === "string") pkg = await assetLoader.getPackage(pkg, "Animation");

    pkg = await assetLoader.load(pkg);


    async function getTextures(pkg: string | UPackage, decodeLibrary: DecodeLibrary, texNames: string[]) {
        if (typeof (pkg) === "string") pkg = await assetLoader.getPackage(pkg, "Texture");

        pkg = await assetLoader.load(pkg);

        // debugger;

        const texExps = texNames.map(v => (pkg as UPackage).exports.find(x => x.objectName === v));

        const textures = await Promise.all(texExps.map(exp => (pkg as UPackage).fetchObject<UShader>(exp.index + 1)));

        const infos = await Promise.all(textures.map(mesh => mesh.getDecodeInfo(decodeLibrary)));

        return infos;
    }

    const hairMesh = "FFighter_m000_m00_bh", hairTex = "FFighter_m000_t00_m00_bh";
    const faceMesh = "FFighter_m000_f", faceTex = "FFighter_m000_t00_f";
    const torsoMesh = "FFighter_m001_u", torsoTex = "FFighter_m001_t01_u";
    const legMesh = "FFighter_m001_l", legTex = "FFighter_m001_t01_l";
    const gloveMesh = "FFighter_m001_g", gloveTex = "FFighter_m001_t01_g";
    const bootMesh = "FFighter_m001_b", bootTex = "FFighter_m001_t01_b";

    // debugger;

    const bodypartMeshNames = [
        faceMesh,
        hairMesh,
        torsoMesh,
        legMesh,
        gloveMesh,
        bootMesh
    ];

    const bodypartTexNames = [
        faceTex,
        hairTex,
        torsoTex,
        legTex,
        gloveTex,
        bootTex
    ];


    const bodyPartExps = bodypartMeshNames.map(v => (pkg as UPackage).exportGroups.SkeletalMesh.find(x => x.export.objectName === v));

    const bodypartMeshes = await Promise.all(bodyPartExps.map(exp => (pkg as UPackage).fetchObject<USkeletalMesh>(exp.index + 1)));

    const decodeLibrary = new DecodeLibrary();

    decodeLibrary.anisotropy = renderManager.renderer.capabilities.getMaxAnisotropy();

    const textures = await getTextures(pkgTex, decodeLibrary, bodypartTexNames);

    const bodypartInfos = await Promise.all(bodypartMeshes.map(mesh => mesh.getDecodeInfo(decodeLibrary)));

    bodypartMeshes.forEach(({ uuid }, index) => {
        const material = decodeLibrary.materials[uuid] as IMaterialGroupDecodeInfo;

        material.materials = [textures[index]];
    });

    const bodypartObjects = bodypartInfos.map(info => decodeObject3D(decodeLibrary, info) as THREE.SkinnedMesh);

    const player = renderManager.player;

    const animations = bodypartObjects[0].userData.animations;

    player.setAnimations(animations);
    player.setIdleAnimation("Wait_Hand_FFighter");
    player.setWalkingAnimation("Walk_Hand_FFighter");
    player.setRunningAnimation("Run_Hand_FFighter");
    player.setDeathAnimation("Death_FFighter");
    player.setFallingAnimation("Falling_FFighter");
    player.setMeshes(bodypartObjects);
    player.initAnimations();

    // const gui = new dat.GUI();

    // const state = { activeAnimation: "Wait_Hand_FFighter" };
    // const actions = [] as THREE.AnimationAction[];

    // gui.add(state, "activeAnimation", Object.keys(animations))
    //     .name("Animation")
    //     .onFinishChange(animName => {
    //         actions.forEach(act => act.stop());

    //         while (actions.pop()) { }

    //         const clip = animations[animName];

    //         bodypartObjects.forEach(char => {
    //             const action = renderManager.mixer.clipAction(clip, char);

    //             actions.push(action);

    //             action.play();
    //         });
    //     });
}

function merge(arr: ArrayBuffer[]): ArrayBuffer {
    const len = arr.reduce((acc, v) => acc + v.byteLength, 0);
    const view = new Uint8Array(len);

    for (let i = 0, offset = 0, len = arr.length; i < len; i++) {
        const buf = arr[i];
        const sz = buf.byteLength;

        view.set(new Uint8Array(buf), offset);

        offset = offset + sz;
    }

    return view.buffer;
}

async function _decodeMonster(renderManager: RenderManager, assetLoader: AssetLoader, pkg: string | UPackage) {

    if (typeof (pkg) === "string") pkg = await assetLoader.getPackage(pkg, "Animation");

    pkg = await assetLoader.load(pkg);

    // debugger;

    // const antaras = pkg.exportGroups.SkeletalMesh.find(x => x.export.objectName.toLowerCase().includes("stone_golem"));
    // const antaras = pkg.exportGroups.SkeletalMesh.find(x => x.export.objectName.toLowerCase().includes("baium"));
    const antaras = pkg.exportGroups.SkeletalMesh.find(x => x.export.objectName.toLowerCase().includes("antaras"));

    const meshIndex = antaras.index + 1;

    const mesh = pkg.fetchObject<USkeletalMesh>(meshIndex).loadSelf();

    const decodeLibrary = new DecodeLibrary();

    decodeLibrary.anisotropy = renderManager.renderer.capabilities.getMaxAnisotropy();

    const info = await mesh.getDecodeInfo(decodeLibrary);

    let compiled = compile({
        lib: decodeLibrary,
        info: info,
        trans: {
            pos: [181425.90940428418, -7702.370465083446, 114852.49754089414],
            rot: [0, -0.7071067805519559, 0, 0.7071067818211395]
        }
    }, []);

    const blob = new Blob(compiled, { type: "application/octet-stream" });
    const f = URL.createObjectURL(blob);

    debugger;

    // let compiledLib = compile(decodeLibrary);
    // let compiledInf = compile(info);

    // let compiled = {
    //     lib: compiledLib,
    //     info: compiledInf,
    //     trans: {
    //         pos: [181425.90940428418, -7702.370465083446, 114852.49754089414],
    //         rot: [0, -0.7071067805519559, 0, 0.7071067818211395]
    //     }
    // }

    // let serialized = JSON.stringify(compiled);

    // debugger;

    const char = decodeObject3D(decodeLibrary, info) as THREE.SkinnedMesh;

    // char.position.set(-87063.33997244012, -3700, 239964.66910649382);           // ti test
    char.position.set(181425.90940428418, -7702.370465083446, 114852.49754089414); // lair
    char.quaternion.set(0, -0.7071067805519559, 0, 0.7071067818211395);

    renderManager.scene.add(char);

    renderManager.scene.updateMatrixWorld(true);

    const helper = new SkeletonHelper(char);

    // renderManager.scene.add(helper);

    // debugger;

    const clip = char.userData.animations["Wait"];
    const action = renderManager.mixer.clipAction(clip);

    // debugger;

    action.play();
}

async function _decodeDatFile(path: string) {
    // const ini = await (new UEncodedFile("assets/system/l2.ini").asReadable()).decode();

    const file = await (new UDataFile(path).asReadable()).decode();

    debugger;
}

async function startCore() {
    const viewport = document.querySelector("viewport") as HTMLViewportElement;
    const renderManager = new RenderManager(viewport);

    (global as any).renderManager = renderManager;

    // debugger;

    const assetList = await (await fetch("asset-list.json")).json();
    const assetLoader = await AssetLoader.Instantiate(assetList.supported);
    const objectGroup = renderManager.objectGroup;

    // await _decodeDatFile("assets/system/Npcgrp.dat");

    // await _decodeCharacter(renderManager, assetLoader, "Fighter", "FFighter");
    // await _decodeMonster(renderManager, assetLoader, "LineageMonsters");


    // const pkgCore = await assetLoader.load(assetLoader.getPackage("core", "Script"));

    // debugger;

    // const classess = [];

    // for (const { index } of pkgCore.exportGroups["Class"]) {

    //     const _UClass = await pkgCore.fetchObject<UClass>(index + 1);

    //     await _UClass.onDecodeReady();

    //     // debugger;

    //     // await _UClass.constructClass();

    //     classess.push(_UClass);

    //     // debugger;
    // }

    // debugger;

    // const structs = [];

    // for (const { index } of pkgCore.exportGroups["Struct"]) {

    //     const _UStruct = await pkgCore.fetchObject<UStruct>(index + 1);

    //     // debugger;

    //     await _UStruct.onDecodeReady();

    //     console.log(_UStruct.friendlyName);

    //     structs.push(_UStruct);
    // }


    // debugger;


    // const pkgEngine = await assetLoader.load(assetLoader.getPackage("engine", "Script"));

    // debugger;


    // // const fnObjectMain = await pkgCore.fetchObject(741);
    // // await fnObjectMain.onDecodeReady();

    // // const fltObjectMin = await pkgCore.fetchObject(13);
    // // await fltObjectMin.onDecodeReady();


    // // const fnObjectRandRng = await pkgCore.fetchObject(716);


    // // await fnObjectRandRng.onDecodeReady();

    // // debugger;

    // // const textBuffers = [];

    // // for (const { index } of pkgCore.exportGroups.TextBuffer) {
    // //     const object = await pkgCore.fetchObject<UTextBuffer>(index + 1);

    // //     await object.onDecodeReady();

    // //     textBuffers.push(object);
    // // }

    // debugger;

    // for (const { index } of pkgCore.exportGroups.Class) {
    //     const object = await pkgCore.fetchObject<UClass>(index + 1);

    //     await object.onDecodeReady();

    //     debugger;
    // }

    // debugger;

    // for (const { index } of pkgCore.exportGroups.Struct) {
    //     const object = await pkgCore.fetchObject<UStruct>(index + 1);

    //     // debugger;

    //     await object.onDecodeReady();

    //     // debugger;

    //     // UClassRegistry.register(object);
    // }

    // const registered = UClassRegistry.structs;

    // debugger;

    // for (const { index } of pkgEngine.exportGroups.Struct) {
    //     debugger;

    //     const object = await pkgEngine.fetchObject<UStruct>(index + 1);

    //     await object.onDecodeReady();

    //     debugger;

    //     UClassRegistry.register(object);

    //     debugger;
    // }

    // const structs = UClassRegistry.structs;

    // debugger;



    // debugger;

    // const UWeaponId = pkgEngine.exports.find(e => e.objectName === "Weapon").index + 1;
    // const UWeapon = await pkgEngine.fetchObject(UWeaponId);

    // await UWeapon.onDecodeReady();

    // debugger;

    // const fn1 = await pkgCore.fetchObject<UFunction>(721); // first function read when starting the game
    // const fn3 = await pkgCore.fetchObject<UFunction>(716); // third function read when starting the game

    // debugger;

    // const objs = [] as UFunction[];
    // const _pkg = pkgEngine;

    // const groups = [
    //     ..._pkg.exportGroups.Function,
    //     ..._pkg.exportGroups.Class,
    //     ..._pkg.exportGroups.Struct
    // ]

    // debugger;

    // for(let {index} of groups.filter(x=>![/*674, 739, 991, 994, 1305, 1308, 1376, 1407, 1417, 1857, 1859, 1905*/].includes(x.index))) {
    //     const a = await _pkg.fetchObject<UFunction>(index+1);
    //     objs.push(a);

    //     // debugger;
    // };

    // console.log(objs)

    // debugger;

    // const pkgEffects = await assetLoader.load(assetLoader.getPackage("lineageeffect", "Script"));

    // const uMortalBlow = pkgEffects.fetchObject<UClass>(21);
    // const MortalBlow = uMortalBlow.buildClass<UEmitter>(assetLoader.getPackage("native", "Script") as UNativePackage);
    // const mortalBlow = new MortalBlow();
    // const decodedMortalBlow = mortalBlow.getDecodeInfo(new DecodeLibrary());

    // const uRapidShot = pkgEffects.fetchObject<UClass>(657);
    // const RapidShot = uRapidShot.buildClass<UEmitter>(assetLoader.getPackage("native", "Script") as UNativePackage);
    // const rapidShot = new RapidShot();
    // const decodedRapidshot = rapidShot.getDecodeInfo(new DecodeLibrary());

    // debugger;

    const loadSettings = {
        helpersZoneBounds: false,
        loadTerrain: false,
        loadBaseModel: true,
        loadStaticModels: true,
        loadEmitters: true,
        _loadStaticModelList: [
            // 1441,
            // 1770,
            // 1802,
            // 1804,
            // 4284,
            // 10253, // scluptures
            // 10254, // scluptures
            // 8028,
            // 1370, // wall object
            // 9742, // some ground from cruma loaded first, fails lighting
            // ...[9742, 9646, 10157, 9675], // some ground from cruma loaded first, fails lighting
            // 5680, // floor near wall objects
            // ...[6157, 6101, 6099, 6096, 6095, 6128, 8386, 7270, 9861, 1759, 7273, 9046, 1370, 1195, 10242, 9628, 5665, 5668, 9034, 10294, 9219, 7312, 5662, 5663] // wall objects
            // 555,// elven ruins colon
            // 47, // rock with ambient light
            // 2369,
            // 2011, // ceiling fixture that's too red
            // 2774, // necropolis entrance
            // 4718, // cruma base
            // 4609, // transparency issue
            // ...[2011, /*6100, 6130*/], // ceiling fixture that's too red with 0xe lights
            // ...[1463, 1500, 2011, 2012, 6100, 6127, 6129, 6130, 7290, 7334, 1380, 1386,], // all ceiling fixture that's too red
            // 610, // light fixture with 2 lights near elven ruins
            // 1755, // light fixture with 3 lights near elven ruins
            // ...[608, 610, 1755, 1781] // elven ruins light fixtures

            ...[/*2092,*/ /*3052*/, 2517], // talking island collision
        ]
    } as LoadSettings_T;

    // working (or mostly working)
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "20_21", loadSettings));  // cruma tower
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "25_21", loadSettings));  // antaras nest
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "20_20", loadSettings));  // elven fortress
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "20_19", loadSettings));  // elven forest
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "20_22", loadSettings));  // dion
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "21_22", loadSettings));  // execution grounds
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "19_21", loadSettings));  // gludio
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "22_22", loadSettings));  // giran
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "19_22", loadSettings));  // ruins of despair
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "19_23", loadSettings));  // ants nest
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "22_21", loadSettings));  // death pass
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "23_22", loadSettings));  // giran castle
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "21_20", loadSettings));  // iris lake
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "23_18", loadSettings));  // tower of insolence
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "23_21", loadSettings));  // dragon valley


    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "15_24", loadSettings));  // TI
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "16_24", loadSettings));  // TI - north of talking island
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "17_24", loadSettings));  // TI

    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "15_25", loadSettings));  // TI
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "16_25", loadSettings));  // TI - elven ruins
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "17_25", loadSettings));  // TI - talking island village

    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "15_26", loadSettings));  // TI
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "16_26", loadSettings));  // TI
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "17_26", loadSettings));  // TI

    // crashing
    // renderManager.addSector(await _decodePackage(renderManager, assetLoader, "17_22", loadSettings));  // gludin

    const sector = decompile(new DataView(await (await fetch("lair.blob")).arrayBuffer()), [0]);
    renderManager.addSector(decodePackage(sector));

    
    {
        const antharas = decompile(new DataView(await (await fetch("antharas.blob")).arrayBuffer()), [0]);
        const char = decodeObject3D(antharas.lib, antharas.info) as THREE.SkinnedMesh;
        const trans = antharas.trans;

        // char.position.set(-87063.33997244012, -3700, 239964.66910649382);           // ti test
        char.position.fromArray(trans.pos); // lair
        char.quaternion.fromArray(trans.rot);

        renderManager.scene.add(char);

        renderManager.scene.updateMatrixWorld(true);

        const helper = new SkeletonHelper(char);

        // renderManager.scene.add(helper);

        // debugger;

        const clip = char.userData.animations["Wait"];
        const action = renderManager.mixer.clipAction(clip);

        // debugger;

        action.play();
    }

    console.info("System has loaded!");



    // renderManager.enableZoneCulling = false;
    renderManager.scene.add(objectGroup);
    renderManager.scene.add(new BoxHelper(objectGroup));
    renderManager.startRendering();
}

export default startCore;
export { startCore };