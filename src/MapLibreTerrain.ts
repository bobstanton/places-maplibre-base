import type * as maplibregl from 'maplibre-gl';
import { logger as rootLogger } from 'places-shared/utils';
import { DEFAULT_TERRAIN_EXAGGERATION, exaggerationAtZoom, type TerrainDemSpec, type TerrainExaggeration } from 'places-shared/map';

const logger = rootLogger.scope('Terrain');

const TERRAIN_SOURCE_ID = 'places-terrain-dem';

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

// Requires a loaded map. `exaggeration` is a constant factor or a zoom curve
// of `@z` stops; MapLibre's terrain exaggeration is a scalar (not an
// expression), and a curve is applied by recomputing the factor on every zoom.
// Never throws. The DEM source is resolved by the main plugin from
// `terrainProvider`.
export function applyTerrain(map: maplibregl.Map, dem: TerrainDemSpec, exaggeration: TerrainExaggeration = DEFAULT_TERRAIN_EXAGGERATION): void {
  try {
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
      map.addSource(TERRAIN_SOURCE_ID, toRasterDemSpec(dem));
    }
    if (typeof exaggeration === 'number') {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
    } else {
      applyZoomExaggeration(map, exaggeration);
    }
    trySetSky(map);
  } catch (error) {
    logger.warn('Failed to enable 3D terrain', { error });
  }
}

// MapLibre re-evaluates neither the scalar nor an expression here. The listeners die with the
// map. `setTerrain` resets terrain state and forces a re-render: during a
// gesture the factor only moves in coarse steps; `zoomend` settles the exact
// value.
const EXAGGERATION_GESTURE_STEP = 0.05;

function applyZoomExaggeration(map: maplibregl.Map, stops: readonly import('places-shared/map').TerrainExaggerationStop[]): void {
  let lastApplied = NaN;
  const apply = (factor: number): void => {
    if (factor === lastApplied) return;
    lastApplied = factor;
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: factor });
  };
  const exactFactor = (): number => Number(exaggerationAtZoom(stops, map.getZoom()).toFixed(3));

  apply(exactFactor());
  map.on('zoom', () => {
    const factor = exactFactor();
    if (Number.isFinite(lastApplied) && Math.abs(factor - lastApplied) < EXAGGERATION_GESTURE_STEP) return;
    apply(factor);
  });
  map.on('zoomend', () => apply(exactFactor()));
}

// setSky exists on MapLibre GL 5+; Mapbox GL styles carry their own atmosphere, and a failure here is non-fatal.
function trySetSky(map: maplibregl.Map): void {
  const withSky = map as maplibregl.Map & { setSky?: (spec: unknown) => void };
  if (typeof withSky.setSky !== 'function') return;
  try {
    withSky.setSky({
      'sky-color': '#8ec5fc',
      'sky-horizon-blend': 0.5,
      'horizon-color': '#ffffff',
      'horizon-fog-blend': 0.5,
      'fog-color': '#dfe9f2',
      'fog-ground-blend': 0.5,
    });
  } catch {
    // Sky is cosmetic; ignore engines/styles that reject the spec.
  }
}
