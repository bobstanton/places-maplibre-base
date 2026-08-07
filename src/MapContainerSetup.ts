import { DEFAULT_MAP_HEIGHT } from "places-shared/settings";

export interface ConfigureMapContainerOptions {
  className: string;
  height?: string;
  css?: string;
}

export function configureMapContainer(container: HTMLElement, options: ConfigureMapContainerOptions): void {
  container.addClass(options.className);
  container.setCssProps({
    height: options.height || DEFAULT_MAP_HEIGHT
  });

  if (options.css) {
    const styleEl = createEl('style');
    styleEl.textContent = options.css;
    container.appendChild(styleEl);
  }
}
