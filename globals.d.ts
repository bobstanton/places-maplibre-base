// Prism.js is loaded globally by Obsidian for syntax highlighting.

// Side-effect CSS imports are resolved by esbuild at build time; TypeScript only
// needs an ambient module for the imports to type-check (required since TypeScript 6.0,
// which flags untyped side-effect imports via TS2882).
declare module "*.css";

// The zstd wasm binary as bytes. Resolved at build time by the zstd-wasm-binary
// esbuild plugin (esbuild.config.mjs) using the binary loader; jest maps it to a
// mock that reads the same file from disk. A virtual specifier is required
// because @bokuweb/zstd-wasm's exports map does not expose the .wasm asset.
declare module "zstd-wasm-binary" {
  const bytes: Uint8Array;
  export default bytes;
}

declare const Prism: {
  highlight?: (code: string, grammar: Prism.Grammar, language: string) => string;
  highlightElement?: (element: Element) => void;
  languages: Record<string, Prism.Grammar>;
} | undefined;

declare namespace Prism {
  interface Grammar {
    [key: string]: unknown;
  }
}
