import type * as maplibregl from 'maplibre-gl';

const POINTER_CURSOR_CLASS = 'places-map-pointer-cursor';

interface PointerCursorState {
  layerIds: Set<string>;
  active: boolean;
  pendingPoint: maplibregl.Point | null;
  frame: number | null;
}

const registries = new WeakMap<maplibregl.Map, PointerCursorState>();

// Do not switch this to `map.on('mouseenter', layerId, ...)`: the engine
// implements layer-scoped mouse events as `mousemove` delegates that each run
// their own single-layer `queryRenderedFeatures`, and per-layer registration
// costs one unthrottled hit-test query per layer per pointer sample.
export function registerPointerCursorLayer(map: maplibregl.Map, layerId: string): void {
  let state = registries.get(map);
  if (!state) {
    state = { layerIds: new Set(), active: false, pendingPoint: null, frame: null };
    registries.set(map, state);
    wirePointerCursor(map, state);
  }
  state.layerIds.add(layerId);
}

export function unregisterPointerCursorLayer(map: maplibregl.Map, layerId: string): void {
  registries.get(map)?.layerIds.delete(layerId);
}

function setPointerCursor(map: maplibregl.Map, state: PointerCursorState, active: boolean): void {
  if (state.active === active) return;
  state.active = active;
  map.getCanvas().classList.toggle(POINTER_CURSOR_CLASS, active);
}

function wirePointerCursor(map: maplibregl.Map, state: PointerCursorState): void {
  const evaluate = () => {
    state.frame = null;
    const point = state.pendingPoint;
    state.pendingPoint = null;
    if (!point) return;

    const activeLayerIds = [...state.layerIds].filter(layerId => map.getLayer(layerId));
    const hit = activeLayerIds.length > 0
      && map.queryRenderedFeatures(point, { layers: activeLayerIds }).length > 0;
    setPointerCursor(map, state, hit);
  };

  map.on('mousemove', (e) => {
    state.pendingPoint = e.point;
    if (state.frame !== null) return;
    state.frame = window.requestAnimationFrame(evaluate);
  });

  const clear = () => {
    state.pendingPoint = null;
    setPointerCursor(map, state, false);
  };
  map.on('mouseout', clear);

  // Cancel any scheduled frame: it would query a map with no style left.
  map.on('remove', () => {
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    state.frame = null;
    state.pendingPoint = null;
    state.layerIds.clear();
    registries.delete(map);
  });
}
