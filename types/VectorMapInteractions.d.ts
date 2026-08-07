import { MapPlace } from "places-shared/overlay";
import { MapControlHandle } from "places-shared/services";
import type * as maplibregl from "maplibre-gl";
type VectorPaintValue = string | number | boolean | maplibregl.ExpressionSpecification;
export interface VectorFocusMap {
    getLayer?(id: string): unknown;
    setPaintProperty?(layerId: string, property: string, value: VectorPaintValue): void;
    once?(event: 'moveend', listener: () => void): unknown;
}
export interface RemovableMapMarker {
    remove: () => void;
}
export interface VectorControlMap {
    getBounds: () => {
        getSouth: () => number;
        getWest: () => number;
        getNorth: () => number;
        getEast: () => number;
    } | null | undefined;
    getZoom: () => number;
    flyTo: (options: {
        center: [number, number];
        zoom: number;
        duration: number;
    }) => unknown;
}
export interface MissingSpriteImageMap {
    addImage: (id: string, image: ImageData) => unknown;
}
export declare const SYMBOL_MARKER_LAYER_ID = "places-symbol-markers";
export declare const SYMBOL_ICON_BASE_OPACITY: maplibregl.ExpressionSpecification;
export declare const VECTOR_FOCUS_DIM_OPACITY = 0.2;
export declare function restoreVectorLabelOpacity(map: VectorFocusMap | undefined): void;
export declare function dimVectorLabels(map: VectorFocusMap | undefined, focusedPlaceId?: string): void;
export declare function focusMapMarkerElement(container: HTMLElement, place: MapPlace, map?: VectorFocusMap): void;
export declare function enterVectorFocusMode(container: HTMLElement, map?: VectorFocusMap, focusedPlaceId?: string): void;
export declare function clearVectorFocusMode(container: HTMLElement, map?: VectorFocusMap): void;
export declare function createSearchResultMarkerElement(place: MapPlace): HTMLElement;
export declare function addTransparentMissingSpriteImage(map: MissingSpriteImageMap, id: string): void;
export declare function shouldSkipPlacePopup(place: MapPlace): boolean;
export declare function getStoredSearchResultMarkers<TMarker extends RemovableMapMarker>(container: HTMLElement): TMarker[];
export declare function setStoredSearchResultMarkers<TMarker extends RemovableMapMarker>(container: HTMLElement, markers: TMarker[]): void;
export interface SetVectorGeocodingSearchMarkersOptions<TMap, TMarker extends RemovableMapMarker> {
    container: HTMLElement;
    map: TMap;
    places: MapPlace[];
    focusMap?: VectorFocusMap;
    createMarker: (place: MapPlace, element: HTMLElement) => TMarker;
    onMarkerClick: (place: MapPlace) => void;
}
export declare function setVectorGeocodingSearchMarkers<TMap, TMarker extends RemovableMapMarker>({ container, map: _map, places, focusMap, createMarker, onMarkerClick, }: SetVectorGeocodingSearchMarkersOptions<TMap, TMarker>): void;
export interface CreateVectorMapControlHandleOptions<TMap extends VectorControlMap> {
    container: HTMLElement;
    map: TMap;
    highlightPlace: (place: MapPlace) => void;
    clearHighlight: () => void;
    setGeocodingSearchMarkers: (places: MapPlace[]) => void;
}
export declare function createVectorMapControlHandle<TMap extends VectorControlMap>(options: CreateVectorMapControlHandleOptions<TMap>): MapControlHandle;
export {};
