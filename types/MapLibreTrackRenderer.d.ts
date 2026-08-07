import type * as maplibregl from 'maplibre-gl';
import { type MapLibreCleanupResult } from './MapLibreResourceRegistry';
export declare function setLayerVisibility(map: maplibregl.Map, layerIds: string[], visibility: 'visible' | 'none'): void;
export declare function removeLayersAndSources(map: maplibregl.Map, layerIds: string[], sourceIds: string[]): MapLibreCleanupResult;
export declare function removeTrackLayers(map: maplibregl.Map, trackIndex: number): MapLibreCleanupResult;
export declare function removeDynamicOverlay(map: maplibregl.Map, placeId: string): MapLibreCleanupResult;
