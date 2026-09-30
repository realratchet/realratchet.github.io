import { ShaderMaterial, Uniform, Color, Matrix3, FrontSide, DataTexture, RGFormat, OneFactor, CustomBlending, LinearFilter } from "three";

import VERTEX_SHADER from "./shader/shader-mesh-terrain.vs";
import FRAGMENT_SHADER from "./shader/shader-mesh-terrain.fs";
import { appendGlobalUniforms } from "../global-uniforms";
import type { IDecodedParameter } from "@l2js/engine/contracts/material";
import type { MapData_T } from "@l2js/engine/contracts/texture";

export class MeshTerrainMaterial extends ShaderMaterial {
    // @ts-ignore
    constructor(info: MeshTerrainMaterialParameters) {
        const defines: Record<string, any> = {
            USE_FOG: "",
            USE_UV_TEXTURE: "",
            UV_COUNT: info.uvs.size.y,
            MASK_UV_INDEX: info.uvs.size.y - 1
        };

        const uniforms: Record<string, Uniform> = appendGlobalUniforms({
            alphaTest: new Uniform(1e-3),
            diffuse: new Uniform(new Color(1, 1, 1)),
            opacity: new Uniform(1),
            uvTransform: new Uniform(new Matrix3()),
            transformSpecular: new Uniform(null),
            uvs: new Uniform(info.uvs),
            // samplers stay out of the GLSL structs: ANGLE's Metal backend binds sampler2D struct members
            // to the wrong texture units, so uvs/layerN carry only the texel size
            uvsMap: new Uniform(info.uvs.texture)
        });

        const splitFragmentShader = FRAGMENT_SHADER.split("\n");

        const pragmaSearchParams = "#pragma params_include_layers"
        const pragmaSearch = "#pragma include_layers";

        const paramsIndex = splitFragmentShader.findIndex(x => x.includes(pragmaSearchParams));
        const wsParams = " ".repeat(splitFragmentShader[paramsIndex].indexOf(pragmaSearchParams));

        let layerIndex = splitFragmentShader.findIndex(x => x.includes(pragmaSearch));
        const ws = " ".repeat(splitFragmentShader[layerIndex].indexOf(pragmaSearch));

        const paramsCode: string[] = [], layerCode: string[] = [];

        let needsPreamble = false;
        let needsOpacityPreamble = false;

        let isFirst = false;

        info.layers.forEach((layer, i) => {
            if (!layer.map) return;
            if (!layer.alphaMap) return;

            needsPreamble = true;

            const u = uniforms[`layer${i}`] = new Uniform({ map: {}, alphaMap: {} });

            defines[`USE_LAYER_${i}`] = "";


            needsOpacityPreamble = true;
            defines[`USE_LAYER_${i}_OPACITY`] = "";

            layerCode.push(`${ws}layerMask = texture2D(layer${i}AlphaMap, vUv[MASK_UV_INDEX]);`);
            paramsCode.push(`${wsParams}uniform MaskedLayerData layer${i};`);
            paramsCode.push(`${wsParams}uniform sampler2D layer${i}Map;`);
            paramsCode.push(`${wsParams}uniform sampler2D layer${i}AlphaMap;`);

            uniforms[`layer${i}Map`] = new Uniform(layer.map.uniforms.map.texture);
            uniforms[`layer${i}AlphaMap`] = new Uniform(layer.alphaMap.uniforms.map.texture);

            Object.assign(u.value.alphaMap, layer.alphaMap.uniforms.map);
            layer.alphaMap.uniforms.map.texture.premultiplyAlpha = true;
            layer.alphaMap.uniforms.map.texture.needsUpdate = true;

            layerCode.push(`${ws}layer = vec4(texture2D(layer${i}Map, vUv[${i + 1}]).rgb, layerMask.r);`)
            if (isFirst) {
                layerCode.push(`${ws}texelDiffuse = addLayer(layer, texelDiffuse);`);
            } else {
                layerCode.push(`${ws}texelDiffuse = layer;`);
                isFirst = true;
            }
            layerCode.push("");

            layer.map.uniforms.map.texture.premultiplyAlpha = true;
            layer.map.uniforms.map.texture.needsUpdate = true;

            Object.assign(u.value.map, layer.map.uniforms.map);
        });

        if (needsPreamble) {
            const preamble = [
                `${wsParams}struct TextureData {`,
                `${wsParams}    vec2 size;`,
                `${wsParams}};`,
                "",
                `${wsParams}struct LayerData {`,
                `${wsParams}    TextureData map;`,
                `${wsParams}};`,
                ""
            ];

            if (needsOpacityPreamble) {
                preamble.push(
                    `${wsParams}struct MaskedLayerData {`,
                    `${wsParams}    TextureData map;`,
                    `${wsParams}    TextureData alphaMap;`,
                    `${wsParams}};`,
                    ""
                );
            }

            paramsCode.unshift(...preamble);
        }

        splitFragmentShader.splice(paramsIndex, 1, ...paramsCode);

        layerIndex = splitFragmentShader.findIndex(x => x.includes(pragmaSearch))
        splitFragmentShader.splice(layerIndex, 1, ...layerCode);

        const fragmentShader = splitFragmentShader.join("\n")

        super({
            defines,
            uniforms,
            vertexShader: VERTEX_SHADER,
            fragmentShader: fragmentShader,
            side: FrontSide
        });
    }
}

export default MeshTerrainMaterial;

type MeshTerrainMaterialParameters = {
    uvs: MapData_T,
    layers: { map: IDecodedParameter, alphaMap: IDecodedParameter }[]
};
