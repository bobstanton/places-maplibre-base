import type * as GeoJSON from "geojson";
import { PopupOptions } from "places-shared/map";
import type * as maplibregl from 'maplibre-gl';
import type { App } from 'obsidian';
export interface MapLibrePopupOptions {
    content: PopupOptions;
    coordinates: maplibregl.LngLatLike;
    app?: App;
    onAdd?: (popup: maplibregl.Popup) => void;
    offset?: maplibregl.Offset;
    appendContent?: (container: HTMLElement) => void;
}
export declare class MapLibreHelper {
    private static readonly inlineCssPropsCache;
    private static readonly inlineCssPropsCacheLimit;
    private static logMarkerStyleDebug;
    private static parseInlineCssProps;
    static createBasicPopup(options?: maplibregl.PopupOptions): maplibregl.Popup;
    static createIconMarker(map: maplibregl.Map, feature: GeoJSON.Feature, clickHandler: (event: Event) => void, showLabel?: boolean): maplibregl.Marker;
    static addTextLayer(map: maplibregl.Map, sourceId: string, defaultColor?: string, minzoom?: number): void;
    static addRouteSource(map: maplibregl.Map): void;
    static addBasicRouteLayers(map: maplibregl.Map): void;
    static clearExistingTracks(map: maplibregl.Map): void;
    static handleMissingSprites(map: maplibregl.Map): void;
    static addPointerCursor(map: maplibregl.Map, layerId: string): void;
    static removePointerCursor(map: maplibregl.Map, layerId: string): void;
    static closeAllPopups(): void;
    static openPopup(map: maplibregl.Map, coordinates: maplibregl.LngLatLike, content: HTMLElement, options?: {
        offset?: maplibregl.Offset;
    }): maplibregl.Popup;
    static createPopup(map: maplibregl.Map, options: MapLibrePopupOptions): maplibregl.Popup;
    static createFrequencyPopup(map: maplibregl.Map, coordinates: maplibregl.LngLatLike, frequency: number, contributingFiles: string[], app: App): maplibregl.Popup;
    static fitBounds(map: maplibregl.Map, pathCoords: Array<[number, number]>, padding?: number): void;
}
export declare function resolveStyleTextFont(map: {
    getStyle: () => {
        layers?: unknown[];
    } | undefined | null;
}, options?: {
    bold?: boolean;
}): string[];
export declare function applyIconRotation(iconEl: HTMLElement, rotationDeg: number | undefined, inlineCss?: string): void;
