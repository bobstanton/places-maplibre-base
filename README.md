# Places MapLibre Base

Shared MapLibre GL implementation for [Places](https://github.com/bobstanton/places) map providers. Manages map lifecycle, markers, polylines, popups, clustering, overlays, terrain, and cleanup.

## Network requests

| Area                           | Request                                             |
| ------------------------------ | --------------------------------------------------- |
| Map style                      | Loads the style document                            |
| Map tiles, glyphs, and sprites | Loads vector or raster tiles and label assets       |
| Vector tile overlay            | Resolves the tile source before the layer is added  |
| Image overlay                  | Fetches the image so it can be aligned and drawn    |
| Glyph fallback                 | Supplies label glyphs for a style that defines none |

## Background tasks

None.

## Dependencies

| Library                                                              | Purpose                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| [maplibre-gl](https://github.com/maplibre/maplibre-gl-js)            | GL map engine, resolved by the consuming provider plugin |
| [@types/geojson](https://github.com/DefinitelyTyped/DefinitelyTyped) | GeoJSON type definitions                                 |
| [places-shared](https://github.com/bobstanton/places-shared)         | Shared map, overlay, routing, and utility code           |
