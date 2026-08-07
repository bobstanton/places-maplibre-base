import type * as maplibregl from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import type { MapPlace } from 'places-shared/overlay';
export declare function createPointFeature(options: {
    place: MapPlace;
    zoomSizeStops?: number[];
    iconImageId: string;
}): GeoJSON.Feature;
export declare function createHtmlMarkerFeature(options: {
    place: MapPlace;
    iconImageId: string;
}): GeoJSON.Feature;
export declare function updateTextLabelSource(map: maplibregl.Map, places: MapPlace[]): void;
