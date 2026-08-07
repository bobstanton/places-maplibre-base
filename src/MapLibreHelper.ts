import { TRACK_STYLE_DEFAULTS, getPlaceId } from "places-shared/track";
import type * as GeoJSON from "geojson";
import { parseMapPlaceProperty } from "places-shared/overlay";
import { MarkerStyleService, buildPopupContent, PopupOptions, attachPopupWheelGuard, createFrequencyPopup as buildFrequencyPopupContent, getZoomRangeClassNames, createContentPopup, closeExistingPopups, GL_POPUP_SELECTOR } from "places-shared/map";
import { DEFAULT_MAP_LABEL_COLOR } from "./TextLabelLayerStyles";
import { isRuntimeDebugEnabled, logRuntimeDebug, logger } from "places-shared/utils";
import { createTextLayerConfig } from './TextLayerConfig';
import { registerPointerCursorLayer, unregisterPointerCursorLayer } from './PointerCursorRegistry';
import type * as maplibregl from 'maplibre-gl';
import { getMapLibreResourceRegistry, reportMapLibreCleanupIssues } from './MapLibreResourceRegistry';
import { getGl } from './GlRuntime';
import type { App } from 'obsidian';

// MapLibre GL 6 supplies missing style images through a resolver instead of the
// on-demand `styleimagemissing` callback, which is now notify-only. maplibre-gl 5
// and mapbox-gl lack the resolver; the base feature-detects and keeps the event
// path for them.
interface MissingStyleImageResolverCapable {
  setMissingStyleImageResolver(resolver: (id: string) => void): void;
}

export interface MapLibrePopupOptions {
  // Passed to buildPopupContent.
  content: PopupOptions;
  coordinates: maplibregl.LngLatLike;
  // Opens internal links.
  app?: App;
  onAdd?: (popup: maplibregl.Popup) => void;
  // Default [0, -15].
  offset?: maplibregl.Offset;
  appendContent?: (container: HTMLElement) => void;
}

export class MapLibreHelper {
  private static readonly inlineCssPropsCache = new Map<string, Record<string, string>>();
  private static readonly inlineCssPropsCacheLimit = 512;

  private static logMarkerStyleDebug(stage: string, payload: Record<string, unknown>): void {
    logRuntimeDebug('marker-style', stage, payload, {
      scope: 'MarkerStyle',
      globalFlag: '__placesMarkerStyleDebug',
      storageKey: 'places.markerStyleDebug',
    });
  }

