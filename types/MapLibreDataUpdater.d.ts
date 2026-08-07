import type * as maplibregl from 'maplibre-gl';
import { type MapPlace } from 'places-shared/overlay';
import type { MapRenderRequest } from 'places-shared/settings';
import type { CommonMapSettings } from 'places-shared/services';
import type { ViewportClusteringManager } from 'places-shared/map';
import { type MapState } from './MapState';
export declare function updateClusteredMarkers(map: maplibregl.Map, clusteringManager: ViewportClusteringManager<maplibregl.Marker>, mapState: MapState, places: MapPlace[], settings: CommonMapSettings | null, request: MapRenderRequest): void;
