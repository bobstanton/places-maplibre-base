import type { ImageOverlay } from 'places-shared/overlay';
import type * as GeoJSON from 'geojson';
import { createRouteEndpointLabelLayerConfig, createRouteLabelLayerConfig } from './TextLabelLayerStyles';

export type OverlayImageCoordinates = [[number, number], [number, number], [number, number], [number, number]];

export function getGeoJsonOverlayDashArray(geojson: GeoJSON.GeoJSON, defaultDashArray: number[]): number[] | undefined {
  const dashProp = getFirstLineDashProperty(geojson);
  if (dashProp !== undefined) {
    if (dashProp === '' || dashProp === null) {
      return undefined;
    }
    if (typeof dashProp === 'string' && dashProp.includes(',')) {
      return dashProp.split(',').map((value: string) => parseFloat(value.trim()));
    }
  }
  return defaultDashArray;
}

export function getImageOverlayCoordinates(overlay: ImageOverlay): OverlayImageCoordinates {
  if (overlay.corners) {
    return [
      [overlay.corners.nwLng, overlay.corners.nwLat],
      [overlay.corners.neLng, overlay.corners.neLat],
      [overlay.corners.seLng, overlay.corners.seLat],
      [overlay.corners.swLng, overlay.corners.swLat]
    ];
  }

  if (overlay.bounds) {
    return [
      [overlay.bounds.swLng, overlay.bounds.neLat],
      [overlay.bounds.neLng, overlay.bounds.neLat],
      [overlay.bounds.neLng, overlay.bounds.swLat],
      [overlay.bounds.swLng, overlay.bounds.swLat]
    ];
  }

  throw new Error('Image overlay must have either bounds or corners');
}

export function getImageOverlayOpacity(overlay: ImageOverlay): number {
  return typeof overlay.style?.opacity === 'number' ? overlay.style.opacity : 1.0;
}

export function createGeoJsonOverlaySourceId(index: number): string {
  return `geojson-overlay-${index}`;
}

export function createGeoJsonOverlayLayerIds(sourceId: string): string[] {
  return [
    `${sourceId}-circle`,
    `${sourceId}-route-endpoint-label`,
    `${sourceId}-route-label`,
    `${sourceId}-line-hitarea`,
    `${sourceId}-line`,
    `${sourceId}-fill-outline`,
    `${sourceId}-fill`
  ];
}

export function createImageOverlaySourceId(index: number): string {
  return `image-overlay-${index}`;
}

export function createImageOverlayLayerId(index: number): string {
  return `image-overlay-layer-${index}`;
}

// Vector tile overlay SOURCE ids are shared per source definition; see
// createVectorTileOverlaySourceId in places-shared/overlay.
export function createVectorTileOverlayLayerId(index: number): string {
  return `vector-tile-overlay-layer-${index}`;
}

export function createGeoJsonOverlayLayers(sourceId: string, defaultColor: string, dashArray?: number[]): Array<Record<string, unknown>> {
  const linePaint: Record<string, unknown> = {
    'line-color': ['coalesce', ['get', 'stroke'], defaultColor],
    'line-width': ['coalesce', ['get', 'stroke-width'], 2],
    'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 1]
  };
  if (dashArray) {
    linePaint['line-dasharray'] = dashArray;
  }

  return [
    {
      id: `${sourceId}-fill`,
      type: 'fill',
      source: sourceId,
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: {
        'fill-color': ['coalesce', ['get', 'fill'], defaultColor],
        'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.3]
      }
    },
    {
      id: `${sourceId}-fill-outline`,
      type: 'line',
      source: sourceId,
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: {
        'line-color': ['coalesce', ['get', 'stroke'], defaultColor],
        'line-width': ['coalesce', ['get', 'stroke-width'], 2],
        'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 1]
      }
    },
    {
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: linePaint
    },
    {
      id: `${sourceId}-line-hitarea`,
      type: 'line',
      source: sourceId,
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
      paint: {
        'line-color': 'transparent',
        'line-width': 15,
        'line-opacity': 0
      }
    },
    createRouteLabelLayerConfig({ sourceId }),
    createRouteEndpointLabelLayerConfig({ sourceId })
  ];
}

export function createGeoJsonOverlayPointLayer(sourceId: string, defaultColor: string): Record<string, unknown> {
  return {
    id: `${sourceId}-circle`,
    type: 'circle',
    source: sourceId,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'route_label_point']]],
    paint: {
      'circle-radius': ['coalesce', ['get', 'circle-radius'], 5],
      'circle-color': ['coalesce', ['get', 'marker-color'], defaultColor],
      'circle-opacity': ['coalesce', ['get', 'fill-opacity'], 0.7],
      'circle-stroke-color': ['coalesce', ['get', 'stroke'], '#fff'],
      'circle-stroke-width': ['coalesce', ['get', 'stroke-width'], 1],
      'circle-stroke-opacity': ['coalesce', ['get', 'stroke-opacity'], 1]
    }
  };
}

function getFirstLineDashProperty(geojson: GeoJSON.GeoJSON): unknown {
  if (geojson.type === 'FeatureCollection') {
    for (const feature of geojson.features) {
      if (feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString') {
        return feature.properties?.['stroke-dasharray'];
      }
    }
  }

  if (geojson.type === 'Feature') {
    return geojson.properties?.['stroke-dasharray'];
  }

  return undefined;
}
