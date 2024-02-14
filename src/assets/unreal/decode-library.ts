class DecodeLibrary {
    public name: string = "Untitled";
    public loadMipmaps = true;                                                              // should mipmaps be loaded into decode library
    public anisotropy = -1;                                                                 // which anisotropy level to set when decoding
    public supportsDDS = true;
    public sector: [number, number];
    public helpersZoneBounds = false;
    public bspNodes: IBSPNodeDecodeInfo_T[] = [];
    public bspColliders: IBoxDecodeInfo[] = [];
    public bspLeaves: IBSPLeafDecodeInfo_T[] = [];
    public bspZones: IBSPZoneDecodeInfo_T[] = [];
    public bspZoneIndexMap: Record<string, number> = {};
    public geometries: Record<string, IGeometryDecodeInfo> = {};         // a dictionary containing all geometry decode info
    public geometryInstances: Record<string, number> = {};               // a dictionary containing all geometray instance decode info
    public materials: Record<string, IBaseMaterialDecodeInfo> = {};      // a dictionary containing all material decode info
    public materialModifiers: Record<string, IMaterialModifier> = {};    // a dictionary containing all material modifiers
}

export default DecodeLibrary;
export { DecodeLibrary };