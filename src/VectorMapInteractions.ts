import { MapPlace } from "places-shared/overlay";
import { getPlaceId } from "places-shared/track";
import { PlacesBoundingBox } from "places-shared/geo";
import { MapControlHandle } from "places-shared/services";
import { getMapContainerState, setMapContainerState } from "places-shared/map";
import type * as maplibregl from "maplibre-gl";

// Expressions use maplibre's ExpressionSpecification rather than a loose `unknown[]`:
// maplibre-gl 6 tightened paint-value types, and a bare array made a concrete Map
// no longer assignable to VectorFocusMap. ExpressionSpecification is valid in both majors.
type VectorPaintValue = string | number | boolean | maplibregl.ExpressionSpecification;

export interface VectorFocusMap {
  // Method (not arrow-property) signatures keep a concrete maplibre-gl Map
  // assignable across engine majors - maplibre-gl 6 typed setPaintProperty as a
  // generic method, which an arrow-property field rejects under strict checking.
  getLayer?(id: string): unknown;
  setPaintProperty?(layerId: string, property: string, value: VectorPaintValue): void;
  once?(event: 'moveend', listener: () => void): unknown;
}

export interface RemovableMapMarker {
  remove: () => void;
}

export interface VectorControlMap {
  getBounds: () => { getSouth: () => number; getWest: () => number; getNorth: () => number; getEast: () => number } | null | undefined;
  getZoom: () => number;
  flyTo: (options: { center: [number, number]; zoom: number; duration: number }) => unknown;
}

export interface MissingSpriteImageMap {
  addImage: (id: string, image: ImageData) => unknown;
}

const LABEL_LAYER_ID = 'places-markers';
const LABEL_OPACITY_PROPERTY = 'text-opacity';
const ICON_OPACITY_PROPERTY = 'icon-opacity';
const FOCUSED_MARKER_CLASS = 'places-marker-focused';
const SEARCH_RESULT_MARKER_CLASS = 'places-marker-search-result';

// The native symbol-marker layer; shared with MapLibreProviderBase, which owns its creation.
export const SYMBOL_MARKER_LAYER_ID = 'places-symbol-markers';

// Base icon opacity honoring per-place styled opacity (iconStyles `opacity`).
export const SYMBOL_ICON_BASE_OPACITY: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'iconOpacity'], 1];

function setLabelOpacity(map: VectorFocusMap | undefined, opacity: VectorPaintValue): void {
  if (map?.getLayer?.(LABEL_LAYER_ID)) {
    map.setPaintProperty?.(LABEL_LAYER_ID, LABEL_OPACITY_PROPERTY, opacity);
  }
}

const LABEL_BASE_OPACITY: VectorPaintValue = ['case', ['has', 'labelOpacity'], ['get', 'labelOpacity'], 1];
export const VECTOR_FOCUS_DIM_OPACITY = 0.2;

function setSymbolIconOpacity(map: VectorFocusMap | undefined, opacity: VectorPaintValue): void {
  if (map?.getLayer?.(SYMBOL_MARKER_LAYER_ID)) {
    map.setPaintProperty?.(SYMBOL_MARKER_LAYER_ID, ICON_OPACITY_PROPERTY, opacity);
  }
}

export function restoreVectorLabelOpacity(map: VectorFocusMap | undefined): void {
  setLabelOpacity(map, LABEL_BASE_OPACITY);
  setSymbolIconOpacity(map, SYMBOL_ICON_BASE_OPACITY);
}

// Dim native labels AND native symbol icons; when a focused place id is given,
// that place keeps its own opacity. The HTML-marker equivalent is the
// `.places-focus-mode` CSS - both renderers must dim, or search results are
// only obvious on one of them.
export function dimVectorLabels(map: VectorFocusMap | undefined, focusedPlaceId?: string): void {
  setLabelOpacity(map, focusedPlaceId !== undefined
    ? ['case', ['==', ['get', 'placeId'], focusedPlaceId], LABEL_BASE_OPACITY, VECTOR_FOCUS_DIM_OPACITY]
    : VECTOR_FOCUS_DIM_OPACITY);
  setSymbolIconOpacity(map, focusedPlaceId !== undefined
    ? ['case', ['==', ['get', 'placeId'], focusedPlaceId], SYMBOL_ICON_BASE_OPACITY, VECTOR_FOCUS_DIM_OPACITY]
    : VECTOR_FOCUS_DIM_OPACITY);
}

