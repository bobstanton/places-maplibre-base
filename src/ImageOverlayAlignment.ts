import { App, MarkdownPostProcessorContext, MarkdownRenderChild, normalizePath, setIcon, TFile } from "obsidian";
import { getErrorMessage, isRecord, renderError, renderMapSurfaceError, copyToClipboard, loggedRequestUrl as requestUrl, sharedRegistryMap } from "places-shared/utils";
import { DEG_TO_RAD, parseCoordinate } from "places-shared/geo";
import { parseCodeBlockYaml, type MapSourceContext } from "places-shared/settings";

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

const ALIGNMENT_SESSION_REGISTRY_KEY = Symbol.for('places.map.image-overlay-alignment-sessions');
type ImageOverlayAlignmentSessionRegistry = Map<string, ImageOverlayAlignmentCorners>;

export function imageOverlayAlignmentSessionKey(source: MapSourceContext, image: string): string {
  const path = source.path ?? '';
  const block = source.lineStart ?? 0;
  return `${path}:${block}:image-align:${image}`;
}

export function getImageOverlayAlignmentSessionCorners(key: string): ImageOverlayAlignmentCorners | undefined {
  const corners = getImageOverlayAlignmentSessionRegistry().get(key);
  return corners ? cloneImageOverlayAlignmentCorners(corners) : undefined;
}

export function setImageOverlayAlignmentSessionCorners(key: string, corners: ImageOverlayAlignmentCorners): void {
  getImageOverlayAlignmentSessionRegistry().set(key, cloneImageOverlayAlignmentCorners(corners));
}

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

// The map coordinate under the pointer is supplied directly (`lngLat`, no unproject), and
// `preventDefault()` cancels the map's own drag-pan / scroll-zoom for that one gesture.
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
  getSource(id: string): { setCoordinates(coordinates: ImageOverlayCoordinates): void } | undefined;
  fitBounds(bounds: unknown, options: { padding: number }): void;
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

export function createMapGlImageAlignmentMap(map: MapGlAlignmentMapLike, MarkerCtor: MapGlMarkerConstructor, BoundsCtor: MapGlBoundsConstructor): ImageAlignmentMap {
  let imageSource: { setCoordinates(coordinates: ImageOverlayCoordinates): void } | undefined;

  return {
    on: (type, handler) => map.on(type, handler),
    resize: () => map.resize(),
    remove: () => map.remove(),
    getCanvas: () => map.getCanvas(),
    unproject: (point) => {
      const lngLat = map.unproject(point);
      return { lat: lngLat.lat, lng: lngLat.lng };
    },
    addImageOverlay: (imageUrl, coordinates, opacity) => {
      map.addSource('overlay-image', {
        type: 'image',
        url: imageUrl,
        coordinates
      });
      map.addLayer({
        id: 'overlay-layer',
        type: 'raster',
        source: 'overlay-image',
        paint: {
          'raster-opacity': opacity,
          'raster-fade-duration': 0
        }
      });
      imageSource = map.getSource('overlay-image');
    },
    updateImageOverlay: (coordinates) => imageSource?.setCoordinates(coordinates),
    createMarker: (position, element) => new MarkerCtor({
      element,
      draggable: true,
      anchor: 'center'
    })
      .setLngLat([position.lng, position.lat])
      .addTo(map),
    fitBounds: (corners) => {
      const bounds = new BoundsCtor();
      bounds.extend([corners.nw.lng, corners.nw.lat]);
      bounds.extend([corners.ne.lng, corners.ne.lat]);
      bounds.extend([corners.se.lng, corners.se.lat]);
      bounds.extend([corners.sw.lng, corners.sw.lat]);
      map.fitBounds(bounds, { padding: 50 });
    },
    zoomIn: () => map.zoomIn?.(),
    zoomOut: () => map.zoomOut?.()
  };
}

const MARKER_COLORS = {
  nw: '#FF0000',
  ne: '#00FF00',
  se: '#0000FF',
  sw: '#FFFF00'
} as const;

export class ImageOverlayAlignmentRunner {
  constructor(private app: App, private adapter: ImageOverlayAlignmentAdapter) {}

