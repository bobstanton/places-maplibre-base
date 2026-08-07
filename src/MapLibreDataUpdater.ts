import type * as maplibregl from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import { convertPlacesToGeoJSONData } from 'places-shared/geo';
import { extractOverlayPointFeatures as extractOverlayPointFeaturesFromOverlays, type MapPlace } from 'places-shared/overlay';
import { getPlaceId, getPlaceMarkerRenderSignature } from 'places-shared/track';
import type { MapRenderRequest } from 'places-shared/settings';
import type { CommonMapSettings } from 'places-shared/services';
import { logger } from 'places-shared/utils';
import type { ViewportClusteringManager } from 'places-shared/map';
import { isNonInteractivePlace, type MapState } from './MapState';
import { updateTextLabelSource } from './MapLibreMarkerRenderer';

export function updateClusteredMarkers(
  map: maplibregl.Map,
  clusteringManager: ViewportClusteringManager<maplibregl.Marker>,
  mapState: MapState,
  places: MapPlace[],
  settings: CommonMapSettings | null,
  request: MapRenderRequest,
): void {
  const blockSettings = request.config;
  const [geoJsonData] = convertPlacesToGeoJSONData(places, { serializePlace: false });
  const features = (geoJsonData as { data: GeoJSON.FeatureCollection }).data.features;
  const overlayFeatures = blockSettings.clusterGeoJsonOverlays
    ? [...extractOverlayPointFeaturesFromOverlays(request.runtime.overlays)]
    : [];
  const interactivePlaces: MapPlace[] = [];
  const interactiveFeatures: GeoJSON.Feature[] = [];

  places.forEach((place, index) => {
    if (isNonInteractivePlace(place)) return;
    interactivePlaces.push(place);
    interactiveFeatures.push(features[index]);
  });

  map.getSource<maplibregl.GeoJSONSource>('places-clustered')?.setData({
    type: 'FeatureCollection',
    features: [...interactiveFeatures, ...overlayFeatures],
  });
  map.getSource<maplibregl.GeoJSONSource>('overlay-points-unclustered')?.setData({
    type: 'FeatureCollection',
    features: overlayFeatures,
  });
  if (settings?.showLabels) updateTextLabelSource(map, places);

  clusteringManager.updatePlaces(interactivePlaces, overlayFeatures.map(feature => {
    const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates;
    return { longitude, latitude };
  }));
  mapState.setCurrentPlaces(places);
  for (const place of interactivePlaces) {
    mapState.setPlaceMarkerSignature(getPlaceId(place), getPlaceMarkerRenderSignature(place));
  }
  logger.scope('Places').debug(`[Places Incremental] Updated clustered source: ${interactivePlaces.length} places`);
}