export function focusMapMarkerElement(container: HTMLElement, place: MapPlace, map?: VectorFocusMap): void {
  const placeId = getPlaceId(place);
  const applyFocusedClass = () => {
    container.querySelectorAll(`.${FOCUSED_MARKER_CLASS}`).forEach((el) => el.removeClass(FOCUSED_MARKER_CLASS));
    const target = container.querySelector<HTMLElement>(`.places-marker[data-place-id="${CSS.escape(placeId)}"]`);
    target?.addClass(FOCUSED_MARKER_CLASS);
  };

  applyFocusedClass();
  map?.once?.('moveend', () => {
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow) {
      applyFocusedClass();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(applyFocusedClass));
  });
}

export function enterVectorFocusMode(container: HTMLElement, map?: VectorFocusMap, focusedPlaceId?: string): void {
  container.addClass('places-focus-mode');
  dimVectorLabels(map, focusedPlaceId);
}

export function clearVectorFocusMode(container: HTMLElement, map?: VectorFocusMap): void {
  container.removeClass('places-focus-mode');
  container.querySelectorAll(`.${FOCUSED_MARKER_CLASS}`).forEach((el) => el.removeClass(FOCUSED_MARKER_CLASS));
  restoreVectorLabelOpacity(map);
}

export function createSearchResultMarkerElement(place: MapPlace): HTMLElement {
  const el = createDiv({ cls: `places-marker ${SEARCH_RESULT_MARKER_CLASS}` });
  const iconEl = createDiv({ cls: 'places-marker-icon' });
  iconEl.setText(place.icon);
  el.appendChild(iconEl);
  return el;
}

export function addTransparentMissingSpriteImage(map: MissingSpriteImageMap, id: string): void {
  const canvas = createEl('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, 1, 1);
  map.addImage(id, ctx.getImageData(0, 0, 1, 1));
}

export function shouldSkipPlacePopup(place: MapPlace): boolean {
  return Boolean(
    place.metadata?.boundsAnchor ||
      place.metadata?.frequency !== undefined ||
      (!place.name && !place.icon && !place.filePath && !place.overlay),
  );
}

export function getStoredSearchResultMarkers<TMarker extends RemovableMapMarker>(container: HTMLElement): TMarker[] {
  return (getMapContainerState(container)?.searchResultMarkers || []) as TMarker[];
}

export function setStoredSearchResultMarkers<TMarker extends RemovableMapMarker>(container: HTMLElement, markers: TMarker[]): void {
  setMapContainerState(container, { searchResultMarkers: markers });
}

export interface SetVectorGeocodingSearchMarkersOptions<TMap, TMarker extends RemovableMapMarker> {
  container: HTMLElement;
  map: TMap;
  places: MapPlace[];
  focusMap?: VectorFocusMap;
  createMarker: (place: MapPlace, element: HTMLElement) => TMarker;
  onMarkerClick: (place: MapPlace) => void;
}

export function setVectorGeocodingSearchMarkers<TMap, TMarker extends RemovableMapMarker>({
  container,
  map: _map,
  places,
  focusMap,
  createMarker,
  onMarkerClick,
}: SetVectorGeocodingSearchMarkersOptions<TMap, TMarker>): void {
  getStoredSearchResultMarkers<TMarker>(container).forEach(marker => marker.remove());
  const markers: TMarker[] = [];
  setStoredSearchResultMarkers(container, markers);

  if (places.length === 0) {
    clearVectorFocusMode(container, focusMap);
    return;
  }

  enterVectorFocusMode(container, focusMap);

  for (const place of places) {
    const element = createSearchResultMarkerElement(place);
    const marker = createMarker(place, element);
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      onMarkerClick(place);
    });
    markers.push(marker);
  }

  setStoredSearchResultMarkers(container, markers);
}

export interface CreateVectorMapControlHandleOptions<TMap extends VectorControlMap> {
  container: HTMLElement;
  map: TMap;
  highlightPlace: (place: MapPlace) => void;
  clearHighlight: () => void;
  setGeocodingSearchMarkers: (places: MapPlace[]) => void;
}

export function createVectorMapControlHandle<TMap extends VectorControlMap>(options: CreateVectorMapControlHandleOptions<TMap>): MapControlHandle {
  const { map, highlightPlace, clearHighlight, setGeocodingSearchMarkers } = options;
  return {
    getBounds: () => {
      const bounds = map.getBounds();
      if (!bounds) return new PlacesBoundingBox();
      return new PlacesBoundingBox(bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast());
    },
    centerOnPlace: (place: MapPlace) => {
      map.flyTo({
        center: [place.longitude, place.latitude],
        zoom: Math.max(map.getZoom(), 14),
        duration: 500,
      });
    },
    highlightPlace,
    clearHighlight,
    setGeocodingSearchMarkers,
  };
}