  process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const container = el.createDiv({ cls: "places-overlay-alignment-container" });
    const ownerWindow = container.ownerDocument.defaultView ?? activeWindow;
    const settings = parseImageOverlayAlignmentSettings(source);

    // Obsidian tears down (and re-runs) code blocks by unloading their render child. Tying all
    // disposal to this child is what frees the map, its window listeners, and the ResizeObserver
    // on re-render.
    const renderChild = new MarkdownRenderChild(container);
    ctx.addChild(renderChild);

    if (!settings.image) {
      renderError(container, {
        icon: "🖼️",
        title: "No Image Specified",
        message: 'Use overlays with path plus bounds or corners.',
        className: "image-align-error"
      });
      return;
    }

    const imagePath = settings.image;
    const sectionInfo = ctx.getSectionInfo(el);
    const sessionKey = imageOverlayAlignmentSessionKey({
      path: ctx.sourcePath,
      lineStart: sectionInfo?.lineStart,
    }, imagePath);

    if (this.adapter.missingConfiguration) {
      renderError(container, {
        icon: "🔑",
        title: this.adapter.missingConfiguration.title,
        message: this.adapter.missingConfiguration.message,
        className: "image-align-error"
      });
      return;
    }

    const mapContainer = container.createDiv({ cls: "places-overlay-alignment-map" });
    mapContainer.setCssProps({
      height: settings.height || "500px",
      width: "100%"
    });

    const coordsContainer = container.createDiv({ cls: "places-overlay-alignment-coords" });
    const coordsOutput = coordsContainer.createEl("pre");
    coordsOutput.setCssProps({
      backgroundColor: "var(--background-secondary)",
      padding: "10px",
      borderRadius: "4px",
      fontSize: "12px",
      fontFamily: "monospace",
      overflowX: "auto",
      marginBottom: "10px"
    });

