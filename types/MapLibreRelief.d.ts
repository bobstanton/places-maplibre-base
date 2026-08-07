import type * as maplibregl from 'maplibre-gl';
import { type TerrainDemSpec, type ColorReliefStop } from 'places-shared/map';
export interface HillshadeOptions {
    intensity: number;
    method?: string;
    direction?: number;
    shadowColor?: string;
    highlightColor?: string;
    accentColor?: string;
}
export declare function applyHillshade(map: maplibregl.Map, dem: TerrainDemSpec, options: HillshadeOptions): void;
export declare function applyColorRelief(map: maplibregl.Map, dem: TerrainDemSpec, opacity: number, stops?: readonly ColorReliefStop[]): void;