  private static parseInlineCssProps(css: string): Record<string, string> {
    const cached = this.inlineCssPropsCache.get(css);
    if (cached) {
      return cached;
    }

    const props: Record<string, string> = {};

    for (const declaration of css.split(';')) {
      const separatorIndex = declaration.indexOf(':');
      if (separatorIndex === -1) continue;

      const rawProperty = declaration.slice(0, separatorIndex).trim();
      const value = declaration.slice(separatorIndex + 1).trim();
      if (!rawProperty || !value) continue;

      props[rawProperty] = value;
    }

    if (this.inlineCssPropsCache.size >= this.inlineCssPropsCacheLimit) {
      const oldestKey = this.inlineCssPropsCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.inlineCssPropsCache.delete(oldestKey);
      }
    }
    this.inlineCssPropsCache.set(css, props);
    return props;
  }

  // The wheel guard stops popup scrolling from scrolling the Obsidian note.
  static createBasicPopup(options: maplibregl.PopupOptions = {}): maplibregl.Popup {
    const popup = new (getGl().Popup)(options);
    attachPopupWheelGuard(popup);
    return popup;
  }

  // Marker DOM uses the places-marker classes from places-shared/marker-styles.css.
  static createIconMarker(map: maplibregl.Map, feature: GeoJSON.Feature, clickHandler: (event: Event) => void, showLabel = true): maplibregl.Marker {
    const mapPlace = parseMapPlaceProperty(feature.properties?.mapPlace);

    const container = createDiv({ cls: 'places-marker' });

    if (mapPlace) {
      container.setAttribute('data-place-id', getPlaceId(mapPlace));
      container.classList.add(...getZoomRangeClassNames(mapPlace.iconStyle?.zoom));
    }

    // Without these MapLibre stamps a generic "Map marker" aria-label, which is
    // what shows when the text label is hidden at low zoom.
    const markerName = mapPlace?.name;
    if (markerName) {
      container.setAttribute('aria-label', markerName);
      container.setAttribute('title', markerName);
    }

    if (mapPlace?.dataAttributes) {
      for (const [key, value] of Object.entries(mapPlace.dataAttributes)) {
        container.setAttribute(`data-${MarkerStyleService.sanitizeDataAttributeName(key)}`, value);
      }
    }

    const iconEl = createDiv({ cls: 'places-marker-icon' });
    const icon: unknown = feature.properties?.icon;
    if (typeof icon === 'string' || typeof icon === 'number') {
      iconEl.setText(String(icon));
    }
    container.appendChild(iconEl);

    const iconClasses = mapPlace?.iconStyle?.classes;
    if (iconClasses && iconClasses.length > 0) {
      iconEl.classList.add(...iconClasses);
    }

    const labelStyle = mapPlace?.labelStyle;
    const shouldRenderDomLabel = Boolean(showLabel && mapPlace && (mapPlace.iconStyle?.zoom || labelStyle?.zoom));
    if (shouldRenderDomLabel) {
      const labelEl = createSpan({ cls: 'places-marker-label' });
      if (labelStyle?.hasUserStyle) {
        labelEl.classList.add('places-marker-label-user-style');
      }
      const labelClasses = labelStyle?.classes;
      if (labelClasses && labelClasses.length > 0) {
        labelEl.classList.add(...labelClasses);
      }
      if (labelStyle?.inlineCss) {
        labelEl.setCssProps(this.parseInlineCssProps(labelStyle.inlineCss));
      }
      labelEl.setText(String(feature.properties?.description ?? ''));
      container.appendChild(labelEl);
    }

    // touch-action: manipulation in CSS disables double-tap-to-zoom and its
    // 300ms click delay on mobile.
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      (e as Event & { _markerClicked?: boolean })._markerClicked = true;
      clickHandler(e);
    });

    const marker = new (getGl().Marker)({
      element: container,
      anchor: 'center'
    })
      .setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number])
      .addTo(map);

    const iconStyle = mapPlace?.iconStyle;
    if (iconStyle) {
      const markerEl = marker.getElement();

      // iconStyles should only affect the icon glyph. MapLibre's Marker#setOpacity applies to the
      // whole marker container, which also dims DOM labels and any other marker children.
      if (iconStyle.opacity !== undefined) {
        iconEl.style.opacity = String(iconStyle.opacity);
      }

      if (iconStyle.zIndex !== undefined) {
        markerEl.setCssProps({
          '--places-marker-z-index': String(iconStyle.zIndex)
        });
        markerEl.addClass('places-marker-z-index-custom');
      }

      if (iconStyle.inlineCss) {
        const cssProps = this.parseInlineCssProps(iconStyle.inlineCss);
        this.logMarkerStyleDebug('applying icon inline css', {
          place: mapPlace?.name,
          placeId: mapPlace ? getPlaceId(mapPlace) : undefined,
          metadata: mapPlace?.metadata,
          inlineCss: iconStyle.inlineCss,
          cssProps
        });
        iconEl.setCssProps(cssProps);
        if (isRuntimeDebugEnabled('marker-style', {
          globalFlag: '__placesMarkerStyleDebug',
          storageKey: 'places.markerStyleDebug',
        }) && /(?:drop-shadow|text-shadow)/i.test(iconStyle.inlineCss)) {
          window.requestAnimationFrame(() => {
            this.logMarkerStyleDebug('applied icon inline css', {
              place: mapPlace?.name,
              placeId: mapPlace ? getPlaceId(mapPlace) : undefined,
              styleAttribute: iconEl.getAttribute('style'),
              computedFilter: getComputedStyle(iconEl).filter,
              computedTextShadow: getComputedStyle(iconEl).textShadow,
              computedFontSize: getComputedStyle(iconEl).fontSize
            });
          });
        }
      }

      // Runs last: the inline CSS pass above can set `transform`.
      applyIconRotation(iconEl, mapPlace?.iconRotation, iconStyle.inlineCss);
    } else {
      // Places that skip the style pipeline (previews, Bases) still rotate.
      applyIconRotation(iconEl, mapPlace?.iconRotation);
    }

    return marker;
  }


  static addTextLayer(map: maplibregl.Map, sourceId: string, defaultColor: string = DEFAULT_MAP_LABEL_COLOR, minzoom?: number): void {
    // text-field requires a glyphs URL on the style. setGlyphs is maplibre-only;
    // engines without it (mapbox-gl) always ship styles that already define glyphs.
    const style = map.getStyle();
    if (!style.glyphs && typeof map.setGlyphs === "function") {
      map.setGlyphs("https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf");
    }

    if (!map.getLayer('places-markers')) {
      map.addLayer(createTextLayerConfig({ sourceId, defaultColor, minzoom }) as maplibregl.LayerSpecification);
    }
  }

  static addRouteSource(map: maplibregl.Map): void {
    if (map.getSource("route")) {
      return;
    }

    map.addSource("route", {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      }
    });
  }

  static addBasicRouteLayers(map: maplibregl.Map): void {
    if (!map.getLayer('route-outline')) {
      map.addLayer({
        id: 'route-outline',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': TRACK_STYLE_DEFAULTS.outlineColor,
          'line-width': TRACK_STYLE_DEFAULTS.outlineWeight,
          'line-opacity': TRACK_STYLE_DEFAULTS.outlineOpacity,
          'line-dasharray': TRACK_STYLE_DEFAULTS.dashArray
        }
      });
    }

    if (!map.getLayer('route-path')) {
      map.addLayer({
        id: 'route-path',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': TRACK_STYLE_DEFAULTS.color,
          'line-width': TRACK_STYLE_DEFAULTS.weight,
          'line-opacity': TRACK_STYLE_DEFAULTS.opacity,
          'line-dasharray': TRACK_STYLE_DEFAULTS.dashArray
        }
      });
    }
  }

  static clearExistingTracks(map: maplibregl.Map): void {
    const layers = ['route-path', 'route-outline'];
    const sources = ['route'];
    let segmentIndex = 0;
    while (map.getLayer(`route-segment-${segmentIndex}`)) {
      layers.push(`route-segment-${segmentIndex}`);
      sources.push(`path-segment-${segmentIndex}`);
      segmentIndex++;
    }
    layers.push('path-outline');
    sources.push('path-outline');
    reportMapLibreCleanupIssues(getMapLibreResourceRegistry(map).remove(layers, sources), 'existing track replacement');
  }

  static handleMissingSprites(map: maplibregl.Map): void {
    const addPlaceholder = (id: string): void => {
      const canvas = createEl('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        map.addImage(id, ctx.getImageData(0, 0, 1, 1));
      }
    };
    // maplibre-gl 6 replaced the on-demand `styleimagemissing` callback with a
    // resolver; maplibre-gl 5 and mapbox-gl still fire the event. Grab the method
    // without narrowing `map`, which compiles against either engine major.
    const resolver = (map as Partial<MissingStyleImageResolverCapable>).setMissingStyleImageResolver;
    if (typeof resolver === 'function') {
      resolver.call(map, addPlaceholder);
      return;
    }
    map.on('styleimagemissing', (e) => addPlaceholder(e.id));
  }

  static addPointerCursor(map: maplibregl.Map, layerId: string): void {
    registerPointerCursorLayer(map, layerId);
  }

  static removePointerCursor(map: maplibregl.Map, layerId: string): void {
    unregisterPointerCursorLayer(map, layerId);
  }

  // Close every tracked GL popup in this window. Closing goes through the
  // engine's own Popup.remove(), which unbinds the map listeners that
  // closeOnClick/closeOnMove registered.
  static closeAllPopups(): void {
    closeExistingPopups(GL_POPUP_SELECTOR);
  }

  // Every GL popup reaches its map through this method; PopupController does the routing.
  static openPopup(map: maplibregl.Map, coordinates: maplibregl.LngLatLike, content: HTMLElement, options: { offset?: maplibregl.Offset } = {}): maplibregl.Popup {
    return createContentPopup({
      map,
      coordinates,
      content,
      popupSelector: GL_POPUP_SELECTOR,
      createPopup: () => MapLibreHelper.createBasicPopup({
        offset: options.offset ?? [0, -15],
        className: 'places-popup',
        closeOnClick: true,
        closeOnMove: false,
        focusAfterOpen: false,
      }),
    });
  }

  static createPopup(map: maplibregl.Map, options: MapLibrePopupOptions): maplibregl.Popup {
    // closePopup is captured while the content is built, before the popup it closes exists.
    const popupRef: { current?: maplibregl.Popup } = {};
    const contentDiv = buildPopupContent({ ...options.content, closePopup: () => popupRef.current?.remove() });

    if (options.content.isLink && options.content.linkPath) {
      const link = contentDiv.querySelector('a.internal-link');
      if (link) {
        const linkPath = options.content.linkPath;
        const isUrl = linkPath.startsWith('http://') || linkPath.startsWith('https://');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          // Stop the event reaching Obsidian's delegated internal-link handler, which
          // would otherwise open the same link a second time from the href.
          e.stopPropagation();
          if (isUrl) {
            activeWindow.open(linkPath, '_blank', 'noopener,noreferrer');
          } else if (options.app) {
            void options.app.workspace.openLinkText(linkPath, '');
          }
        });
      }
    }

    if (options.appendContent) {
      options.appendContent(contentDiv);
    }

    const popup = MapLibreHelper.openPopup(map, options.coordinates, contentDiv, { offset: options.offset });
    popupRef.current = popup;

    if (options.onAdd) {
      options.onAdd(popup);
    }

    return popup;
  }

  // Shows how many tracks overlap the point and the contributing files.
  static createFrequencyPopup(map: maplibregl.Map, coordinates: maplibregl.LngLatLike, frequency: number, contributingFiles: string[], app: App): maplibregl.Popup {
    const popupContent = buildFrequencyPopupContent({ frequency, contributingFiles, app });

    return MapLibreHelper.openPopup(map, coordinates, popupContent);
  }

  static fitBounds(map: maplibregl.Map, pathCoords: Array<[number, number]>, padding: number = 50): void {
    if (!pathCoords || pathCoords.length === 0) {
      return;
    }
    
    try {
      const bounds = new (getGl().LngLatBounds)();
      let validCoords = 0;
      
      pathCoords.forEach(coord => {
        if (coord && coord.length === 2 && 
            typeof coord[0] === 'number' && typeof coord[1] === 'number' &&
            !isNaN(coord[0]) && !isNaN(coord[1]) &&
            coord[0] >= -180 && coord[0] <= 180 &&
            coord[1] >= -90 && coord[1] <= 90) {
          bounds.extend(coord);
          validCoords++;
        }
      });
      
      if (validCoords > 0) {
        map.fitBounds(bounds, {
          padding,
          animate: false
        });
      }
    } catch (error) {
      logger.scope('Places').error('Error in fitBounds:', error);
    }
  }
}