    let activeMap: ImageAlignmentMap | null = null;
    void this.loadImageResource(imagePath).then((resource) => {
      const imageUrl = resource.url;
      const map = this.adapter.createMap(mapContainer, settings);
      activeMap = map;
      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(mapContainer);
      renderChild.register(() => {
        if (activeMap === map) {
          map.remove();
          activeMap = null;
        }
      });
      renderChild.register(() => resizeObserver.disconnect());
      if (resource.revoke) renderChild.register(resource.revoke);

      // On mobile a marker drag or map gesture must not reach Obsidian's document-level swipe handlers
      // (which open the sidebar / command palette). MapLibre processes the touch on its inner canvas
      // container first: stopping propagation on the outer container blocks Obsidian while leaving
      // the marker drag and map pan intact.
      const stopTouchPropagation = (event: TouchEvent) => event.stopPropagation();
      renderChild.registerDomEvent(mapContainer, 'touchstart', stopTouchPropagation);
      renderChild.registerDomEvent(mapContainer, 'touchmove', stopTouchPropagation);
      renderChild.registerDomEvent(mapContainer, 'touchend', stopTouchPropagation);

      // When the note has no coordinates yet, the image is placed in the current
      // view on load rather than jumping to a fixed default location.
      const positionedCorners = getImageOverlayAlignmentSessionCorners(sessionKey) ?? settings.initialCorners;
      const hasPositionedCorners = !!positionedCorners;
      const corners: ImageOverlayAlignmentCorners = positionedCorners
        ? cloneImageOverlayAlignmentCorners(positionedCorners)
        : { nw: { lat: 0, lng: 0 }, ne: { lat: 0, lng: 0 }, se: { lat: 0, lng: 0 }, sw: { lat: 0, lng: 0 } };

      const markers: Partial<Record<keyof ImageOverlayAlignmentCorners, ImageAlignmentMarker>> = {};
      let updateScheduled = false;
      let lastCoordsUpdate = 0;
      let isDraggingImage = false;
      let dragStartPoint: ImageOverlayAlignmentCorner | null = null;

      const setMarkersToCorners = () => {
        markers.nw?.setLngLat([corners.nw.lng, corners.nw.lat]);
        markers.ne?.setLngLat([corners.ne.lng, corners.ne.lat]);
        markers.se?.setLngLat([corners.se.lng, corners.se.lat]);
        markers.sw?.setLngLat([corners.sw.lng, corners.sw.lat]);
      };

      const updateImageOverlay = (immediate = false) => {
        const doUpdate = () => {
          map.updateImageOverlay(cornersToCoordinates(corners));
          setImageOverlayAlignmentSessionCorners(sessionKey, corners);

          const now = Date.now();
          if (immediate || now - lastCoordsUpdate > 150) {
            coordsOutput.textContent = formatImageOverlayAlignmentOutput(imagePath, corners);
            lastCoordsUpdate = now;
          }

          updateScheduled = false;
        };

        if (immediate) {
          doUpdate();
        } else if (!updateScheduled) {
          updateScheduled = true;
          window.requestAnimationFrame(doUpdate);
        }
      };

      map.on('load', () => {
        if (!hasPositionedCorners) {
          Object.assign(corners, computeCenteredCorners(map, resource.aspectRatio));
          setImageOverlayAlignmentSessionCorners(sessionKey, corners);
        }
        map.addImageOverlay(imageUrl, cornersToCoordinates(corners), settings.opacity ?? 1.0);
        coordsOutput.textContent = formatImageOverlayAlignmentOutput(imagePath, corners);

        // Track modifier keys at the window level, letting corner-marker drags (whose
        // drag events carry no DOM event) scale (Shift) and rotate (Alt) too.
        let shiftHeld = false;
        let altHeld = false;
        const trackModifiers = (event: KeyboardEvent) => {
          shiftHeld = event.shiftKey;
          altHeld = event.altKey;
        };
        renderChild.registerDomEvent(ownerWindow, 'keydown', trackModifiers, true);
        renderChild.registerDomEvent(ownerWindow, 'keyup', trackModifiers, true);

        // Reference distance/angle of the dragged marker, captured across a drag
        // for Shift/Alt to transform the whole image around its center.
        let markerDragRef: { dist: number; angle: number } | null = null;

        for (const corner of Object.keys(MARKER_COLORS) as Array<keyof ImageOverlayAlignmentCorners>) {
          const marker = map.createMarker(corners[corner], createCornerMarkerElement(MARKER_COLORS[corner]));
          marker.on('drag', () => {
            const lngLat = marker.getLngLat();
            const point = { lat: lngLat.lat, lng: lngLat.lng };

            if (shiftHeld) {
              const dist = distanceFromCenter(corners, point) || 1;
              if (!markerDragRef) {
                markerDragRef = { dist, angle: 0 };
              } else {
                if (markerDragRef.dist > 0) scaleCorners(corners, dist / markerDragRef.dist);
                markerDragRef.dist = dist;
              }
              setMarkersToCorners();
            } else if (altHeld) {
              const angle = angleFromCenter(corners, point);
              if (!markerDragRef) {
                markerDragRef = { dist: 0, angle };
              } else {
                rotateCorners(corners, angle - markerDragRef.angle);
                markerDragRef.angle = angle;
              }
              setMarkersToCorners();
            } else {
              corners[corner] = point;
            }
            updateImageOverlay();
          });
          marker.on('dragend', () => {
            markerDragRef = null;
            updateImageOverlay(true);
          });
          markers[corner] = marker;
        }

        if (hasPositionedCorners) {
          map.fitBounds(corners);
        }

        const buttonContainer = container.createDiv('places-overlay-alignment-buttons');
        if (this.adapter.showZoomButtons) {
          this.addButton(buttonContainer, 'Zoom in', 'plus', () => map.zoomIn?.());
          this.addButton(buttonContainer, 'Zoom out', 'minus', () => map.zoomOut?.());
        }
        this.addButton(buttonContainer, 'Copy to clipboard', 'clipboard', () => {
          void copyToClipboard(coordsOutput.textContent || "", "Coordinates copied to clipboard");
        });

        const canvas = map.getCanvas();
        let isOverImage = false;

        const isPointerOverImage = (lngLat: ImageOverlayAlignmentCorner) => {
          const inside = pointInPolygon(
            [lngLat.lng, lngLat.lat],
            [
              [corners.nw.lng, corners.nw.lat],
              [corners.ne.lng, corners.ne.lat],
              [corners.se.lng, corners.se.lat],
              [corners.sw.lng, corners.sw.lat]
            ]
          );
          isOverImage = inside;
          return inside;
        };

        // Drag over the image to move it; hold Shift to scale, Alt to rotate (both around the image
        // center). Markers still drag individual corners. These map listeners die with the map.
        let dragMode: 'move' | 'scale' | 'rotate' | null = null;
        let lastScaleDist = 0;
        let lastRotateAngle = 0;

        map.on('mousedown', (event) => {
          // Corner-marker drags ride the same map mousedown (MapLibre's draggable Marker handles the
          // event and preventDefaults it); markers register first, and a claimed gesture is skipped here
          // instead of starting a competing image drag.
          if (event.defaultPrevented) return;
          if (!isPointerOverImage(event.lngLat)) return;

          event.preventDefault();
          isDraggingImage = true;
          const point = event.lngLat;
          if (event.originalEvent.shiftKey) {
            dragMode = 'scale';
            lastScaleDist = distanceFromCenter(corners, point) || 1;
            canvas.setCssProps({ cursor: 'nwse-resize' });
          } else if (event.originalEvent.altKey) {
            dragMode = 'rotate';
            lastRotateAngle = angleFromCenter(corners, point);
            canvas.setCssProps({ cursor: 'grabbing' });
          } else {
            dragMode = 'move';
            dragStartPoint = point;
            canvas.setCssProps({ cursor: 'move' });
          }
        });

        map.on('mousemove', (event) => {
          const point = event.lngLat;
          if (!isDraggingImage || !dragMode) {
            const over = isPointerOverImage(point);
            canvas.setCssProps({ cursor: over ? (event.originalEvent.shiftKey ? 'nwse-resize' : 'grab') : '' });
            return;
          }

          if (dragMode === 'move' && dragStartPoint) {
            translateCorners(corners, point.lng - dragStartPoint.lng, point.lat - dragStartPoint.lat);
            dragStartPoint = point;
          } else if (dragMode === 'scale') {
            const dist = distanceFromCenter(corners, point);
            if (dist > 0 && lastScaleDist > 0) scaleCorners(corners, dist / lastScaleDist);
            lastScaleDist = dist || lastScaleDist;
          } else if (dragMode === 'rotate') {
            const angle = angleFromCenter(corners, point);
            rotateCorners(corners, angle - lastRotateAngle);
            lastRotateAngle = angle;
          }

          setMarkersToCorners();
          updateImageOverlay();
        });

        // End the drag on document mouseup (a release outside the map would never reach a map-level
        // mouseup, leaving the drag stuck) and on window blur (release outside the window entirely).
        const endImageDrag = () => {
          if (!isDraggingImage) return;

          isDraggingImage = false;
          dragMode = null;
          dragStartPoint = null;
          canvas.setCssProps({ cursor: isOverImage ? 'grab' : '' });
          updateImageOverlay(true);
        };
        renderChild.registerDomEvent(container.ownerDocument, 'mouseup', endImageDrag);
        renderChild.registerDomEvent(ownerWindow, 'blur', endImageDrag);

        map.on('wheel', (event) => {
          if (!isPointerOverImage(event.lngLat)) return;

          event.preventDefault();

          scaleCorners(corners, -event.originalEvent.deltaY > 0 ? 1.05 : 0.95);
          setMarkersToCorners();
          updateImageOverlay(true);
        });

        container.setAttribute('tabindex', '0');
        container.setCssProps({ outline: 'none' });

        const handleKeydown = (event: KeyboardEvent) => {
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          const step = event.shiftKey ? 0.0001 : 0.00001;
          const delta = getArrowKeyDelta(event.key, step);
          translateCorners(corners, delta.lng, delta.lat);
          setMarkersToCorners();
          updateImageOverlay(true);
        };

        renderChild.registerDomEvent(container, 'keydown', handleKeydown);

        const hint = container.createDiv({ cls: 'places-overlay-alignment-hint' });
        hint.setText('Drag to move · Shift-drag to scale · Alt-drag to rotate · scroll to zoom the image. Plain-drag a corner to skew, or Shift/Alt-drag a corner to scale/rotate. Copy the coordinates into a places block when done.');
      });
    }).catch((error) => {
      activeMap?.remove();
      activeMap = null;
      coordsContainer.remove();
      renderMapSurfaceError(mapContainer, {
        icon: "⚠️",
        title: "Error Loading Overlay",
        message: getErrorMessage(error),
        className: "image-align-error"
      });
    });
  }

  // External http(s) images are fetched through Obsidian's requestUrl (no CORS) and
  // served as an object URL, since GL image sources cannot load cross-origin
  // images that lack CORS headers. Vault files use their resource path.
  private async loadImageResource(path: string): Promise<{ url: string; aspectRatio: number; revoke?: () => void }> {
    let url: string;
    let revoke: (() => void) | undefined;

    if (path.startsWith('http://') || path.startsWith('https://')) {
      const response = await requestUrl({ url: path });
      const contentType = response.headers?.['content-type'] || response.headers?.['Content-Type'] || 'image/*';
      const blob = new Blob([response.arrayBuffer], { type: contentType });
      url = URL.createObjectURL(blob);
      revoke = () => URL.revokeObjectURL(url);
    } else if (path.startsWith('data:')) {
      url = path;
    } else {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!file) throw new Error(`Image file not found in vault: ${path}`);
      if (!(file instanceof TFile)) throw new Error(`Path is not a file: ${path}`);
      url = this.app.vault.getResourcePath(file);
    }

    const aspectRatio = await loadImageAspectRatio(url).catch(() => 1);
    return { url, aspectRatio, revoke };
  }

  private addButton(container: HTMLElement, label: string, icon: string, onClick: () => void): void {
    const button = container.createDiv('places-floating-button');
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    button.addEventListener('click', onClick);
  }

}

