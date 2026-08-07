import { copyStylesIfPresent, createPluginBuildOptions, watchMode } from "./esbuild.shared.mjs";
import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "process";

const context = await esbuild.context(createPluginBuildOptions({
  external: [
    "obsidian",
    "electron",
    "places-shared",
    "places-shared/*",
    // Resolved by each provider plugin's bundle so a provider can alias it to its
    // vendor SDK's maplibre copy (see places-maptiler) and ship a single engine.
    "maplibre-gl",
    ...builtinModules,
  ],
}));

await copyStylesIfPresent();

if (watchMode) {
  await context.watch();
} else {
  await context.rebuild();
  process.exit(0);
}
