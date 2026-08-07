import { App } from 'obsidian';
import type * as GeoJSON from 'geojson';
import type * as maplibregl from 'maplibre-gl';
import { MapPlace, type OverlayRenderStyle, type VectorTileLayerType } from "places-shared/overlay";
import { type ZoomRange } from "places-shared/map";
import type { Overlay, TileJsonVectorLayer } from "places-shared/overlay";
export interface GeoJSONOverlayConfig {
    index?: number;
    geojson: GeoJSON.GeoJSON;
    source?: string;
    zoom?: ZoomRange;
    style?: OverlayRenderStyle;
    hoverStyle?: OverlayRenderStyle;
}
export interface ImageOverlayConfig {
    index?: number;
    url: string;
    bounds?: {
        north: number;
        south: number;
        east: number;
        west: number;
    };
    corners?: {
        nwLng: number;
        nwLat: number;
        neLng: number;
        neLat: number;
        seLng: number;
        seLat: number;
        swLng: number;
        swLat: number;
    };
    opacity?: number;
    sourcePath?: string;
    zoom?: ZoomRange;
}
export interface VectorTileOverlayConfig {
    index?: number;
    source: string;
    url?: string;
    tiles?: string[];
    sourceLayer: string;
    layerType: VectorTileLayerType;
    zoom?: ZoomRange;
    bounds?: [number, number, number, number];
    attribution?: string;
    filter?: unknown[];
    textField?: string;
    symbolPlacement?: 'point' | 'line' | 'line-center';
    sprite?: string;
    icon?: string;
    style?: OverlayRenderStyle;
    hoverStyle?: OverlayRenderStyle;
}
export interface MapLibreOverlayHandlerOptions {
    getCacheableTileUrl?: (url: string) => string;
}
export interface OverlayClusteringConfig {
    enabled: boolean;
    threshold: number;
    unifiedClustering?: boolean;
}
export declare class MapLibreOverlayHandler {
    private app;
    private getCacheableTileUrl?;
    private readonly hoverListeners;
    constructor(app: App, options?: MapLibreOverlayHandlerOptions);
    processOverlays(map: maplibregl.Map, overlays: readonly Overlay[], showLabels: boolean, _places: MapPlace[], clusteringConfig?: OverlayClusteringConfig): Promise<void>;
    syncOverlays(map: maplibregl.Map, previousOverlays: readonly Overlay[], nextOverlays: readonly Overlay[], showLabels: boolean, places: MapPlace[], clusteringConfig?: OverlayClusteringConfig): Promise<void>;
    private applyImageOpacityOnlyUpdate;
    private removeGeoJsonOverlay;
    private removeImageOverlay;
    private removeVectorTileOverlayLayer;
    private removeUnusedVectorTileOverlaySources;
    private getOverlayDashArray;
    addGeoJSONOverlays(map: maplibregl.Map, overlays: GeoJSONOverlayConfig[], clusteringConfig?: OverlayClusteringConfig, showLabels?: boolean): void;
    private filterOutPointFeatures;
    private countPointFeatures;
    private hasPointGeometry;
    private addClusteredPointSource;
    private extractPointFeatures;
    private applyZoomRange;
    private addPointLayers;
    private addPolygonLayers;
    private addLineLayers;
    private addRouteLabelLayer;
    private addGeoJsonPopupHandler;
    private static hoverFeatureKeyFor;
    private addHoverOverlay;
    private removeHoverListeners;
    private createHoverPaint;
    private hasOverlayPointAtEvent;
    addImageOverlays(map: maplibregl.Map, overlays: ImageOverlayConfig[]): void;
    private static readonly tileJsonLoader;
    private static readonly resolvedTileJson;
    private static resolveTileJson;
    static getResolvedVectorLayers(url: string): TileJsonVectorLayer[] | undefined;
    addVectorTileOverlays(map: maplibregl.Map, overlays: VectorTileOverlayConfig[]): Promise<void>;
    private logVectorTileOverlayFeatureCounts;
    private cacheTileUrl;
    private addVectorTileLayer;
    private createVectorTilePaint;
    private createVectorTileLayout;
    private resolveVectorTileIconImage;
    private showGeoJsonFeaturePopup;
}
