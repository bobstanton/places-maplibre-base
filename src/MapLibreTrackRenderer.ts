import type * as maplibregl from 'maplibre-gl';
import { unregisterPointerCursorLayer } from './PointerCursorRegistry';
import { getMapLibreResourceRegistry, type MapLibreCleanupResult } from './MapLibreResourceRegistry';

export function setLayerVisibility(map: maplibregl.Map, layerIds: string[], visibility: 'visible' | 'none'): void {
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility);
  }
}

export function removeLayersAndSources(map: maplibregl.Map, layerIds: string[], sourceIds: string[]): MapLibreCleanupResult {
  for (const layerId of layerIds) unregisterPointerCursorLayer(map, layerId);
  return getMapLibreResourceRegistry(map).remove(layerIds, sourceIds);
}

export function removeTrackLayers(map: maplibregl.Map, trackIndex: number): MapLibreCleanupResult {
  return removeLayersAndSources(
    map,
    [`track-${trackIndex}`, `track-outline-${trackIndex}`, `track-arrow-${trackIndex}`],
    [`track-source-${trackIndex}`],
  );
}

export function removeDynamicOverlay(map: maplibregl.Map, placeId: string): MapLibreCleanupResult {
  const sourceId = `dynamic-overlay-${placeId}`;
  const lineLayerId = `${sourceId}-line`;
  return removeLayersAndSources(
    map,
    [`${sourceId}-hitarea`, `${lineLayerId}-route-label`, `${lineLayerId}-direction`, `${lineLayerId}-endpoints`, `${lineLayerId}-points`, `${lineLayerId}-points-label`, lineLayerId, `${lineLayerId}-outline`],
    [sourceId],
  );
}