function cloneImageOverlayAlignmentCorners(corners: ImageOverlayAlignmentCorners): ImageOverlayAlignmentCorners {
  return {
    nw: { ...corners.nw },
    ne: { ...corners.ne },
    se: { ...corners.se },
    sw: { ...corners.sw },
  };
}

function getImageOverlayAlignmentSessionRegistry(): ImageOverlayAlignmentSessionRegistry {
  return sharedRegistryMap<string, ImageOverlayAlignmentCorners>(ALIGNMENT_SESSION_REGISTRY_KEY);
}

function loadImageAspectRatio(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1);
    img.onerror = () => reject(new Error('Could not load image to measure its dimensions'));
    img.src = url;
  });
}

// Place the image as a centered rectangle in the map's current view, sized to
// roughly half the viewport while keeping the image's aspect ratio.
function computeCenteredCorners(map: ImageAlignmentMap, aspectRatio: number): ImageOverlayAlignmentCorners {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width || 800;
  const height = canvas.clientHeight || canvas.height || 500;

  let rectW = width * 0.5;
  let rectH = rectW / (aspectRatio || 1);
  if (rectH > height * 0.7) {
    rectH = height * 0.7;
    rectW = rectH * (aspectRatio || 1);
  }

  const cx = width / 2;
  const cy = height / 2;
  return {
    nw: map.unproject([cx - rectW / 2, cy - rectH / 2]),
    ne: map.unproject([cx + rectW / 2, cy - rectH / 2]),
    se: map.unproject([cx + rectW / 2, cy + rectH / 2]),
    sw: map.unproject([cx - rectW / 2, cy + rectH / 2]),
  };
}

