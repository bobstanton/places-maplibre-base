import type * as maplibregl from 'maplibre-gl';
import { type DebugData, type DebugOverlayInput } from "places-shared/map";
export type { DebugData, DebugOverlayInput };
export declare function addDebugOverlay(map: maplibregl.Map, container: HTMLElement, input: DebugOverlayInput): DebugData;
