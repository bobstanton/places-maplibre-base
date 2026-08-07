import type * as maplibregl from "maplibre-gl";
export interface MapGlRuntime {
    Map: typeof maplibregl.Map;
    Marker: typeof maplibregl.Marker;
    Popup: typeof maplibregl.Popup;
    LngLatBounds: typeof maplibregl.LngLatBounds;
    addProtocol?: typeof maplibregl.addProtocol;
    getVersion?: () => string;
}
export declare function setGlRuntime(gl: MapGlRuntime): void;
export declare function getGl(): MapGlRuntime;
interface WorkerUrlConfigurable {
    setWorkerUrl(url: string): void;
}
export declare function installMaplibreWorker(gl: WorkerUrlConfigurable, workerCode: string): void;
export {};
