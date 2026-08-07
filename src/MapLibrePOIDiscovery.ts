import type * as GeoJSON from 'geojson';
import type * as maplibregl from 'maplibre-gl';
import { logger } from "places-shared/utils";
import { buildPoiDiscoveryPopupContent, shouldFilterPOI, type PlaceNoteHost } from "places-shared/map";
import { MapLibreHelper } from './MapLibreHelper';

// POI information read from vector tile features.
export interface POIDiscoveryInfo {
  name: string;
  class: string;
  subclass: string;
  coordinates: maplibregl.LngLat;
  layer: string;
  sourceLayer: string;
  geometry?: GeoJSON.Geometry;
}

export class POIDiscoveryHandler {
  // @param poiFilterPatterns - Regex patterns; matching POIs are excluded from discovery
  // @param placeNoteHost - Host-owned note creation from the render runtime; absent = popup offers no create-note row
  setup(map: maplibregl.Map, poiFilterPatterns: string[], placeNoteHost?: PlaceNoteHost): void {
    map.on('click', (e) => {
      if (map.getContainer().closest('.places-track-builder-active')) return;
      // Places' own layer handlers (markers, labels, waypoints, track lines)
      // claim their clicks with preventDefault, but MapLibre fires every click
      // listener from one array in registration order, with no hit-test
      // priority. A microtask runs as soon as the dispatch unwinds, before paint.
      queueMicrotask(() => this.discoverAt(map, e));
    });

    this.poiFilterPatterns = poiFilterPatterns;
    this.placeNoteHost = placeNoteHost;
  }

  private poiFilterPatterns: string[] = [];
  private placeNoteHost?: PlaceNoteHost;

  private discoverAt(map: maplibregl.Map, e: maplibregl.MapMouseEvent): void {
    {
      const poiFilterPatterns = this.poiFilterPatterns;
      if (e.defaultPrevented) {
        return;
      }

      // Box query widens the hit target for thin lines.
      const tolerance = 10;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - tolerance, e.point.y - tolerance],
        [e.point.x + tolerance, e.point.y + tolerance]
      ];
      const features = map.queryRenderedFeatures(bbox);

      const poiFeatures = features.filter(f => {
        const layerId = f.layer?.id || '';
        if (layerId.startsWith('places-') || layerId.startsWith('track-') || layerId.startsWith('geojson-') || layerId.startsWith('heatmap')) {
          return false;
        }
        // Every Places-rendered GeoJSON feature (markers, labels, tracks,
        // dynamic overlays, route overlays) lacks a vector source-layer;
        // discoverable POIs come from vector tiles (base map or vector tile
        // overlays).
        if (!f.sourceLayer) {
          return false;
        }
        return f.properties?.name;
      });

      if (poiFeatures.length === 0) return;

      const feature = poiFeatures[0];
      const props: Record<string, unknown> = feature.properties || {};

      // Vector-tile POI schemas vary by provider: OpenMapTiles (Stadia/MapTiler/Geoapify) uses
      // `class`/`subclass`; Mapbox Streets uses `class`/`type`.
      if (props.class === undefined && props.type === undefined) {
        logger.scope('POIDiscovery').debug('POI feature has no class/type field', {
          sourceLayer: feature.sourceLayer,
          propertyKeys: Object.keys(props),
        });
      }

      // Geometry is queried at "Create Note" time.
      const poiString = (value: unknown): string =>
        typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
      const poiInfo: POIDiscoveryInfo = {
        name: poiString(props.name),
        class: poiString(props.class) || poiString(props.type),
        subclass: poiString(props.subclass),
        coordinates: e.lngLat,
        layer: feature.layer?.id || '',
        sourceLayer: feature.sourceLayer || ''
      };

      if (poiFilterPatterns && poiFilterPatterns.length > 0) {
        if (shouldFilterPOI(poiFilterPatterns, {
          class: poiInfo.class,
          subclass: poiInfo.subclass,
          name: poiInfo.name,
        })) {
          return;
        }
      }

      this.showPopup(map, poiInfo);
    }
  }

  private showPopup(map: maplibregl.Map, poi: POIDiscoveryInfo): void {
    const content = buildPoiDiscoveryPopupContent({
      map,
      poi,
      placeNoteHost: this.placeNoteHost,
      closePopups: () => MapLibreHelper.closeAllPopups(),
    });

    MapLibreHelper.openPopup(map, poi.coordinates, content);
  }

}
