import type * as maplibregl from 'maplibre-gl';
import { logger as rootLogger } from 'places-shared/utils';
import { DEFAULT_COLOR_RELIEF_STOPS, type TerrainDemSpec, type ColorReliefStop } from 'places-shared/map';

const logger = rootLogger.scope('Relief');

const HILLSHADE_SOURCE_ID = 'places-hillshade-dem';
const HILLSHADE_LAYER_ID = 'places-hillshade';
const COLOR_RELIEF_SOURCE_ID = 'places-colorrelief-dem';
const COLOR_RELIEF_LAYER_ID = 'places-color-relief';

// Build the `color-relief-color` expression (elevation->color) from a ramp.
function colorReliefRamp(stops: readonly ColorReliefStop[]): unknown[] {
  return ['interpolate', ['linear'], ['elevation'], ...stops.flatMap(stop => [stop.elevation, stop.color])];
}

function toRasterDemSpec(spec: TerrainDemSpec): maplibregl.RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [...spec.tiles],
    encoding: spec.encoding,
    tileSize: spec.tileSize ?? 256,
    ...(spec.maxzoom !== undefined ? { maxzoom: spec.maxzoom } : {}),
    ...(spec.attribution ? { attribution: spec.attribution } : {}),
  };
}

// Insert relief above the base map's fills but below its roads and labels.
// Falls back to the top of the stack when a style has no line/symbol layers.
function reliefInsertBeforeId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return layers.find(layer => layer.type === 'line' || layer.type === 'symbol')?.id;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

// Unset properties fall back to MapLibre's own defaults.
export interface HillshadeOptions {
  intensity: number;
  // `hillshade-method` is MapLibre GL 5-only; the base passes undefined on engines that lack it (mapbox-gl).
  method?: string;
  direction?: number;
  shadowColor?: string;
  highlightColor?: string;
  accentColor?: string;
}

// Independent of 3D terrain - renders on a flat 2D map. Never throws.
export function applyHillshade(map: maplibregl.Map, dem: TerrainDemSpec, options: HillshadeOptions): void {
  try {
    if (!map.getSource(HILLSHADE_SOURCE_ID)) map.addSource(HILLSHADE_SOURCE_ID, toRasterDemSpec(dem));
    if (map.getLayer(HILLSHADE_LAYER_ID)) return;
    const paint: Record<string, unknown> = { 'hillshade-exaggeration': clamp01(options.intensity) };
    if (options.method) paint['hillshade-method'] = options.method;
    if (options.direction !== undefined) paint['hillshade-illumination-direction'] = options.direction;
    if (options.shadowColor) paint['hillshade-shadow-color'] = options.shadowColor;
    if (options.highlightColor) paint['hillshade-highlight-color'] = options.highlightColor;
    if (options.accentColor) paint['hillshade-accent-color'] = options.accentColor;
    map.addLayer({
      id: HILLSHADE_LAYER_ID,
      type: 'hillshade',
      source: HILLSHADE_SOURCE_ID,
      paint,
    }, reliefInsertBeforeId(map));
  } catch (error) {
    logger.warn('Failed to enable hillshade', { error });
  }
}

// Elevation tint at the given opacity (0-1). MapLibre's color-relief layer
// colors each pixel by its elevation via the `["elevation"]` expression.
// Never throws.
export function applyColorRelief(map: maplibregl.Map, dem: TerrainDemSpec, opacity: number, stops?: readonly ColorReliefStop[]): void {
  try {
    if (!map.getSource(COLOR_RELIEF_SOURCE_ID)) map.addSource(COLOR_RELIEF_SOURCE_ID, toRasterDemSpec(dem));
    if (map.getLayer(COLOR_RELIEF_LAYER_ID)) return;
    map.addLayer({
      id: COLOR_RELIEF_LAYER_ID,
      type: 'color-relief',
      source: COLOR_RELIEF_SOURCE_ID,
      paint: { 'color-relief-color': colorReliefRamp(stops ?? DEFAULT_COLOR_RELIEF_STOPS), 'color-relief-opacity': clamp01(opacity) },
    } as maplibregl.LayerSpecification, reliefInsertBeforeId(map));
  } catch (error) {
    logger.warn('Failed to enable color relief', { error });
  }
}
