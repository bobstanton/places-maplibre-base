import type { ResolvedMapConfig } from 'places-shared/settings';

export type MarkerRendererKind = 'native' | 'html';

export function markerRendererKind(settings: ResolvedMapConfig): MarkerRendererKind {
  return settings.markerRenderer === 'html' ? 'html' : 'native';
}

export function usesNativeMarkerRenderer(settings: ResolvedMapConfig): boolean {
  return markerRendererKind(settings) === 'native';
}
