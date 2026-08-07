import { isStyleHidden } from "places-shared/place";
import { App, Component } from "obsidian";
import type * as GeoJSON from "geojson";
import { loggedRequestUrl as requestUrl } from "places-shared/utils";
import { hasTrackData, getMaxIconScale, type IconBadgeOffset } from "places-shared/place";
import { type UnitsSystem } from "places-shared/units";
import { PlacesBoundingBox, convertPlacesToGeoJSONData } from "places-shared/geo";
import { TRACK_STYLE_DEFAULTS, PlaceTrackState, TrackVisibilityResult, CompleteTrackStyle, getPlaceId, getPlaceMarkerRenderSignature, getPlaceTrackRenderHash, getTrackStateRenderSignature, getStyleForPlace, type TrackColorBy } from "places-shared/track";
import { MapPlace, parseMapPlaceProperty, extendBoundingBoxWithOverlays, extractOverlayPointFeatures as extractOverlayPointFeaturesFromOverlays, getGeoJsonFeatures, type Overlay } from "places-shared/overlay";
import { MIN_ZOOM_FOR_LABELS, ViewportClusteringManager, resolveClusteringDecision, MapStateManager, renderPopupContentCore, buildMultiPlacePopupContent, buildWaypointPopupContent, buildGeocodingSearchPopupContent, createContentPopup, createPlaceSummaryPopup, closeExistingPopups, buildOverlayPointPopupContent, createSourceLinkClickHandler, type MapProviderLifecycle, getMapProviderState, setMapProviderState, clearMapProviderState, TileCache, createGradientColoredGeoJson, setupVectorContextMenu, estimateInitialZoom, updateZoomContainerState, type ZoomRange, ensureMapSurfaceLifecycle, ensureTrackDirectionArrowImage, dispatchMapTrackSelection, onMapTrackSelection, TrackDetailsPanel, TRACK_INSPECTION_REQUEST_EVENT, TRACK_POINT_SELECT_EVENT, toGlMaxZoom, TileFailureMonitor, describeTileFailure } from "places-shared/map";
import { IPlaceExtensionSettings, type MapRenderRequest, type ResolvedMapConfig, DEFAULT_GRADE_WINDOW, type MapToolAttachment, type MapToolFactory, type MetricWindow } from "places-shared/settings";
import { MapBlockProcessorBase, CommonMapSettings, type MapDataUpdateContext, type MapDataUpdateResult, type MapControlHandle, type MapCameraApplyResult, type MapIncrementalUpdateCapabilities } from "places-shared/services";
import { hasOverlayRenderableChanges, hasTrackRenderableChanges, type MapCameraIntent } from "places-shared/render";
import { renderMapSurfaceError, renderMapSupplementalError, parseContributingFiles, MapConstants, logger, getErrorMessage, createPerformanceMonitor, hashString36, nextSharedSequence, sharedRegistryValue, type PerformanceMonitor } from "places-shared/utils";
import type * as maplibregl from 'maplibre-gl';
import { getGl } from './GlRuntime';
import { resolveStyleTextFont, MapLibreHelper } from './MapLibreHelper';
import { MapState, isNonInteractivePlace, hasDisplayableContent } from './MapState';
import { addDebugOverlay, DebugData } from './MapLibreDebugOverlay';
import type { DebugTilesetSummary } from 'places-shared/map';
import { MarkerStyleService } from 'places-shared/map';
import { POIDiscoveryHandler } from './MapLibrePOIDiscovery';
import { MapLibreOverlayHandler } from './MapLibreOverlays';
import { configureMapContainer } from './MapContainerSetup';
import { setupMapTouchHandlers } from './MapTouchHandler';
import { computePlaceMarkerDiff, applyPlaceMarkerDiff, hasPlaceMarkerDiffChanges } from './PlaceMarkerDiff';
import { enterVectorFocusMode, clearVectorFocusMode, focusMapMarkerElement, setVectorGeocodingSearchMarkers, createVectorMapControlHandle, SYMBOL_MARKER_LAYER_ID, SYMBOL_ICON_BASE_OPACITY } from './VectorMapInteractions';
import { handleWebGLContextLost } from './WebGLContextHandler';
import { buildMapLibrePOIFilter, isExpressionFilter, getPOILayerPatterns } from './MapLibrePOIFilter';
import { createPathLabelLayerConfig, createMapLabelPaint } from './TextLabelLayerStyles';
import { setupVectorClusterInteractions } from './VectorClusterLayers';
import { usesNativeMarkerRenderer } from './MarkerRendererPolicy';
import { applyCameraIntent, applyInitialViewport as applyMapInitialViewport, withProgrammaticCamera } from './MapLibreCameraController';
import { applyTerrain } from './MapLibreTerrain';
import { registerPointerCursorLayer } from './PointerCursorRegistry';
import { applyHillshade, applyColorRelief } from './MapLibreRelief';
import { createHeatmapGeoJson, renderHeatmap, type MapLibreHeatmapData } from './MapLibreHeatmapRenderer';
import { recordOverlayVisibility } from './MapLibreOverlayRenderer';
import { removeDynamicOverlay, removeLayersAndSources, removeTrackLayers, setLayerVisibility } from './MapLibreTrackRenderer';

function trackEndpointFeatures(geojson: GeoJSON.GeoJSON): GeoJSON.Feature<GeoJSON.Point>[] {
  const features = geojson.type === 'FeatureCollection' ? geojson.features : geojson.type === 'Feature' ? [geojson] : [];
  const lines: GeoJSON.Position[][] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry?.type === 'LineString') lines.push(geometry.coordinates);
    else if (geometry?.type === 'MultiLineString') lines.push(...geometry.coordinates);
  }
  const nonEmpty = lines.filter(line => line.length > 0);
  if (nonEmpty.length === 0) return [];
  const first = nonEmpty[0][0];
  const lastLine = nonEmpty[nonEmpty.length - 1];
  const last = lastLine[lastLine.length - 1];
  return [
    { type: 'Feature', properties: { _placesTrackEndpoint: '●' }, geometry: { type: 'Point', coordinates: first } },
    { type: 'Feature', properties: { _placesTrackEndpoint: '■' }, geometry: { type: 'Point', coordinates: last } },
  ];
}

interface ActiveMapTool {
  factory: MapToolFactory;
  attachment: MapToolAttachment;
  toolConfig: unknown;
}

const activeMapTools = new WeakMap<maplibregl.Map, Map<string, ActiveMapTool>>();
import { getMapLibreResourceRegistry, reportMapLibreCleanupIssues } from './MapLibreResourceRegistry';
import { createHtmlMarkerFeature as buildHtmlMarkerFeature, createPointFeature as buildPointFeature, updateTextLabelSource } from './MapLibreMarkerRenderer';
import { updateClusteredMarkers } from './MapLibreDataUpdater';

export type MapContainer = HTMLElement;

interface MapLibreProviderState {
  map: maplibregl.Map;
  lifecycle: MapProviderLifecycle;
}

type MapLibreStyle = string | maplibregl.StyleSpecification;
const PLACES_TILE_CACHE_PROTOCOL = 'places-cache';
// Initial camera tilt (degrees) when 3D terrain is enabled without an explicit/saved camera.
const DEFAULT_TERRAIN_PITCH = 60;
// MapLibre's default maxPitch is 60, mapbox-gl's is 85. Passing 85 explicitly unifies the tilt range
// across engines and keeps the up-drag gesture live from the 60° terrain start (a 60° ceiling pinned
// the terrain camera at max pitch, making tilt-further a dead gesture on MapLibre providers).
const MAX_PITCH = 85;

// Source-data event fields the base reads. maplibre-gl 5 (`MapDataEvent`) and 6
// (`MapSourceDataEvent`) expose these under different type names, and a standalone
// shape stays compatible with either engine major.
interface MapSourceDataEvent {
  sourceId?: string;
  isSourceLoaded?: boolean;
}

// GeoJSON feature properties are untyped; only pass through values the paint spec accepts.
const asStyleText = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const asStyleNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const EMOJI_IMAGE_PREFIX = 'places-emoji-';
const SYMBOL_MARKER_ICON_SIZE_PX = 28;
const SYMBOL_IMAGE_CACHE_GLOBAL_KEY = '__placesSymbolImageCache';
const RENDER_SEQUENCE_GLOBAL_KEY = '__placesMapLibreRenderSequence';
const SYMBOL_IMAGE_CACHE_LIMIT = 256;
type SymbolImageCacheEntry = { imageData: ImageData; pixelRatio: number };
type SharedSymbolImageCache = { entries: Map<string, SymbolImageCacheEntry>; limit: number };
type SymbolImagePreparation = {
  uniqueImages: number;
  flush: (reason: 'marker-mode' | 'cleanup') => void;
};
function zoomStopKey(zoom: number): string {
  return String(zoom).replace('.', '_');
}

function collectIconZoomSizeStops(places: MapPlace[]): number[] {
  const stops = new Set<number>();
  for (const place of places) {
    for (const stop of place.iconStyle?.zoomSizeStops ?? []) {
      stops.add(stop.zoom);
    }
  }
  return [...stops].sort((a, b) => a - b);
}

// icon-size for the symbol layer. Zoom-size stops become a camera interpolate whose outputs
// read per-feature scale properties (the ['zoom'] input must sit at the top level: the
// global stop union is baked into the expression and each feature carries its scale at
// every global stop).
function buildSymbolIconSizeExpression(zoomSizeStops: number[]): maplibregl.ExpressionSpecification {
  const base: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'iconScale'], 1];
  if (zoomSizeStops.length === 0) return base;
  if (zoomSizeStops.length === 1) {
    return ['*', base, ['coalesce', ['get', `iconScaleZ${zoomStopKey(zoomSizeStops[0])}`], 1]] as maplibregl.ExpressionSpecification;
  }
  const expression: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const zoom of zoomSizeStops) {
    expression.push(zoom, ['*', base, ['coalesce', ['get', `iconScaleZ${zoomStopKey(zoom)}`], 1]]);
  }
  return expression as maplibregl.ExpressionSpecification;
}

// Per-feature min/max-zoom visibility as filter conditions. ['zoom'] is unrestricted in
// filters (unlike paint/layout) and filters re-evaluate at integer zoom levels - the same
// granularity as the HTML renderer's zoom bucket classes.
function symbolZoomVisibilityConditions(minProp: string, maxProp: string): unknown[] {
  return [
    ['any', ['!', ['has', minProp]], ['>=', ['zoom'], ['get', minProp]]],
    ['any', ['!', ['has', maxProp]], ['<=', ['zoom'], ['get', maxProp]]],
  ];
}

// Icon symbol layer filter. `visibilityDeny` (a live `visible:`-driven hide
// expression) and `extraFilter` are optional leading clauses; the built-in
// icon-hidden and zoom conditions always apply.
function symbolIconFilter(visibilityDeny?: maplibregl.FilterSpecification, extraFilter?: maplibregl.FilterSpecification): maplibregl.FilterSpecification {
  return [
    'all',
    ...(extraFilter ? [extraFilter] : []),
    ...(visibilityDeny ? [visibilityDeny] : []),
    ['!', ['has', 'iconHidden']],
    ...symbolZoomVisibilityConditions('iconMinZoom', 'iconMaxZoom'),
  ] as maplibregl.FilterSpecification;
}

// Icon and label hide together: the same conditions as symbolIconFilter.
function symbolLabelFilter(visibilityDeny?: maplibregl.FilterSpecification): maplibregl.FilterSpecification {
  return [
    'all',
    ...(visibilityDeny ? [visibilityDeny] : []),
    ['!', ['has', 'labelHidden']],
    // The shared label floor, as a condition rather than layer minzoom: this
    // layer carries zoom-ranged labels too, and an author's explicit range
    // must govern - a `zoom: 5-8` label shows at 6, floor notwithstanding.
    ['any', ['has', 'labelMinZoom'], ['has', 'labelMaxZoom'], ['>=', ['zoom'], MIN_ZOOM_FOR_LABELS]],
    ...symbolZoomVisibilityConditions('labelMinZoom', 'labelMaxZoom'),
  ] as maplibregl.FilterSpecification;
}

// Deny-list expression hiding the given placeIds; `undefined` (show all) when the list is empty.
function markerVisibilityDenyExpression(hiddenPlaceIds: readonly string[]): maplibregl.FilterSpecification | undefined {
  if (hiddenPlaceIds.length === 0) return undefined;
  return ['!', ['in', ['get', 'placeId'], ['literal', [...hiddenPlaceIds]]]] as unknown as maplibregl.FilterSpecification;
}

function isIconHidden(place: MapPlace | undefined): boolean {
  return isStyleHidden(place?.iconStyle);
}

// Provider plugins bundle this base independently. The raster cache lives on the shared
// application global to be reusable across MapLibre, Mapbox, MapTiler, and Radar.
function getSharedSymbolImageCache(): SharedSymbolImageCache {
  return sharedRegistryValue<SharedSymbolImageCache>(SYMBOL_IMAGE_CACHE_GLOBAL_KEY, () => ({
    entries: new Map<string, SymbolImageCacheEntry>(),
    limit: SYMBOL_IMAGE_CACHE_LIMIT,
  }));
}

// Handle to a map's viewport trackLayer loader. Tracks auto-shown in bulk are
// rendered into shared style buckets (not one source+layers per track), and
// per-place marker toggle flips membership in the loader's hidden set: a single
// track hides or shows without adding a duplicate overlay.
interface ViewportTrackController {
  // True when this loader owns the track for placeId (feeds toggle routing).
  isManaged: (placeId: string) => boolean;
  isHidden: (placeId: string) => boolean;
  setHidden: (placeId: string, hidden: boolean) => void;
  // Hidden because a markerFilter excluded the place, tracked apart from the
  // user's own toggle: unfiltering restores whatever the user chose.
  setFilterHidden: (placeId: string, hidden: boolean) => void;
}

export abstract class MapLibreProviderBase extends MapBlockProcessorBase {
  protected app: App;
  protected extensionSettings: IPlaceExtensionSettings;
  private poiDiscoveryHandler: POIDiscoveryHandler;
  private overlayHandler: MapLibreOverlayHandler;
  private static tileCacheProtocolRegistered = false;
  private static readonly auditedStyleDocuments = new WeakSet<Document>();
  private static readonly deduplicatedStyleCounts = new WeakMap<Document, number>();
  private initializedMaps = new WeakSet<maplibregl.Map>();
  private viewportTrackCleanups = new WeakMap<maplibregl.Map, () => void>();
  private viewportTrackControllers = new WeakMap<maplibregl.Map, ViewportTrackController>();
  private symbolImagePreparationCleanups = new WeakMap<maplibregl.Map, () => void>();
  // Track-waypoint layer ids per map, mapped to the note each layer's points link back to. Survives layer remove/re-add: re-renders never stack duplicate handlers.
  private wiredWaypointClickLayers = new WeakMap<maplibregl.Map, Map<string, string | undefined>>();
  private waypointClickWiredMaps = new WeakSet<maplibregl.Map>();
  // Track hitarea layer ids per map, mapped to their owning place id (undefined = shared bucket, features carry `_placeId`).
  private trackLineLayers = new WeakMap<maplibregl.Map, Map<string, string | undefined>>();
  private trackLineClickWiredMaps = new WeakSet<maplibregl.Map>();
  private trackInspectionPanels = new WeakMap<maplibregl.Map, TrackDetailsPanel>();
  // Live `markerFilter:` hidden placeIds per map: layer builders and the cluster source re-read it, and it survives recreation.
  private symbolVisibilityHidden = new WeakMap<maplibregl.Map, readonly string[]>();
  // Track visibility the user set by clicking, keyed by place id. Kept apart from
  // the configured `showOnLoad`: a refresh cannot undo a deliberate toggle. Kept
  // apart from the markerFilter hidden set: unfiltering restores what the user
  // chose rather than what the config says.
  private trackUserVisibility = new WeakMap<maplibregl.Map, Map<string, boolean>>();
  // Full clustered-source inputs per map: a live visibility toggle re-derives the visible subset without a rebuild.
  private symbolClusterData = new WeakMap<maplibregl.Map, { features: GeoJSON.Feature[]; renderedPlaces: MapPlace[]; overlayPointFeatures: GeoJSON.Feature[] }>();

  // Native GL symbol markers can toggle whole-marker visibility with setFilter (no marker rebuild).
  readonly supportsLiveMarkerVisibility = true;

  private static nextRenderId(): number {
    return nextSharedSequence(RENDER_SEQUENCE_GLOBAL_KEY);
  }

  private getDocumentStyleAudit(document: Document): Record<string, number> {
    const styleElements = Array.from(document.querySelectorAll<HTMLStyleElement>('style'))
      .filter(style => {
        const text = style.textContent ?? '';
        return text.includes('places-') || text.includes('maplibre') || text.includes('mapboxgl') || text.includes('leaflet');
      });
    const hashCounts = new Map<string, number>();

    for (const style of styleElements) {
      const text = style.textContent ?? '';
      if (!text.trim()) continue;
      const hash = hashString36(text);
      hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
    }

    return {
      documentStyleBlocks: styleElements.length,
      duplicateStyleBlockGroups: Array.from(hashCounts.values()).filter(count => count > 1).length,
      deduplicatedStyleBlocks: MapLibreProviderBase.deduplicatedStyleCounts.get(document) ?? 0,
    };
  }

  // Remove only byte-identical Places/map-engine style tags; provider-specific CSS is untouched.
  private deduplicateDocumentStyles(document: Document): void {
    if (MapLibreProviderBase.auditedStyleDocuments.has(document)) return;
    MapLibreProviderBase.auditedStyleDocuments.add(document);

    const seen = new Set<string>();
    let removed = 0;
    for (const style of Array.from(document.querySelectorAll<HTMLStyleElement>('style'))) {
      const text = style.textContent ?? '';
      if (!text.trim() || !(text.includes('places-') || text.includes('maplibre') || text.includes('mapboxgl') || text.includes('leaflet'))) continue;
      if (seen.has(text)) {
        style.remove();
        removed += 1;
      } else {
        seen.add(text);
      }
    }
    MapLibreProviderBase.deduplicatedStyleCounts.set(document, removed);
    if (removed > 0) {
      logger.scope('MapSurface').debug('Removed duplicate map style blocks', { removed });
    }
  }

  private getMapRuntimeAudit(map: maplibregl.Map, container: HTMLElement): Record<string, number> {
    const style = map.getStyle();
    return {
      mapSources: Object.keys(style.sources ?? {}).length,
      mapLayers: style.layers?.length ?? 0,
      mapMarkerNodes: container.querySelectorAll('.maplibregl-marker, .mapboxgl-marker').length,
      placeMarkerNodes: container.querySelectorAll('.places-marker').length,
      ...this.getDocumentStyleAudit(container.ownerDocument),
    };
  }

  private getRuntimeIdentity(map: maplibregl.Map): Record<string, unknown> {
    const runtime = getGl();
    return {
      provider: this.getProviderClassName(),
      integration: this.getProviderIntegration(),
      engine: this.getProviderClassName() === 'mapbox' ? 'mapbox-gl' : 'maplibre-gl',
      engineVersion: runtime.getVersion?.() ?? 'unknown',
      mapClass: map.constructor?.name ?? 'unknown',
      protocolSupport: typeof runtime.addProtocol === 'function',
    };
  }

  constructor(app: App, extensionSettings: IPlaceExtensionSettings, private readonly units: UnitsSystem, developerMode = false) {
    super();
    this.app = app;
    this.extensionSettings = extensionSettings;
    this.developerMode = developerMode;
    this.poiDiscoveryHandler = new POIDiscoveryHandler();
    this.overlayHandler = new MapLibreOverlayHandler(app, {
      getCacheableTileUrl: (url) => {
        if (!this.supportsTileCache() || !TileCache.isEnabled()) return url;
        this.ensureTileCacheProtocol();
        return this.toCacheProtocolUrl(url);
      }
    });
  }

  protected addMapLibreProtocol(customProtocol: string, loadFn: Parameters<typeof maplibregl.addProtocol>[1]): void {
    getGl().addProtocol?.(customProtocol, loadFn);
  }

protected abstract getStyleUrl(style: string): MapLibreStyle | undefined;
  protected abstract getProviderClassName(): string;

  protected getProviderIntegration(): string {
    return 'maplibre-gl';
  }

  // Construct the underlying map. Providers whose vendor SDK ships a maplibregl.Map
  // subclass (key injection, auth headers, telemetry) override this and return the SDK
  // map; everything else in the base operates on it through the maplibregl.Map interface.
  // The SDK's map class must share this bundle's maplibre-gl instance - either via a peer
  // dependency or a build-time alias - for protocol handlers and prototypes to line up.
  protected constructMap(options: maplibregl.MapOptions): maplibregl.Map {
    return new (getGl().Map)(options);
  }

  private getProviderStateId(): string {
    return `maplibre:${this.getProviderClassName()}`;
  }

  private getMapInstance(container: HTMLElement): maplibregl.Map | undefined {
    return getMapProviderState<MapLibreProviderState>(container, this.getProviderStateId())?.map;
  }

  private attachMapTool(
    map: maplibregl.Map,
    container: HTMLElement,
    request: MapRenderRequest,
    factory: MapToolFactory,
  ): ActiveMapTool | undefined {
    if (factory.engine !== 'maplibre') return undefined;
    const toolConfig = request.config.tools[factory.id];
    const attachment = this.buildMapToolAttachment(map, container, request, factory, toolConfig);
    if (!attachment) return undefined;
    const entry = { factory, attachment, toolConfig };
    const tools = activeMapTools.get(map) ?? new Map<string, ActiveMapTool>();
    activeMapTools.set(map, tools);
    tools.set(factory.id, entry);
    let disposed = false;
    getMapLibreResourceRegistry(map).registerDisposer('disposer', `map-tool:${factory.id}`, () => {
      if (disposed) return;
      disposed = true;
      attachment.destroy();
      if (tools.get(factory.id)?.attachment === attachment) tools.delete(factory.id);
    }, `map-tool:${factory.id}`);
    return entry;
  }

  // Attach one tool, containing a throw. This runs inside the awaited map-load
  // chain, where an escaping error would become an unhandled rejection and abort
  // the rest of the load; a bad `tools.<id>` mapping is reported inline by the
  // block processor's validateToolConfig pass instead.
  private buildMapToolAttachment(
    map: maplibregl.Map,
    container: HTMLElement,
    request: MapRenderRequest,
    factory: MapToolFactory,
    toolConfig: unknown,
  ): MapToolAttachment | undefined {
    try {
      return this.attachMapToolUnguarded(map, container, request, factory);
    } catch (error) {
      logger.scope('MapLibre').error('map tool failed to attach', {
        tool: factory.id,
        source: request.runtime.source.path,
        toolConfig,
        error: getErrorMessage(error),
      });
      return undefined;
    }
  }

