import { MapPlace } from "places-shared/overlay";
import { getPlaceId, getPlaceMarkerRenderSignature } from "places-shared/track";

export interface PlaceMarkerDiffEntry {
  place: MapPlace;
  markerSignature: string;
}

export interface PlaceMarkerDiff {
  removedIds: string[];
  added: PlaceMarkerDiffEntry[];
  updated: PlaceMarkerDiffEntry[];
}

export interface PlaceMarkerDiffOptions<TStored> {
  currentMarkers: Iterable<[string, TStored]>;
  nextPlaces: MapPlace[];
  getStoredMarkerSignature: (stored: TStored, identity: string) => string | undefined;
  getNextMarkerSignature?: (place: MapPlace, identity: string) => string | undefined;
}

export function computePlaceMarkerDiff<TStored>({
  currentMarkers,
  nextPlaces,
  getStoredMarkerSignature,
  getNextMarkerSignature,
}: PlaceMarkerDiffOptions<TStored>): PlaceMarkerDiff {
  const nextByIdentity = new Map<string, MapPlace>();
  for (const place of nextPlaces) {
    nextByIdentity.set(getPlaceId(place), place);
  }

  const removedIds: string[] = [];
  const added: PlaceMarkerDiffEntry[] = [];
  const updated: PlaceMarkerDiffEntry[] = [];

  for (const [identity, stored] of currentMarkers) {
    const nextPlace = nextByIdentity.get(identity);
    if (!nextPlace) {
      removedIds.push(identity);
      continue;
    }

    const markerSignature = getNextMarkerSignature?.(nextPlace, identity) ?? getPlaceMarkerRenderSignature(nextPlace);
    if (getStoredMarkerSignature(stored, identity) !== markerSignature) {
      updated.push({ place: nextPlace, markerSignature });
    }
    nextByIdentity.delete(identity);
  }

  for (const place of nextByIdentity.values()) {
    const identity = getPlaceId(place);
    added.push({ place, markerSignature: getNextMarkerSignature?.(place, identity) ?? getPlaceMarkerRenderSignature(place) });
  }

  return { removedIds, added, updated };
}

export function hasPlaceMarkerDiffChanges(diff: PlaceMarkerDiff): boolean {
  return diff.removedIds.length > 0 || diff.added.length > 0 || diff.updated.length > 0;
}

export function getRemovedAndUpdatedPlaceIds(diff: PlaceMarkerDiff): string[] {
  return [
    ...diff.removedIds,
    ...diff.updated.map(({ place }) => getPlaceId(place)),
  ];
}

export interface ApplyPlaceMarkerDiffOptions<TStored> {
  diff: PlaceMarkerDiff;
  getStored: (identity: string) => TStored | undefined;
  removeStored: (identity: string, stored: TStored) => void;
  createStored: (entry: PlaceMarkerDiffEntry) => TStored | undefined;
  setStored?: (identity: string, stored: TStored) => void;
}

export function applyPlaceMarkerDiff<TStored>({
  diff,
  getStored,
  removeStored,
  createStored,
  setStored,
}: ApplyPlaceMarkerDiffOptions<TStored>): void {
  for (const identity of getRemovedAndUpdatedPlaceIds(diff)) {
    const stored = getStored(identity);
    if (stored) {
      removeStored(identity, stored);
    }
  }

  for (const entry of [...diff.added, ...diff.updated]) {
    const stored = createStored(entry);
    if (stored) {
      setStored?.(getPlaceId(entry.place), stored);
    }
  }
}
