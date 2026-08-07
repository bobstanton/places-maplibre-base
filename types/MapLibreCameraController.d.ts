import type * as maplibregl from 'maplibre-gl';
import type { MapRenderRequest } from 'places-shared/settings';
import type { MapCameraApplyResult } from 'places-shared/services';
import type { MapCameraIntent } from 'places-shared/render';
export declare function withProgrammaticCamera(map: maplibregl.Map, move: () => void): void;
export declare function applyInitialViewport(options: {
    map: maplibregl.Map;
    bounds: [[number, number], [number, number]];
    request: MapRenderRequest;
    padding: number;
}): void;
export declare function applyCameraIntent(map: maplibregl.Map, camera: MapCameraIntent, request: MapRenderRequest): MapCameraApplyResult;
