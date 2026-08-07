import type * as GeoJSON from 'geojson';
export interface VectorClusterLayerPlan {
    clusteredSource: {
        type: 'geojson';
        data: GeoJSON.FeatureCollection;
        cluster: true;
        clusterRadius: number;
        clusterMaxZoom?: number;
    };
    clusterLayers: Array<Record<string, unknown>>;
    overlayPointSource?: {
        type: 'geojson';
        data: GeoJSON.FeatureCollection;
    };
    overlayPointLayer?: Record<string, unknown>;
}
export interface VectorClusterLayerOptions {
    clusterRadius?: number;
    clusterMaxZoom?: number;
    countTextFont?: string[];
    defaultOverlayPointColor: string;
}
export declare function createVectorClusterLayerPlan(placeFeatures: GeoJSON.Feature[], overlayPointFeatures: GeoJSON.Feature[], options: VectorClusterLayerOptions): VectorClusterLayerPlan;
export declare function createFeatureIndexMap(features: GeoJSON.Feature[]): Map<number, GeoJSON.Feature>;
export declare function extractPointFeatureCoordinates(features: GeoJSON.Feature[]): Array<{
    longitude: number;
    latitude: number;
}>;
export interface VectorGeoJsonSource {
    setData: (data: GeoJSON.FeatureCollection) => unknown;
}
export interface VectorClusterManager<TPlace> {
    updatePlaces: (places: TPlace[], overlayPointCoordinates: Array<{
        longitude: number;
        latitude: number;
    }>) => void;
}
export interface SyncVectorClusteredSourcesOptions<TPlace> {
    places: TPlace[];
    placeFeatures: GeoJSON.Feature[];
    overlayPointFeatures: GeoJSON.Feature[];
    clusterOptions: VectorClusterLayerOptions;
    clusteredSource: VectorGeoJsonSource | undefined;
    overlayPointSource?: VectorGeoJsonSource | undefined;
    clusteringManager: VectorClusterManager<TPlace> | undefined;
    onBeforeUpdateManager?: () => void;
}
export interface VectorClusterInteractionMap<TEvent = unknown> {
    on(event: 'sourcedata', handler: (event: unknown) => void): unknown;
    on(event: 'click', layerId: string, handler: (event: TEvent) => void): unknown;
    on(event: 'mouseenter' | 'mouseleave', layerId: string, handler: () => void): unknown;
    queryRenderedFeatures(point: unknown, options?: {
        layers?: string[];
    }): Array<{
        properties?: GeoJSON.GeoJsonProperties;
        geometry?: GeoJSON.Geometry | null;
    }>;
    getSource(sourceId: string): {
        getClusterExpansionZoom?: (clusterId: number) => Promise<number>;
    } | undefined;
    easeTo(options: {
        center: [number, number];
        zoom: number;
    }): unknown;
    getCanvas(): HTMLCanvasElement;
}
export interface VectorClusterClickEvent {
    point: unknown;
    features?: Array<{
        properties?: GeoJSON.GeoJsonProperties;
        geometry?: GeoJSON.Geometry | null;
    }>;
}
export interface SetupVectorClusterInteractionsOptions<TMap extends VectorClusterInteractionMap<TEvent>, TEvent extends VectorClusterClickEvent> {
    map: TMap;
    clusteringManager: {
        update: () => void;
    };
    clusterLayerId?: string;
    clusteredSourceId?: string;
    isClusterSourceLoadedEvent?: (event: unknown) => boolean;
    getClusterExpansionZoom?: (map: TMap, clusterId: number, sourceId: string) => Promise<number | undefined>;
}
export declare function syncVectorClusteredSources<TPlace>(options: SyncVectorClusteredSourcesOptions<TPlace>): void;
export declare function setupVectorClusterInteractions<TMap extends VectorClusterInteractionMap<TEvent>, TEvent extends VectorClusterClickEvent>(options: SetupVectorClusterInteractionsOptions<TMap, TEvent>): void;
