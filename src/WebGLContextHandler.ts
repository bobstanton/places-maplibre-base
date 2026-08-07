import { logger, renderMapSurfaceError } from "places-shared/utils";
import { getMapRecoveryState, markMapContextLost, markMapContextRestored } from "places-shared/map";

// A lost WebGL context is usually transient (backgrounded tab, GPU reset). Both
// maplibre-gl and mapbox-gl automatically re-apply the style (base map plus the
// Places layers) and re-emit 'webglcontextrestored' when the browser hands the context
// back. Wait this long for that before treating the loss as permanent and
// tearing the map down for a manual retry.
const CONTEXT_RESTORE_GRACE_MS = 3000;

export function showWebGLContextLostMessage(container: HTMLElement, onRetry?: () => void): void {
  const existingOverlay = container.querySelector('.places-webgl-error-overlay');
  if (existingOverlay) {
    return;
  }

  const recoveryState = getMapRecoveryState(container);
  const retry = onRetry ?? recoveryState?.rehydrate;

  // A lost context cannot render again. Tear down the provider immediately: a
  // page with many maps releases everything associated with this instance.
  try {
    if (recoveryState) recoveryState.suppressContextLoss = true;
    recoveryState?.cleanup?.();
  } catch (error) {
    logger.error('Failed to clean up map after WebGL context loss:', error);
  }

  // Floating map controls live beside the map container. They no longer have a
  // usable target and would overlap the recovery action, and are discarded too.
  const host = container.parentElement;
  host?.querySelectorAll(':scope > .places-floating-buttons, :scope > .places-geocoding-search')
    .forEach(element => element.remove());

  container.addClass('places-map-context-lost');
  const errorPanel = renderMapSurfaceError(container, {
    icon: '⚠️',
    title: 'Map display error',
    message: 'The map lost its graphics context. Use refresh or reopen the view after resources are available.',
    className: 'webgl-error-overlay',
  });

  if (retry) {
    const actions = errorPanel.createDiv({ cls: 'places-webgl-error-actions' });
    const retryBtn = actions.createEl('button', { text: 'Retry', cls: 'mod-cta' });
    retryBtn.addEventListener('click', () => void (async () => {
      retryBtn.toggleClass('is-loading', true);
      retryBtn.setAttr('disabled', 'true');
      try {
        await Promise.resolve(retry());
        container.removeClass('places-map-context-lost');
        errorPanel.remove();
      } catch (error) {
        retryBtn.toggleClass('is-loading', false);
        retryBtn.removeAttribute('disabled');
        logger.error('Failed to retry map after WebGL context loss:', error);
      }
    })());
  }
}

export interface WebGLContextLostMap {
  on(type: 'webglcontextlost' | 'webglcontextrestored', handler: () => void): void;
}

// A loss is not torn down immediately: the engine (MapLibre/mapbox-gl) has already
// called preventDefault on the canvas event, and the browser fires
// 'webglcontextrestored' for a transient loss, at which point the engine
// automatically re-applies the serialized style (base map plus the Places sources
// and layers) and HTML markers persist as DOM. Only the lost state is cleared.
//
// A loss that never restores within the grace window is treated as permanent: the
// recovery panel tears the provider down for a manual retry (freeing resources
// under genuine memory pressure). Both native listeners are disposed by
// `map.remove()`.
export function handleWebGLContextLost(map: WebGLContextLostMap, container: HTMLElement, onRetry?: () => void): void {
  const ownerWindow = container.ownerDocument.defaultView ?? window;
  let restored = false;
  let pendingTeardown: number | null = null;

  const cancelPendingTeardown = (): void => {
    if (pendingTeardown !== null) {
      ownerWindow.clearTimeout(pendingTeardown);
      pendingTeardown = null;
    }
  };

  map.on('webglcontextrestored', () => {
    restored = true;
    cancelPendingTeardown();
    markMapContextRestored(container);
    logger.debug('WebGL context restored - map recovered automatically');
  });

  map.on('webglcontextlost', () => {
    const recoveryState = getMapRecoveryState(container);
    if (recoveryState?.suppressContextLoss) {
      return;
    }

    restored = false;
    logger.warn('WebGL context lost - waiting for automatic restore (memory pressure or too many map instances)');
    markMapContextLost(container);

    if (pendingTeardown !== null) {
      return;
    }
    pendingTeardown = ownerWindow.setTimeout(() => {
      pendingTeardown = null;
      // Restored in the meantime, or the surface was torn down / detached (note
      // closed) while waiting - nothing to recover or report.
      if (restored || !container.isConnected) {
        return;
      }
      logger.warn('WebGL context did not restore - showing recovery panel');
      showWebGLContextLostMessage(container, onRetry);
    }, CONTEXT_RESTORE_GRACE_MS);
  });
}