export function parseImageOverlayAlignmentSettings(source: string): ImageOverlayAlignmentSettings {
  const parsed = parseCodeBlockYaml(source);
  const settings: ImageOverlayAlignmentSettings = {};

  const overlayValue = parsed.overlays;
  if (overlayValue !== undefined) {
    const overlay = firstImageOverlayDefinition(overlayValue);
    if (overlay.path) {
      settings.image = overlay.path;
      if (overlay.bounds) {
        settings.initialCorners = requireImageOverlayCoordinates(overlay.bounds, 'bounds');
      } else if (overlay.corners) {
        settings.initialCorners = requireImageOverlayCoordinates(overlay.corners, 'corners');
      }
      if (overlay.opacity !== undefined) {
        settings.opacity = overlay.opacity;
      }
    }
  }

  if (typeof parsed.height === 'string' || typeof parsed.height === 'number') settings.height = String(parsed.height);
  if (typeof parsed.style === 'string') settings.style = parsed.style;
  if (typeof parsed.opacity === 'number') settings.opacity = parsed.opacity;
  if (typeof parsed.initialZoom === 'number') settings.initialZoom = parsed.initialZoom;
  if (typeof parsed.initialCenter === 'string') {
    const coordinate = parseCoordinate(parsed.initialCenter);
    if (coordinate) settings.initialCenter = [coordinate.longitude, coordinate.latitude];
  }

  return settings;
}

