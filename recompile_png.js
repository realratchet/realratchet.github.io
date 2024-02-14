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

function _decompileArray(obj, iter) {
    const count = obj.getUint32(iter[0], true);
    const arr = new Array(count);
    iter[0] += 4;


    for (let i = 0; i < count; i++) {
        arr[i] = decompile(obj, iter);
    }

    return arr;
}

function _decompileLibrary(obj, iter) {
    const lib = new DecodeLibrary();
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

function _decompileObject(obj, iter) {
    const lib = {};
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

function _decodePrimitive(Constructor, obj, iter) {
    const byteLength = obj.getUint32(iter[0], true);
    iter[0] += 4;

    const slice = obj.buffer.slice(iter[0], iter[0] + byteLength);
    const arr = new (global)[Constructor](slice);

    iter[0] += byteLength;

    return arr;
}

function _decodeArrayBuffer(obj, iter) {
    const byteLength = obj.getUint32(iter[0], true);
    iter[0] += 4;

    const slice = obj.buffer.slice(iter[0], iter[0] + byteLength);

    iter[0] += byteLength;

    return slice;
}

function decompile(obj, iter) {
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

class DecodeLibrary {
    constructor() {
        this.name = undefined;
        this.loadMipmaps = undefined;
        this.anisotropy = undefined;
        this.supportsDDS = undefined;
        this.sector = undefined;
        this.helpersZoneBounds = undefined;
        this.bspNodes = undefined;
        this.bspColliders = undefined;
        this.bspLeaves = undefined;
        this.bspZones = undefined;
        this.bspZoneIndexMap = undefined;
        this.geometries = undefined;
        this.geometryInstances = undefined;
        this.materials = undefined;
        this.materialModifiers = undefined;
    }
}

function _compileDecodeLibrary(obj, buf) {
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

function _compileArray(obj, buf) {
    buf.push(new Uint32Array([obj.length]).buffer);

    for (const o of obj) {
        const compiled = compile(o, []);
        // const len = compiled.reduce((acc, v) => acc + v.byteLength, 0);

        // buf.push(new Uint32Array([len]).buffer);
        for (const c of compiled) buf.push(c);
    }
}

function compile(obj, buf) {
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

const blobName = "antharas";

const fs = require("fs");
const cp = require("child_process");
const data = fs.readFileSync(`assets/${blobName}.blob`);

/**
 * @type {DecodeLibrary}
 */
const decompiled = decompile(new DataView(data.buffer), [0]);

for (const mat of Object.values(decompiled.lib.materials).filter(m => m?.textureType === "dds")) {
    fs.writeFileSync(`/tmp/dds.dds`, Buffer.from(mat.buffer));
    cp.execSync(`convert /tmp/dds.dds /tmp/dds.png`);
    mat.buffer = fs.readFileSync("/tmp/dds.png").buffer;
    mat.textureType = "png";
}

const recompiled = compile(decompiled, []);
new Blob(recompiled, { type: "application/octet-stream" }).arrayBuffer().then(buf =>{
    fs.writeFileSync(`assets/${blobName}_png.blob`, Buffer.from(buf));
    console.log("done");
});