  private attachMapToolUnguarded(
    map: maplibregl.Map,
    container: HTMLElement,
    request: MapRenderRequest,
    factory: MapToolFactory,
  ): MapToolAttachment | undefined {
    return factory.attach({
      app: this.app,
      map,
      engineApi: {
        Marker: getGl().Marker,
        runProgrammaticCamera: move => withProgrammaticCamera(map, move),
        getPlacePositionHandle: placeId => {
          const marker = MapState.for(map).getPlaceMarker(placeId);
          if (marker) return { setLngLat: coordinate => { marker.setLngLat(coordinate); } };
          const source = map.getSource<maplibregl.GeoJSONSource>(SYMBOL_MARKER_LAYER_ID);
          if (!source || typeof source.updateData !== 'function') return undefined;
          return {
            setLngLat: coordinate => {
              source.updateData({
                update: [{ id: placeId, newGeometry: { type: 'Point', coordinates: coordinate } }],
              });
            },
          };
        },
        getSelectableTracks: () => MapState.for(map).getCurrentPlaces().filter(place => hasTrackData(place) && Boolean(place.filePath)),
        onTrackSelected: handler => {
          return onMapTrackSelection(container, selection => {
            if (selection.intent === 'preview') handler(selection);
          });
        },
      },
      container,
      source: request.runtime.source,
      config: request.config,
      toolConfig: request.config.tools[factory.id],
      trackLoader: request.runtime.trackLoader,
    });
  }

  private syncMapTools(map: maplibregl.Map, container: HTMLElement, request: MapRenderRequest): MapDataUpdateResult {
    const tools = activeMapTools.get(map) ?? new Map<string, ActiveMapTool>();
    activeMapTools.set(map, tools);
    const factories = new Map(request.runtime.mapTools.filter(factory => factory.engine === 'maplibre').map(factory => [factory.id, factory]));

    for (const [id, active] of [...tools]) {
      const factory = factories.get(id);
      const nextConfig = request.config.tools[id];
      if (!factory || nextConfig === undefined || nextConfig === false) {
        getMapLibreResourceRegistry(map).disposeOwner(`map-tool:${id}`);
        continue;
      }
      if (JSON.stringify(active.toolConfig) === JSON.stringify(nextConfig)) continue;
      if (!active.attachment.update?.({ config: request.config, toolConfig: nextConfig })) {
        return { updated: false, status: 'requires-rebuild', reason: `map tool "${id}" requires rebuild for this configuration change` };
      }
      active.toolConfig = nextConfig;
      active.factory = factory;
    }

    for (const [id, factory] of factories) {
      const toolConfig = request.config.tools[id];
      if (tools.has(id) || toolConfig === undefined || toolConfig === false) continue;
      this.attachMapTool(map, container, request, factory);
    }
    return { updated: true };
  }

  // Override in subclasses to provide style validation.
  protected getSupportedStyles(): string[] {
    return [];
  }

  protected prepareStyle(blockSettings: ResolvedMapConfig): Promise<MapLibreStyle | undefined> {
    return this.prepareCacheableStyle(blockSettings);
  }

  protected supportsTileCache(): boolean {
    // Engines without protocol interception (mapbox-gl) cannot route tile
    // requests through the cache.
    return getGl().addProtocol !== undefined && TileCache.isProviderEnabled(this.getTileCacheProviderName());
  }

  protected getTileCacheProviderName(): string {
    return this.getProviderClassName();
  }

  protected getCacheableResourceUrl(url: string): string {
    return url;
  }

  // Headers to send when the tile cache fetches resources on this provider's
  // behalf (e.g. Radar authenticates with an Authorization header). The
  // protocol handler is registered once per plugin bundle, and the instance that
  // registers it serves all of that plugin's maps.
  protected getCacheableResourceHeaders(): Record<string, string> | undefined {
    return undefined;
  }

  private async prepareCacheableStyle(blockSettings: ResolvedMapConfig): Promise<MapLibreStyle | undefined> {
    const style = this.getStyleUrl(blockSettings.style);
    if (!style || !this.supportsTileCache() || !TileCache.isEnabled()) return style;

    this.ensureTileCacheProtocol();

    if (typeof style !== 'string') {
      return await this.prepareTileCacheStyle(structuredClone(style));
    }

    if (!style.startsWith('http://') && !style.startsWith('https://')) return style;

    const styleFetchUrl = this.getCacheableResourceUrl(style);
    const response = await TileCache.getOrFetch(styleFetchUrl, async () => {
      const styleResponse = await requestUrl({ url: styleFetchUrl, headers: this.getCacheableResourceHeaders() });
      return {
        arrayBuffer: styleResponse.arrayBuffer,
        contentType: styleResponse.headers['content-type'] || 'application/json',
      };
    });
    const styleSpec = JSON.parse(new TextDecoder().decode(response.arrayBuffer)) as maplibregl.StyleSpecification;
    return this.prepareTileCacheStyle(styleSpec, styleFetchUrl);
  }

  protected ensureTileCacheProtocol(): void {
    if (MapLibreProviderBase.tileCacheProtocolRegistered) return;
    MapLibreProviderBase.tileCacheProtocolRegistered = true;

    this.addMapLibreProtocol(PLACES_TILE_CACHE_PROTOCOL, async (params) => {
      const url = decodeURIComponent(params.url.slice(`${PLACES_TILE_CACHE_PROTOCOL}://`.length));
      const response = await TileCache.getOrFetch(url, async () => {
        return this.fetchCacheableResource(url);
      });
      return { data: response.arrayBuffer };
    });
  }

  private async fetchCacheableResource(url: string): Promise<{ arrayBuffer: ArrayBuffer; contentType?: string }> {
    const headers = this.getCacheableResourceHeaders();
    const remoteResponse = await requestUrl({ url, headers });
    return {
      arrayBuffer: remoteResponse.arrayBuffer,
      contentType: remoteResponse.headers['content-type'],
    };
  }

  private async prepareTileCacheStyle(style: maplibregl.StyleSpecification, baseUrl?: string): Promise<maplibregl.StyleSpecification> {
    for (const source of Object.values(style.sources ?? {})) {
      const sourceConfig = source as Record<string, unknown>;
      if (typeof sourceConfig.url === 'string') {
        await this.inlineTileJson(sourceConfig, baseUrl);
      }
      if (Array.isArray(sourceConfig.tiles)) {
        sourceConfig.tiles = sourceConfig.tiles.map((tileUrl: unknown) =>
          typeof tileUrl === 'string' ? this.toCacheProtocolUrl(tileUrl, baseUrl) : tileUrl
        );
      }
    }

    return style;
  }

  private async inlineTileJson(sourceConfig: Record<string, unknown>, baseUrl?: string): Promise<void> {
    const sourceUrl = this.resolveRemoteUrl(sourceConfig.url as string, baseUrl);
    if (!sourceUrl) return;

    const sourceFetchUrl = this.getCacheableResourceUrl(sourceUrl);
    const response = await TileCache.getOrFetch(sourceFetchUrl, async () => {
      const sourceResponse = await requestUrl({ url: sourceFetchUrl });
      return {
        arrayBuffer: sourceResponse.arrayBuffer,
        contentType: sourceResponse.headers['content-type'] || 'application/json',
      };
    });
    const tileJson = JSON.parse(new TextDecoder().decode(response.arrayBuffer)) as Record<string, unknown>;

    delete sourceConfig.url;
    for (const key of ['tiles', 'minzoom', 'maxzoom', 'bounds', 'scheme', 'attribution', 'vector_layers']) {
      if (tileJson[key] !== undefined) {
        sourceConfig[key] = tileJson[key];
      }
    }
  }

  protected toCacheProtocolUrl(url: string, baseUrl?: string): string {
    const resolved = this.resolveRemoteUrl(url, baseUrl);
    if (!resolved) return url;
    return `${PLACES_TILE_CACHE_PROTOCOL}://${this.encodeTemplateUrl(this.getCacheableResourceUrl(resolved))}`;
  }

  private applyInitialViewport(map: maplibregl.Map, bounds: [[number, number], [number, number]], request: MapRenderRequest, padding: number): void {
    applyMapInitialViewport({
      map,
      bounds,
      request,
      padding,
    });
  }

  private encodeTemplateUrl(url: string): string {
    return encodeURIComponent(url)
      .replace(/%7B/g, '{')
      .replace(/%7D/g, '}');
  }

  private resolveRemoteUrl(url: string, baseUrl?: string): string | null {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (!baseUrl) return null;
    try {
      const resolved = new URL(url, baseUrl).href;
      return resolved.startsWith('http://') || resolved.startsWith('https://') ? resolved : null;
    } catch {
      return null;
    }
  }

  processPlaceCodeBlock(places: MapPlace[], mapContainerElement: HTMLElement, request: MapRenderRequest): Promise<void> {
    // Returning the promise is what makes callers (renderMapSurface) await the render. Otherwise the map
    // state is registered after they continue, and anything needing it (e.g. the floating search
    // buttons' control handle) races and loses for providers that await a style fetch.
    return this.processPlaceCodeBlockAsync(places, mapContainerElement, request);
  }

  private async processPlaceCodeBlockAsync(places: MapPlace[], mapContainerElement: HTMLElement, request: MapRenderRequest): Promise<void> {
    const blockSettings = request.config;
    const runtime = request.runtime;
    const loadStartTime = Date.now();
    const renderId = MapLibreProviderBase.nextRenderId();
    const perf = createPerformanceMonitor('maplibre-render', {
      renderId,
      provider: this.getProviderClassName(),
      source: runtime.source.path,
      places: places.length,
      overlays: runtime.overlays.length,
      trackDefaultVisibility: blockSettings.trackDefaultVisibility,
    }, { enabled: this.developerMode });
    perf.mark('start');

    perf.measure('setup-container', () => this.setupMapContainer(mapContainerElement, blockSettings));

    const settings = this.extractCommonSettings(blockSettings, runtime);
    const isHeatmapLayer = blockSettings.heatmapLayer;
    const prepared = perf.measure('prepare-geojson', () => isHeatmapLayer
      ? createHeatmapGeoJson(places, blockSettings.heatmapColorScheme || 'heat')
      : convertPlacesToGeoJSONData(places, { serializePlace: false }));
    const geoJsonData = prepared[0];
    // Live marker-filter: all places stay in the source, but the construction fit
    // frames only the currently-visible subset, matching a statically-filtered
    // map's bounds. Rendering still uses geoJsonData (every place).
    const hiddenIds = runtime.markerVisibilityHiddenIds;
    let boundingBox = prepared[1];
    if (!isHeatmapLayer && hiddenIds && hiddenIds.length > 0) {
      const hiddenSet = new Set(hiddenIds);
      const visiblePlaces = places.filter(place => !hiddenSet.has(getPlaceId(place)));
      if (visiblePlaces.length > 0) {
        boundingBox = convertPlacesToGeoJSONData(visiblePlaces, { serializePlace: false })[1];
      }
    }

    this.extendBoundsWithOverlays(boundingBox, runtime.overlays, blockSettings.debug);

    // prepareStyle() when a platform needs style resources fetched or rewritten.
    let styleUrl: MapLibreStyle | undefined;
    try {
      styleUrl = await perf.measureAsync('prepare-style', () => this.prepareStyle(blockSettings));
    } catch (error) {
      logger.scope('MapLibre').error('Error preparing map style:', error);
      styleUrl = this.getStyleUrl(blockSettings.style);
    }
    if (!styleUrl) {
      this.showStyleError(mapContainerElement, blockSettings);
      return;
    }

    // Create map at the best-known final viewport to avoid loading throwaway
    // tiles at the fallback zoom before fitBounds/state restoration runs.
    // 3D terrain needs a tilted camera to be visible, and implies pitch gestures.
    const terrainEnabled = Boolean(runtime.terrainDem);
    const allowPitch = blockSettings.pitch || terrainEnabled;
    const map = perf.measure('create-map', () => this.createMapInstance(mapContainerElement, styleUrl, boundingBox, allowPitch, blockSettings, runtime.camera, terrainEnabled), {
      initialZoom: runtime.camera.kind === 'explicit' ? runtime.camera.zoom : 'bounds',
    });
    MapState.for(map).setCurrentRenderRequest(request);
    this.deduplicateDocumentStyles(mapContainerElement.ownerDocument);
    const runtimeIdentity = this.getRuntimeIdentity(map);
    logger.scope('MapSurface').debug('GL map runtime created', {
      renderId,
      source: runtime.source.path,
      ...runtimeIdentity,
    });

    const surfaceLifecycle = ensureMapSurfaceLifecycle(mapContainerElement);
    surfaceLifecycle.reportCreated();

    const component = this.createMapComponent(mapContainerElement);
    let disposed = false;
    const providerStateId = this.getProviderStateId();
    const lifecycle: MapProviderLifecycle = {
      cleanup: () => component.unload(),
      hasActiveInstance: () => !disposed
    };
    setMapProviderState<MapLibreProviderState>(mapContainerElement, providerStateId, { map, lifecycle });

    component.register(() => {
      disposed = true;
      reportMapLibreCleanupIssues(getMapLibreResourceRegistry(map).disposeAll(), 'surface disposal');
      this.symbolImagePreparationCleanups.get(map)?.();
      this.symbolImagePreparationCleanups.delete(map);
      MapState.for(map).getClusteringManager()?.destroy();
      MapState.cleanup(map);
      map.remove();
      clearMapProviderState(mapContainerElement, providerStateId);
      surfaceLifecycle.reportDestroyed();
    });
    // Setup and disposal registered together on the lifecycle owner: the document/scroll listeners
    // cannot leak on any path - error paths that never reach this point never install them either.
    component.register(setupMapTouchHandlers({ mapContainer: mapContainerElement }));
    component.load();

    // On mobile the container may have zero dimensions when the map initialises
    // (layout not yet finalised), and the initial load-event resize() is a no-op;
    // the ResizeObserver fires once the container gets its dimensions.
    // resize() fires move events; the guard keeps them from counting as user camera activity.
    const resizeObserver = new ResizeObserver((entries) => {
      withProgrammaticCamera(map, () => map.resize());
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) surfaceLifecycle.reportSize(rect.width, rect.height);
    });
    resizeObserver.observe(mapContainerElement);
    component.register(() => resizeObserver.disconnect());

    this.setupZoomVariable(map, mapContainerElement, perf);

    this.setupStatePersistence(map, runtime.source);
    this.setupCameraGestureTracking(map, mapContainerElement);

    this.setupEventHandlers(map, settings, blockSettings.poiFilterPatterns);
    MapLibreHelper.handleMissingSprites(map);
    map.on("error", (e) => logger.scope('MapLibre').error('Map error', this.sanitizeMapError(e.error)));
    this.setupTileFailureReporting(map);

    const readyTimeoutMs = 10000;
    const ownerWindow = mapContainerElement.ownerDocument.defaultView;
    if (!ownerWindow) throw new Error('Map container is not attached to a window.');
    // Full-'load' telemetry (style + initial viewport tiles). Kept SEPARATE from
    // provider setup below: markers and layers only need the style, not the
    // tiles, and are added on style readiness. Moving this telemetry changes the
    // meaning of the map-load/render/idle metrics and the lifecycle 'loaded'
    // signal the surface controller uses for camera policy.
    void map.once("load", () => {
      perf.mark('map-load', { zoom: map.getZoom() });
      this.profileNextRenderAndIdle(map, perf, 'initial', {
        renderId,
        source: runtime.source.path,
        ...runtimeIdentity,
      });
      logger.scope('MapSurface').debug('GL map load complete', {
        renderId,
        source: runtime.source.path,
        elapsedMs: Date.now() - loadStartTime,
        zoom: map.getZoom(),
        ...runtimeIdentity,
      });
      surfaceLifecycle.reportLoaded();
    });

    await new Promise<void>((resolve) => {
      let settled = false;
      const timeoutId = ownerWindow.setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.scope('MapLibre').warn('Map style did not become ready before readiness timeout', {
          renderId,
          provider: this.getProviderClassName(),
          source: runtime.source.path,
          timeoutMs: readyTimeoutMs,
        });
        resolve();
      }, readyTimeoutMs);

      const finish = () => {
        if (settled) return;
        settled = true;
        ownerWindow.clearTimeout(timeoutId);
        resolve();
      };

      let providerLoadRan = false;
      const runProviderLoad = () => {
        if (providerLoadRan) return;
        providerLoadRan = true;
        perf.mark('style-ready', { zoom: map.getZoom() });
        void (async () => {
          try {
            perf.measure('load-resize', () => withProgrammaticCamera(map, () => map.resize()));
            perf.measure('load-zoom-state', () => updateZoomContainerState(mapContainerElement, map.getZoom()));

            perf.measure('on-map-load', () => getMapLibreResourceRegistry(map).capture(
              'provider-load',
              () => this.onMapLoad(map, places, geoJsonData, boundingBox, settings, request, perf),
            ));

            perf.measure('apply-poi-filters', () => this.applyPOIFilters(map, blockSettings.poiFilterPatterns));

            try {
              await perf.measureAsync('process-overlays', () => getMapLibreResourceRegistry(map).captureAsync(
                'overlays',
                () => this.processOverlays(map, mapContainerElement, request, places),
              ), {
                overlays: runtime.overlays.length,
              });
            } catch (error) {
              logger.scope('Places').error('[MapLibre] Error processing overlays:', error);
            }

            perf.measure('setup-context-menu', () => this.setupContextMenu(map, mapContainerElement, request, places));

            for (const factory of runtime.mapTools) {
              const toolConfig = request.config.tools[factory.id];
              if (toolConfig === undefined || toolConfig === false) continue;
              this.attachMapTool(map, mapContainerElement, request, factory);
            }

            if (blockSettings.debug) {
              this.setupDebugOverlay(map, mapContainerElement, places, request, loadStartTime);
            }
            const runtimeAudit = this.getMapRuntimeAudit(map, mapContainerElement);
            if (runtimeAudit.duplicateStyleBlockGroups > 0) {
              logger.scope('MapLibre').warn('Map runtime audit detected duplicate document style blocks', {
                renderId,
                provider: this.getProviderClassName(),
                source: runtime.source.path,
                ...runtimeAudit,
              });
            }

            perf.mark('ready', {
              renderId,
              zoom: map.getZoom(),
              markers: MapState.for(map).getPlaceMarkers().size,
              visibleTracks: MapState.for(map).getVisibleTracks().size,
              ...runtimeAudit,
            });
            logger.scope('MapSurface').debug('GL map application render ready', {
              renderId,
              source: runtime.source.path,
              elapsedMs: Date.now() - loadStartTime,
              zoom: map.getZoom(),
              markers: MapState.for(map).getPlaceMarkers().size,
              visibleTracks: MapState.for(map).getVisibleTracks().size,
              ...runtimeAudit,
              ...runtimeIdentity,
            });
          } finally {
            finish();
          }
        })();
      };

