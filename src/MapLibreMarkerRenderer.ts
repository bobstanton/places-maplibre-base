import { isStyleHidden } from "places-shared/place";
import type * as maplibregl from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import { getLabelOffsetEm, getMaxIconScale, type IconZoomSizeStop } from 'places-shared/place';
import { getPlaceId } from 'places-shared/track';
import { mergeZoomRanges } from 'places-shared/map';
import { conditionalProps } from 'places-shared/settings';
import type { MapPlace } from 'places-shared/overlay';

function zoomStopKey(zoom: number): string {
  return String(zoom).replace('.', '_');
}

function iconScaleAtZoom(stops: IconZoomSizeStop[], zoom: number): number {
  if (stops.length === 0) return 1;
  if (zoom <= stops[0].zoom) return stops[0].scale;
  const last = stops[stops.length - 1];
  if (zoom >= last.zoom) return last.scale;
  for (let index = 1; index < stops.length; index++) {
    if (zoom <= stops[index].zoom) {
      const from = stops[index - 1];
      const to = stops[index];
      const ratio = (zoom - from.zoom) / (to.zoom - from.zoom);
      return from.scale + ratio * (to.scale - from.scale);
    }
  }
  return last.scale;
}

export function createPointFeature(options: {
  place: MapPlace;
  zoomSizeStops?: number[];
  iconImageId: string;
}): GeoJSON.Feature {
  const { place, zoomSizeStops = [], iconImageId } = options;
  const properties: Record<string, unknown> = {
    description: place.name || '',
    file_path: place.filePath || '',
    icon: place.icon || '',
    placeId: getPlaceId(place),
    iconImage: iconImageId,
  };
  if (place.iconStyle?.opacity !== undefined && place.iconStyle.opacity !== 0) properties.iconOpacity = place.iconStyle.opacity;
  if (place.iconStyle?.opacity === 0 || place.iconStyle?.inlineCss?.toLowerCase().includes('display: none')) properties.iconHidden = true;
  const labelStyle = place.labelStyle;
  if (isStyleHidden(labelStyle)) properties.labelHidden = true;
  if (place.iconRotation !== undefined) properties.iconRotate = place.iconRotation;
  const renderedScale = (place.iconStyle?.scale ?? 1) / getMaxIconScale(place.iconStyle);
  if (renderedScale !== 1) properties.iconScale = renderedScale;

  const iconZoom = place.iconStyle?.zoom;
  if (iconZoom?.minZoom !== undefined) properties.iconMinZoom = iconZoom.minZoom;
  if (iconZoom?.maxZoom !== undefined) properties.iconMaxZoom = iconZoom.maxZoom;
  if (place.iconStyle?.zoomSizeStops?.length) {
    for (const zoom of zoomSizeStops) properties[`iconScaleZ${zoomStopKey(zoom)}`] = iconScaleAtZoom(place.iconStyle.zoomSizeStops, zoom);
  }

  const labelZoom = mergeZoomRanges(iconZoom, labelStyle?.zoom);
  if (labelStyle) {
    Object.assign(properties, conditionalProps({
      labelColor: labelStyle.color,
      labelFontSize: labelStyle.fontSize,
      labelOpacity: labelStyle.opacity,
      labelHaloColor: labelStyle.haloColor,
      labelHaloWidth: labelStyle.haloWidth,
      labelHaloBlur: labelStyle.haloBlur,
      labelHasUserStyle: labelStyle.hasUserStyle ? true : undefined,
      labelLetterSpacing: labelStyle.letterSpacing,
      labelMaxWidth: labelStyle.maxWidth,
      labelTextTransform: labelStyle.textTransform,
      labelJustify: labelStyle.textJustify,
    }));
  }
  Object.assign(properties, conditionalProps({ labelMinZoom: labelZoom?.minZoom, labelMaxZoom: labelZoom?.maxZoom }));
  const labelOffsetEm = getLabelOffsetEm(place.iconStyle, labelStyle);
  if (labelOffsetEm !== 1) properties.labelOffsetEm = labelOffsetEm;
  const labelZIndex = labelStyle?.zIndex ?? place.iconStyle?.zIndex ?? 0;
  if (labelZIndex !== 0) properties.labelSortKey = -labelZIndex;

  return {
    type: 'Feature',
    id: getPlaceId(place),
    properties,
    geometry: { type: 'Point', coordinates: [place.longitude, place.latitude] },
  };
}

export function createHtmlMarkerFeature(options: { place: MapPlace; iconImageId: string }): GeoJSON.Feature {
  const feature = createPointFeature(options);
  feature.properties = { ...feature.properties, mapPlace: JSON.stringify(options.place) };
  return feature;
}

export function updateTextLabelSource(map: maplibregl.Map, places: MapPlace[]): void {
  const features: GeoJSON.Feature[] = places.filter(place => {
    const style = place.labelStyle;
    return style?.opacity !== 0 && !style?.inlineCss?.toLowerCase().includes('display: none') && !place.iconStyle?.zoom && !style?.zoom;
  }).map(place => {
    const style = place.labelStyle;
    const properties: Record<string, unknown> = {
      description: place.name || '',
      file_path: place.filePath || '',
      icon: place.icon || '',
      placeId: getPlaceId(place),
    };
    if (style) {
      Object.assign(properties, conditionalProps({
        labelColor: style.color,
        labelFontSize: style.fontSize,
        labelOpacity: style.opacity,
        labelHaloColor: style.haloColor,
        labelHaloWidth: style.haloWidth,
        labelHaloBlur: style.haloBlur,
        labelHasUserStyle: style.hasUserStyle ? true : undefined,
        labelLetterSpacing: style.letterSpacing,
        labelMaxWidth: style.maxWidth,
        labelTextTransform: style.textTransform,
        labelJustify: style.textJustify,
        labelMinZoom: style.zoom?.minZoom,
        labelMaxZoom: style.zoom?.maxZoom,
      }));
    }
    const offset = getLabelOffsetEm(place.iconStyle, style);
    if (offset !== 1) properties.labelOffsetEm = offset;
    return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [place.longitude, place.latitude] } };
  });
  map.getSource<maplibregl.GeoJSONSource>('places-labels')?.setData({ type: 'FeatureCollection', features });
}
