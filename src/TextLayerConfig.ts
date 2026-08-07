import { createMapLabelPaint } from "./TextLabelLayerStyles";

export interface TextLayerOptions {
  sourceId: string;
  defaultColor?: string;
  layerId?: string;
  // Unset leaves the engine's own overlap behavior.
  textOverlap?: "never" | "always" | "cooperative";
  // Layer-level floor. Only for sources with no zoom-ranged labels in them
  // (the HTML renderer's places-labels source, which excludes them); on the
  // symbol layer the floor is a filter condition instead, or it would override
  // every explicit per-feature range.
  minzoom?: number;
}

export function createTextLayerConfig(options: TextLayerOptions) {
  const { sourceId, defaultColor = "#d73027", layerId = "places-markers", textOverlap, minzoom } = options;

  const layout: Record<string, unknown> = {
    "text-field": ["get", "description"],
    "text-anchor": "left",
    // Distance from the anchor in ems of the label's own text size (data-driven, unlike
    // text-offset arrays). labelOffsetEm grows with the icon's rendered scale and badge overhang.
    "text-radial-offset": ["coalesce", ["get", "labelOffsetEm"], 1],
    "text-size": [
      "case",
      ["has", "labelFontSize"],
      ["get", "labelFontSize"],
      14
    ],
    "text-transform": [
      "case",
      ["has", "labelTextTransform"],
      ["get", "labelTextTransform"],
      "none"
    ],
    "text-letter-spacing": [
      "case",
      ["has", "labelLetterSpacing"],
      ["get", "labelLetterSpacing"],
      0
    ],
    "text-max-width": [
      "case",
      ["has", "labelMaxWidth"],
      ["get", "labelMaxWidth"],
      10
    ],
    "text-justify": [
      "case",
      ["has", "labelJustify"],
      ["get", "labelJustify"],
      "center"
    ],
    "text-optional": true,
    // Lower sort key is placed first and wins label collisions
    // (labelSortKey is the negated z-index from iconStyles/labelStyles rules)
    "symbol-sort-key": [
      "case",
      ["has", "labelSortKey"],
      ["get", "labelSortKey"],
      0
    ],
  };

  if (textOverlap) {
    layout["text-overlap"] = textOverlap;
  }

  return {
    "id": layerId,
    "type": "symbol",
    "source": sourceId,
    ...(minzoom !== undefined ? { "minzoom": minzoom } : {}),
    "layout": layout,
    "paint": createMapLabelPaint(defaultColor)
  };
}
