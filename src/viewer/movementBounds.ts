import * as THREE from 'three';
import type { Point3 } from '../boundary/geometry.ts';

/** Operator diagnostics remain outside the scan and never enter the headset. */
export function createMovementBounds(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = 'desktop-movement-boundaries';
  scene.add(root);
  const makeLine = (name: string, color: number) => {
    const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9,
    }));
    line.name = name;
    line.renderOrder = 1500;
    line.frustumCulled = false;
    root.add(line);
    return line;
  };
  const headset = makeLine('desktop-headset-boundary', 0x63dce9);
  const manual = makeLine('desktop-manual-boundary', 0xffc46c);
  const previous = new Map<THREE.LineSegments, string>();
  const updateLine = (line: THREE.LineSegments, points: readonly Point3[]) => {
    const signature = JSON.stringify(points.map(point => point.map(value => Number(value.toFixed(4)))));
    line.visible = points.length >= 3;
    if (previous.get(line) === signature) return;
    previous.set(line, signature);
    const positions: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      // Small corner ticks aid floor inspection; they do not represent a ceiling.
      positions.push(a[0], a[1] + 0.015, a[2], b[0], b[1] + 0.015, b[2],
        a[0], a[1] + 0.015, a[2], a[0], a[1] + 0.215, a[2]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    line.geometry.dispose();
    line.geometry = geometry;
  };
  return {
    update(runtimePoints: readonly Point3[], manualPoints: readonly Point3[], presenting: boolean) {
      updateLine(headset, runtimePoints);
      updateLine(manual, manualPoints);
      root.visible = !presenting;
    },
    dispose() {
      scene.remove(root);
      for (const line of [headset, manual]) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }
    },
  };
}
