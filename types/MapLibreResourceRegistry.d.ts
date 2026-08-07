import type * as maplibregl from 'maplibre-gl';
export type MapLibreResourceKind = 'listener' | 'disposer' | 'marker' | 'control' | 'layer' | 'source';
export interface MapLibreCleanupIssue {
    kind: MapLibreResourceKind;
    id: string;
    message: string;
}
export interface MapLibreCleanupResult {
    removed: number;
    missing: number;
    issues: MapLibreCleanupIssue[];
}
type RegisteredDisposer = {
    kind: Exclude<MapLibreResourceKind, 'layer' | 'source'>;
    id: string;
    owner: string;
    dispose: () => void;
};
export declare function getMapLibreResourceRegistry(map: maplibregl.Map): MapLibreResourceRegistry;
export declare function reportMapLibreCleanupIssues(result: MapLibreCleanupResult, operation: string): void;
export declare class MapLibreResourceRegistry {
    private readonly map;
    private readonly layers;
    private readonly sources;
    private readonly disposers;
    constructor(map: maplibregl.Map);
    registerLayer(id: string, owner?: string): void;
    registerSource(id: string, owner?: string): void;
    registerDisposer(kind: RegisteredDisposer['kind'], id: string, dispose: () => void, owner?: string): void;
    capture(owner: string, action: () => void): void;
    captureAsync<T>(owner: string, action: () => Promise<T>): Promise<T>;
    remove(layerIds: readonly string[], sourceIds: readonly string[]): MapLibreCleanupResult;
    disposeOwner(owner: string): MapLibreCleanupResult;
    disposeAll(): MapLibreCleanupResult;
    private disposeRegistered;
    private removeLayer;
    private snapshot;
    private registerSnapshotDifference;
    private removeSource;
}
export declare function mergeMapLibreCleanupResults(...results: readonly MapLibreCleanupResult[]): MapLibreCleanupResult;
export {};