// First constant text-font stack declared by the style's own layers. Symbol
// text must use fonts the style's glyph endpoint serves - MapLibre's default
// ("Open Sans Regular") is a 404 on styles such as OpenFreeMap's, which
// renders no text and no error. `bold` prefers a bold stack when
// the style declares one and falls back to any declared stack rather than to
// an unserved font.
export function resolveStyleTextFont(map: { getStyle: () => { layers?: unknown[] } | undefined | null }, options?: { bold?: boolean }): string[] {
  let fallback: string[] | undefined;
  try {
    for (const layer of map.getStyle()?.layers ?? []) {
      const font = (layer as { layout?: Record<string, unknown> }).layout?.['text-font'];
      if (!Array.isArray(font) || font.length === 0 || !font.every(entry => typeof entry === 'string')) continue;
      const stack = font;
      if (!options?.bold) return stack;
      if (stack[0].toLowerCase().includes('bold')) return stack;
      fallback ??= stack;
    }
  } catch {
    // Style not loaded yet.
  }
  return fallback ?? (options?.bold ? ['Noto Sans Bold'] : ['Noto Sans Regular']);
}

// The rotation goes on the inner icon, never the marker container - MapLibre
// positions the container with its own `transform`, and overwriting that would
// move the marker off its coordinate.
export function applyIconRotation(iconEl: HTMLElement, rotationDeg: number | undefined, inlineCss = ''): void {
  if (rotationDeg === undefined) return;

  // Only the angle is set inline; the pivot is a constant on
  // .places-marker-icon in places-shared/marker-styles.css.
  const userTransform = /(?:^|;)\s*transform\s*:\s*([^;]+)/i.exec(inlineCss)?.[1]?.trim();
  iconEl.style.transform = userTransform ? `${userTransform} rotate(${rotationDeg}deg)` : `rotate(${rotationDeg}deg)`;
}
