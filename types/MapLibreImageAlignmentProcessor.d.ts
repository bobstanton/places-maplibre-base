import { App, MarkdownPostProcessorContext } from "obsidian";
export declare function buildImageAlignment(app: App, _providerName: string, getStyleUrl: (style?: string) => string): (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void;
export declare class MapLibreImageAlignmentProcessor {
    private app;
    private getStyleUrl;
    constructor(app: App, getStyleUrl: (style?: string) => string);
    process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void;
}