function firstImageOverlayDefinition(value: unknown): { path?: string; bounds?: string; corners?: string; opacity?: number } {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (!isRecord(first)) {
    throw new Error('overlays must be a mapping or a list of mappings.');
  }

  const result: { path?: string; bounds?: string; corners?: string; opacity?: number } = {};
  if (typeof first.path === 'string') result.path = first.path;
  if (typeof first.bounds === 'string') result.bounds = first.bounds;
  if (typeof first.corners === 'string') result.corners = first.corners;
  if (isRecord(first.style) && typeof first.style.opacity === 'number') result.opacity = first.style.opacity;
  if (!result.path) {
    throw new Error('The first overlays entry requires a text path.');
  }
  return result;
}

export function parseImageOverlayCoordinates(value: string): ImageOverlayAlignmentCorners | undefined {
  const coords = value.split(',').map(v => parseFloat(v.trim()));

  if (coords.length === 4 && coords.every(c => !isNaN(c))) {
    let [swLat, swLng, neLat, neLng] = coords;
    if (swLat > neLat) [swLat, neLat] = [neLat, swLat];
    if (swLng > neLng) [swLng, neLng] = [neLng, swLng];
    return {
      nw: { lat: neLat, lng: swLng },
      ne: { lat: neLat, lng: neLng },
      se: { lat: swLat, lng: neLng },
      sw: { lat: swLat, lng: swLng }
    };
  }

  if (coords.length === 8 && coords.every(c => !isNaN(c))) {
    return {
      nw: { lat: coords[0], lng: coords[1] },
      ne: { lat: coords[2], lng: coords[3] },
      sw: { lat: coords[4], lng: coords[5] },
      se: { lat: coords[6], lng: coords[7] }
    };
  }

  return undefined;
}

function requireImageOverlayCoordinates(value: string, key: 'bounds' | 'corners'): ImageOverlayAlignmentCorners {
  const coordinates = parseImageOverlayCoordinates(value);
  if (!coordinates) {
    const expected = key === 'bounds' ? 4 : 8;
    throw new Error(`${key} requires ${expected} comma-separated numeric coordinates.`);
  }
  return coordinates;
}

export function formatImageOverlayAlignmentOutput(image: string, corners: ImageOverlayAlignmentCorners): string {
  const format = (n: number) => n.toFixed(6);
  const cornersStr = `${format(corners.nw.lat)},${format(corners.nw.lng)},${format(corners.ne.lat)},${format(corners.ne.lng)},${format(corners.sw.lat)},${format(corners.sw.lng)},${format(corners.se.lat)},${format(corners.se.lng)}`;
  let output = [
    'overlays:',
    `  - path: ${JSON.stringify(image)}`,
    `    corners: ${cornersStr}`,
  ].join('\n');

  const isAxisAligned =
    Math.abs(corners.nw.lat - corners.ne.lat) < 0.000001 &&
    Math.abs(corners.sw.lat - corners.se.lat) < 0.000001 &&
    Math.abs(corners.nw.lng - corners.sw.lng) < 0.000001 &&
    Math.abs(corners.ne.lng - corners.se.lng) < 0.000001;
  const hasValidWidth = Math.abs(corners.ne.lng - corners.nw.lng) > 0.00001;
  const hasValidHeight = Math.abs(corners.nw.lat - corners.sw.lat) > 0.00001;
  const isValidShape = hasValidWidth && hasValidHeight;

  if (isAxisAligned && isValidShape) {
    const boundsStr = `${format(corners.sw.lat)},${format(corners.sw.lng)},${format(corners.ne.lat)},${format(corners.ne.lng)}`;
    output += [
      '',
      '',
      'overlays:',
      `  - path: ${JSON.stringify(image)}`,
      `    bounds: ${boundsStr}`,
    ].join('\n');
  }

  if (!isValidShape) {
    output += '\n\n⚠️ Warning: Image has near-zero ';
    if (!hasValidWidth && !hasValidHeight) {
      output += 'width and height';
    } else if (!hasValidWidth) {
      output += 'width';
    } else {
      output += 'height';
    }
    output += '. Drag corner markers to create a valid shape.';
  }

  return output;
}

