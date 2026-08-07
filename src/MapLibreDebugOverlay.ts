import type * as maplibregl from 'maplibre-gl';
import { addSharedDebugOverlay, createVectorDebugOverlayAdapter, type DebugData, type DebugOverlayInput } from "places-shared/map";

export type { DebugData, DebugOverlayInput };

// Enabled by debug: true in the code block.
export function addDebugOverlay(map: maplibregl.Map, container: HTMLElement, input: DebugOverlayInput): DebugData {
  return addSharedDebugOverlay(container, input, createVectorDebugOverlayAdapter(map, { includeClickFeatures: true }));
}
