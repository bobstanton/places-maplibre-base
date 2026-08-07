import type * as GeoJSON from 'geojson';

export interface VectorClusterLayerPlan {
  clusteredSource: {
    type: 'geojson';
    data: GeoJSON.FeatureCollection;
    cluster: true;
    clusterRadius: number;
    clusterMaxZoom?: number;
  };
  clusterLayers: Array<Record<string, unknown>>;
  overlayPointSource?: {
    type: 'geojson';
    data: GeoJSON.FeatureCollection;
  };
  overlayPointLayer?: Record<string, unknown>;
}

export interface VectorClusterLayerOptions {
  clusterRadius?: number;
  clusterMaxZoom?: number;
  countTextFont?: string[];
  defaultOverlayPointColor: string;
}

export function createVectorClusterLayerPlan(placeFeatures: GeoJSON.Feature[], overlayPointFeatures: GeoJSON.Feature[], options: VectorClusterLayerOptions): VectorClusterLayerPlan {
  const allGeoJson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [...placeFeatures, ...overlayPointFeatures]
  };

  const plan: VectorClusterLayerPlan = {
    clusteredSource: {
      type: 'geojson',
      data: allGeoJson,
      cluster: true,
      clusterRadius: options.clusterRadius ?? 50,
      clusterMaxZoom: options.clusterMaxZoom
    },
    clusterLayers: [
      {
        id: 'clusters',
        type: 'circle',
        source: 'places-clustered',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#51bbd6',
            100, '#f1f075',
            750, '#f28cb1'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            20,
            100, 30,
            750, 40
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      },
      {
        id: 'cluster-count',
        type: 'symbol',
        source: 'places-clustered',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': options.countTextFont ?? ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12
        },
        paint: {
          'text-color': '#000'
        }
      }
    ]
  };

  if (overlayPointFeatures.length > 0) {
    plan.overlayPointSource = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: overlayPointFeatures
      }
    };
    plan.overlayPointLayer = {
      id: 'overlay-points-individual',
      type: 'circle',
      source: 'overlay-points-unclustered',
      layout: {
        'visibility': 'none'
      },
      paint: {
        'circle-radius': ['coalesce', ['get', 'circle-radius'], 6],
        'circle-color': ['coalesce', ['get', 'marker-color'], options.defaultOverlayPointColor],
        'circle-opacity': ['coalesce', ['get', 'fill-opacity'], 0.8],
        'circle-stroke-color': ['coalesce', ['get', 'stroke'], '#fff'],
        'circle-stroke-width': ['coalesce', ['get', 'stroke-width'], 2],
        'circle-stroke-opacity': 1
      }
    };
  }

  return plan;
}

export function createFeatureIndexMap(features: GeoJSON.Feature[]): Map<number, GeoJSON.Feature> {
  const featureMap = new Map<number, GeoJSON.Feature>();
  features.forEach((feature, index) => {
    featureMap.set(index, feature);
  });
  return featureMap;
}

export function extractPointFeatureCoordinates(features: GeoJSON.Feature[]): Array<{ longitude: number; latitude: number }> {
  return features
    .filter(feature => feature.geometry.type === 'Point')
    .map(feature => {
      const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates;
      return { longitude, latitude };
    });
}

export interface VectorGeoJsonSource {
  setData: (data: GeoJSON.FeatureCollection) => unknown;
}

export interface VectorClusterManager<TPlace> {
  updatePlaces: (places: TPlace[], overlayPointCoordinates: Array<{ longitude: number; latitude: number }>) => void;
}

export interface SyncVectorClusteredSourcesOptions<TPlace> {
  places: TPlace[];
  placeFeatures: GeoJSON.Feature[];
  overlayPointFeatures: GeoJSON.Feature[];
  clusterOptions: VectorClusterLayerOptions;
  clusteredSource: VectorGeoJsonSource | undefined;
  overlayPointSource?: VectorGeoJsonSource | undefined;
  clusteringManager: VectorClusterManager<TPlace> | undefined;
  onBeforeUpdateManager?: () => void;
}

export interface VectorClusterInteractionMap<TEvent = unknown> {
  on(event: 'sourcedata', handler: (event: unknown) => void): unknown;
  on(event: 'click', layerId: string, handler: (event: TEvent) => void): unknown;
  on(event: 'mouseenter' | 'mouseleave', layerId: string, handler: () => void): unknown;
  queryRenderedFeatures(point: unknown, options?: { layers?: string[] }): Array<{
    properties?: GeoJSON.GeoJsonProperties;
    geometry?: GeoJSON.Geometry | null;
  }>;
  getSource(sourceId: string): { getClusterExpansionZoom?: (clusterId: number) => Promise<number> } | undefined;
  easeTo(options: { center: [number, number]; zoom: number }): unknown;
  getCanvas(): HTMLCanvasElement;
}

