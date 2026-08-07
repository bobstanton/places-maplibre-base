import type { App } from 'obsidian';
import type * as maplibregl from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import { PlacesBoundingBox } from 'places-shared/geo';
import type { MapPlace } from 'places-shared/overlay';
import { ColorSchemes } from 'places-shared/track';
import { findClosestPointFeature } from 'places-shared/map';
import { MapConstants, parseContributingFiles } from 'places-shared/utils';
import { MapLibreHelper } from './MapLibreHelper';

export interface MapLibreHeatmapData {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
  isHeatmapLayer: true;
  colorScheme: string;
  minWeight: number;
  maxWeight: number;
}

export function createHeatmapGeoJson(places: MapPlace[], colorScheme: string): [MapLibreHeatmapData, PlacesBoundingBox] {
  const weights = places.map(place => Number(place.metadata?.heatmapWeight) || 1);
  const minWeight = weights.length > 0 ? Math.min(...weights) : 1;
  const maxWeight = weights.length > 0 ? Math.max(...weights) : 1;
  const features: GeoJSON.Feature[] = places.map((place, index) => ({
    type: 'Feature',
    properties: {
      weight: weights[index],
      frequency: place.metadata?.frequency || weights[index],
      contributingFiles: place.metadata?.contributingFiles || [],
      minWeight,
      maxWeight,
    },
    geometry: { type: 'Point', coordinates: [place.longitude, place.latitude] },
  }));
  const boundingBox = new PlacesBoundingBox();
  for (const place of places) boundingBox.update(place.latitude, place.longitude);
  return [{
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
    isHeatmapLayer: true,
    colorScheme,
    minWeight,
    maxWeight,
  }, boundingBox];
}

export function renderHeatmap(options: {
  app: App;
  map: maplibregl.Map;
  data: MapLibreHeatmapData;
}): void {
  const { app, map, data } = options;
  map.addSource('heatmap', { type: 'geojson', data: data.data });
  const equalWeights = data.minWeight === data.maxWeight;
  const weightExpression = equalWeights ? 1 : ['interpolate', ['linear'], ['get', 'weight'], data.minWeight, 0, data.maxWeight, 1];
  const radiusAtZoom0 = equalWeights ? 8 : ['interpolate', ['linear'], ['get', 'weight'], data.minWeight, 2, data.maxWeight, 8];
  const radiusAtZoom9 = equalWeights ? 50 : ['interpolate', ['linear'], ['get', 'weight'], data.minWeight, 20, data.maxWeight, 50];
  map.addLayer({
    id: 'heatmap-layer',
    type: 'heatmap',
    source: 'heatmap',
    paint: {
      'heatmap-weight': weightExpression as maplibregl.ExpressionSpecification | number,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
      'heatmap-color': ColorSchemes.getHeatmapMapGLExpression(data.colorScheme || 'heat') as maplibregl.ExpressionSpecification,
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, radiusAtZoom0, 9, radiusAtZoom9] as maplibregl.ExpressionSpecification,
      'heatmap-opacity': 1,
    },
  });

  map.on('click', 'heatmap-layer', (event: maplibregl.MapLayerMouseEvent) => {
    const features = map.querySourceFeatures('heatmap', { sourceLayer: undefined });
    const closest = findClosestPointFeature({ map, features, clickPoint: event.point, thresholdPx: MapConstants.CLICK_PROXIMITY_THRESHOLD_PX });
    if (!closest) return;
    event.preventDefault();
    const frequencyProperty: unknown = closest.properties?.frequency;
    const weightProperty: unknown = closest.properties?.weight;
    MapLibreHelper.createFrequencyPopup(
      map,
      event.lngLat,
      (typeof frequencyProperty === 'number' ? frequencyProperty : 0) || (typeof weightProperty === 'number' ? weightProperty : 0),
      parseContributingFiles(closest.properties?.contributingFiles),
      app,
    );
  });
  MapLibreHelper.addPointerCursor(map, 'heatmap-layer');
}
