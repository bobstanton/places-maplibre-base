import type * as maplibregl from "maplibre-gl";

// maplibre-gl and mapbox-gl share these APIs; either engine satisfies the shape.
export interface MapGlRuntime {
  Map: typeof maplibregl.Map;
  Marker: typeof maplibregl.Marker;
  Popup: typeof maplibregl.Popup;
  LngLatBounds: typeof maplibregl.LngLatBounds;
  // Engines without protocol support (mapbox-gl) omit this; the tile cache stays off for them.
  addProtocol?: typeof maplibregl.addProtocol;
  // Runtime package version. MapLibre exposes getVersion; injected engines provide an equivalent.
  getVersion?: () => string;
}

let runtime: MapGlRuntime | undefined;

// Each provider plugin bundles its own copy of this module and injects its
// engine (`maplibre-gl` or `mapbox-gl`) from the processor constructor. The
// base layer never imports an engine itself.
export function setGlRuntime(gl: MapGlRuntime): void {
  runtime = gl;
}

export function getGl(): MapGlRuntime {
  if (!runtime) {
    throw new Error("No map engine registered. A provider must call setGlRuntime() in its constructor before rendering a map.");
  }
  return runtime;
}

interface WorkerUrlConfigurable {
  setWorkerUrl(url: string): void;
}

let maplibreWorkerInstalled = false;

// maplibre-gl 6 loads its web worker from a URL instead of the inline blob v5
// created automatically, and an Obsidian plugin has no server to host it. Serve
// the provider's bundled worker source (produced by the maplibre-worker-inline
// esbuild helper and imported as `maplibre-worker-bundle`) via a blob URL.
//
// Call once from a maplibre-gl 6 provider before any map is constructed. Engines
// that build their own worker (maplibre-gl 5, mapbox-gl) don't need this. Each
// provider plugin bundles its own copy of this module, and the guard is per plugin.
export function installMaplibreWorker(gl: WorkerUrlConfigurable, workerCode: string): void {
  if (maplibreWorkerInstalled) return;
  maplibreWorkerInstalled = true;
  const blob = new Blob([workerCode], { type: "text/javascript" });
  gl.setWorkerUrl(URL.createObjectURL(blob));
}
