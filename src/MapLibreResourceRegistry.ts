import type * as maplibregl from 'maplibre-gl';
import { getErrorMessage, logger } from 'places-shared/utils';

export type MapLibreResourceKind = 'listener' | 'disposer' | 'marker' | 'control' | 'layer' | 'source';

export interface MapLibreCleanupIssue {
  kind: MapLibreResourceKind;
  id: string;
  message: string;
}

export interface MapLibreCleanupResult {
  removed: number;
  missing: number;
  issues: MapLibreCleanupIssue[];
}

type RegisteredDisposer = {
  kind: Exclude<MapLibreResourceKind, 'layer' | 'source'>;
  id: string;
  owner: string;
  dispose: () => void;
};

const registries = new WeakMap<maplibregl.Map, MapLibreResourceRegistry>();

export function getMapLibreResourceRegistry(map: maplibregl.Map): MapLibreResourceRegistry {
  let registry = registries.get(map);
  if (!registry) {
    registry = new MapLibreResourceRegistry(map);
    registries.set(map, registry);
  }
  return registry;
}

export function reportMapLibreCleanupIssues(result: MapLibreCleanupResult, operation: string): void {
  if (result.issues.length === 0) return;
  logger.scope('Places').warn(`Map cleanup incomplete during ${operation}`, { issues: result.issues });
}

export class MapLibreResourceRegistry {
  private readonly layers = new Map<string, string>();
  private readonly sources = new Map<string, string>();
  private readonly disposers: RegisteredDisposer[] = [];

  constructor(private readonly map: maplibregl.Map) {}

  registerLayer(id: string, owner = 'surface'): void {
    this.layers.set(id, owner);
  }

  registerSource(id: string, owner = 'surface'): void {
    this.sources.set(id, owner);
  }

  registerDisposer(kind: RegisteredDisposer['kind'], id: string, dispose: () => void, owner = 'surface'): void {
    this.disposers.push({ kind, id, dispose, owner });
  }

  capture(owner: string, action: () => void): void {
    const before = this.snapshot();
    try {
      action();
    } finally {
      this.registerSnapshotDifference(owner, before);
    }
  }

  async captureAsync<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const before = this.snapshot();
    try {
      return await action();
    } finally {
      this.registerSnapshotDifference(owner, before);
    }
  }

  remove(layerIds: readonly string[], sourceIds: readonly string[]): MapLibreCleanupResult {
    const result = emptyCleanupResult();
    for (const id of layerIds) this.removeLayer(id, result);
    for (const id of sourceIds) this.removeSource(id, result);
    return result;
  }

  disposeOwner(owner: string): MapLibreCleanupResult {
    const result = emptyCleanupResult();
    this.disposeRegistered(result, entry => entry.owner === owner);
    for (const [id, resourceOwner] of [...this.layers]) {
      if (resourceOwner === owner) this.removeLayer(id, result);
    }
    for (const [id, resourceOwner] of [...this.sources]) {
      if (resourceOwner === owner) this.removeSource(id, result);
    }
    return result;
  }

  disposeAll(): MapLibreCleanupResult {
    const result = emptyCleanupResult();
    this.disposeRegistered(result, () => true);
    for (const id of [...this.layers.keys()].reverse()) this.removeLayer(id, result);
    for (const id of [...this.sources.keys()].reverse()) this.removeSource(id, result);
    return result;
  }

  private disposeRegistered(result: MapLibreCleanupResult, include: (entry: RegisteredDisposer) => boolean): void {
    for (let index = this.disposers.length - 1; index >= 0; index--) {
      const entry = this.disposers[index];
      if (!include(entry)) continue;
      try {
        entry.dispose();
        result.removed++;
      } catch (error) {
        result.issues.push({ kind: entry.kind, id: entry.id, message: getErrorMessage(error) });
      }
      this.disposers.splice(index, 1);
    }
  }

  private removeLayer(id: string, result: MapLibreCleanupResult): void {
    try {
      if (this.map.getLayer(id)) {
        this.map.removeLayer(id);
        result.removed++;
      } else {
        result.missing++;
      }
      this.layers.delete(id);
    } catch (error) {
      result.issues.push({ kind: 'layer', id, message: getErrorMessage(error) });
    }
  }

  private snapshot(): { layers: Set<string>; sources: Set<string> } {
    const style = this.map.getStyle();
    return {
      layers: new Set((style?.layers ?? []).map(layer => layer.id)),
      sources: new Set(Object.keys(style?.sources ?? {})),
    };
  }

  private registerSnapshotDifference(owner: string, before: { layers: Set<string>; sources: Set<string> }): void {
    const after = this.snapshot();
    for (const id of after.layers) if (!before.layers.has(id)) this.registerLayer(id, owner);
    for (const id of after.sources) if (!before.sources.has(id)) this.registerSource(id, owner);
  }

  private removeSource(id: string, result: MapLibreCleanupResult): void {
    try {
      if (this.map.getSource(id)) {
        this.map.removeSource(id);
        result.removed++;
      } else {
        result.missing++;
      }
      this.sources.delete(id);
    } catch (error) {
      result.issues.push({ kind: 'source', id, message: getErrorMessage(error) });
    }
  }
}

function emptyCleanupResult(): MapLibreCleanupResult {
  return { removed: 0, missing: 0, issues: [] };
}

export function mergeMapLibreCleanupResults(...results: readonly MapLibreCleanupResult[]): MapLibreCleanupResult {
  return results.reduce((merged, result) => ({
    removed: merged.removed + result.removed,
    missing: merged.missing + result.missing,
    issues: [...merged.issues, ...result.issues],
  }), emptyCleanupResult());
}
