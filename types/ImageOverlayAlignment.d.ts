import { App, MarkdownPostProcessorContext } from "obsidian";
import { type MapSourceContext } from "places-shared/settings";
export interface ImageOverlayAlignmentCorner {
    lat: number;
    lng: number;
}
export type ImageOverlayAlignmentCorners = {
    nw: ImageOverlayAlignmentCorner;
    ne: ImageOverlayAlignmentCorner;
    se: ImageOverlayAlignmentCorner;
    sw: ImageOverlayAlignmentCorner;
};
export declare function imageOverlayAlignmentSessionKey(source: MapSourceContext, image: string): string;
export declare function getImageOverlayAlignmentSessionCorners(key: string): ImageOverlayAlignmentCorners | undefined;
export declare function setImageOverlayAlignmentSessionCorners(key: string, corners: ImageOverlayAlignmentCorners): void;
export interface ImageOverlayAlignmentSettings {
    image?: string;
    height?: string;
    style?: string;
    opacity?: number;
    initialZoom?: number;
    initialCenter?: [number, number];
    initialCorners?: ImageOverlayAlignmentCorners;
}
export interface ImageAlignmentMarker {
    setLngLat(position: [number, number]): void;
    getLngLat(): ImageOverlayAlignmentCorner;
    on(type: 'drag' | 'dragend', handler: () => void): void;
}
export interface ImageAlignmentPointerEvent {
    lngLat: ImageOverlayAlignmentCorner;
    originalEvent: MouseEvent;
    readonly defaultPrevented: boolean;
    preventDefault(): void;
}
export interface ImageAlignmentWheelEvent {
    lngLat: ImageOverlayAlignmentCorner;
    originalEvent: WheelEvent;
    preventDefault(): void;
}
export interface ImageAlignmentMapEventMap {
    load: unknown;
    mousedown: ImageAlignmentPointerEvent;
    mousemove: ImageAlignmentPointerEvent;
    wheel: ImageAlignmentWheelEvent;
}
export interface ImageAlignmentMap {
    on<K extends keyof ImageAlignmentMapEventMap>(type: K, handler: (event: ImageAlignmentMapEventMap[K]) => void): void;
    resize(): void;
    getCanvas(): HTMLCanvasElement;
    unproject(point: [number, number]): ImageOverlayAlignmentCorner;
    addImageOverlay(imageUrl: string, coordinates: ImageOverlayCoordinates, opacity: number): void;
    updateImageOverlay(coordinates: ImageOverlayCoordinates): void;
    createMarker(position: ImageOverlayAlignmentCorner, element: HTMLElement): ImageAlignmentMarker;
    fitBounds(corners: ImageOverlayAlignmentCorners): void;
    remove(): void;
    zoomIn?(): void;
    zoomOut?(): void;
}
export type ImageOverlayCoordinates = [[number, number], [number, number], [number, number], [number, number]];
export interface ImageOverlayAlignmentAdapter {
    createMap(container: HTMLElement, settings: ImageOverlayAlignmentSettings): ImageAlignmentMap;
    missingConfiguration?: {
        title: string;
        message: string;
    };
    showZoomButtons?: boolean;
}
export interface MapGlAlignmentMapLike {
    on<K extends keyof ImageAlignmentMapEventMap>(type: K, handler: (event: ImageAlignmentMapEventMap[K]) => void): void;
    resize(): void;
    remove(): void;
    getCanvas(): HTMLCanvasElement;
    unproject(point: [number, number]): ImageOverlayAlignmentCorner;
    addSource(id: string, source: {
        type: 'image';
        url: string;
        coordinates: ImageOverlayCoordinates;
    }): void;
    addLayer(layer: {
        id: string;
        type: 'raster';
        source: string;
        paint: {
            'raster-opacity': number;
            'raster-fade-duration': number;
        };
    }): void;
    getSource(id: string): {
        setCoordinates(coordinates: ImageOverlayCoordinates): void;
    } | undefined;
    fitBounds(bounds: unknown, options: {
        padding: number;
    }): void;
    zoomIn?(): void;
    zoomOut?(): void;
}
export interface MapGlMarkerLike extends ImageAlignmentMarker {
    setLngLat(position: [number, number]): MapGlMarkerLike;
    addTo(map: MapGlAlignmentMapLike): ImageAlignmentMarker;
}
export type MapGlMarkerConstructor = new (options: {
    element: HTMLElement;
    draggable: true;
    anchor: 'center';
}) => MapGlMarkerLike;
export type MapGlBoundsConstructor = new () => {
    extend(position: [number, number]): void;
};
export declare function createMapGlImageAlignmentMap(map: MapGlAlignmentMapLike, MarkerCtor: MapGlMarkerConstructor, BoundsCtor: MapGlBoundsConstructor): ImageAlignmentMap;
export declare class ImageOverlayAlignmentRunner {
    private app;
    private adapter;
    constructor(app: App, adapter: ImageOverlayAlignmentAdapter);
    process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void;
    private loadImageResource;
    private addButton;
}
export declare function parseImageOverlayAlignmentSettings(source: string): ImageOverlayAlignmentSettings;
export declare function parseImageOverlayCoordinates(value: string): ImageOverlayAlignmentCorners | undefined;
export declare function formatImageOverlayAlignmentOutput(image: string, corners: ImageOverlayAlignmentCorners): string;
export declare function cornersToCoordinates(corners: ImageOverlayAlignmentCorners): ImageOverlayCoordinates;
