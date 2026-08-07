export const DEFAULT_MAP_LABEL_COLOR = '#d73027';
export const DEFAULT_ROUTE_LABEL_COLOR = DEFAULT_MAP_LABEL_COLOR;

export function createMapLabelPaint(defaultColor = DEFAULT_MAP_LABEL_COLOR): Record<string, unknown> {
  const baseOpacity = [
    'case',
    ['has', 'labelOpacity'],
    ['get', 'labelOpacity'],
    1
  ];
  const hasUserLabelStyle = ['has', 'labelHasUserStyle'];

  return {
    'text-color': [
      'case',
      ['has', 'labelColor'],
      ['get', 'labelColor'],
      defaultColor
    ],
    'text-opacity': baseOpacity,
    'text-halo-blur': [
      'case',
      ['has', 'labelHaloBlur'],
      ['get', 'labelHaloBlur'],
      hasUserLabelStyle,
      0,
      0.5
    ],
    'text-halo-color': [
      'case',
      ['has', 'labelHaloColor'],
      ['get', 'labelHaloColor'],
      hasUserLabelStyle,
      'rgba(255,255,255,1)',
      'rgba(255,255,255,0.9)'
    ],
    'text-halo-width': [
      'case',
      ['has', 'labelHaloWidth'],
      ['get', 'labelHaloWidth'],
      hasUserLabelStyle,
      0,
      1.25
    ]
  };
}

export function createRouteLabelPaint(defaultColor = DEFAULT_ROUTE_LABEL_COLOR): Record<string, unknown> {
  return {
    'text-color': defaultColor,
    'text-opacity': 1,
    'text-halo-blur': 1,
    'text-halo-color': 'rgba(255,255,255,0.75)',
    'text-halo-width': 1
  };
}

export function createRouteLabelLayerConfig(options: {
  sourceId: string;
  layerId?: string;
  defaultColor?: string;
}): Record<string, unknown> {
  return {
    id: options.layerId ?? `${options.sourceId}-route-label`,
    type: 'symbol',
    source: options.sourceId,
    filter: ['all', ['has', 'route_label'], ['has', 'route_label_point'], ['==', ['geometry-type'], 'Point']],
    layout: {
      'text-field': ['get', 'route_label'],
      'text-size': [
        'case',
        ['has', 'route_label_font_size'],
        ['get', 'route_label_font_size'],
        14
      ],
      'text-anchor': 'left',
      'text-offset': [0.6, 0],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
      'text-optional': true
    },
    paint: createRouteLabelPaint(options.defaultColor ?? DEFAULT_ROUTE_LABEL_COLOR)
  };
}

export function createRouteEndpointLabelLayerConfig(options: {
  sourceId: string;
  layerId?: string;
  defaultColor?: string;
}): Record<string, unknown> {
  return {
    id: options.layerId ?? `${options.sourceId}-route-endpoint-label`,
    type: 'symbol',
    source: options.sourceId,
    filter: ['all', ['has', 'route_endpoint_label'], ['==', ['geometry-type'], 'Point']],
    layout: {
      'text-field': ['get', 'route_endpoint_label'],
      'text-size': 13,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
      'text-optional': true
    },
    paint: createMapLabelPaint(options.defaultColor ?? DEFAULT_MAP_LABEL_COLOR)
  };
}

// Label layer for GPX/path overlay labels (start/mid/end). Inherits the normal marker-label
// paint and respects label collisions: labels only show when they fit.
// The start label anchors below its point to avoid overlapping the start marker's own label.
export function createPathLabelLayerConfig(options: {
  sourceId: string;
  layerId?: string;
  defaultColor?: string;
}): Record<string, unknown> {
  return {
    id: options.layerId ?? `${options.sourceId}-route-label`,
    type: 'symbol',
    source: options.sourceId,
    filter: ['all', ['has', 'route_label'], ['has', 'route_label_point'], ['==', ['geometry-type'], 'Point']],
    layout: {
      'text-field': ['get', 'route_label'],
      'text-size': 14,
      'text-anchor': ['match', ['get', 'route_label_role'], 'start', 'top', 'left'],
      'text-offset': ['match', ['get', 'route_label_role'], 'start', ['literal', [0, 1]], ['literal', [0.6, 0]]],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true
    },
    paint: createMapLabelPaint(options.defaultColor ?? DEFAULT_MAP_LABEL_COLOR)
  };
}
