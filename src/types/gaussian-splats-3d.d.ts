// Minimal ambient types for @mkkellogg/gaussian-splats-3d (ships without .d.ts)
declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export interface SplatSceneOptions {
    path: string;
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    onProgress?: (percent: number, label: string) => void;
  }

  export interface ViewerOptions {
    gpuAcceleratedSort?: boolean;
    antialiased?: boolean;
    dynamicScene?: boolean;
    sphericalHarmonicsDegree?: number;
    sharedMemoryForWorkers?: boolean;
    renderer?: THREE.WebGLRenderer;
    camera?: THREE.Camera;
    threeScene?: THREE.Scene;
    useBuiltInControls?: boolean;
    selfDrivenMode?: boolean;
    rootElement?: HTMLElement | null;
    dropInMode?: boolean;
  }

  export class DropInViewer extends THREE.Group {
    constructor(options?: ViewerOptions);
    viewer: Viewer;
    addSplatScene(path: string, options?: Partial<SplatSceneOptions>): Promise<void>;
    addSplatScenes(scenes: SplatSceneOptions[]): Promise<void>;
    removeSplatScene(index: number): void;
    dispose(): Promise<void>;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    splatMesh: THREE.Mesh & Record<string, unknown>;
    addSplatScene(path: string, options?: Partial<SplatSceneOptions>): Promise<void>;
    addSplatScenes(scenes: SplatSceneOptions[]): Promise<void>;
    update(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void;
    start(): void;
    stop(): void;
    dispose(): Promise<void>;
  }
}