export interface VectorClusterClickEvent {
  point: unknown;
  // Features hit-tested for the clicked layer, supplied by layer-scoped click events.
  features?: Array<{ properties?: GeoJSON.GeoJsonProperties; geometry?: GeoJSON.Geometry | null }>;
}

export interface SetupVectorClusterInteractionsOptions<TMap extends VectorClusterInteractionMap<TEvent>, TEvent extends VectorClusterClickEvent> {
  map: TMap;
  clusteringManager: { update: () => void };
  clusterLayerId?: string;
  clusteredSourceId?: string;
  isClusterSourceLoadedEvent?: (event: unknown) => boolean;
  getClusterExpansionZoom?: (map: TMap, clusterId: number, sourceId: string) => Promise<number | undefined>;
}

export function syncVectorClusteredSources<TPlace>(options: SyncVectorClusteredSourcesOptions<TPlace>): void {
  const { places, placeFeatures, overlayPointFeatures, clusterOptions, clusteredSource, overlayPointSource, clusteringManager, onBeforeUpdateManager } = options;
  const clusterPlan = createVectorClusterLayerPlan(placeFeatures, overlayPointFeatures, clusterOptions);
  if (!clusteredSource) {
    throw new Error('clustered source missing');
  }

  clusteredSource.setData(clusterPlan.clusteredSource.data);

  if (overlayPointSource && clusterPlan.overlayPointSource) {
    overlayPointSource.setData(clusterPlan.overlayPointSource.data);
  }

  if (!clusteringManager) {
    throw new Error('clustering manager missing');
  }

  onBeforeUpdateManager?.();
  clusteringManager.updatePlaces(places, extractPointFeatureCoordinates(overlayPointFeatures));
}

export function setupVectorClusterInteractions<TMap extends VectorClusterInteractionMap<TEvent>, TEvent extends VectorClusterClickEvent>(
  options: SetupVectorClusterInteractionsOptions<TMap, TEvent>,
): void {
  const clusterLayerId = options.clusterLayerId ?? 'clusters';
  const clusteredSourceId = options.clusteredSourceId ?? 'places-clustered';
  const isClusterSourceLoadedEvent = options.isClusterSourceLoadedEvent ?? ((event: unknown) => {
    const sourceEvent = event as { sourceId?: string; isSourceLoaded?: boolean };
    return sourceEvent.sourceId === clusteredSourceId && Boolean(sourceEvent.isSourceLoaded);
  });

  // 'sourcedata' fires only for source data events (with sourceId/isSourceLoaded),
  // unlike the broad 'data' event which also fires for every style change.
  options.map.on('sourcedata', (event: unknown) => {
    if (isClusterSourceLoadedEvent(event)) {
      options.clusteringManager.update();
    }
  });

  options.map.on('click', clusterLayerId, (event: TEvent) => {
    void (async () => {
      // Layer-scoped click events already carry this layer's hit-tested features.
      const clusterFeatures = event.features;
      if (!clusterFeatures || !clusterFeatures.length) return;

      const clusterId: unknown = clusterFeatures[0].properties?.cluster_id;
      if (typeof clusterId !== 'number') return;

      const zoom = await (options.getClusterExpansionZoom
        ? options.getClusterExpansionZoom(options.map, clusterId, clusteredSourceId)
        : getDefaultClusterExpansionZoom(options.map, clusterId, clusteredSourceId));
      if (zoom === undefined) return;
      const geometry = clusterFeatures[0].geometry;
      if (geometry?.type !== 'Point') return;
      const coords = geometry.coordinates as [number, number];

      options.map.easeTo({ center: coords, zoom });
    })();
  });

  options.map.on('mouseenter', clusterLayerId, () => {
    options.map.getCanvas().classList.add('places-map-pointer-cursor');
  });
  options.map.on('mouseleave', clusterLayerId, () => {
    options.map.getCanvas().classList.remove('places-map-pointer-cursor');
  });
}

async function getDefaultClusterExpansionZoom<TMap extends VectorClusterInteractionMap<unknown>>(
  map: TMap,
  clusterId: number,
  sourceId: string,
): Promise<number | undefined> {
  const source = map.getSource(sourceId);
  if (!source?.getClusterExpansionZoom) return undefined;
  return source.getClusterExpansionZoom(clusterId);
}
