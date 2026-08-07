export declare const DEFAULT_MAP_LABEL_COLOR = "#d73027";
export declare const DEFAULT_ROUTE_LABEL_COLOR = "#d73027";
export declare function createMapLabelPaint(defaultColor?: string): Record<string, unknown>;
export declare function createRouteLabelPaint(defaultColor?: string): Record<string, unknown>;
export declare function createRouteLabelLayerConfig(options: {
    sourceId: string;
    layerId?: string;
    defaultColor?: string;
}): Record<string, unknown>;
export declare function createRouteEndpointLabelLayerConfig(options: {
    sourceId: string;
    layerId?: string;
    defaultColor?: string;
}): Record<string, unknown>;
export declare function createPathLabelLayerConfig(options: {
    sourceId: string;
    layerId?: string;
    defaultColor?: string;
}): Record<string, unknown>;
