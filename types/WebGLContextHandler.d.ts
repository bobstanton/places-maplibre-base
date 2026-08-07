export declare function showWebGLContextLostMessage(container: HTMLElement, onRetry?: () => void): void;
export interface WebGLContextLostMap {
    on(type: 'webglcontextlost' | 'webglcontextrestored', handler: () => void): void;
}
export declare function handleWebGLContextLost(map: WebGLContextLostMap, container: HTMLElement, onRetry?: () => void): void;
