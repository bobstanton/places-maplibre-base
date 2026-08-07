import { App, MarkdownPostProcessorContext } from "obsidian";
import { getGl } from "./GlRuntime";
import { ImageOverlayAlignmentRunner, ImageOverlayAlignmentSettings, createMapGlImageAlignmentMap, type MapGlAlignmentMapLike, type MapGlMarkerConstructor } from "./ImageOverlayAlignment";

// The `imageAlignment` provider export: one aligned-image block processor per provider.
export function buildImageAlignment(app: App, _providerName: string, getStyleUrl: (style?: string) => string): (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
  const processor = new MapLibreImageAlignmentProcessor(app, getStyleUrl);
  return processor.process.bind(processor);
}

export class MapLibreImageAlignmentProcessor {
  constructor(private app: App, private getStyleUrl: (style?: string) => string) {}

  process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const runner = new ImageOverlayAlignmentRunner(this.app, {
      showZoomButtons: true,
      createMap: (container: HTMLElement, settings: ImageOverlayAlignmentSettings) => {
        const map = new (getGl().Map)({
          container,
          style: this.getStyleUrl(settings.style),
          center: settings.initialCenter ?? [0, 0],
          zoom: settings.initialZoom ?? 2,
          keyboard: false,
          doubleClickZoom: false,
          boxZoom: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchPitch: false
        });
        return createMapGlImageAlignmentMap(
          map as unknown as MapGlAlignmentMapLike,
          getGl().Marker as unknown as MapGlMarkerConstructor,
          getGl().LngLatBounds
        );
      }
    });

    runner.process(source, el, ctx);
  }
}
