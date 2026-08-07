import type * as maplibregl from 'maplibre-gl';
import type { MapRuntimeContext } from 'places-shared/settings';
import { MapState } from './MapState';

export function recordOverlayVisibility(options: {
  map: maplibregl.Map;
  runtime: MapRuntimeContext;
  setLayerVisibility: (layerIds: string[], visibility: 'visible' | 'none') => void;
}): void {
  const { map, runtime, setLayerVisibility } = options;
  const overlays = runtime.overlays;
  const mapState = MapState.for(map);
  mapState.setOverlayLineLayerCount(overlays.length);
  const embeddedTrackIndices = overlays
    .map((overlay, index) => ({ overlay, index }))
    .filter(({ overlay }) => overlay.source?.endsWith('.md'))
    .map(({ overlay, index }) => {
      mapState.setPlaceFilePathToOverlayIndex(overlay.source, index);
      return index;
    });
  mapState.setEmbeddedTrackOverlayIndices(embeddedTrackIndices);

  const defaultState = mapState.getDefaultTrackState();
  const hide = defaultState === 'hidden' || (defaultState === 'visible' && runtime.unifiedClusteringActive);
  for (const index of embeddedTrackIndices) {
    if (hide) setLayerVisibility([`geojson-overlay-${index}-line`, `geojson-overlay-${index}-line-hitarea`, `geojson-overlay-${index}-circle`], 'none');
    mapState.setGeoJsonOverlayVisible(index, !hide);
  }
}
