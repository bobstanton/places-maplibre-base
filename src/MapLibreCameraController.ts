import type * as maplibregl from 'maplibre-gl';
import { PlacesBoundingBox } from 'places-shared/geo';
import { extendBoundingBoxWithOverlays } from 'places-shared/overlay';
import type { MapRenderRequest } from 'places-shared/settings';
import type { MapCameraApplyResult } from 'places-shared/services';
import type { MapCameraIntent } from 'places-shared/render';
import { isNonInteractivePlace, MapState } from './MapState';

export function withProgrammaticCamera(map: maplibregl.Map, move: () => void): void {
  const release = MapState.for(map).getCameraGuard().beginProgrammaticMove();
  try {
    move();
  } finally {
    release();
  }
}

export function applyInitialViewport(options: {
  map: maplibregl.Map;
  bounds: [[number, number], [number, number]];
  request: MapRenderRequest;
  padding: number;
}): void {
  const { map, bounds, request, padding } = options;
  const intent = request.runtime.camera;
  const initialCenter = intent.kind === 'explicit' ? intent.center : undefined;
  const initialZoom = intent.kind === 'explicit' ? intent.zoom : undefined;
  if (initialCenter || initialZoom !== undefined) {
    const currentCenter = map.getCenter();
    withProgrammaticCamera(map, () => map.jumpTo({
      center: initialCenter ?? [currentCenter.lng, currentCenter.lat],
      zoom: initialZoom ?? map.getZoom(),
    }));
    return;
  }

  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return;
  // fitBounds resets pitch/bearing to 0 by default.
  withProgrammaticCamera(map, () => map.fitBounds(bounds, { padding, animate: false, maxZoom: 14, pitch: map.getPitch(), bearing: map.getBearing() }));
}

export function applyCameraIntent(map: maplibregl.Map, camera: MapCameraIntent, request: MapRenderRequest): MapCameraApplyResult {
  switch (camera.kind) {
    case 'fit-data': {
      const bounds = new PlacesBoundingBox();
      for (const place of MapState.for(map).getCurrentPlaces()) {
        if (!isNonInteractivePlace(place)) bounds.update(place.latitude, place.longitude);
      }
      extendBoundingBoxWithOverlays(bounds, request.runtime.overlays);
      if (!bounds.isValid()) return { applied: false, reason: 'no valid data bounds' };
      withProgrammaticCamera(map, () => map.fitBounds(bounds.getLngLatBounds(), {
        padding: camera.padding ?? 30,
        animate: false,
        maxZoom: camera.maxZoom ?? 14,
        // fitBounds resets pitch/bearing to 0 by default.
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      }));
      return { applied: true };
    }
    case 'explicit': {
      const currentCenter = map.getCenter();
      withProgrammaticCamera(map, () => map.jumpTo({
        center: camera.center ?? [currentCenter.lng, currentCenter.lat],
        zoom: camera.zoom ?? map.getZoom(),
      }));
      return { applied: true };
    }
    case 'preserve': {
      return { applied: true };
    }
  }
}