      // Markers paint in the first frame instead of ~1s later at full 'load' (tiles).
      this.runWhenStyleReady(map, runProviderLoad);
      // 'load' guarantees the style is loaded and is a safe fallback if style
      // readiness is somehow never observed first (the guard makes it run once).
      void map.once("load", runProviderLoad);
    });

  }

  // Run a callback as soon as the map's style SPEC is loaded - the point where
  // addSource/addLayer become legal - without waiting for the full 'load' event,
  // which also blocks on the initial viewport tiles.

  // isStyleLoaded()/Style.loaded() is NOT an early signal - it stays false until
  // every source's viewport tiles finish loading, firing at ~the same time as
  // 'load'. The 'style.load' event fires when the style JSON is parsed,
  // before any tiles; both maplibre-gl and mapbox-gl emit it. It is not in the
  // typed MapEventType, but Map.once() has a plain-string overload, and no cast is needed.
  private runWhenStyleReady(map: maplibregl.Map, run: () => void): void {
    if (map.isStyleLoaded()) {
      run();
      return;
    }
    void map.once('style.load', run);
  }

  private setupMapContainer(container: HTMLElement, blockSettings: ResolvedMapConfig): void {
    configureMapContainer(container, {
      className: `${this.getProviderClassName()}-map`,
      height: blockSettings.height,
      css: blockSettings.css,
    });
  }

  private showStyleError(container: HTMLElement, blockSettings: ResolvedMapConfig): void {
    const supportedStyles = this.getSupportedStyles();
    const requestedStyle = blockSettings.style;
    const providerName = this.getProviderClassName();

    const parent = container.parentElement;
    if (!parent) return;

    renderMapSurfaceError(container, {
      icon: '⚠️',
      title: 'Invalid Map Style',
      message: `Unknown style "${requestedStyle}" for ${providerName} provider.`,
      className: 'style-error'
    });

    if (supportedStyles.length > 0) {
      const section = parent.createDiv({ cls: 'places-help-section' });
      section.createEl('h3', { text: 'Available styles' });
      const styleList = section.createEl('ul');
      supportedStyles.forEach(style => styleList.createEl('li', { text: style }));
      section.createEl('p', { text: 'Use an available style:' });

      const pre = section.createEl('pre', { cls: 'places-help-code-block' });
      pre.createSpan({ cls: 'places-help-fence', text: '```places\n' });
      const codeEl = pre.createEl('code', { cls: 'language-places' });
      codeEl.textContent = `mapProvider: ${providerName}\nstyle: ${supportedStyles[0]}`;
      pre.createSpan({ cls: 'places-help-fence', text: '\n```' });
    }
  }

  private createMapInstance(
    container: HTMLElement,
    styleUrl: MapLibreStyle,
    boundingBox: PlacesBoundingBox,
    allowPitch: boolean,
    blockSettings: ResolvedMapConfig,
    camera: MapCameraIntent,
    terrainEnabled: boolean,
  ): maplibregl.Map {
    const rawCenter = boundingBox.getLngLatCenter();
    const fallbackCenter: [number, number] = (isFinite(rawCenter[0]) && isFinite(rawCenter[1]))
      ? rawCenter
      : [0, 0];
    const intent = camera;
    const initialCenter = intent.kind === 'explicit' ? intent.center : undefined;
    const initialZoom = intent.kind === 'explicit' ? intent.zoom : undefined;
    // Without a saved or explicit camera, let the GL engine compute the camera
    // from the data bounds at construction (the native form of fitBounds), and
    // no throwaway tiles load at a guessed zoom. Padding and maxZoom mirror
    // applyInitialViewport, which re-fits after load with the same values.
    const useBoundsCamera = intent.kind === 'fit-data' && boundingBox.isValid();
    const center: [number, number] = initialCenter ?? fallbackCenter;
    const zoom = initialZoom ?? estimateInitialZoom(boundingBox);
    // Start tilted when terrain is on: the relief is immediately visible.
    // A saved viewport (preserve intent) restores the user's own pitch instead.
    const initialPitch = terrainEnabled && intent.kind !== 'preserve' ? DEFAULT_TERRAIN_PITCH : 0;

    const map = this.constructMap({
      container,
      style: styleUrl,
      ...(useBoundsCamera
        ? { bounds: boundingBox.getLngLatBounds(), fitBoundsOptions: { padding: 30, maxZoom: 14, pitch: initialPitch } }
        : { center, zoom, pitch: initialPitch }),
      minZoom: this.getMinZoom(blockSettings),
      pitchWithRotate: allowPitch,
      dragRotate: allowPitch,
      touchPitch: allowPitch,
      ...(allowPitch ? { maxPitch: MAX_PITCH } : {}),
      // The engine's own container ResizeObserver calls resize() outside the
      // camera guard, and its move events register as user gestures - one
      // Obsidian detach/reattach cycle then permanently vetoes data fits. The
      // guarded ResizeObserver here is the only resize driver.
      trackResize: false,
      ...this.getMapOptions(blockSettings)
    });

    MapState.for(map);

    handleWebGLContextLost(map, container);

    return map;
  }

  private setupZoomVariable(map: maplibregl.Map, container: HTMLElement, perf?: PerformanceMonitor): void {
    const updateZoom = () => {
      updateZoomContainerState(container, map.getZoom());
    };
    map.on('zoom', () => this.measureIf(perf, 'zoom-state-update', updateZoom, { zoom: map.getZoom() }, { slowOnly: true }));
    map.on('zoomend', () => this.measureIf(perf, 'zoomend-state-update', updateZoom, { zoom: map.getZoom() }));
    this.measureIf(perf, 'initial-zoom-state', updateZoom, { zoom: map.getZoom() });
  }

  private setupStatePersistence(map: maplibregl.Map, source: MapRenderRequest['runtime']['source']): void {
    const stateKey = MapStateManager.getStateKey(source);
    if (!stateKey) return;

    map.on('moveend', () => {
      // Programmatic moves (fits, restores, resizes) must not overwrite the
      // user's viewport - only gestures and click-driven moves persist.
      if (MapState.for(map).getCameraGuard().isProgrammaticMove()) return;
      const center = map.getCenter();
      MapStateManager.saveState(stateKey, {
        zoom: map.getZoom(),
        center: { lat: center.lat, lng: center.lng }
      });
    });
  }

  // Flag-based user-gesture detection: any camera move that starts outside the
  // programmatic guard is user-driven. This also covers click-driven easeTo/flyTo
  // (cluster zoom, popup focus), which carry no originalEvent to sniff.
  private setupCameraGestureTracking(map: maplibregl.Map, container: HTMLElement): void {
    const surfaceLifecycle = ensureMapSurfaceLifecycle(container);
    const markGesture = () => {
      if (MapState.for(map).getCameraGuard().isProgrammaticMove()) return;
      surfaceLifecycle.reportUserCameraGesture();
    };
    map.on('movestart', markGesture);
    map.on('zoomstart', markGesture);
    map.on('rotatestart', markGesture);
  }

  private setupDebugOverlay(map: maplibregl.Map, container: HTMLElement, places: MapPlace[], request: MapRenderRequest, loadStartTime: number): void {
    const blockSettings = request.config;
    const overlays = request.runtime.overlays;

    this.debugData = addDebugOverlay(map, container, {
      places,
      overlayCount: overlays.filter(o => o.type === 'geojson').length,
      imageOverlayCount: overlays.filter(o => o.type === 'image').length,
      vectorTileOverlayCount: overlays.filter(o => o.type === 'vector-tile').length,
      providerName: this.getProviderClassName(),
      style: blockSettings.style,
      loadStartTime,
      prepareTimings: request.runtime.prepareTimings,
      tilesets: collectDebugTilesets(overlays),
    });
  }

  // Incremental updates change the runtime overlay list; keep the debug panel's Data counts current.
  private refreshDebugOverlayData(places: MapPlace[], overlays: readonly Overlay[]): void {
    this.debugData?.updateData?.({
      places,
      overlayCount: overlays.filter(o => o.type === 'geojson').length,
      imageOverlayCount: overlays.filter(o => o.type === 'image').length,
      vectorTileOverlayCount: overlays.filter(o => o.type === 'vector-tile').length,
    });
  }

  getMapControlHandle(container: HTMLElement): MapControlHandle | null {
    const map = this.getMapInstance(container);
    if (!map) return null;

    return createVectorMapControlHandle({
      container,
      map,
      highlightPlace: place => this.highlightPlace(map, container, place),
      clearHighlight: () => this.clearPlaceHighlight(map, container),
      setGeocodingSearchMarkers: places => this.setGeocodingSearchMarkers(places, container),
    });
  }

  private highlightPlace(map: maplibregl.Map, container: HTMLElement, place: MapPlace): void {
    enterVectorFocusMode(container, map, getPlaceId(place));
    focusMapMarkerElement(container, place, map);
    this.focusSymbolMarker(map, place);
    this.openPopupForPlace(map, place);
  }

  private clearPlaceHighlight(map: maplibregl.Map, container: HTMLElement): void {
    clearVectorFocusMode(container, map);
    this.clearSymbolMarkerFocus(map);
    closeExistingPopups('.maplibregl-popup, .mapboxgl-popup');
  }

  // Draw-order treatment for the native symbol renderer: the focused place
  // sorts above its neighbours. Icon dimming rides on focus mode itself
  // (enterVectorFocusMode), and both search paths dim identically.
  private focusSymbolMarker(map: maplibregl.Map, place: MapPlace): void {
    if (!map.getLayer(SYMBOL_MARKER_LAYER_ID)) return;
    const isFocused: maplibregl.ExpressionSpecification = ['==', ['get', 'placeId'], getPlaceId(place)];
    map.setLayoutProperty(SYMBOL_MARKER_LAYER_ID, 'symbol-sort-key', ['case', isFocused, 1, 0] as maplibregl.ExpressionSpecification);
  }

  private clearSymbolMarkerFocus(map: maplibregl.Map): void {
    if (!map.getLayer(SYMBOL_MARKER_LAYER_ID)) return;
    map.setLayoutProperty(SYMBOL_MARKER_LAYER_ID, 'symbol-sort-key', 0);
  }

  private openPopupForPlace(map: maplibregl.Map, place: MapPlace): void {
    createPlaceSummaryPopup({
      app: this.app,
      map,
      place,
      coordinates: [place.longitude, place.latitude] as [number, number],
      popupSelector: '.maplibregl-popup, .mapboxgl-popup',
      onPlaceAction: MapState.for(map).getCurrentSettings()?.onPlaceAction,
      createPopup: () => MapLibreHelper.createBasicPopup({
        offset: [0, -15],
        className: 'places-popup',
        closeOnClick: true,
        closeOnMove: false,
        focusAfterOpen: false
      }),
    });
  }

  private createMapComponent(_mapContainerElement: HTMLElement): Component {
    return new Component();
  }

  // The places-markers click handler is set up in onMapLoad, after the layer is created.
  private setupEventHandlers(map: maplibregl.Map, settings: CommonMapSettings, poiFilterPatterns: readonly string[]): void {
    // POI Discovery - click on base map features (vector tiles only)
    if (settings.poiDiscovery) {
      this.poiDiscoveryHandler.setup(map, [...poiFilterPatterns], settings.placeNoteHost);
    }
    // Touch handlers are set up early in processPlaceCodeBlock, before map creation
  }

  private applyPOIFilters(map: maplibregl.Map, patterns: readonly string[]): void {
    if (!patterns || patterns.length === 0) return;

    const poiLayerPattern = getPOILayerPatterns();

    const style = map.getStyle();
    if (!style || !style.layers) return;

    for (const layer of style.layers) {
      if (!poiLayerPattern.test(layer.id)) continue;

      // Detect whether the layer's existing filter uses expression or classic property syntax.
      const existingFilter = map.getFilter(layer.id);
      const useExpression = isExpressionFilter(existingFilter);
      const poiFilter = buildMapLibrePOIFilter([...patterns], 'class', 'subclass', useExpression);
      if (!poiFilter) continue;

      const combinedFilter: unknown[] = existingFilter
        ? ['all', existingFilter, ...poiFilter.slice(1)]
        : poiFilter;

      try {
        map.setFilter(layer.id, combinedFilter as maplibregl.FilterSpecification);
        logger.scope('Places').debug(`[POIFilter] Applied filter to layer "${layer.id}"`);
      } catch (e) {
        logger.scope('Places').warn(`[POIFilter] Failed to apply filter to layer "${layer.id}":`, e);
      }
    }
  }

  private debugData: DebugData | null = null;

  private onMapLoad(
    map: maplibregl.Map,
    places: MapPlace[],
    geoJsonData: unknown,
    boundingBox: { getLngLatCenter: () => [number, number], getLngLatBounds: () => [[number, number], [number, number]] },
    settings: CommonMapSettings,
    request: MapRenderRequest,
    perf?: PerformanceMonitor,
  ): void {
    const blockSettings = request.config;
    const runtime = request.runtime;
    const isHeatmapLayer = (geoJsonData as { isHeatmapLayer?: boolean }).isHeatmapLayer;

    if (isHeatmapLayer) {
      this.measureIf(perf, 'render-heatmap', () => {
        renderHeatmap({ app: this.app, map, data: geoJsonData as MapLibreHeatmapData });
        this.applyInitialViewport(map, boundingBox.getLngLatBounds(), request, 50);
      });
      return;
    }

    if (this.initializedMaps.has(map)) {
      perf?.mark('map-load-skipped', { reason: 'already initialized' });
      return;
    }
    this.initializedMaps.add(map);

    if (request.runtime.terrainDem) {
      this.measureIf(perf, 'setup-terrain', () => applyTerrain(map, request.runtime.terrainDem!, blockSettings.terrainExaggeration));
    }
    // Color relief goes below hillshade: shaded slopes sit over the elevation tint.
    // The color-relief layer type is a MapLibre GL 5 extension that Mapbox GL lacks, and is skipped there.
    const reliefDem = request.runtime.reliefDem;
    if (reliefDem && blockSettings.colorReliefOpacity > 0 && this.getProviderIntegration() === 'maplibre-gl') {
      this.measureIf(perf, 'setup-color-relief', () => applyColorRelief(map, reliefDem, blockSettings.colorReliefOpacity, blockSettings.colorReliefColors));
    }
    if (reliefDem && blockSettings.hillshadeIntensity > 0) {
      this.measureIf(perf, 'setup-hillshade', () => applyHillshade(map, reliefDem, {
        intensity: blockSettings.hillshadeIntensity,
        // hillshade-method is a MapLibre extension that Mapbox GL rejects.
        method: this.getProviderIntegration() === 'maplibre-gl' ? blockSettings.hillshadeMethod : undefined,
        direction: blockSettings.hillshadeDirection,
        shadowColor: blockSettings.hillshadeShadowColor,
        highlightColor: blockSettings.hillshadeHighlightColor,
        accentColor: blockSettings.hillshadeAccentColor,
      }));
    }

    this.measureIf(perf, 'setup-route-source', () => {
      MapLibreHelper.addRouteSource(map);
      MapLibreHelper.addBasicRouteLayers(map);
    });

    if (settings.showLabels) {
      this.measureIf(perf, 'setup-text-label-layer', () => this.setupTextLabelLayer(map, geoJsonData, places, settings, usesNativeMarkerRenderer(blockSettings)));
    }

    const overlayPointFeatures = blockSettings.clusterGeoJsonOverlays
      ? [...extractOverlayPointFeaturesFromOverlays(runtime.overlays)]
      : [];

    // Only count interactive places (exclude heatmap frequency points, bounds anchors)
    const interactivePlaceCount = places.filter(p => !isNonInteractivePlace(p)).length;

    const clusteringDecision = resolveClusteringDecision({
      placeCount: interactivePlaceCount,
      overlayPointCount: overlayPointFeatures.length,
      clusterThreshold: blockSettings.clusterThreshold,
      clusterGeoJsonOverlays: blockSettings.clusterGeoJsonOverlays,
    });

    if (blockSettings.debug) {
      logger.scope('Places').debug(`[Places Clustering] Places: ${interactivePlaceCount}, Overlay points: ${overlayPointFeatures.length}, Total: ${clusteringDecision.totalPointCount}, Threshold: ${blockSettings.clusterThreshold}, Should cluster: ${clusteringDecision.shouldCluster}`);
    }

    if (clusteringDecision.shouldCluster) {
      this.measureIf(perf, 'add-clustered-markers', () => this.addClusteredMarkers(map, geoJsonData, settings, places, blockSettings, blockSettings.clusterThreshold, overlayPointFeatures), {
        interactivePlaces: interactivePlaceCount,
        overlayPointFeatures: overlayPointFeatures.length,
      });
    } else if (usesNativeMarkerRenderer(blockSettings)) {
      this.measureIf(perf, 'add-symbol-markers', () => this.addSymbolLayerMarkers(map, settings, places, blockSettings), {
        interactivePlaces: interactivePlaceCount,
      });
    } else {
      this.measureIf(perf, 'add-icon-markers', () => this.addIconMarkers(map, settings, places, blockSettings), {
        interactivePlaces: interactivePlaceCount,
      });
    }

    this.measureIf(perf, 'initialize-map-view', () => this.initializeMapView(map, places, settings, boundingBox, request, clusteringDecision.shouldCluster, perf));
  }

  private ensureGeoJsonSource(map: maplibregl.Map, sourceId: string, source: maplibregl.GeoJSONSourceSpecification): void {
    const existingSource = map.getSource<maplibregl.GeoJSONSource>(sourceId);
    if (existingSource) {
      if (typeof existingSource.setData === 'function') {
        existingSource.setData(source.data);
      }
      return;
    }

    map.addSource(sourceId, source);
  }

  // Measure when a data change is painted and when all resulting map work settles.
  private profileNextRenderAndIdle(
    map: maplibregl.Map,
    perf: PerformanceMonitor,
    phase: 'initial' | 'update',
    details: Record<string, unknown> = {},
  ): void {
    const started = Date.now();
    void map.once('render', () => {
      const elapsedMs = Date.now() - started;
      perf.mark('map-render', { phase });
      logger.scope('MapSurface').debug('GL map frame rendered', { phase, elapsedMs, ...details });
    });
    void map.once('idle', () => {
      const elapsedMs = Date.now() - started;
      perf.mark('map-idle', { phase });
      logger.scope('MapSurface').debug('GL map reached idle', { phase, elapsedMs, ...details });
    });
  }

  // Replace the complete source snapshot.

  // MapLibre's updateData property-patch path can temporarily remove a symbol when a
  // style refresh adds or removes feature properties (for example iconOpacity). The
  // render plan then considers the update applied, and a later manual refresh cannot
  // repair the missing marker. setData is atomic from the renderer's perspective and
  // is the correct operation for these small, user-triggered refresh snapshots.
  private updateGeoJsonSource(
    source: maplibregl.GeoJSONSource,
    _previousFeatures: GeoJSON.Feature[],
    nextFeatures: GeoJSON.Feature[],
  ): void {
    source.setData({ type: 'FeatureCollection', features: nextFeatures });
  }

  // @param nativeZoomLabels Symbol renderer: the label layer shares the symbol marker source
  // (no separate label source or feature copy - source data is worker-serialized, and
  // duplicates are the expensive part), with hidden/zoom exclusions as filter conditions.
  // HTML renderer: a dedicated places-labels source excluding zoom-ranged labels - markers
  // render DOM labels that hide with the marker's zoom classes, and a native label
  // would double up.
  private setupTextLabelLayer(map: maplibregl.Map, geoJsonData: unknown, places: MapPlace[], settings: CommonMapSettings, nativeZoomLabels = false): void {
    // Data refreshes re-enter here; layer-scoped handlers are keyed by layer id and
    // survive layer recreation, and are registered only with the first layer.
    const layerExisted = Boolean(map.getLayer('places-markers'));

    if (nativeZoomLabels) {
      if (!map.getSource(SYMBOL_MARKER_LAYER_ID)) {
        // The symbol marker path fills this source; created empty when labels come first.
        map.addSource(SYMBOL_MARKER_LAYER_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      MapLibreHelper.addTextLayer(map, SYMBOL_MARKER_LAYER_ID);
      map.setFilter('places-markers', symbolLabelFilter(markerVisibilityDenyExpression(this.symbolVisibilityHidden.get(map) ?? [])));
    } else {
      const labelFeatures = (geoJsonData as { data: { features: GeoJSON.Feature[] } }).data.features.filter((_feature: GeoJSON.Feature, index: number) => {
        const place = places[index];
        if (isNonInteractivePlace(place)) {
          return false;
        }
        const labelStyle = place?.labelStyle;
        const usesDomZoomLabel = Boolean(place.iconStyle?.zoom || labelStyle?.zoom);
        return !isStyleHidden(labelStyle) && !usesDomZoomLabel;
      });

      this.ensureGeoJsonSource(map, "places-labels", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: labelFeatures
        }
      });
      // Layer-level floor is safe here: zoom-ranged labels are excluded from
      // this source (they render as DOM labels with the marker's zoom classes).
      MapLibreHelper.addTextLayer(map, "places-labels", undefined, MIN_ZOOM_FOR_LABELS);
    }

    if (!layerExisted) {
      map.on('click', 'places-markers', (e) => {
        e.preventDefault();
        const feature = e.features?.[0];
        if (feature) {
          void this.onPlacesLayerClick(e, settings);
        }
      });

      MapLibreHelper.addPointerCursor(map, 'places-markers');
    }
  }

  private initializeMapView(
    map: maplibregl.Map,
    _places: MapPlace[],
    settings: CommonMapSettings,
    boundingBox: { getLngLatCenter: () => [number, number], getLngLatBounds: () => [[number, number], [number, number]] },
    request: MapRenderRequest,
    willCluster: boolean = false,
    perf?: PerformanceMonitor,
  ): void {
    const blockSettings = request.config;
    const debug = blockSettings.debug;

    const visibility = request.runtime.trackVisibility;

    const mapState = MapState.for(map);
    mapState.setDefaultTrackState(visibility?.shouldShowByDefault ? 'visible' : 'hidden');

    if (visibility?.hasAnyVisibleTracks) {
      const placesToShow = visibility.placeStates.filter(s => s.showOnLoad);

      if (visibility.isSingleTrackView && placesToShow.length === 1) {
        const { place, effectiveColorBy } = placesToShow[0];
        if (place.overlay?.geojson) {
          const fitTrack = request.runtime.camera.kind === 'fit-data';
          this.measureIf(perf, 'show-single-track', () => this.showGeoJsonOverlayAndFitBounds(map, place, visibility, settings, effectiveColorBy, settings.trackGradeWindow, fitTrack), { placeId: getPlaceId(place) });
          if (!fitTrack) this.applyInitialViewport(map, boundingBox.getLngLatBounds(), request, 30);
        }
        return;
      } else if (placesToShow.length > 0) {
        this.measureIf(perf, 'show-initial-tracks', () => this.showInitialTracks(map, placesToShow, visibility, settings, visibility.shouldShowByDefault, willCluster, perf), { tracks: placesToShow.length });
      }
    } else if (willCluster && !visibility?.shouldShowByDefault) {
      logger.scope('Places').debug('[Places] Clustering enabled - trackLayers will show when markers are unclustered');
    }

    const bounds = boundingBox.getLngLatBounds();
    if (debug) {
      logger.scope('Places').debug('[Places Bounds] applying initial viewport:', bounds);
    }
    this.applyInitialViewport(map, bounds, request, 30);
  }

  // Clusters show only when the visible marker count exceeds the threshold.
  // overlayPointFeatures merge into the cluster for unified clustering.
  private addClusteredMarkers(map: maplibregl.Map, geoJsonData: unknown, settings: CommonMapSettings, places: MapPlace[], blockSettings: ResolvedMapConfig, clusterThreshold: number, overlayPointFeatures: GeoJSON.Feature[] = []): void {
    if (usesNativeMarkerRenderer(blockSettings)) {
      this.addSymbolClusteredMarkers(map, settings, places, blockSettings, clusterThreshold, overlayPointFeatures);
      return;
    }

    const geojson = geoJsonData as { data: GeoJSON.FeatureCollection };
    const features = geojson.data.features;

    const filteredPlaces: MapPlace[] = [];
    const filteredFeatures: GeoJSON.Feature[] = [];
    places.forEach((place, index) => {
      if (!isNonInteractivePlace(place)) {
        filteredPlaces.push(place);
        filteredFeatures.push(features[index]);
      }
    });

    this.addClusterSourceAndLayers(map, [...filteredFeatures, ...overlayPointFeatures]);

    if (overlayPointFeatures.length > 0) {
      map.addSource('overlay-points-unclustered', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: overlayPointFeatures
        }
      });

      // Initially hidden (clusters are shown first); ViewportClusteringManager toggles visibility
      this.addOverlayPointLayer(map, 'overlay-points-unclustered', { initiallyHidden: true });
    }

    const overlayPointCoordinates = overlayPointFeatures.map(feature => {
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      return { longitude: coords[0], latitude: coords[1] };
    });

    // defaultTrackState is set in initializeMapView (called after this method)
    const mapState = MapState.for(map);
    mapState.setCurrentPlaces(places);
    mapState.setCurrentSettings(settings);
    mapState.setCurrentBlockSettings(blockSettings);

    const clusteringManager = new ViewportClusteringManager<maplibregl.Marker>({
      map: map,
      places: filteredPlaces,
      clusterThreshold,
      overlayPointCoordinates,
      overlayPointsLayerId: overlayPointFeatures.length > 0 ? 'overlay-points-individual' : undefined,
      providerName: 'MapLibre',
      markerFactory: {
        createMarker: (place) => {
          const feature = this.createHtmlMarkerFeature(place);
          return MapLibreHelper.createIconMarker(
            map,
            feature,
            this.onMarkerClick.bind(this, map, feature, settings)
          );
        },
        removeMarker: (marker) => marker.remove()
      },
      onClusteringModeChange: (isClustering, visiblePlaceIds) => {
        this.handleClusteringModeChange(map, mapState, settings, isClustering, visiblePlaceIds);
      }
    });

    mapState.setClusteringManager(clusteringManager);

    const markerMap = clusteringManager.getMarkerMap();
    for (const [placeId, marker] of markerMap.entries()) {
      mapState.setPlaceMarker(placeId, marker);
    }
    for (const place of filteredPlaces) {
      mapState.setPlaceMarkerSignature(getPlaceId(place), getPlaceMarkerRenderSignature(place));
    }

    setupVectorClusterInteractions({
      map: map as never,
      clusteringManager,
      isClusterSourceLoadedEvent: event => {
        const sourceEvent = event as MapSourceDataEvent;
        return sourceEvent.sourceId === 'places-clustered' && Boolean(sourceEvent.isSourceLoaded);
      },
      getClusterExpansionZoom: async (_map, clusterId, sourceId) => {
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
        return source.getClusterExpansionZoom(clusterId);
      },
    });
  }

  // Clustering is all-or-nothing by viewport point count - the product's contract, kept
  // from the HTML renderer: cluster circles and individual markers are never shown
  // together. The cluster-enabled source only feeds the cluster circles; individual
  // markers render from the plain symbol source: marker mode always shows every point.
  private addSymbolClusteredMarkers(map: maplibregl.Map, settings: CommonMapSettings, places: MapPlace[], blockSettings: ResolvedMapConfig, clusterThreshold: number, overlayPointFeatures: GeoJSON.Feature[]): void {
    const started = performance.now();
    const { renderedPlaces, features: placeFeatures, zoomSizeStops } = this.buildSymbolMarkerData(places);
    const dataReady = performance.now();
    const imagePreparation = this.scheduleSymbolMarkerImages(map, renderedPlaces);
    const imagesReady = performance.now();

    this.addClusterSourceAndLayers(map, [...placeFeatures, ...overlayPointFeatures]);
    // Retain the full inputs: a live markerFilter toggle re-derives the visible
    // subset for the cluster source; the post-render applyMarkerVisibility (live
    // blocks only) then filters the initial cluster counts to match.
    this.symbolClusterData.set(map, { features: placeFeatures, renderedPlaces, overlayPointFeatures });

    this.ensureGeoJsonSource(map, SYMBOL_MARKER_LAYER_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: placeFeatures },
    });
    this.addSymbolMarkerLayer(map, SYMBOL_MARKER_LAYER_ID, settings, zoomSizeStops, renderedPlaces.some(place => place.iconRotation !== undefined));
    const layersReady = performance.now();

    if (overlayPointFeatures.length > 0) {
      map.addSource('overlay-points-unclustered', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: overlayPointFeatures }
      });
      this.addOverlayPointLayer(map, 'overlay-points-unclustered', { initiallyHidden: true });
    }

    const overlayPointCoordinates = overlayPointFeatures.map(feature => {
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      return { longitude: coords[0], latitude: coords[1] };
    });

    const mapState = MapState.for(map);
    mapState.setCurrentPlaces(places);
    mapState.setCurrentSettings(settings);
    mapState.setCurrentBlockSettings(blockSettings);

    // No marker factory: the symbol and label layers render the markers; the manager
    // toggles their visibility against the cluster layers and reports viewport place ids.
    const clusteringManager = new ViewportClusteringManager<maplibregl.Marker>({
      map: map,
      places: renderedPlaces,
      clusterThreshold,
      providerName: 'MapLibre',
      markersLayerIds: [SYMBOL_MARKER_LAYER_ID, 'places-markers'],
      overlayPointCoordinates,
      overlayPointsLayerId: overlayPointFeatures.length > 0 ? 'overlay-points-individual' : undefined,
      onClusteringModeChange: (isClustering, visiblePlaceIds) => {
        if (!isClustering) imagePreparation.flush('marker-mode');
        this.handleClusteringModeChange(map, mapState, settings, isClustering, visiblePlaceIds);
      }
    });

    mapState.setClusteringManager(clusteringManager);
    const managerReady = performance.now();

    setupVectorClusterInteractions({
      map: map as never,
      clusteringManager,
      isClusterSourceLoadedEvent: event => {
        const sourceEvent = event as MapSourceDataEvent;
        return sourceEvent.sourceId === 'places-clustered' && Boolean(sourceEvent.isSourceLoaded);
      },
      getClusterExpansionZoom: async (_map, clusterId, sourceId) => {
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
        return source.getClusterExpansionZoom(clusterId);
      },
    });

    logger.scope('MapSurface').debug('Native clustered marker setup ready', {
      provider: this.getProviderClassName(),
      places: renderedPlaces.length,
      overlayPointFeatures: overlayPointFeatures.length,
      uniqueImages: imagePreparation.uniqueImages,
      imagePreparation: 'scheduled',
      buildDataMs: Math.round((dataReady - started) * 10) / 10,
      scheduleImagesMs: Math.round((imagesReady - dataReady) * 10) / 10,
      addSourcesAndLayersMs: Math.round((layersReady - imagesReady) * 10) / 10,
      createManagerMs: Math.round((managerReady - layersReady) * 10) / 10,
      interactionsMs: Math.round((performance.now() - managerReady) * 10) / 10,
    });
  }

  private addClusterSourceAndLayers(map: maplibregl.Map, features: GeoJSON.Feature[]): void {
    map.addSource('places-clustered', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
      cluster: true,
      clusterRadius: 50,
      clusterMaxZoom: MapConstants.CLUSTER_MAX_ZOOM  // Stop clustering to ensure points become visible
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'places-clustered',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          MapConstants.CLUSTER_COLORS.SMALL,
          MapConstants.CLUSTER_SIZES.MEDIUM.threshold, MapConstants.CLUSTER_COLORS.MEDIUM,
          MapConstants.CLUSTER_SIZES.LARGE.threshold, MapConstants.CLUSTER_COLORS.LARGE
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          MapConstants.CLUSTER_SIZES.SMALL.radius,
          MapConstants.CLUSTER_SIZES.MEDIUM.threshold, MapConstants.CLUSTER_SIZES.MEDIUM.radius,
          MapConstants.CLUSTER_SIZES.LARGE.threshold, MapConstants.CLUSTER_SIZES.LARGE.radius
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff'
      }
    });

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'places-clustered',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': resolveStyleTextFont(map, { bold: true }),
        'text-size': 12
      },
      paint: {
        'text-color': '#000'
      }
    });
  }

  private addOverlayPointLayer(map: maplibregl.Map, sourceId: string, options: { initiallyHidden?: boolean } = {}): void {
    map.addLayer({
      id: 'overlay-points-individual',
      type: 'circle',
      source: sourceId,
      layout: {
        'visibility': options.initiallyHidden ? 'none' : 'visible'
      },
      paint: {
        'circle-radius': ['coalesce', ['get', 'circle-radius'], 6],
        'circle-color': ['coalesce', ['get', 'marker-color'], TRACK_STYLE_DEFAULTS.color],
        'circle-opacity': ['coalesce', ['get', 'fill-opacity'], 0.8],
        'circle-stroke-color': ['coalesce', ['get', 'stroke'], '#fff'],
        'circle-stroke-width': ['coalesce', ['get', 'stroke-width'], 2],
        'circle-stroke-opacity': 1
      }
    });

    map.on('click', 'overlay-points-individual', (e) => {
      if (!e.features || e.features.length === 0) return;
      e.preventDefault();
      this.handleOverlayPointClick(map, e.features[0]);
    });

    MapLibreHelper.addPointerCursor(map, 'overlay-points-individual');
  }

  private handleOverlayPointClick(map: maplibregl.Map, feature: GeoJSON.Feature, fallbackSourcePath?: string): void {
    const properties: Record<string, unknown> = feature.properties || {};
    const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const sourcePath = typeof properties._overlaySource === 'string' ? properties._overlaySource : fallbackSourcePath;
    const popupContent = buildOverlayPointPopupContent({
      properties,
      sourcePath,
      defaultName: 'Point',
      onSourceLinkClick: createSourceLinkClickHandler(sourcePath, (linkPath) => void this.app.workspace.openLinkText(linkPath, ''))
    });

    MapLibreHelper.openPopup(map, coords, popupContent);
  }

  private addIconMarkers(map: maplibregl.Map, settings: CommonMapSettings, places: MapPlace[], blockSettings: ResolvedMapConfig): void {
    const mapState = MapState.for(map);
    mapState.setCurrentPlaces(places);
    mapState.setCurrentSettings(settings);
    mapState.setCurrentBlockSettings(blockSettings);

    for (const place of places) {
      // Skip non-interactive places (heatmap frequency and bounds anchors) - they have dedicated handlers
      if (isNonInteractivePlace(place)) {
        continue;
      }

      // Skip icon rendering if iconStyle hides it (display: none or opacity: 0)
      if (!isIconHidden(place)) {
        const marker = this.createIconMarkerWithReturn(map, this.createHtmlMarkerFeature(place), settings);
        const placeId = getPlaceId(place);
        const markerSignature = getPlaceMarkerRenderSignature(place);
        mapState.setPlaceMarkerWithSignature(placeId, marker, markerSignature);
      }
    }
  }

  // Native symbol-layer marker rendering. Emoji keep their color by being
  // rasterized onto a canvas and registered as style images - images are not
  // signed-distance-field encoded, unlike text glyphs, which is why icons
  // cannot go through text-field but labels can (and already do, via
  // setupTextLabelLayer). Structured iconStyles rules become data-driven
  // expressions (opacity -> icon-opacity, font-size % -> icon-size); arbitrary
  // CSS needs `markerRenderer: html`. Clustered maps share one cluster-enabled
  // source between the cluster circles and the symbol layer, and focus mode
  // dims icons/labels through paint expressions keyed on placeId.
  private addSymbolLayerMarkers(map: maplibregl.Map, settings: CommonMapSettings, places: MapPlace[], blockSettings: ResolvedMapConfig): void {
    const mapState = MapState.for(map);
    mapState.setCurrentPlaces(places);
    mapState.setCurrentSettings(settings);
    mapState.setCurrentBlockSettings(blockSettings);

    const { renderedPlaces, features, zoomSizeStops } = this.buildSymbolMarkerData(places);
    const imageStats = this.ensureSymbolMarkerImages(map, renderedPlaces);
    logger.scope('MapSurface').debug('Native symbol marker images ready', {
      provider: this.getProviderClassName(),
      places: renderedPlaces.length,
      ...imageStats,
    });

    this.ensureGeoJsonSource(map, SYMBOL_MARKER_LAYER_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    this.addSymbolMarkerLayer(map, SYMBOL_MARKER_LAYER_ID, settings, zoomSizeStops, renderedPlaces.some(place => place.iconRotation !== undefined));
  }

  private addSymbolMarkerLayer(map: maplibregl.Map, sourceId: string, settings: CommonMapSettings, zoomSizeStops: number[], mapAlignedIcons: boolean, extraFilter?: maplibregl.FilterSpecification): void {
    if (map.getLayer(SYMBOL_MARKER_LAYER_ID)) {
      this.removeMapLayersAndSources(map, [SYMBOL_MARKER_LAYER_ID], []);
    }
    const filter = symbolIconFilter(markerVisibilityDenyExpression(this.symbolVisibilityHidden.get(map) ?? []), extraFilter);
    map.addLayer({
      id: SYMBOL_MARKER_LAYER_ID,
      type: 'symbol',
      source: sourceId,
      filter,
      layout: {
        'icon-image': ['get', 'iconImage'],
        'icon-size': buildSymbolIconSizeExpression(zoomSizeStops),
        // Degrees clockwise from north, per place. Blocks that rotate icons
        // (iconRotation) align to the map, keeping a bearing pointed at true
        // north when the map rotates; without iconRotation, icons stay
        // viewport-aligned (upright), the behavior from before iconRotation
        // existed. The alignment is a layout property (per layer, not per
        // feature): in a mixed block any rotated place makes unrotated siblings
        // track north too. Pitch alignment stays viewport, keeping a tilted map
        // from laying icons flat.
        'icon-rotate': ['coalesce', ['get', 'iconRotate'], 0],
        'icon-rotation-alignment': mapAlignedIcons ? 'map' : 'viewport',
        'icon-pitch-alignment': 'viewport',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': SYMBOL_ICON_BASE_OPACITY,
      },
    });

    map.on('click', SYMBOL_MARKER_LAYER_ID, (event) => this.onPlacesLayerClick(event, settings));
    registerPointerCursorLayer(map, SYMBOL_MARKER_LAYER_ID);
  }

  // Interactive places, their symbol features (structured icon style bits as data-driven
  // properties), and the union of zoom-size stops that shapes the icon-size expression.
  // Hidden icons/labels stay in the features - a place can hide its icon but keep its
  // label - and are excluded per layer via the iconHidden/labelHidden filter properties.
  private buildSymbolMarkerData(places: MapPlace[]): { renderedPlaces: MapPlace[]; features: GeoJSON.Feature[]; zoomSizeStops: number[] } {
    const renderedPlaces = places.filter(place => !isNonInteractivePlace(place));
    const zoomSizeStops = collectIconZoomSizeStops(renderedPlaces);
    const features = renderedPlaces.map(place => this.createPointFeature(place, zoomSizeStops));
    return { renderedPlaces, features, zoomSizeStops };
  }

  private ensureSymbolMarkerImages(map: maplibregl.Map, places: MapPlace[]): { uniqueImages: number; existing: number; cacheHits: number; rasterized: number } {
    const imageIds = new Set<string>();
    let existing = 0;
    let cacheHits = 0;
    let rasterized = 0;
    for (const place of places) {
      if (place.icon && !isIconHidden(place)) {
        const imageId = this.getSymbolIconImageId(place);
        if (imageIds.has(imageId)) continue;
        imageIds.add(imageId);
        const result = this.ensureSymbolIconImage(map, place, imageId);
        if (result === 'existing') existing += 1;
        else if (result === 'cache') cacheHits += 1;
        else if (result === 'rasterized') rasterized += 1;
      }
    }
    return { uniqueImages: imageIds.size, existing, cacheHits, rasterized };
  }

  // Cluster circles are immediately useful without individual marker images. Prepare those
  // images in short animation-frame slices, then synchronously finish only if marker mode is
  // reached before prewarming completes.
  private scheduleSymbolMarkerImages(map: maplibregl.Map, places: MapPlace[]): SymbolImagePreparation {
    const queued = new Map<string, MapPlace>();
    for (const place of places) {
      if (place.icon && !isIconHidden(place)) {
        const imageId = this.getSymbolIconImageId(place);
        if (!map.hasImage(imageId) && !queued.has(imageId)) queued.set(imageId, place);
      }
    }

    const items = Array.from(queued, ([imageId, place]) => ({ imageId, place }));
    const stats = { existing: 0, cacheHits: 0, rasterized: 0, failed: 0 };
    let index = 0;
    let frameId = 0;
    let finished = false;
    const started = performance.now();

    const record = (result: ReturnType<MapLibreProviderBase['ensureSymbolIconImage']>) => {
      if (result === 'existing') stats.existing += 1;
      else if (result === 'cache') stats.cacheHits += 1;
      else if (result === 'rasterized') stats.rasterized += 1;
      else stats.failed += 1;
    };
    const finish = (mode: 'incremental' | 'marker-mode') => {
      if (finished) return;
      finished = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      this.symbolImagePreparationCleanups.delete(map);
      logger.scope('MapSurface').debug('Native clustered marker images ready', {
        provider: this.getProviderClassName(),
        uniqueImages: items.length,
        ...stats,
        mode,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
      });
    };
    const processFrame = () => {
      frameId = 0;
      if (finished) return;
      const sliceStarted = performance.now();
      while (index < items.length && performance.now() - sliceStarted < 6) {
        const item = items[index++];
        record(this.ensureSymbolIconImage(map, item.place, item.imageId));
      }
      if (index >= items.length) finish('incremental');
      else frameId = window.requestAnimationFrame(processFrame);
    };
    const flush = (reason: 'marker-mode' | 'cleanup') => {
      if (finished) return;
      if (reason === 'cleanup') {
        finished = true;
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
        return;
      }
      while (index < items.length) {
        const item = items[index++];
        record(this.ensureSymbolIconImage(map, item.place, item.imageId));
      }
      finish('marker-mode');
    };

    if (items.length === 0) finish('incremental');
    else frameId = window.requestAnimationFrame(processFrame);
    this.symbolImagePreparationCleanups.set(map, () => flush('cleanup'));
    return { uniqueImages: items.length, flush };
  }

  private getSymbolIconImageId(place: MapPlace): string {
    const badge = place.iconStyle?.badge;
    const shadows = place.iconStyle?.shadows;
    const imageScale = getMaxIconScale(place.iconStyle);
    const icon = place.icon || '';
    const color = place.iconStyle?.color;
    if (!badge && !shadows?.length && !color && imageScale === 1) return EMOJI_IMAGE_PREFIX + icon;
    return `places-icon-${hashString36(JSON.stringify({ icon, badge, shadows, imageScale, color }))}`;
  }

  // Sources, images, and data-shaped expressions refresh in place: no layer teardown.
  private refreshSymbolLayerData(map: maplibregl.Map, newPlaces: MapPlace[], settings: CommonMapSettings, request: MapRenderRequest): void {
    const blockSettings = request.config;
    const { renderedPlaces, features, zoomSizeStops } = this.buildSymbolMarkerData(newPlaces);
    const previousPlaces = MapState.for(map).getCurrentPlaces();
    const previousFeatures = this.buildSymbolMarkerData(previousPlaces).features;
    this.ensureSymbolMarkerImages(map, renderedPlaces);

    if (map.getLayer(SYMBOL_MARKER_LAYER_ID)) {
      // The stop union is baked into the icon-size expression, and data changes must refresh it.
      map.setLayoutProperty(SYMBOL_MARKER_LAYER_ID, 'icon-size', buildSymbolIconSizeExpression(zoomSizeStops));
    }

    const symbolSource = map.getSource<maplibregl.GeoJSONSource>(SYMBOL_MARKER_LAYER_ID);
    if (symbolSource) {
      this.updateGeoJsonSource(symbolSource, previousFeatures, features);
    } else {
      map.addSource(SYMBOL_MARKER_LAYER_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
    }

    const clusteredSource = map.getSource<maplibregl.GeoJSONSource>('places-clustered');
    if (clusteredSource) {
      const overlayPointFeatures = blockSettings.clusterGeoJsonOverlays
        ? [...extractOverlayPointFeaturesFromOverlays(request.runtime.overlays)]
        : [];
      // Retain the full inputs: a later markerFilter toggle re-derives the
      // visible subset; applyClusteredData feeds only the currently-visible set.
      this.symbolClusterData.set(map, { features, renderedPlaces, overlayPointFeatures });
      this.applyClusteredData(map);
    }

    if (settings.showLabels) {
      // Native labels share the symbol source updated above; this only ensures the layer exists.
      this.setupTextLabelLayer(map, undefined, newPlaces, settings, true);
    }
  }

  // Rasterize a place's icon to a style image; canvas 2D keeps emoji color (SDF text would
  // not). Structured iconStyles decorations are baked in: badge glyphs (`content:`) draw
  // behind or in front at their own size/opacity, and halo shadows (`filter: drop-shadow`,
  // `text-shadow`) render as canvas shadow passes. The canvas grows to fit badge overhang
  // and shadow spread, and decorations extend beyond the icon exactly like their
  // CSS counterparts.
  private ensureSymbolIconImage(map: maplibregl.Map, place: MapPlace, imageId = this.getSymbolIconImageId(place)): 'existing' | 'cache' | 'rasterized' | 'failed' {
    if (map.hasImage(imageId)) return 'existing';

    const badge = place.iconStyle?.badge;
    const shadows = place.iconStyle?.shadows ?? [];
    const pixelRatio = Math.min(activeWindow.devicePixelRatio || 1, 3);
    const cache = getSharedSymbolImageCache();
    const cached = cache.entries.get(imageId);
    if (cached?.pixelRatio === pixelRatio) {
      map.addImage(imageId, cached.imageData, { pixelRatio });
      return 'cache';
    }
    // Rasterize at the largest scale the icon can render at; the layer's icon-size is
    // emitted relative to this, and GL only ever downscales (upscaling blurs emoji).
    const imageScale = getMaxIconScale(place.iconStyle);
    const badgeScale = badge ? Math.max(badge.sizePct / 100, 1) : 1;
    const shadowMarginPx = shadows.reduce((margin, shadow) => Math.max(margin, shadow.blur + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY))), 0);
    const badgeFontLogicalPx = badge ? SYMBOL_MARKER_ICON_SIZE_PX * imageScale * badge.sizePct / 100 : 0;
    const badgeOffsetX = this.resolveBadgeOffsetPx(badge?.offsetX, badgeFontLogicalPx);
    const badgeOffsetY = this.resolveBadgeOffsetPx(badge?.offsetY, badgeFontLogicalPx);
    const offsetMarginPx = Math.max(Math.abs(badgeOffsetX), Math.abs(badgeOffsetY));
    const logicalSize = Math.ceil(SYMBOL_MARKER_ICON_SIZE_PX * imageScale * badgeScale + 2 * (shadowMarginPx + offsetMarginPx));
    const canvasSize = Math.ceil(logicalSize * pixelRatio);
    const canvas = createEl('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const context = canvas.getContext('2d');
    if (!context) return 'failed';

    // Colour emoji are bitmap glyphs and ignore fillStyle; text-presentation
    // glyphs (arrows, dingbats, geometric shapes) take it, which is what makes
    // `color:` work for them. Undefined leaves the canvas default.
    const iconColor = place.iconStyle?.color;
    const drawGlyph = (glyph: string, fontPx: number, alpha: number, offsetXPx = 0, offsetYPx = 0, color?: string) => {
      context.font = `${Math.floor(fontPx * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.globalAlpha = alpha;
      // Set unconditionally: fillStyle persists on the context, and a front badge
      // drawn after a coloured icon would otherwise inherit the icon's colour.
      context.fillStyle = color ?? '#000';
      context.fillText(glyph, canvasSize / 2 + offsetXPx, canvasSize / 2 + offsetYPx + fontPx * 0.04);
      context.globalAlpha = 1;
    };

    const iconFontPx = SYMBOL_MARKER_ICON_SIZE_PX * imageScale * pixelRatio;
    const badgeFontPx = badge ? iconFontPx * badge.sizePct / 100 : 0;
    const badgeOffsetXPx = badgeOffsetX * pixelRatio;
    const badgeOffsetYPx = badgeOffsetY * pixelRatio;

    if (badge && badge.order === 'behind') {
      drawGlyph(badge.content, badgeFontPx, badge.opacity, badgeOffsetXPx, badgeOffsetYPx);
    }

    if (shadows.length > 0) {
      for (const shadow of shadows) {
        context.shadowOffsetX = shadow.offsetX * pixelRatio;
        context.shadowOffsetY = shadow.offsetY * pixelRatio;
        context.shadowBlur = shadow.blur * pixelRatio;
        context.shadowColor = shadow.color;
        drawGlyph(place.icon, iconFontPx, 1, 0, 0, iconColor);
      }
      context.shadowOffsetX = 0;
      context.shadowOffsetY = 0;
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
    } else {
      drawGlyph(place.icon, iconFontPx, 1, 0, 0, iconColor);
    }

    if (badge && badge.order === 'front') {
      drawGlyph(badge.content, badgeFontPx, badge.opacity, badgeOffsetXPx, badgeOffsetYPx);
    }

    const imageData = context.getImageData(0, 0, canvasSize, canvasSize);
    map.addImage(imageId, imageData, { pixelRatio });
    cache.entries.delete(imageId);
    cache.entries.set(imageId, { imageData, pixelRatio });
    if (cache.entries.size > cache.limit) {
      const oldest = cache.entries.keys().next().value;
      if (oldest !== undefined) cache.entries.delete(oldest);
    }
    return 'rasterized';
  }

  private resolveBadgeOffsetPx(offset: IconBadgeOffset | undefined, badgeFontPx: number): number {
    if (!offset) return 0;
    return offset.unit === '%' ? badgeFontPx * offset.value / 100 : offset.value;
  }

  // Primitive-only feature for GL sources. The full place is deliberately NOT serialized
  // here - source data is transferred to the map worker and indexed there, and embedded
  // place JSON multiplies load time and memory at scale. Click handlers resolve the place
  // from MapState via placeId. Markers that need the full place on the feature (HTML
  // marker DOM) use createHtmlMarkerFeature.
  private createPointFeature(place: MapPlace, zoomSizeStops: number[] = []): GeoJSON.Feature {
    return buildPointFeature({ place, zoomSizeStops, iconImageId: this.getSymbolIconImageId(place) });
  }

  // Feature for HTML marker DOM creation: main-thread only, never uploaded to a GL source, and carries the full place.
  private createHtmlMarkerFeature(place: MapPlace): GeoJSON.Feature {
    return buildHtmlMarkerFeature({ place, iconImageId: this.getSymbolIconImageId(place) });
  }

  private createIconMarkerWithReturn(map: maplibregl.Map, feature: GeoJSON.Feature, settings: CommonMapSettings): maplibregl.Marker {
    return MapLibreHelper.createIconMarker(
      map,
      feature,
      this.onMarkerClick.bind(this, map, feature, settings),
      settings.showLabels
    );
  }

  protected onMarkerClick(map: maplibregl.Map, feature: GeoJSON.Feature, settings: CommonMapSettings): void {
    const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
    const place = parseMapPlaceProperty(feature.properties?.mapPlace);

    if (isNonInteractivePlace(place)) {
      return;
    }

    if (!hasDisplayableContent(place)) {
      return;
    }

    this.createPopup(map, place, coordinates, settings);
  }

  protected onPlacesLayerClick(e: maplibregl.MapLayerMouseEvent, settings: CommonMapSettings): void {
    const map = e.target;
    const feature = e.features?.[0];
    if (!feature) return;

    const props: Record<string, unknown> = feature.properties ?? {};

    // GL-source features carry only primitives; resolve the real place (metadata, overlay,
    // computed styles) from MapState by placeId. HTML-marker features still embed the
    // place as JSON; manual reconstruction is the last resort for foreign features.
    const place: MapPlace = (() => {
      if (typeof props.placeId === 'string') {
        const statePlace = MapState.for(map).getPlaceById(props.placeId);
        if (statePlace) return statePlace;
      }
      if (typeof props.mapPlace === 'string') {
        try {
          return JSON.parse(props.mapPlace) as MapPlace;
        } catch {
          // Fall through to manual reconstruction
        }
      }
      const asText = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
      return {
        latitude: (feature.geometry as GeoJSON.Point).coordinates[1],
        longitude: (feature.geometry as GeoJSON.Point).coordinates[0],
        name: asText(props.description) ?? '',
        icon: asText(props.icon) ?? '',
        filePath: asText(props.file_path),
        trackLayer: asText(props.trackLayer),
        elevationData: asText(props.elevationData)
      };
    })()

    // Skip bounds anchor points (empty places used only for map fitting)
    if (place.metadata?.boundsAnchor) {
      return;
    }

    // Skip heatmap frequency places - they have their own dedicated click handler
    // that shows the frequency popup with contributing files info
    if (place.metadata?.frequency !== undefined) {
      // Set flag to prevent POI discovery from showing a popup too
      (e.originalEvent as Event & { _heatmapClicked?: boolean })._heatmapClicked = true;
      return;
    }

    if (!hasDisplayableContent(place)) {
      return;
    }

    const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

    this.createPopup(map, place, coordinates, settings);
  }

  private toggleGeoJsonOverlay(map: maplibregl.Map, place: MapPlace): void {
    const mapState = MapState.for(map);

    if (place.filePath) {
      const overlayIndex = mapState.getOverlayIndexForPlace(place.filePath);
      if (overlayIndex !== undefined) {
        const lineLayerId = `geojson-overlay-${overlayIndex}-line`;
        const hitareaLayerId = `geojson-overlay-${overlayIndex}-line-hitarea`;

        const isCurrentlyVisible = mapState.isGeoJsonOverlayVisible(overlayIndex);
        const newVisibility = isCurrentlyVisible ? 'none' : 'visible';

        // Track waypoints (`-circle`) follow the line: they never persist after the track hides.
        this.setLayersVisibility(map, [lineLayerId, `${lineLayerId}-outline`, `${lineLayerId}-route-label`, `${lineLayerId}-direction`, `${lineLayerId}-endpoints`, hitareaLayerId, `geojson-overlay-${overlayIndex}-circle`], newVisibility);
        mapState.setGeoJsonOverlayVisible(overlayIndex, !isCurrentlyVisible);
        this.recordTrackUserVisibility(map, getPlaceId(place), !isCurrentlyVisible);
        return;
      }
    }

    if (!place.overlay?.geojson) return;

    const placeId = getPlaceId(place);

    // Bucket-managed track (bulk auto-show or viewport loading): toggle by
    // flipping its hidden state in the loader instead of adding a per-place
    // overlay, which would duplicate the geometry already in the shared bucket.
    const viewportController = this.viewportTrackControllers.get(map);
    if (viewportController?.isManaged(placeId)) {
      viewportController.setHidden(placeId, !viewportController.isHidden(placeId));
      return;
    }

    const sourceId = `dynamic-overlay-${placeId}`;
    const lineLayerId = `${sourceId}-line`;
    const hitareaLayerId = `${sourceId}-hitarea`;

    if (map.getSource(sourceId)) {
      const lineLayer = map.getLayer(lineLayerId);
      if (lineLayer) {
        const currentVisibility: unknown = map.getLayoutProperty(lineLayerId, 'visibility');
        const nowVisible = currentVisibility === 'none';
        this.setDynamicOverlayVisibility(map, placeId, nowVisible);
        this.recordTrackUserVisibility(map, placeId, nowVisible);
      }
    } else {
      const style = getStyleForPlace(undefined, placeId, place);
      const currentSettings = MapState.for(map).getCurrentSettings();
      this.addDynamicOverlayLayers(map, place.overlay.geojson, sourceId, lineLayerId, hitareaLayerId, style, placeId, place.overlay.pathLabels ?? [], place.trackZoom, currentSettings?.showLabels ?? true, place.filePath);
      MapState.for(map).setTrack(placeId, {
        place,
        settings: MapState.for(map).getCurrentSettings()!,
        trackIndex: -1,
        renderSignature: this.getTrackRenderSignature(place, undefined),
      });
      this.recordTrackUserVisibility(map, placeId, true);
    }
  }

  private applyZoomRange<T extends maplibregl.LayerSpecification>(layer: T, zoom?: ZoomRange): T {
    if (zoom?.minZoom !== undefined) layer.minzoom = zoom.minZoom;
    if (zoom?.maxZoom !== undefined) layer.maxzoom = toGlMaxZoom(zoom.maxZoom);
    return layer;
  }

  private addDynamicOverlayLayers(map: maplibregl.Map, geojson: GeoJSON.GeoJSON, sourceId: string, lineLayerId: string, hitareaLayerId: string, style: CompleteTrackStyle & { outline: boolean }, placeId: string, pathLabels: GeoJSON.Feature[] = [], zoom?: ZoomRange, showLabels = true, sourcePath?: string): void {
    const outlineLayerId = `${lineLayerId}-outline`;
    const routeLabelLayerId = `${lineLayerId}-route-label`;
    const directionLayerId = `${lineLayerId}-direction`;
    const endpointLayerId = `${lineLayerId}-endpoints`;

    // Merge path labels into the source only here, leaving place.overlay.geojson untouched.
    const endpointFeatures = trackEndpointFeatures(geojson);
    const sourceData: GeoJSON.GeoJSON = geojson.type === 'FeatureCollection'
      ? { ...geojson, features: [...geojson.features, ...pathLabels, ...endpointFeatures] }
      : geojson;

    const existingSource = map.getSource<maplibregl.GeoJSONSource>(sourceId);
    if (existingSource) {
      existingSource.setData(sourceData);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: sourceData
      });
    }

    const dashArray = style.dashArray.length > 0 ? style.dashArray : undefined;

    if (style.outline && !map.getLayer(outlineLayerId)) {
      const outlinePaint: Record<string, unknown> = {
        'line-color': style.outlineColor,
        'line-width': style.outlineWeight,
        'line-opacity': style.outlineOpacity
      };
      if (dashArray) {
        outlinePaint['line-dasharray'] = dashArray;
      }

      map.addLayer(this.applyZoomRange({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: outlinePaint
      }, zoom));
    }

    // Gradient coloring gives each segment its own stroke: a feature's own
    // properties override the place style.
    const paint: Record<string, unknown> = {
      'line-color': ['coalesce', ['get', 'stroke'], style.color],
      'line-width': ['coalesce', ['get', 'stroke-width'], style.weight],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], style.opacity]
    };
    if (dashArray) {
      paint['line-dasharray'] = dashArray;
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer(this.applyZoomRange({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint
      }, zoom));
    }

    const arrowScale = MapState.for(map).getCurrentBlockSettings()?.trackDirectionArrows ?? 1;
    if (arrowScale > 0 && !map.getLayer(directionLayerId)) {
      // The base map's own one-way "arrow" sprite is a fixed raster image that
      // cannot be recoloured or outlined, and stays low-contrast on a bold coloured
      // track. Places draws its own chevron instead: dark with a thin white halo to
      // read against the line, symmetric about the icon centre for icon-anchor
      // 'center' to land its tip on the line.
      const directionImage = ensureTrackDirectionArrowImage(map);
      map.addLayer({
        id: directionLayerId, type: 'symbol', source: sourceId, minzoom: Math.max(zoom?.minZoom ?? 0, 10),
        ...(zoom?.maxZoom !== undefined ? { maxzoom: toGlMaxZoom(zoom.maxZoom) } : {}),
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 260, 'icon-image': directionImage, 'icon-size': 1.25 * arrowScale, 'icon-anchor': 'center', 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-keep-upright': false, 'icon-allow-overlap': false, 'icon-ignore-placement': true, 'icon-padding': 8 },
        paint: { 'icon-color': ['coalesce', ['get', 'stroke'], style.color], 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.25, 'icon-opacity': ['coalesce', ['get', 'stroke-opacity'], style.opacity] }
      });
    } else if (arrowScale <= 0 && map.getLayer(directionLayerId)) {
      map.removeLayer(directionLayerId);
    }
    if (!map.getLayer(endpointLayerId)) {
      map.addLayer({
        id: endpointLayerId, type: 'symbol', source: sourceId,
        filter: ['has', '_placesTrackEndpoint'],
        layout: { 'text-field': ['get', '_placesTrackEndpoint'], 'text-size': 12, 'text-allow-overlap': true },
        paint: { 'text-color': style.color, 'text-halo-color': '#fff', 'text-halo-width': 1.5 }
      });
    }

    if (!map.getLayer(hitareaLayerId)) {
      map.addLayer(this.applyZoomRange({
        id: hitareaLayerId,
        type: 'line',
        source: sourceId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        paint: {
          'line-color': 'transparent',
          'line-width': 15,
          'line-opacity': 0
        }
      }, zoom));
    }

    this.addDynamicWaypointLayers(map, sourceId, lineLayerId, style, zoom, showLabels, sourcePath);
    // After the waypoints, putting the path labels above them: MapLibre places
    // symbols from the top layer down, and whatever is placed first wins the
    // collision. Added first, these lost every contest with a waypoint name.
    if (showLabels && !map.getLayer(routeLabelLayerId)) {
      this.addDynamicRouteLabelLayer(map, sourceId, routeLabelLayerId, zoom);
    }
    this.registerTrackLineLayer(map, hitareaLayerId, placeId);
  }

  // Waypoints (GPX `<wpt>` Point features carried in the same source as the track line) render as
  // part of the track overlay, sharing its show/hide lifecycle. Path labels are excluded via
  // `route_label_point` - they render through the route-label symbol layer, not as waypoint circles.
  private addDynamicWaypointLayers(map: maplibregl.Map, sourceId: string, lineLayerId: string, style: CompleteTrackStyle & { outline: boolean }, zoom?: ZoomRange, showLabels = true, sourcePath?: string): void {
    const pointsLayerId = `${lineLayerId}-points`;
    const pointsLabelLayerId = `${lineLayerId}-points-label`;

    if (!map.getLayer(pointsLayerId)) {
      map.addLayer(this.applyZoomRange({
        id: pointsLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'route_label_point']], ['!', ['has', '_placesTrackEndpoint']]],
        paint: {
          'circle-radius': ['coalesce', ['get', 'circle-radius'], 5],
          'circle-color': ['coalesce', ['get', 'marker-color'], style.color],
          'circle-opacity': ['coalesce', ['get', 'fill-opacity'], 0.9],
          'circle-stroke-color': ['coalesce', ['get', 'stroke'], '#fff'],
          'circle-stroke-width': ['coalesce', ['get', 'stroke-width'], 2],
          'circle-stroke-opacity': 1
        }
      }, zoom));
      this.wireWaypointClick(map, pointsLayerId, sourcePath);
    }

    if (showLabels && !map.getLayer(pointsLabelLayerId)) {
      map.addLayer(this.applyZoomRange({
        id: pointsLabelLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'route_label_point']], ['!', ['has', '_placesTrackEndpoint']], ['!', ['has', '_placesWaypointLabelApplied']], ['has', 'name']],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-anchor': 'top',
          'text-offset': [0, 0.8],
          'text-optional': true
        },
        paint: createMapLabelPaint()
      }, zoom));
    }
  }

  // Record a track hitarea layer and the place that owns it. `placeId` is
  // undefined for the shared viewport bucket, whose features carry `_placeId`
  // individually. This registry is the only record of the layer/place link: no
  // id is ever parsed back out of a layer name.
  private registerTrackLineLayer(map: maplibregl.Map, hitareaLayerId: string, placeId?: string): void {
    let layers = this.trackLineLayers.get(map);
    if (!layers) {
      layers = new Map<string, string | undefined>();
      this.trackLineLayers.set(map, layers);
    }
    MapLibreHelper.addPointerCursor(map, hitareaLayerId);
    layers.set(hitareaLayerId, placeId);
    this.wireTrackLineClick(map);
  }

  // ONE click handler for every track line on the map. Clicking a place's
  // trackLayer opens the same popup as its marker (name link and per-place
  // actions) without toggling the track's visibility, keeping those actions
  // reachable from the line itself; the place resolves fresh from MapState at
  // click time.

  // Registration happens while tracks are added, after onMapLoad wires the marker
  // and waypoint handlers, which claim their own clicks first.
  private wireTrackLineClick(map: maplibregl.Map): void {
    if (this.trackLineClickWiredMaps.has(map)) return;
    this.trackLineClickWiredMaps.add(map);

    const applySharedTrackPoint = (event: Event): void => {
      const detail = (event as CustomEvent<{ trackPath?: string; latitude?: number; longitude?: number }>).detail;
      if (!detail || detail.latitude === undefined || detail.longitude === undefined) return;
      const mapState = MapState.for(map);
      const exactPlace = mapState.getCurrentPlaces().find(candidate => candidate.filePath === detail.trackPath);
      if (detail.trackPath && !exactPlace) return;
      const place = exactPlace ?? mapState.getCurrentPlaces().find(candidate => hasTrackData(candidate));
      if (!place) return;
      const settings = mapState.getCurrentSettings() ?? ({} as CommonMapSettings);
      const coordinate = { latitude: detail.latitude, longitude: detail.longitude };
      logger.scope('TrackInteractions').debug('shared track point applied to map', {
        placeId: getPlaceId(place),
        trackPath: place.filePath,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        detailsMode: settings.trackDetails,
      });
      if (settings.trackDetails === 'panel') {
        this.showTrackInspectionPanel(map, place, coordinate, settings);
      } else {
        this.createPopup(map, place, [coordinate.longitude, coordinate.latitude], settings, { toggleOverlay: false, inspectTrack: true });
      }
    };
    const mapContainer = map.getContainer();
    const document = mapContainer.ownerDocument;
    mapContainer.addEventListener(TRACK_INSPECTION_REQUEST_EVENT, applySharedTrackPoint);
    document.addEventListener(TRACK_POINT_SELECT_EVENT, applySharedTrackPoint);
    void map.once('remove', () => {
      mapContainer.removeEventListener(TRACK_INSPECTION_REQUEST_EVENT, applySharedTrackPoint);
      document.removeEventListener(TRACK_POINT_SELECT_EVENT, applySharedTrackPoint);
    });

    map.on('click', (e) => {
      if (e.defaultPrevented) return;

      const layers = this.trackLineLayers.get(map);
      const activeLayerIds = layers ? [...layers.keys()].filter(id => map.getLayer(id)) : [];
      if (activeLayerIds.length === 0) return;

      const mapState = MapState.for(map);
      const seen = new Set<string>();
      const places: MapPlace[] = [];
      const hitTolerance = 5;
      const hitBox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - hitTolerance, e.point.y - hitTolerance],
        [e.point.x + hitTolerance, e.point.y + hitTolerance],
      ];
      const hitFeatures = map.queryRenderedFeatures(hitBox, { layers: activeLayerIds });
      // queryRenderedFeatures returns topmost first, and stacked tracks list in draw order.
      for (const feature of hitFeatures) {
        const placeId = typeof feature.properties?._placeId === 'string'
          ? feature.properties._placeId
          : layers?.get(feature.layer.id);
        if (!placeId || seen.has(placeId)) continue;
        seen.add(placeId);
        const place = mapState.getPlaceById(placeId);
        if (place) places.push(place);
      }
      logger.scope('TrackInteractions').debug('track-line click resolved', {
        activeLayerCount: activeLayerIds.length,
        hitFeatureCount: hitFeatures.length,
        placeCount: places.length,
        placeIds: [...seen],
      });
      if (places.length === 0) return;

      e.preventDefault();
      const settings = mapState.getCurrentSettings() ?? ({} as CommonMapSettings);
      const coordinates: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (places.length === 1) {
        dispatchMapTrackSelection(map.getContainer(), { place: places[0], coordinate: { longitude: coordinates[0], latitude: coordinates[1] }, intent: 'preview', source: 'map-click' });
        if (settings.trackDetails === 'panel') {
          this.showTrackInspectionPanel(map, places[0], { latitude: coordinates[1], longitude: coordinates[0] }, settings);
        } else {
          this.createPopup(map, places[0], coordinates, settings, { toggleOverlay: false, inspectTrack: true });
        }
        return;
      }
      this.openOverlappingTracksPopup(map, places, coordinates, settings);
    });
  }

  // Several tracks under one point, in ONE popup: every place keeps its own name
  // link and actions, topmost first, and selecting any of them is a single click.
  private openOverlappingTracksPopup(map: maplibregl.Map, places: MapPlace[], coordinates: [number, number], settings: CommonMapSettings): void {
    const onPlaceAction = settings.onPlaceAction ?? MapState.for(map).getCurrentSettings()?.onPlaceAction;
    const closePopup = () => closeExistingPopups('.maplibregl-popup, .mapboxgl-popup');

    const content = buildMultiPlacePopupContent({
      title: `${places.length} tracks here`,
      places: places.map(place => ({
        icon: place.icon,
        name: place.name,
        subtitle: place.subtitle,
        isLink: !!place.filePath,
        linkPath: place.filePath,
        onLinkClick: place.filePath ? (linkPath) => void this.app.workspace.openLinkText(linkPath, '') : undefined,
        placeActions: place.actions,
        onPlaceAction: onPlaceAction ? (actionId, state) => onPlaceAction(place, actionId, state) : undefined,
        closePopup,
      })),
    });

    const popup = MapLibreHelper.openPopup(map, coordinates, content);

    // Give each section the same note content a single-place popup shows. The
    // popup scrolls, keeping several enriched sections usable.
    const sections = content.querySelectorAll<HTMLElement>('.places-popup-multi-place');
    places.forEach((place, index) => {
      const section = sections.item(index);
      if (section && place.filePath) {
        this.enrichPlaceSection(place, section, popup, content);
        // Inspecting is per-section only here: a single-place popup loads its track
        // details automatically, but an overlapping stack cannot inspect every
        // track at once, and each section offers it on demand. Selecting is a
        // separate concern - applySelectionActions injects a '📌 Select this
        // track' action that commits the selection parameter - and this row must
        // not claim to select.
        const actionsHost = section.querySelector<HTMLElement>('.places-popup-actions') ?? section.createDiv({ cls: 'places-popup-actions' });
        const inspectItem = actionsHost.createDiv({ cls: 'places-context-menu-item' });
        inspectItem.createSpan({ text: '🔍', cls: 'places-context-menu-icon' });
        const inspectLabel = inspectItem.createSpan({ text: 'Inspect track' });
        let inspecting = false;
        inspectItem.addEventListener('click', () => {
          if (inspecting) return;
          dispatchMapTrackSelection(map.getContainer(), { place, coordinate: { longitude: coordinates[0], latitude: coordinates[1] }, intent: 'preview', source: 'popup-action' });
          if (settings.trackDetails === 'panel') {
            this.showTrackInspectionPanel(map, place, { latitude: coordinates[1], longitude: coordinates[0] }, settings);
            closePopup();
            return;
          }
          inspecting = true;
          inspectLabel.setText('Loading track details...');
          void settings.inspectTrack?.(place, { latitude: coordinates[1], longitude: coordinates[0] }).then(inspection => {
            inspectItem.remove();
            if (!inspection) return;
            const details = section.createDiv({ cls: 'places-track-inspection' });
            for (const field of inspection.fields) details.createDiv({ text: `${field.label}: ${field.value}`, cls: 'places-track-inspection-row' });
            popup.setDOMContent(content);
          });
        });
      }
    });
  }

  private showTrackInspectionPanel(map: maplibregl.Map, place: MapPlace, coordinate: { latitude: number; longitude: number }, settings: CommonMapSettings): void {
    closeExistingPopups('.maplibregl-popup, .mapboxgl-popup');
    let panel = this.trackInspectionPanels.get(map);
    if (!panel) {
      panel = new TrackDetailsPanel({
        container: map.getContainer(),
        openLink: (linkPath) => void this.app.workspace.openLinkText(linkPath, ''),
        // The close button disposes the panel internally; dropping this entry is
        // what lets the next track click build a fresh one.
        onDispose: () => this.trackInspectionPanels.delete(map),
      });
      this.trackInspectionPanels.set(map, panel);
      getMapLibreResourceRegistry(map).registerDisposer('disposer', 'track-inspection-panel', () => {
        this.trackInspectionPanels.get(map)?.dispose();
      });
    }
    panel.show(place, coordinate, settings.inspectTrack);
  }

  // Record a waypoint-circle layer and the note its points link back to, then
  // ensure the single map-level click handler exists. One batched query resolves
  // the topmost waypoint across every registered layer.
  private wireWaypointClick(map: maplibregl.Map, layerId: string, sourcePath?: string): void {
    let wired = this.wiredWaypointClickLayers.get(map);
    if (!wired) {
      wired = new Map<string, string | undefined>();
      this.wiredWaypointClickLayers.set(map, wired);
    }
    wired.set(layerId, sourcePath);
    MapLibreHelper.addPointerCursor(map, layerId);

    if (this.waypointClickWiredMaps.has(map)) return;
    this.waypointClickWiredMaps.add(map);

    // Deliberately no defaultPrevented guard: waypoints claim the click even
    // after the marker handler, and ahead of the track-line handler.
    map.on('click', (e) => {
      const layers = this.wiredWaypointClickLayers.get(map);
      const activeLayerIds = layers ? [...layers.keys()].filter(id => map.getLayer(id)) : [];
      if (activeLayerIds.length === 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: activeLayerIds });
      if (features.length === 0) return;

      e.preventDefault();
      const feature = features[0];
      this.handleOverlayPointClick(map, feature, layers?.get(feature.layer.id));
    });
  }

  private addDynamicRouteLabelLayer(map: maplibregl.Map, sourceId: string, layerId: string, zoom?: ZoomRange): void {
    map.addLayer(this.applyZoomRange(createPathLabelLayerConfig({
      sourceId,
      layerId
    }) as maplibregl.LayerSpecification, zoom));
  }

  private getViewportTrackBucketKey(style: CompleteTrackStyle & { outline: boolean }, zoom?: ZoomRange): string {
    const dashArray = style.dashArray.length > 0 ? style.dashArray : [];
    return [
      style.outline ? 'outline' : 'plain',
      dashArray.length > 0 ? `dash:${dashArray.join(',')}` : 'solid',
      `min:${zoom?.minZoom ?? ''}`,
      `max:${zoom?.maxZoom ?? ''}`,
    ].join('|');
  }

  // The geometry a track renders from: gradient-coloured segments when the place
  // asks for elevation/grade/speed/pace colouring and carries the data that mode
  // needs, otherwise the plain overlay.
  // Gradient output is a run of short LineStrings each carrying its own `stroke`,
  // which the shared bucket layer already honours through
  // `['coalesce', ['get', 'stroke'], ...]` - no separate source needed.
  private resolveTrackGeoJson(place: MapPlace, settings?: CommonMapSettings): GeoJSON.GeoJSON | undefined {
    const geojson = place.overlay?.geojson;
    if (!geojson) return undefined;
    const colorBy = place.trackColorBy ?? settings?.trackColorBy;
    if (!colorBy || colorBy === 'none') return geojson;

    const hasData = (colorBy === 'elevation' || colorBy === 'grade')
      ? Boolean(place.overlay?.track?.elevation)
      : Boolean(place.overlay?.track?.time?.length);
    if (!hasData) return geojson;

    return createGradientColoredGeoJson(
      place,
      colorBy,
      settings?.trackGradeWindow ?? DEFAULT_GRADE_WINDOW,
      settings?.trackSpeedWindow,
    ) ?? geojson;
  }

  private createViewportTrackFeatures(place: MapPlace, visibility: TrackVisibilityResult, settings: CommonMapSettings): GeoJSON.Feature[] {
    const geojson = this.resolveTrackGeoJson(place, settings);
    if (!geojson) return [];

    const placeId = getPlaceId(place);
    const style = getStyleForPlace(visibility, placeId, place);
    const features: GeoJSON.Feature[] = [];

    for (const feature of getGeoJsonFeatures(geojson)) {
      const properties: Record<string, unknown> = { ...(feature.properties ?? {}) };
      const isPointFeature = feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint';
      if (!properties.stroke) properties.stroke = style.color;
      // style.weight is the line thickness; on a waypoint point it becomes the
      // circle's outline width: a bold track gives waypoints a bold ring.
      // Apply it to lines only - a point's own simplestyle stroke-width still wins.
      if (!isPointFeature && properties['stroke-width'] === undefined) properties['stroke-width'] = style.weight;
      if (properties['stroke-opacity'] === undefined) properties['stroke-opacity'] = style.opacity;
      if (style.outline) {
        if (properties['outline-color'] === undefined) properties['outline-color'] = style.outlineColor;
        if (properties['outline-width'] === undefined) properties['outline-width'] = style.outlineWeight;
        if (properties['outline-opacity'] === undefined) properties['outline-opacity'] = style.outlineOpacity;
      }
      properties._placeId = placeId;
      // Waypoint popups in the shared bucket read their source backlink off the feature (multiple
      // tracks share one click handler, and there is no single fallback path to pass).
      if (isPointFeature) {
        properties._overlaySource = place.filePath;
      }

      features.push({
        ...feature,
        properties,
      });
    }
    // Endpoints come from the original geometry, not the gradient split: a
    // coloured track gets one start and one end rather than one per segment.
    for (const endpoint of trackEndpointFeatures(place.overlay?.geojson ?? geojson)) {
      features.push({ ...endpoint, properties: { ...endpoint.properties, _placeId: placeId, stroke: style.color } });
    }

    if (settings.showLabels) {
      for (const labelFeature of place.overlay?.pathLabels ?? []) {
        features.push({
          ...labelFeature,
          properties: {
            ...(labelFeature.properties ?? {}),
            _placeId: placeId,
          },
        });
      }
    }

    return features;
  }

  private updateViewportTrackBucket(map: maplibregl.Map, sourceId: string, data: GeoJSON.FeatureCollection, style: CompleteTrackStyle & { outline: boolean }, zoom: ZoomRange | undefined, showLabels: boolean): string[] {
    const lineLayerId = `${sourceId}-line`;
    const outlineLayerId = `${lineLayerId}-outline`;
    const hitareaLayerId = `${sourceId}-hitarea`;
    const routeLabelLayerId = `${lineLayerId}-route-label`;
    const directionLayerId = `${lineLayerId}-direction`;
    const endpointLayerId = `${lineLayerId}-endpoints`;

    const source = map.getSource<maplibregl.GeoJSONSource>(sourceId);
    if (source) {
      source.setData(data);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data,
      });
    }

    const dashArray = style.dashArray.length > 0 ? style.dashArray : undefined;

    if (style.outline && !map.getLayer(outlineLayerId)) {
      const outlinePaint: Record<string, unknown> = {
        'line-color': ['coalesce', ['get', 'outline-color'], style.outlineColor],
        'line-width': ['coalesce', ['get', 'outline-width'], style.outlineWeight],
        'line-opacity': ['coalesce', ['get', 'outline-opacity'], style.outlineOpacity],
      };
      if (dashArray) {
        outlinePaint['line-dasharray'] = dashArray;
      }

      map.addLayer(this.applyZoomRange({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: outlinePaint,
      }, zoom));
    }

    const paint: Record<string, unknown> = {
      'line-color': ['coalesce', ['get', 'stroke'], style.color],
      'line-width': ['coalesce', ['get', 'stroke-width'], style.weight],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], style.opacity],
    };
    if (dashArray) {
      paint['line-dasharray'] = dashArray;
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer(this.applyZoomRange({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint,
      }, zoom));
    }
    const arrowScale = MapState.for(map).getCurrentBlockSettings()?.trackDirectionArrows ?? 1;
    if (arrowScale > 0 && !map.getLayer(directionLayerId)) {
      const directionImage = ensureTrackDirectionArrowImage(map);
      map.addLayer({ id: directionLayerId, type: 'symbol', source: sourceId, minzoom: Math.max(zoom?.minZoom ?? 0, 10), ...(zoom?.maxZoom !== undefined ? { maxzoom: toGlMaxZoom(zoom.maxZoom) } : {}), filter: ['==', ['geometry-type'], 'LineString'], layout: { 'symbol-placement': 'line', 'symbol-spacing': 260, 'icon-image': directionImage, 'icon-size': 1.25 * arrowScale, 'icon-anchor': 'center', 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-keep-upright': false, 'icon-allow-overlap': false, 'icon-ignore-placement': true, 'icon-padding': 8 }, paint: { 'icon-color': ['coalesce', ['get', 'stroke'], style.color], 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.25, 'icon-opacity': ['coalesce', ['get', 'stroke-opacity'], style.opacity] } });
    } else if (arrowScale <= 0 && map.getLayer(directionLayerId)) {
      map.removeLayer(directionLayerId);
    }
    if (!map.getLayer(endpointLayerId)) {
      map.addLayer({ id: endpointLayerId, type: 'symbol', source: sourceId, filter: ['has', '_placesTrackEndpoint'], layout: { 'text-field': ['get', '_placesTrackEndpoint'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': ['coalesce', ['get', 'stroke'], style.color], 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
    }

    if (!map.getLayer(hitareaLayerId)) {
      map.addLayer(this.applyZoomRange({
        id: hitareaLayerId,
        type: 'line',
        source: sourceId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        paint: {
          'line-color': 'transparent',
          'line-width': 15,
          'line-opacity': 0,
        },
      }, zoom));
    }

    if (!showLabels && map.getLayer(routeLabelLayerId)) {
      this.removeMapLayersAndSources(map, [routeLabelLayerId], []);
    }

    // Track waypoints render in the shared bucket too, and a bulk auto-shown line always carries its
    // waypoints (they leave the bucket data when the track hides - visibility stays biconditional).
    this.addDynamicWaypointLayers(map, sourceId, lineLayerId, style, zoom, showLabels);
    // Above the waypoints: symbols are placed from the top layer down, and the
    // first placed wins the collision, and path labels are added last.
    if (showLabels && !map.getLayer(routeLabelLayerId)) {
      this.addDynamicRouteLabelLayer(map, sourceId, routeLabelLayerId, zoom);
    }
    this.registerTrackLineLayer(map, hitareaLayerId);
    const pointLayerIds = [`${lineLayerId}-points`, `${lineLayerId}-points-label`, directionLayerId, endpointLayerId];

    return style.outline
      ? [hitareaLayerId, routeLabelLayerId, lineLayerId, outlineLayerId, ...pointLayerIds]
      : [hitareaLayerId, routeLabelLayerId, lineLayerId, ...pointLayerIds];
  }

  // @param gradeWindow Span the rolling grade is computed over
  private showGeoJsonOverlayAndFitBounds(map: maplibregl.Map, place: MapPlace, visibility: TrackVisibilityResult | undefined, settings?: CommonMapSettings, colorBy?: string, gradeWindow?: MetricWindow, fitBounds = true): void {
    if (!place.overlay?.geojson) return;

    const placeId = getPlaceId(place);
    const sourceId = `dynamic-overlay-${placeId}`;
    const lineLayerId = `${sourceId}-line`;
    const hitareaLayerId = `${sourceId}-hitarea`;

    const style = getStyleForPlace(visibility, placeId, place);
    const mapState = MapState.for(map);
    const currentSettings = settings ?? mapState.getCurrentSettings();

    // Elevation and grade colour from stored elevations; speed and pace from
    // stored per-point times. A track missing what its mode needs draws plain.
    const useGradientColoring = (colorBy === 'elevation' || colorBy === 'grade')
      ? Boolean(place.overlay.track?.elevation)
      : (colorBy === 'speed' || colorBy === 'pace') && Boolean(place.overlay.track?.time?.length);

    if (useGradientColoring) {
      const coloredGeojson = createGradientColoredGeoJson(place, colorBy as TrackColorBy, gradeWindow ?? DEFAULT_GRADE_WINDOW, currentSettings?.trackSpeedWindow);
      if (coloredGeojson) {
        this.addDynamicOverlayLayers(map, coloredGeojson, sourceId, lineLayerId, hitareaLayerId, style, placeId, place.overlay.pathLabels ?? [], place.trackZoom, currentSettings?.showLabels ?? true, place.filePath);
      } else {
        this.addDynamicOverlayLayers(map, place.overlay.geojson, sourceId, lineLayerId, hitareaLayerId, style, placeId, place.overlay.pathLabels ?? [], place.trackZoom, currentSettings?.showLabels ?? true, place.filePath);
      }
    } else {
      this.addDynamicOverlayLayers(map, place.overlay.geojson, sourceId, lineLayerId, hitareaLayerId, style, placeId, place.overlay.pathLabels ?? [], place.trackZoom, currentSettings?.showLabels ?? true, place.filePath);
    }

    if (currentSettings) {
      mapState.setTrack(placeId, {
        place,
        settings: currentSettings,
        trackIndex: -1,
        renderSignature: this.getTrackRenderSignature(place, visibility),
      });
    }

    const overlayBounds = PlacesBoundingBox.fromGeoJSON(place.overlay.geojson);
    if (fitBounds && overlayBounds.isValid()) {
      withProgrammaticCamera(map, () => map.fitBounds(overlayBounds.getLngLatBounds(), { padding: 50, animate: false, pitch: map.getPitch(), bearing: map.getBearing() }));
    }
  }

  private clearTrackLayers(map: maplibregl.Map, trackIndex: number): void {
    const prefix = `trackLayer-${trackIndex}`;

    this.removeMapLayersAndSources(
      map,
      [
        `${prefix}-route-path`,
        `${prefix}-route-outline`,
        `${prefix}-frequency-line`,
        `${prefix}-outline`
      ],
      [
        `${prefix}-route`,
        `${prefix}-frequency`,
        `${prefix}-outline`
      ]
    );

    let segmentIndex = 0;
    while (segmentIndex < 1000) { // Safety limit to prevent infinite loops
      const segmentLayerId = `${prefix}-segment-${segmentIndex}`;
      if (!map.getLayer(segmentLayerId)) break;

      this.removeMapLayersAndSources(
        map,
        [segmentLayerId],
        [`${prefix}-segment-source-${segmentIndex}`]
      );
      segmentIndex++;
    }
  }

  protected createPopup(map: maplibregl.Map, place: MapPlace | undefined, coordinates: [number, number], settings: CommonMapSettings, options?: { toggleOverlay?: boolean; inspectTrack?: boolean }): void {
    if (!place) return;

    // A place from JSON serialization may have lost large overlay data to MapLibre's
    // property limits; MapState holds the original.
    const mapState = MapState.for(map);
    const originalPlaces = mapState.getCurrentPlaces();
    const placeId = getPlaceId(place);
    const originalPlace = originalPlaces.find(p => getPlaceId(p) === placeId) ?? place;
    const onPlaceAction = settings.onPlaceAction ?? mapState.getCurrentSettings()?.onPlaceAction;

    // A GPX waypoint carries its own fields (description, photos, type,
    // elevation) that the generic place popup has nowhere to show.
    if (originalPlace.metadata?.isWaypoint) {
      MapLibreHelper.openPopup(map, coordinates, buildWaypointPopupContent({
        place: originalPlace,
        units: this.units,
        onSourceLinkClick: (linkPath) => void this.app.workspace.openLinkText(linkPath, ''),
      }));
      return;
    }

    MapLibreHelper.createPopup(map, {
      content: {
        icon: place.icon,
        name: place.name,
        subtitle: originalPlace.subtitle,
        isLink: !!place.filePath,
        linkPath: place.filePath,
        placeActions: originalPlace.actions,
        onPlaceAction: onPlaceAction ? (actionId, state) => onPlaceAction(originalPlace, actionId, state) : undefined,
        debug: settings.popupDebug
          ? { fields: MarkerStyleService.styleMetadataEntries(originalPlace), filterRules: MarkerStyleService.explainPlaceMarkerFilter(originalPlace, settings.popupDebug.markerFilter) }
          : undefined
      },
      coordinates,
      app: this.app,
      onAdd: (createdPopup) => {
        // Skip toggle for non-interactive places (they're already visible as the main content)
        if ((options?.toggleOverlay ?? true) && !isNonInteractivePlace(originalPlace) && originalPlace.overlay) {
          this.toggleGeoJsonOverlay(map, originalPlace);
        }

        if (place.filePath) {
          const popupElement = createdPopup.getElement();
          const contentDiv = popupElement?.querySelector('.places-popup-content');
          if (contentDiv?.instanceOf(HTMLElement)) {
            this.enrichPlaceSection(place, contentDiv, createdPopup);
            if (options?.inspectTrack && settings.inspectTrack) {
              const inspectionEl = contentDiv.createDiv({ cls: 'places-track-inspection places-popup-loading', text: 'Loading track details...' });
              void settings.inspectTrack(originalPlace, { latitude: coordinates[1], longitude: coordinates[0] })
                .then(inspection => {
                  inspectionEl.empty();
                  inspectionEl.removeClass('places-popup-loading');
                  if (!inspection?.fields.length) {
                    inspectionEl.remove();
                    return;
                  }
                  for (const field of inspection.fields) {
                    const row = inspectionEl.createDiv({ cls: 'places-track-inspection-row' });
                    row.createSpan({ cls: 'places-track-inspection-label', text: `${field.label}: ` });
                    row.createSpan({ text: field.value });
                  }
                  createdPopup.setDOMContent(contentDiv);
                })
                .catch(() => inspectionEl.remove());
            }
          }
        }
      }
    });
  }

  // Called by the single-place popup and by each section of a multi-place popup.
  // `sectionEl` receives the content; `rootEl` is what gets handed back to the
  // popup for remeasuring - for a multi-place popup those differ, and re-setting
  // the section would replace the whole popup with one of its sections.
  private enrichPlaceSection(place: MapPlace, sectionEl: HTMLElement, popup: maplibregl.Popup, rootEl: HTMLElement = sectionEl): void {
    const loadingEl = sectionEl.createDiv({
      text: "Loading...",
      cls: "places-popup-loading"
    });

    let popupClosed = false;
    popup.on('close', () => { popupClosed = true; });

    void (async () => {
      try {
        const rendered = await renderPopupContentCore(this.app, place, sectionEl);
        if (rendered) {
          if (popupClosed) {
            rendered.dispose();
          } else {
            popup.on('close', () => rendered.dispose());
          }
        }

        if (popupClosed) return;

        // { once: true } auto-removes the listener after firing (prevents a leak per image).
        const images = sectionEl.querySelectorAll('img');
        images.forEach(img => {
          img.addEventListener('load', () => {
            if (!popupClosed) {
              popup.setDOMContent(rootEl);
            }
          }, { once: true });
        });

        popup.setDOMContent(rootEl);

        if (loadingEl.parentElement) {
          loadingEl.remove();
        }
      } catch (error) {
        if (!popupClosed && loadingEl.parentElement) {
          loadingEl.textContent = "Error loading content";
        }
        logger.scope('Places').error(`Failed to load content for ${place.filePath}:`, error);
      }
    })();
  }

  // @param willCluster True if clustering will be enabled (the clustering manager may not exist yet)
  private showInitialTracks(map: maplibregl.Map, placeStates: PlaceTrackState[], visibility: TrackVisibilityResult, settings: CommonMapSettings, _shouldShowByDefault: boolean = false, willCluster: boolean = false, perf?: PerformanceMonitor): void {
    // defaultTrackState is already set in initializeMapView (the caller)
    const mapState = MapState.for(map);

    const frequencyStates = placeStates.filter(s => hasTrackData(s.place) && s.place.metadata?.frequency !== undefined);
    const regularStates = placeStates.filter(s => hasTrackData(s.place) && s.place.metadata?.frequency === undefined && !s.place.metadata?.boundsAnchor);

    // Frequency places show regardless of clustering.
    if (frequencyStates.length > 0) {
      this.showMultipleTracks(map, frequencyStates.map(s => s.place), settings);
    }

    // Tracks are only visible when individual markers are (not clusters), and
    // handleClusteringModeChange shows them when clustering becomes inactive.
    if (willCluster) {
      logger.scope('Places').debug(`[Places] Clustering will be active - trackLayers will show when markers are unclustered`);
      return;
    }

    this.setupViewportTrackLoading(map, regularStates.map(s => s.place), visibility, settings, mapState, perf);
  }

  // Tracks the overlay in MapState, where handleClusteringModeChange can hide it.
  private showTrackForPlace(map: maplibregl.Map, place: MapPlace, visibility?: TrackVisibilityResult, settings?: CommonMapSettings): void {
    if (!place.overlay?.geojson) return;

    const placeId = getPlaceId(place);
    const sourceId = `dynamic-overlay-${placeId}`;
    const lineLayerId = `${sourceId}-line`;
    const hitareaLayerId = `${sourceId}-hitarea`;

    const nextSignature = this.getTrackRenderSignature(place, visibility);
    const mapState = MapState.for(map);
    const existingTrack = mapState.getTrack(placeId);
    if (existingTrack && existingTrack.renderSignature !== nextSignature) {
      this.removeDynamicOverlayLayers(map, placeId);
      mapState.removeTrack(placeId);
    }

    if (!map.getSource(sourceId)) {
      const style = getStyleForPlace(visibility, placeId, place);
      const geojson = this.resolveTrackGeoJson(place, settings ?? mapState.getCurrentSettings() ?? undefined) ?? place.overlay.geojson;
      this.addDynamicOverlayLayers(map, geojson, sourceId, lineLayerId, hitareaLayerId, style, placeId, place.overlay.pathLabels ?? [], place.trackZoom, settings?.showLabels ?? true, place.filePath);

      // Use trackIndex = -1 to indicate this is a dynamic overlay (uses placeId-based naming)
      mapState.setTrack(placeId, {
        place,
        settings: settings ?? mapState.getCurrentSettings()!,
        trackIndex: -1,
        renderSignature: nextSignature,
      });
    }
  }

  private getTrackRenderSignature(place: MapPlace, visibility?: TrackVisibilityResult): string {
    const placeId = getPlaceId(place);
    const state = visibility?.placeStateMap.get(placeId);
    return state ? getTrackStateRenderSignature(state) : getPlaceTrackRenderHash(place);
  }

  private handleClusteringModeChange(map: maplibregl.Map, mapState: ReturnType<typeof MapState.for>, settings: CommonMapSettings, isClustering: boolean, _visiblePlaceIds: Set<string>): void {
    const defaultState = mapState.getDefaultTrackState();
    const visibleTracks = mapState.getVisibleTracks();
    const embeddedTrackIndices = mapState.getEmbeddedTrackOverlayIndices();

    if (isClustering) {
      // Regardless of defaultState: tracks only show when markers are unclustered.
      if (Array.from(visibleTracks.values()).some(trackState => trackState.renderMode === 'viewport-batch')) {
        this.viewportTrackCleanups.get(map)?.();
      }

      for (const [placeId, trackState] of visibleTracks.entries()) {
        if (trackState.trackIndex === -1) {
          // Dynamic overlay uses placeId-based naming
          this.removeDynamicOverlayLayers(map, placeId);
        } else {
          // Indexed track uses trackIndex-based naming
          this.removeTrackLayersById(map, trackState.trackIndex);
        }
        mapState.removeTrack(placeId);
      }

      // User-specified overlays (from overlays: setting) are NOT hidden - they remain always visible
      for (const i of embeddedTrackIndices) {
        this.setLayersVisibility(map, [`geojson-overlay-${i}-line`, `geojson-overlay-${i}-line-hitarea`, `geojson-overlay-${i}-circle`], 'none');
        mapState.setGeoJsonOverlayVisible(i, false);
      }
    } else {
      if (defaultState !== 'visible') {
        return;
      }

      for (const i of embeddedTrackIndices) {
        this.setLayersVisibility(map, [`geojson-overlay-${i}-line`, `geojson-overlay-${i}-line-hitarea`, `geojson-overlay-${i}-circle`], 'visible');
        mapState.setGeoJsonOverlayVisible(i, true);
      }

      // The viewport loader owns the auto-shown tracks: it renders them into
      // shared style buckets (a handful of GL sources/layers instead of one
      // source + line/hit-area/outline/label layers per track) and self-manages
      // per pan/zoom via its own moveend/zoomend handlers. Set it up once on the
      // first uncluster; every later uncluster call is a no-op (the #1 early-out
      // against re-selecting the full track set on every pan while unclustered).
      if (this.viewportTrackControllers.has(map)) {
        return;
      }

      // Places with overlay data (multi-segment tracks). Embedded route overlays
      // are boundsAnchor/geojson-overlay layers handled above, and are excluded.
      const placesWithTracks = mapState.getCurrentPlaces()
        .filter(p => hasTrackData(p) && !p.metadata?.frequency && !p.metadata?.boundsAnchor && Boolean(p.overlay));

      this.setupViewportTrackLoading(map, placesWithTracks, settings.trackVisibility, settings, mapState);
    }
  }

  // Layers first (the order MapLibre requires), then sources. Absent ids are ignored.
  private removeMapLayersAndSources(map: maplibregl.Map, layerIds: string[], sourceIds: string[]): void {
    reportMapLibreCleanupIssues(removeLayersAndSources(map, layerIds, sourceIds), 'layer/source removal');
  }

  private setLayersVisibility(map: maplibregl.Map, layerIds: string[], visibility: 'visible' | 'none'): void {
    setLayerVisibility(map, layerIds, visibility);
  }

  // Dynamic overlays use `dynamic-overlay-{placeId}` naming pattern
  private removeDynamicOverlayLayers(map: maplibregl.Map, placeId: string): void {
    reportMapLibreCleanupIssues(removeDynamicOverlay(map, placeId), `dynamic overlay ${placeId}`);
    // The hitarea id is the registry key; dropping it keeps the click handler's
    // activeLayerIds scan proportional to the tracks actually on the map.
    this.trackLineLayers.get(map)?.delete(`dynamic-overlay-${placeId}-hitarea`);
  }

  // Indexed tracks use `trackLayer-{trackIndex}` naming pattern
  private removeTrackLayersById(map: maplibregl.Map, trackIndex: number): void {
    reportMapLibreCleanupIssues(removeTrackLayers(map, trackIndex), `track ${trackIndex}`);
  }

  // Every track intersecting the viewport renders into shared style buckets;
  // offscreen tracks are skipped.
  private setupViewportTrackLoading(map: maplibregl.Map, places: MapPlace[], visibility: TrackVisibilityResult, settings: CommonMapSettings, mapState: ReturnType<typeof MapState.for>, perf?: PerformanceMonitor): void {
    this.viewportTrackCleanups.get(map)?.();
    const viewportBucketPrefix = 'viewport-trackLayers';
    const bucketLayerIds = new Map<string, { layerIds: string[]; sourceId: string }>();
    const bucketMembershipSignatures = new Map<string, string>();
    const renderedViewportPlaceIds = new Set<string>();
    // Tracks the user has toggled off via a marker popup. Excluded from the
    // desired set: hide-one runs without tearing the loader down. Seeded from the
    // surviving per-map record, and re-establishing the loader after a data
    // refresh does not silently un-hide what the user hid.
    const userHiddenPlaceIds = new Set<string>();
    for (const [placeId, visible] of this.trackUserVisibility.get(map) ?? []) {
      if (!visible) userHiddenPlaceIds.add(placeId);
    }
    const filterHiddenPlaceIds = new Set(this.symbolVisibilityHidden.get(map) ?? []);
    const hiddenPlaceIds = {
      has: (placeId: string) => userHiddenPlaceIds.has(placeId) || filterHiddenPlaceIds.has(placeId),
    };

    const removeViewportTrackBuckets = () => {
      for (const bucket of bucketLayerIds.values()) {
        this.removeMapLayersAndSources(map, bucket.layerIds, [bucket.sourceId]);
      }
      bucketLayerIds.clear();
      bucketMembershipSignatures.clear();
      for (const placeId of renderedViewportPlaceIds) {
        mapState.removeTrack(placeId);
      }
      renderedViewportPlaceIds.clear();
    };

    const trackData: Array<{
      place: MapPlace;
      bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
      rendered: boolean;
      pending: boolean;
    }> = [];

    for (const place of places) {
      if (!place.overlay?.geojson) continue;
      try {
        const bbox = PlacesBoundingBox.fromGeoJSON(place.overlay.geojson);
        if (!bbox.isValid()) continue;

        trackData.push({
          place,
          bounds: { minLng: bbox.minLng, maxLng: bbox.maxLng, minLat: bbox.minLat, maxLat: bbox.maxLat },
          rendered: false,
          pending: false
        });
      } catch (error) {
        logger.scope('Places').debug('Skipped overlay with invalid bounds', { name: place?.name, error: getErrorMessage(error) });
      }
    }

    const updateVisibleTracks = () => {
      // Tracks only show when markers are unclustered.
      const clusteringManager = mapState.getClusteringManager();
      if (clusteringManager?.isClustering()) {
        removeViewportTrackBuckets();
        for (const data of trackData) {
          if (data.rendered || data.pending) {
            mapState.removeTrack(getPlaceId(data.place));
          }
          data.rendered = false;
          data.pending = false;
        }
        return;
      }

      const mapBounds = map.getBounds();
      const viewMinLng = mapBounds.getWest();
      const viewMaxLng = mapBounds.getEast();
      const viewMinLat = mapBounds.getSouth();
      const viewMaxLat = mapBounds.getNorth();

      const margin = MapConstants.VIEWPORT_MARGIN_DEGREES;
      const desiredData: typeof trackData = [];

      for (const data of trackData) {
        if (hiddenPlaceIds.has(getPlaceId(data.place))) {
          continue;
        }
        const intersects =
          data.bounds.minLng <= viewMaxLng + margin &&
          data.bounds.maxLng >= viewMinLng - margin &&
          data.bounds.minLat <= viewMaxLat + margin &&
          data.bounds.maxLat >= viewMinLat - margin;

        if (intersects) {
          desiredData.push(data);
        }
      }

      const desiredPlaceIds = new Set(desiredData.map(data => getPlaceId(data.place)));

      let removedCount = 0;
      for (const data of trackData) {
        if ((!data.rendered && !data.pending) || desiredPlaceIds.has(getPlaceId(data.place))) {
          continue;
        }

        const placeId = getPlaceId(data.place);
        mapState.removeTrack(placeId);
        renderedViewportPlaceIds.delete(placeId);
        removedCount++;
        data.rendered = false;
        data.pending = false;
      }

      const dataToAdd = desiredData.filter(data => !data.rendered && !data.pending);

      // Visible set unchanged: every desired track is already rendered and
      // nothing left the viewport. Styles are fixed for the life of this
      // handler: the buckets on the map are already correct - skipping the
      // rebuild avoids re-encoding all visible geometry into setData on every
      // pan/zoom end.
      if (removedCount === 0 && dataToAdd.length === 0) {
        return;
      }

      const bucketPlaces = new Map<string, {
        places: MapPlace[];
        style: CompleteTrackStyle & { outline: boolean };
        zoom?: ZoomRange;
      }>();

      for (const data of desiredData) {
        const placeId = getPlaceId(data.place);
        const style = getStyleForPlace(visibility, placeId, data.place);
        const bucketKey = this.getViewportTrackBucketKey(style, data.place.trackZoom);
        let bucket = bucketPlaces.get(bucketKey);
        if (!bucket) {
          bucket = { places: [], style, zoom: data.place.trackZoom };
          bucketPlaces.set(bucketKey, bucket);
        }
        bucket.places.push(data.place);

        data.rendered = true;
        data.pending = false;
        mapState.setTrack(placeId, {
          place: data.place,
          settings,
          trackIndex: -1,
          renderMode: 'viewport-batch',
          renderSignature: this.getTrackRenderSignature(data.place, visibility),
        });
        renderedViewportPlaceIds.add(placeId);
      }

      const activeBucketSourceIds = new Set<string>();
      this.measureIf(perf, 'viewport-update-trackLayer-buckets', () => {
        for (const [bucketKey, bucket] of bucketPlaces.entries()) {
          const sourceId = `${viewportBucketPrefix}-${hashString36(bucketKey)}`;
          activeBucketSourceIds.add(sourceId);
          const membershipSignature = bucket.places.map(place => getPlaceId(place)).sort().join('\u0001');
          if (bucketMembershipSignatures.get(sourceId) === membershipSignature && bucketLayerIds.has(sourceId)) {
            continue;
          }
          const features = bucket.places.flatMap(place => this.createViewportTrackFeatures(place, visibility, settings));
          const featureCollection: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features,
          };
          const layerIds = this.updateViewportTrackBucket(map, sourceId, featureCollection, bucket.style, bucket.zoom, settings.showLabels);
          bucketLayerIds.set(sourceId, { layerIds, sourceId });
          bucketMembershipSignatures.set(sourceId, membershipSignature);
        }

        for (const [sourceId, bucket] of Array.from(bucketLayerIds.entries())) {
          if (!activeBucketSourceIds.has(sourceId)) {
            this.removeMapLayersAndSources(map, bucket.layerIds, [bucket.sourceId]);
            bucketLayerIds.delete(sourceId);
            bucketMembershipSignatures.delete(sourceId);
          }
        }
      }, {
        buckets: bucketPlaces.size,
        features: Array.from(bucketPlaces.values()).reduce((sum, bucket) => sum + bucket.places.length, 0),
        tracks: desiredData.length,
        zoom: map.getZoom(),
      }, { slowOnly: true });

      const finalRendered = trackData.filter(d => d.rendered || d.pending).length;
      if (dataToAdd.length > 0 || removedCount > 0) {
        logger.scope('Places').info(`[Places] Viewport update: +${dataToAdd.length} -${removedCount} trackLayers (${finalRendered}/${trackData.length} visible)`);
      }
    };

    const updateVisibleTracksWithTiming = (event: 'initial' | 'moveend') => {
      this.measureIf(perf, 'viewport-trackLayer-update-total', updateVisibleTracks, {
        event,
        zoom: map.getZoom(),
        visibleTracks: mapState.getVisibleTracks().size,
        tracks: trackData.length,
      });
    };

    const handleMoveEnd = () => updateVisibleTracksWithTiming('moveend');

    updateVisibleTracksWithTiming('initial');

    // 'moveend' fires for pan AND zoom (a zoom moves the camera), making it the
    // single trigger for the viewport recompute. A separate 'zoomend' listener
    // would double the recompute on every zoom, since zoomend always coincides
    // with moveend.
    map.on('moveend', handleMoveEnd);
    this.viewportTrackCleanups.set(map, () => {
      map.off('moveend', handleMoveEnd);
      removeViewportTrackBuckets();
      this.viewportTrackControllers.delete(map);
    });

    const managedPlaceIds = new Set(trackData.map(data => getPlaceId(data.place)));
    this.viewportTrackControllers.set(map, {
      isManaged: placeId => managedPlaceIds.has(placeId),
      isHidden: placeId => hiddenPlaceIds.has(placeId),
      setHidden: (placeId, hidden) => {
        if (hidden) userHiddenPlaceIds.add(placeId);
        else userHiddenPlaceIds.delete(placeId);
        this.recordTrackUserVisibility(map, placeId, !hidden);
        updateVisibleTracksWithTiming('moveend');
      },
      setFilterHidden: (placeId, hidden) => {
        const changed = hidden ? !filterHiddenPlaceIds.has(placeId) : filterHiddenPlaceIds.delete(placeId);
        if (hidden) filterHiddenPlaceIds.add(placeId);
        if (changed) updateVisibleTracksWithTiming('moveend');
      },
    });
  }

  // @param gradeWindow Span the rolling grade is computed over
  protected showTrackAndFitBounds(map: maplibregl.Map, place: MapPlace, coloringType?: TrackColorBy, gradeWindow?: MetricWindow): void {
    const effectiveColorBy = coloringType ?? place.trackColorBy;
    this.showGeoJsonOverlayAndFitBounds(map, place, undefined, undefined, effectiveColorBy, gradeWindow ?? DEFAULT_GRADE_WINDOW);
  }

  // Overlays are named `overlay-{index}` and tracked in MapState.
  protected showMultipleTracks(map: maplibregl.Map, places: MapPlace[], settings: CommonMapSettings): void {
    const mapState = MapState.for(map);

    places.forEach((place) => {
      if (!place.overlay?.geojson) return;

      const trackIndex = mapState.getNextTrackIndex();
      const placeId = getPlaceId(place);
      mapState.setTrack(placeId, { place, settings, trackIndex, renderSignature: this.getTrackRenderSignature(place, settings.trackVisibility) });

      this.addFrequencyOverlayLayer(map, place, trackIndex);
    });
  }

  private addFrequencyOverlayLayer(map: maplibregl.Map, place: MapPlace, trackIndex: number): void {
    const sourceId = `overlay-${trackIndex}-frequency`;
    const layerId = `overlay-${trackIndex}-frequency-line`;

    const geojson = place.overlay!.geojson;

    const dataWithMetadata: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geojson.features.map(feature => ({
        ...feature,
        properties: {
          ...feature.properties,
          frequency: place.metadata?.frequency || 0,
          contributingFiles: place.metadata?.contributingFiles || []
        }
      }))
    };

    map.addSource(sourceId, {
      type: 'geojson',
      data: dataWithMetadata
    });

    const overlayStyle = place.overlay?.style;
    const featureProps: Record<string, unknown> | null | undefined = geojson.features[0]?.properties;

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': overlayStyle?.color ?? asStyleText(featureProps?.stroke) ?? TRACK_STYLE_DEFAULTS.color,
        'line-width': overlayStyle?.weight ?? asStyleNumber(featureProps?.['stroke-width']) ?? TRACK_STYLE_DEFAULTS.weight,
        'line-opacity': overlayStyle?.opacity ?? asStyleNumber(featureProps?.['stroke-opacity']) ?? TRACK_STYLE_DEFAULTS.opacity
      }
    });

    map.on('click', layerId, (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      // Each opacity-stacking route is in a separate layer (overlay-N-frequency-line),
      // and every one of them is queried at the click point.
      const allLayers = map.getStyle()?.layers || [];
      const frequencyLayerIds = allLayers
        .filter(layer => layer.id.endsWith('-frequency-line'))
        .map(layer => layer.id);

      // Small buffer around the click point, making thin lines easy to hit.
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - 5, e.point.y - 5],
        [e.point.x + 5, e.point.y + 5]
      ];
      const allFeatures = map.queryRenderedFeatures(bbox, { layers: frequencyLayerIds });

      const allContributingFiles = new Set<string>();
      let totalFrequency = 0;

      for (const feature of allFeatures) {
        const featureFrequency = Number(feature.properties?.frequency) || 0;
        totalFrequency += featureFrequency;

        const files = parseContributingFiles(feature.properties?.contributingFiles);
        for (const file of files) {
          allContributingFiles.add(file);
        }
      }

      // Stops POI discovery from also showing a popup.
      e.preventDefault();

      // For opacity stacking, show the actual count of overlapping routes
      const displayFrequency = allContributingFiles.size > 0 ? allContributingFiles.size : totalFrequency;
      MapLibreHelper.createFrequencyPopup(map, e.lngLat, displayFrequency, Array.from(allContributingFiles), this.app);
    });

    MapLibreHelper.addPointerCursor(map, layerId);
  }

  protected showTrack(map: maplibregl.Map, place: MapPlace): void {
    MapLibreHelper.clearExistingTracks(map);
    this.clearTrackLayers(map, 0);

    if (place.overlay?.geojson) {
      this.showTrackForPlace(map, place);
    }
  }

  private extendBoundsWithOverlays(boundingBox: PlacesBoundingBox, overlays: MapRenderRequest['runtime']['overlays'], debug: boolean): void {
    const result = extendBoundingBoxWithOverlays(boundingBox, overlays);
    if (debug) {
      logger.scope('Places').debug('[Places Bounds] Processed overlays:', result.overlays.length, 'bounds:', boundingBox.getLngLatBounds());
    }
  }

  protected getMapOptions(_blockSettings: ResolvedMapConfig): Record<string, unknown> {
    return {
      cancelPendingTileRequestsWhileZooming: true,
      fadeDuration: 0,
      maxTileCacheSize: 256,
      maxTileCacheZoomLevels: 8,
      refreshExpiredTiles: false,
    };
  }

  // Raster basemap tiles fail silently otherwise - MapLibre reports them on the
  // `error` event, which otherwise only reaches the log. Scoped to raster sources
  // because vector overlays surface their own failures through MapLibreOverlays.
  private setupTileFailureReporting(map: maplibregl.Map): void {
    let errorEl: HTMLElement | undefined;
    const monitor = new TileFailureMonitor({
      onChange: (report) => {
        errorEl?.remove();
        errorEl = undefined;
        if (!report) return;
        errorEl = renderMapSupplementalError(map.getContainer(), {
          icon: '⚠️',
          title: 'Map tiles failed to load',
          message: describeTileFailure(report),
          className: 'tile-load-error',
        });
      },
    });

    const isRasterSource = (sourceId: string | undefined): boolean => {
      if (!sourceId) return false;
      try {
        return map.getSource(sourceId)?.type === 'raster';
      } catch {
        return false;
      }
    };

    const onError = (event: { sourceId?: string; error?: unknown }): void => {
      if (!isRasterSource(event.sourceId)) return;
      const url = (event.error as { url?: unknown } | undefined)?.url;
      monitor.recordFailure(typeof url === 'string' ? url : '', event.error);
    };
    const onData = (event: { dataType?: string; sourceId?: string; tile?: unknown }): void => {
      if (event.dataType !== 'source' || !event.tile) return;
      if (!isRasterSource(event.sourceId)) return;
      monitor.recordSuccess();
    };

    map.on('error', onError);
    map.on('data', onData);
    void map.once('remove', () => {
      map.off('error', onError);
      map.off('data', onData);
      monitor.dispose();
      errorEl?.remove();
    });
  }

  private sanitizeMapError(error: unknown): string {
    const message = getErrorMessage(error ?? '');
    return message.replace(
      /([?&](?:apiKey|apikey|api_key|access_token|token)=)[^&\s)]+/gi,
      '$1[REDACTED]'
    );
  }

  private setupContextMenu(map: maplibregl.Map, mapContainerElement: HTMLElement, request: MapRenderRequest, places: MapPlace[]): void {
    setupVectorContextMenu({
      app: this.app,
      map,
      container: mapContainerElement,
      request,
      places,
      developerMode: this.developerMode,
      providerName: this.getProviderClassName(),
      getCurrentPlaces: () => this.getCurrentPlaces(mapContainerElement) ?? undefined,
      includeDirectionsRouteActions: true,
    });
  }

  protected async processOverlays(map: maplibregl.Map, _mapContainer: HTMLElement, request: MapRenderRequest, places: MapPlace[]): Promise<void> {
    const unifiedClustering = request.runtime.unifiedClusteringActive;

    // If unified clustering is active, overlay points are already in the main cluster
    // source, and the overlay handler skips adding point layers
    const clusteringConfig = unifiedClustering
      ? { enabled: true, threshold: 0, unifiedClustering: true }
      : undefined;

    await this.overlayHandler.processOverlays(map, request.runtime.overlays, request.config.showLabels, places, clusteringConfig);
    recordOverlayVisibility({
      map,
      runtime: request.runtime,
      setLayerVisibility: (layerIds, visibility) => setLayerVisibility(map, layerIds, visibility),
    });
  }

  getCurrentPlaces(container: HTMLElement): MapPlace[] | null {
    const mapInstance = this.getMapInstance(container);
    if (!mapInstance) return null;
    const places = MapState.for(mapInstance).getCurrentPlaces();
    return places.length > 0 ? places : null;
  }

  getIncrementalUpdateCapabilities(): Readonly<MapIncrementalUpdateCapabilities> {
    return {
      places: true,
      overlays: true,
      styles: false,
      tools: true,
      clustering: false,
      terrain: false,
    };
  }

  // Returns true when the existing map instance was updated, false when a full refresh is needed.
  async updateMapData(container: HTMLElement, newPlaces: MapPlace[], request: MapRenderRequest, context?: MapDataUpdateContext): Promise<MapDataUpdateResult> {
    const result = await this.performMapDataUpdate(container, newPlaces, request, context);
    // A declined in-place update escalates to a full surface rebuild, whose
    // fresh initial render would re-fit the camera to the data bounds and jerk
    // the viewport (e.g. dragging a radius slider that pulls a track in or out
    // of range). Capture the live viewport into the same store that preserves
    // the view across tab switches, where resolveCameraIntent restores it on the
    // rebuild instead of re-fitting. 'temporarily-unavailable' is not a rebuild.
    if (result.updated === false && result.status === 'requires-rebuild') {
      this.persistViewportForRebuild(container, request.runtime.source);
    }
    return result;
  }

  // Save the live map's current center/zoom for an imminent rebuild to restore.
  private persistViewportForRebuild(container: HTMLElement, source: MapRenderRequest['runtime']['source']): void {
    const stateKey = MapStateManager.getStateKey(source);
    if (!stateKey) return;
    const map = this.getMapInstance(container);
    if (!map) return;
    const center = map.getCenter();
    MapStateManager.saveState(stateKey, { zoom: map.getZoom(), center: { lat: center.lat, lng: center.lng } });
  }

  private async performMapDataUpdate(container: HTMLElement, newPlaces: MapPlace[], request: MapRenderRequest, context?: MapDataUpdateContext): Promise<MapDataUpdateResult> {
    const blockSettings = request.config;
    const runtime = request.runtime;
    const perf = createPerformanceMonitor('maplibre-update', {
      provider: this.getProviderClassName(),
      source: runtime.source.path,
      places: newPlaces.length,
      overlays: runtime.overlays.length,
      trackDefaultVisibility: blockSettings.trackDefaultVisibility,
    }, { enabled: this.developerMode });
    const ineligibleReason = this.getMapDataUpdateIneligibleReason(blockSettings);
    if (ineligibleReason) {
      logger.scope('Places').debug(`[Places Incremental] ${ineligibleReason} - full refresh needed`);
      perf.mark('ineligible', { reason: ineligibleReason });
      return Promise.resolve({ updated: false, status: 'requires-rebuild', reason: ineligibleReason });
    }

    const mapInstance = this.getMapInstance(container);
    if (!mapInstance) {
      logger.scope('Places').debug('[Places Incremental] No map instance found - full refresh needed');
      perf.mark('ineligible', { reason: 'no map instance found' });
      return { updated: false, status: 'requires-rebuild', reason: 'no map instance found' };
    }

    const mapState = MapState.for(mapInstance);
    let updateProfileStarted = false;
    const profileUpdate = (): void => {
      if (updateProfileStarted) return;
      updateProfileStarted = true;
      this.profileNextRenderAndIdle(mapInstance, perf, 'update');
    };
    const markerMap = mapState.getPlaceMarkers();
    const settings = mapState.getCurrentSettings();
    const previousBlockSettings = mapState.getCurrentBlockSettings();
    const previousRequest = mapState.getCurrentRenderRequest();
    if (previousBlockSettings && JSON.stringify(previousBlockSettings.tools) !== JSON.stringify(blockSettings.tools)) {
      const result = this.syncMapTools(mapInstance, container, request);
      if (!result.updated) return result;
    }
    if (previousBlockSettings && previousBlockSettings.showLabels !== blockSettings.showLabels) {
      logger.scope('Places').debug('[Places Incremental] showLabels changed - full refresh needed');
      perf.mark('ineligible', { reason: 'showLabels changed' });
      return Promise.resolve({ updated: false, status: 'requires-rebuild', reason: 'showLabels changed' });
    }
    if (previousBlockSettings && previousBlockSettings.trackDirectionArrows !== blockSettings.trackDirectionArrows) {
      logger.scope('Places').debug('[Places Incremental] trackDirectionArrows changed - full refresh needed');
      perf.mark('ineligible', { reason: 'trackDirectionArrows changed' });
      return Promise.resolve({ updated: false, status: 'requires-rebuild', reason: 'trackDirectionArrows changed' });
    }
    if (previousBlockSettings && JSON.stringify(previousBlockSettings.trackBuilder) !== JSON.stringify(blockSettings.trackBuilder)) {
      logger.scope('Places').debug('[Places Incremental] trackBuilder changed - full refresh needed');
      perf.mark('ineligible', { reason: 'trackBuilder changed' });
      return Promise.resolve({ updated: false, status: 'requires-rebuild', reason: 'trackBuilder changed' });
    }
    const overlayClusteringConfig = runtime.unifiedClusteringActive
      ? { enabled: true, threshold: 0, unifiedClustering: true }
      : undefined;
    if (hasOverlayRenderableChanges(context?.planDiff)) {
      profileUpdate();
      await perf.measureAsync('sync-overlays', () => this.overlayHandler.syncOverlays(mapInstance, previousRequest?.runtime.overlays ?? [], runtime.overlays, blockSettings.showLabels, newPlaces, overlayClusteringConfig));
    }
    this.refreshDebugOverlayData(newPlaces, runtime.overlays);
    if (hasTrackRenderableChanges(context?.planDiff)) {
      const trackSettings = this.extractCommonSettings(blockSettings, runtime);
      if (Array.from(mapState.getVisibleTracks().values()).some(trackState => trackState.renderMode === 'viewport-batch')) {
        // A radius/filter change that pulls a track in or out of the result
        // re-establishes the viewport trackLayer loader against the new place set on
        // the *existing* map: it tears down its old buckets and re-renders the tracks
        // intersecting the viewport. Markers and labels still update in place below,
        // and the GL map - and its tiles - are never recreated.
        profileUpdate();
        const placesWithTracks = newPlaces.filter(place => hasTrackData(place) && !place.metadata?.frequency && !place.metadata?.boundsAnchor && Boolean(place.overlay));
        perf.measure('resync-viewport-tracks', () => this.setupViewportTrackLoading(mapInstance, placesWithTracks, trackSettings.trackVisibility, trackSettings, mapState), {
          tracks: placesWithTracks.length,
        });
      } else {
        profileUpdate();
        perf.measure('sync-visible-tracks', () => this.syncVisibleTrackOverlays(mapInstance, mapState, trackSettings), {
          currentVisibleTracks: mapState.getVisibleTracks().size,
        });
      }
    }

    if (previousBlockSettings && usesNativeMarkerRenderer(previousBlockSettings) !== usesNativeMarkerRenderer(blockSettings)) {
      logger.scope('Places').debug('[Places Incremental] marker renderer changed - full refresh needed');
      perf.mark('ineligible', { reason: 'marker renderer config changed' });
      return { updated: false, status: 'requires-rebuild', reason: 'marker renderer config changed' };
    }

    // Symbol maps (clustered or not) refresh through their sources; the clustering manager
    // branch below is the HTML renderer's marker-recreation path.
    if (usesNativeMarkerRenderer(previousBlockSettings ?? blockSettings)) {
      if (!settings) {
        logger.scope('Places').debug('[Places Incremental] Missing current settings - full refresh needed');
        return { updated: false, status: 'requires-rebuild', reason: 'missing marker tracking data' };
      }
      profileUpdate();
      perf.measure('symbol-source-update', () => this.refreshSymbolLayerData(mapInstance, newPlaces, settings, request));
      mapState.setCurrentPlaces(newPlaces);
      mapState.setCurrentSettings({
        ...settings,
        trackVisibility: runtime.trackVisibility,
        onPlaceAction: runtime.onPlaceAction ?? settings.onPlaceAction
      });
      mapState.setCurrentBlockSettings(blockSettings);
      mapState.setCurrentRenderRequest(request);
      perf.mark('symbol-update-complete', { places: newPlaces.length });
      return { updated: true };
    }

    const clusteringManager = mapState.getClusteringManager();
    if (clusteringManager) {
      try {
        profileUpdate();
        this.updateClusteredMarkersIncrementally(mapInstance, clusteringManager, mapState, newPlaces, settings, request);
        mapState.setCurrentBlockSettings(blockSettings);
        mapState.setCurrentRenderRequest(request);
        perf.mark('clustered-update-complete', {
          markers: mapState.getPlaceMarkers().size,
          visibleTracks: mapState.getVisibleTracks().size,
        });
        return Promise.resolve({ updated: true });
      } catch (error) {
        logger.scope('Places').debug('[Places Incremental] Clustered source update failed:', error);
        return Promise.resolve({ updated: false, status: 'requires-rebuild', reason: 'clustered source update failed' });
      }
    }

    if (!settings) {
      logger.scope('Places').debug('[Places Incremental] Missing current settings - full refresh needed');
      return { updated: false, status: 'requires-rebuild', reason: 'missing marker tracking data' };
    }

    const nextMarkerSignatures = context?.nextPlan
      ? new Map(context.nextPlan.renderables
        .filter(renderable => renderable.kind === 'marker')
        .map(renderable => [renderable.id.slice('marker:'.length), renderable.signature]))
      : undefined;
    const diff = computePlaceMarkerDiff({
      currentMarkers: markerMap,
      nextPlaces: newPlaces,
      getStoredMarkerSignature: (_marker, identity) => mapState.getPlaceMarkerRenderSignature(identity),
      getNextMarkerSignature: (_place, identity) => nextMarkerSignatures?.get(identity),
    });

    if (!hasPlaceMarkerDiffChanges(diff)) {
      logger.scope('Places').debug('[Places Incremental] No marker changes needed');
      mapState.setCurrentPlaces(newPlaces);
      mapState.setCurrentSettings({
        ...settings,
        trackVisibility: runtime.trackVisibility,
        onPlaceAction: runtime.onPlaceAction,
      });
      mapState.setCurrentBlockSettings(blockSettings);
      mapState.setCurrentRenderRequest(request);
      perf.mark('no-marker-changes', {
        markers: markerMap.size,
        visibleTracks: mapState.getVisibleTracks().size,
      });
      return { updated: true };
    }

    logger.scope('Places').debug('[Places Incremental] Updating markers', { removeCount: diff.removedIds.length, addCount: diff.added.length, updateCount: diff.updated.length });
    profileUpdate();

    const createMarkerForPlace = (place: MapPlace, markerSignature: string): void => {
      const iconStyle = place?.iconStyle;
      const isHidden = iconStyle?.opacity === 0 ||
        iconStyle?.inlineCss?.toLowerCase().includes('display: none');
      if (!isHidden) {
        const feature: GeoJSON.Feature = {
          type: 'Feature',
          properties: {
            description: place.name || '',
            file_path: place.filePath || '',
            icon: place.icon || '',
            // Serialize place as JSON for createIconMarker to read iconStyle
            mapPlace: JSON.stringify(place)
          },
          geometry: {
            type: 'Point',
            coordinates: [place.longitude, place.latitude]
          }
        };

        const marker = this.createIconMarkerWithReturn(mapInstance, feature, settings);
        const identity = getPlaceId(place);
        mapState.setPlaceMarkerWithSignature(identity, marker, markerSignature);
      }
    };

    perf.measure('apply-marker-diff', () => applyPlaceMarkerDiff({
      diff,
      getStored: identity => markerMap.get(identity),
      removeStored: identity => {
        const marker = mapState.deletePlaceMarkerWithSignature(identity);
        marker?.remove();
      },
      createStored: ({ place, markerSignature }) => {
        createMarkerForPlace(place, markerSignature);
        return markerMap.get(getPlaceId(place));
      }
    }), { removeCount: diff.removedIds.length, addCount: diff.added.length, updateCount: diff.updated.length });

    if (settings.showLabels) {
      perf.measure('update-text-label-layer', () => this.updateTextLabelLayer(mapInstance, newPlaces));
    }

    mapState.setCurrentPlaces(newPlaces);
    if (settings) {
      mapState.setCurrentSettings({
        ...settings,
        trackVisibility: runtime.trackVisibility,
        onPlaceAction: runtime.onPlaceAction,
      });
    }
    mapState.setCurrentBlockSettings(blockSettings);
    mapState.setCurrentRenderRequest(request);

    perf.mark('complete', {
      markers: mapState.getPlaceMarkers().size,
      visibleTracks: mapState.getVisibleTracks().size,
    });
    return { updated: true };
  }

  applyCamera(container: HTMLElement, camera: MapCameraIntent, request: MapRenderRequest): MapCameraApplyResult {
    const map = this.getMapInstance(container);
    if (!map) return { applied: false, reason: 'no map instance found' };
    return applyCameraIntent(map, camera, request);
  }

  // Hide the given placeIds on the live map (empty = show all). The deny-list is
  // stored per map for the async-built symbol/label layers to re-read, then
  // applied immediately to any layer that already exists. Icon and label filters
  // both carry the deny clause, and a marker's icon and label hide together.
  applyMarkerVisibility(container: HTMLElement, hiddenPlaceIds: readonly string[]): void {
    const map = this.getMapInstance(container);
    if (!map) return;
    this.symbolVisibilityHidden.set(map, hiddenPlaceIds);
    const deny = markerVisibilityDenyExpression(hiddenPlaceIds);
    if (map.getLayer(SYMBOL_MARKER_LAYER_ID)) map.setFilter(SYMBOL_MARKER_LAYER_ID, symbolIconFilter(deny));
    if (map.getLayer('places-markers')) map.setFilter('places-markers', symbolLabelFilter(deny));
    // Clustering counts from a separate cluster-enabled source; setFilter cannot
    // reach it; the visible subset is re-derived and re-fed (cluster circle
    // counts and the cluster-vs-marker mode decision then match what is shown).
    this.applyClusteredData(map);
    this.applyTrackFilterVisibility(map);
  }

  // A filtered-out marker takes its track with it. This reuses the ids the
  // markerFilter already resolved - no second evaluation of the filter - and
  // routes them to whichever mechanism owns each track.
  private applyTrackFilterVisibility(map: maplibregl.Map): void {
    const hidden = new Set(this.symbolVisibilityHidden.get(map) ?? []);
    const mapState = MapState.for(map);
    const controller = this.viewportTrackControllers.get(map);

    for (const place of mapState.getCurrentPlaces()) {
      if (!hasTrackData(place)) continue;
      const placeId = getPlaceId(place);
      const filtered = hidden.has(placeId);

      if (controller?.isManaged(placeId)) {
        controller.setFilterHidden(placeId, filtered);
        continue;
      }

      const overlayIndex = place.filePath ? mapState.getOverlayIndexForPlace(place.filePath) : undefined;
      if (overlayIndex !== undefined) {
        const lineLayerId = `geojson-overlay-${overlayIndex}-line`;
        if (!map.getLayer(lineLayerId)) continue;
        // Only the filter drives these back on: a track the user hid stays hidden.
        const visible = !filtered && mapState.isGeoJsonOverlayVisible(overlayIndex);
        this.setLayersVisibility(map, [lineLayerId, `${lineLayerId}-outline`, `${lineLayerId}-route-label`, `${lineLayerId}-direction`, `${lineLayerId}-endpoints`, `${lineLayerId}-hitarea`, `geojson-overlay-${overlayIndex}-circle`], visible ? 'visible' : 'none');
        continue;
      }

      const sourceId = `dynamic-overlay-${placeId}`;
      const lineLayerId = `${sourceId}-line`;
      if (!map.getLayer(lineLayerId)) continue;
      const userVisible = this.trackUserVisibility.get(map)?.get(placeId) ?? true;
      this.setDynamicOverlayVisibility(map, placeId, !filtered && userVisible);
    }
  }

  private recordTrackUserVisibility(map: maplibregl.Map, placeId: string, visible: boolean): void {
    let overrides = this.trackUserVisibility.get(map);
    if (!overrides) this.trackUserVisibility.set(map, overrides = new Map<string, boolean>());
    overrides.set(placeId, visible);
  }

  private setDynamicOverlayVisibility(map: maplibregl.Map, placeId: string, visible: boolean): void {
    const sourceId = `dynamic-overlay-${placeId}`;
    const lineLayerId = `${sourceId}-line`;
    this.setLayersVisibility(map, [lineLayerId, `${lineLayerId}-outline`, `${lineLayerId}-route-label`, `${lineLayerId}-direction`, `${lineLayerId}-endpoints`, `${sourceId}-hitarea`, `${lineLayerId}-points`, `${lineLayerId}-points-label`], visible ? 'visible' : 'none');
  }

  // Feed the clustered source and its ViewportClusteringManager the currently
  // visible subset (all retained inputs minus the live `markerFilter:` hidden
  // ids). Called on render (full set) and on every visibility toggle. No-op until
  // the cluster source and its retained inputs exist.
  private applyClusteredData(map: maplibregl.Map): void {
    const data = this.symbolClusterData.get(map);
    const clusteredSource = map.getSource<maplibregl.GeoJSONSource>('places-clustered');
    if (!data || !clusteredSource) return;
    const hidden = new Set(this.symbolVisibilityHidden.get(map) ?? []);
    const visibleFeatures = hidden.size === 0 ? data.features : data.features.filter(feature => !hidden.has(String(feature.properties?.placeId)));
    const visiblePlaces = hidden.size === 0 ? data.renderedPlaces : data.renderedPlaces.filter(place => !hidden.has(getPlaceId(place)));
    clusteredSource.setData({ type: 'FeatureCollection', features: [...visibleFeatures, ...data.overlayPointFeatures] });
    map.getSource<maplibregl.GeoJSONSource>('overlay-points-unclustered')?.setData({ type: 'FeatureCollection', features: data.overlayPointFeatures });
    MapState.for(map).getClusteringManager()?.updatePlaces(visiblePlaces, data.overlayPointFeatures.map(feature => {
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      return { longitude: coords[0], latitude: coords[1] };
    }));
  }

  private syncVisibleTrackOverlays(map: maplibregl.Map, mapState: MapState, nextSettings: CommonMapSettings): void {
    const nextVisibility = nextSettings.trackVisibility;
    if (!nextVisibility) return;

    const visibleTracks = mapState.getVisibleTracks();
    // `showOnLoad` is configuration only: a manually shown track is absent
    // from the config set. Union in what the user turned on and subtract what
    // they turned off; a refresh must not undo a click.
    const userVisibility = this.trackUserVisibility.get(map);
    const nextVisibleStates = new Map(
      nextVisibility.placeStates
        .filter(state => userVisibility?.get(state.placeId) ?? state.showOnLoad)
        .map(state => [state.placeId, state])
    );

    for (const [placeId, trackState] of Array.from(visibleTracks.entries())) {
      const nextState = nextVisibleStates.get(placeId);
      const nextSignature = nextState ? getTrackStateRenderSignature(nextState) : undefined;
      const changed = !nextState || !nextSignature || trackState.renderSignature !== nextSignature;

      if (changed) {
        if (trackState.trackIndex === -1) {
          this.removeDynamicOverlayLayers(map, placeId);
        } else {
          this.removeTrackLayersById(map, trackState.trackIndex);
        }
        mapState.removeTrack(placeId);
      }
    }

    for (const state of nextVisibleStates.values()) {
      if (!visibleTracks.has(state.placeId)) {
        this.showTrackForPlace(map, state.place, nextVisibility, nextSettings);
      } else {
        const existing = visibleTracks.get(state.placeId);
        if (existing) {
          existing.place = state.place;
          existing.settings = nextSettings;
          existing.renderSignature = getTrackStateRenderSignature(state);
        }
      }
    }
  }

  private updateClusteredMarkersIncrementally(map: maplibregl.Map, clusteringManager: ViewportClusteringManager<maplibregl.Marker>, mapState: MapState, newPlaces: MapPlace[], settings: CommonMapSettings | null, request: MapRenderRequest): void {
    updateClusteredMarkers(map, clusteringManager, mapState, newPlaces, settings, request);
  }

  private updateTextLabelLayer(map: maplibregl.Map, places: MapPlace[]): void {
    updateTextLabelSource(map, places);
  }

  setGeocodingSearchMarkers(places: MapPlace[], container: HTMLElement): void {
    const mapInstance = this.getMapInstance(container);
    if (!mapInstance) return;

    setVectorGeocodingSearchMarkers({
      container,
      map: mapInstance,
      places,
      focusMap: mapInstance,
      createMarker: (place, element) => new (getGl().Marker)({ element, anchor: 'center' })
        .setLngLat([place.longitude, place.latitude])
        .addTo(mapInstance),
      onMarkerClick: (place) => {
        createContentPopup({
          map: mapInstance,
          coordinates: [place.longitude, place.latitude] as [number, number],
          content: buildGeocodingSearchPopupContent(place, MapState.for(mapInstance).getCurrentSettings()?.onPlaceAction ?? undefined, () => closeExistingPopups('.maplibregl-popup, .mapboxgl-popup')),
          popupSelector: '.maplibregl-popup, .mapboxgl-popup',
          createPopup: () => MapLibreHelper.createBasicPopup({
            offset: 18,
            className: 'places-popup',
            closeOnClick: true,
            closeOnMove: false,
            focusAfterOpen: false
          }),
        });
      }
    });
  }

  cleanup(): void {
    // Empty: each map's components register their own cleanup.
  }
}

// The vector tilesets this block renders, deduplicated by URL, with whatever
// layers their TileJSON declared. Overlays are applied before the debug panel
// is built, and the documents have already resolved by this point; a tileset
// that declares no vector_layers is simply absent.
function collectDebugTilesets(overlays: readonly Overlay[]): DebugTilesetSummary[] {
  const byUrl = new Map<string, DebugTilesetSummary>();
  for (const overlay of overlays) {
    if (overlay.type !== 'vector-tile') continue;
    const url = (overlay as { url?: string }).url;
    if (!url || byUrl.has(url)) continue;
    const layers = MapLibreOverlayHandler.getResolvedVectorLayers(url);
    if (!layers?.length) continue;
    byUrl.set(url, { url, layers: layers.map(layer => ({ id: layer.id, fields: layer.fields })) });
  }
  return [...byUrl.values()];
}
