import { MapPlace } from "places-shared/overlay";
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
export declare function computePlaceMarkerDiff<TStored>({ currentMarkers, nextPlaces, getStoredMarkerSignature, getNextMarkerSignature, }: PlaceMarkerDiffOptions<TStored>): PlaceMarkerDiff;
export declare function hasPlaceMarkerDiffChanges(diff: PlaceMarkerDiff): boolean;
export declare function getRemovedAndUpdatedPlaceIds(diff: PlaceMarkerDiff): string[];
export interface ApplyPlaceMarkerDiffOptions<TStored> {
    diff: PlaceMarkerDiff;
    getStored: (identity: string) => TStored | undefined;
    removeStored: (identity: string, stored: TStored) => void;
    createStored: (entry: PlaceMarkerDiffEntry) => TStored | undefined;
    setStored?: (identity: string, stored: TStored) => void;
}
export declare function applyPlaceMarkerDiff<TStored>({ diff, getStored, removeStored, createStored, setStored, }: ApplyPlaceMarkerDiffOptions<TStored>): void;