export function cornersToCoordinates(corners: ImageOverlayAlignmentCorners): ImageOverlayCoordinates {
  return [
    [corners.nw.lng, corners.nw.lat],
    [corners.ne.lng, corners.ne.lat],
    [corners.se.lng, corners.se.lat],
    [corners.sw.lng, corners.sw.lat]
  ];
}

function createCornerMarkerElement(color: string): HTMLElement {
  const el = createDiv();
  el.setCssProps({
    width: '20px',
    height: '20px',
    backgroundColor: color,
    border: '2px solid white',
    borderRadius: '50%',
    cursor: 'move',
    // Handle the touch as a drag; stop the browser from treating it as a scroll/pan gesture.
    touchAction: 'none',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
    transition: 'none'
  });
  return el;
}

function pointInPolygon(point: number[], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

function translateCorners(corners: ImageOverlayAlignmentCorners, deltaLng: number, deltaLat: number): void {
  for (const corner of Object.values(corners)) {
    corner.lng += deltaLng;
    corner.lat += deltaLat;
  }
}

function getCornersCenter(corners: ImageOverlayAlignmentCorners): ImageOverlayAlignmentCorner {
  return {
    lng: (corners.nw.lng + corners.ne.lng + corners.se.lng + corners.sw.lng) / 4,
    lat: (corners.nw.lat + corners.ne.lat + corners.se.lat + corners.sw.lat) / 4,
  };
}

function scaleCorners(corners: ImageOverlayAlignmentCorners, scaleFactor: number): void {
  const center = getCornersCenter(corners);
  for (const corner of Object.values(corners)) {
    corner.lng = center.lng + (corner.lng - center.lng) * scaleFactor;
    corner.lat = center.lat + (corner.lat - center.lat) * scaleFactor;
  }
}

// Rotate the corners around their center by `angleRad`. Longitude is scaled by
// cos(lat), keeping the on-screen rotation correct away from the equator.
function rotateCorners(corners: ImageOverlayAlignmentCorners, angleRad: number): void {
  const center = getCornersCenter(corners);
  const lngScale = Math.cos(center.lat * DEG_TO_RAD) || 1;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  for (const corner of Object.values(corners)) {
    const dx = (corner.lng - center.lng) * lngScale;
    const dy = corner.lat - center.lat;
    corner.lng = center.lng + (dx * cos - dy * sin) / lngScale;
    corner.lat = center.lat + (dx * sin + dy * cos);
  }
}

// Screen angle (radians) of a point relative to the corners' center.
function angleFromCenter(corners: ImageOverlayAlignmentCorners, point: ImageOverlayAlignmentCorner): number {
  const center = getCornersCenter(corners);
  const lngScale = Math.cos(center.lat * DEG_TO_RAD) || 1;
  return Math.atan2(point.lat - center.lat, (point.lng - center.lng) * lngScale);
}

// Distance from the corners' center, in scaled degrees.
function distanceFromCenter(corners: ImageOverlayAlignmentCorners, point: ImageOverlayAlignmentCorner): number {
  const center = getCornersCenter(corners);
  const lngScale = Math.cos(center.lat * DEG_TO_RAD) || 1;
  const dx = (point.lng - center.lng) * lngScale;
  const dy = point.lat - center.lat;
  return Math.hypot(dx, dy);
}

function getArrowKeyDelta(key: string, step: number): ImageOverlayAlignmentCorner {
  switch (key) {
    case 'ArrowUp':
      return { lng: 0, lat: step };
    case 'ArrowDown':
      return { lng: 0, lat: -step };
    case 'ArrowLeft':
      return { lng: -step, lat: 0 };
    case 'ArrowRight':
      return { lng: step, lat: 0 };
    default:
      return { lng: 0, lat: 0 };
  }
}
