export interface TextLayerOptions {
    sourceId: string;
    defaultColor?: string;
    layerId?: string;
    textOverlap?: "never" | "always" | "cooperative";
    minzoom?: number;
}
export declare function createTextLayerConfig(options: TextLayerOptions): {
    layout: Record<string, unknown>;
    paint: Record<string, unknown>;
    minzoom?: number | undefined;
    id: string;
    type: string;
    source: string;
};
