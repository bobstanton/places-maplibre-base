import type * as maplibregl from 'maplibre-gl';
import { type TerrainDemSpec, type TerrainExaggeration } from 'places-shared/map';
export declare function applyTerrain(map: maplibregl.Map, dem: TerrainDemSpec, exaggeration?: TerrainExaggeration): void;
