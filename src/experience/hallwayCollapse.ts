import { Matrix4, Vector3 } from 'three';
import { normalizeBoundary, type Point3 } from '../boundary/geometry.ts';
import { cutoutPlacement, type CutOpening } from '../viewer/hallwayCutPlacement.ts';
import { HoleWorldRotation, easeHoleTurn, type HoleTurnGeometry } from './holeWorldRotation.ts';

export const HALLWAY_COLLAPSE = Object.freeze({
  minProtectedDepth: 6, userClearance: 2, boundaryClearance: 1,
  blastCount: 10, spotsPerSide: 5, minStaggerSeconds: .6, maxStaggerSeconds: 1.1,
  blastSeconds: 1.8, blastRadius: .9, blastClearance: 2, patchSeconds: 3, residualSeconds: 8,
  edgeWidth: .75, defaultSeed: 0x51ce2026,
});

type Phase = 'idle' | 'fracturing' | 'disintegrating' | 'complete' | 'suppressed' | 'cancelled';
type Transform = Matrix4 | readonly number[];
export interface HallwayCollapseSample {
  dt: number;
  eligible: boolean;
  upright: boolean;
  positionWorld: Point3 | null;
  presentation: Transform;
  /** Optional current physical bounds can only enlarge the protected prefix. */
  boundaryPoints?: readonly Point3[] | null;
}
interface Blast {
  id: number;
  side: -1 | 1;
  depth: number;
  height: number;
  across: number;
  start: number;
  duration: number;
  radiusAcross: number;
  radiusUp: number;
  radiusDepth: number;
  seed: number;
}
export interface CollapseDamagePatch {
  id: number;
  centerOpening: Point3;
  age: number;
  fadeProgress: number;
  radiusAcross: number;
  radiusUp: number;
  radiusDepth: number;
  seed: number;
  active: boolean;
}

/** A captured seed is reproducible; callers choose a new seed for each game. */
function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ state >>> 15, state | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

const finitePoint = (point: Point3 | null): point is Point3 =>
  !!point && point.length === 3 && point.every(Number.isFinite);
function rigidMatrix(value: Transform): Matrix4 | null {
  if (!(value instanceof Matrix4) && (!value || value.length !== 16)) return null;
  const matrix = value instanceof Matrix4 ? value.clone() : new Matrix4().fromArray(value);
  const e = matrix.elements, axes = [new Vector3(e[0], e[1], e[2]), new Vector3(e[4], e[5], e[6]), new Vector3(e[8], e[9], e[10])];
  if (!e.every(Number.isFinite) || Math.abs(matrix.determinant() - 1) > 1e-6 ||
      axes.some(axis => Math.abs(axis.length() - 1) > 1e-6) ||
      Math.max(Math.abs(axes[0].dot(axes[1])), Math.abs(axes[0].dot(axes[2])), Math.abs(axes[1].dot(axes[2]))) > 1e-6 ||
      Math.abs(e[3]) + Math.abs(e[7]) + Math.abs(e[11]) + Math.abs(e[15] - 1) > 1e-8) return null;
  return matrix;
}
function validSource(source: CutOpening): boolean {
  if (!source || ![source.origin, source.across, source.up, source.along].every(finitePoint) ||
      !Number.isFinite(source.width) || source.width <= 0 || !Number.isFinite(source.height) || source.height <= 0) return false;
  const axes = [source.across, source.up, source.along].map(axis => new Vector3(...axis));
  return axes.every(axis => Math.abs(axis.length() - 1) <= 1e-6) &&
    Math.max(Math.abs(axes[0].dot(axes[1])), Math.abs(axes[0].dot(axes[2])), Math.abs(axes[1].dot(axes[2]))) <= 1e-6;
}

/** One distant, added-corridor collapse per game. No renderer, sound or XR input. */
export class HallwayCollapse {
  private phase: Phase = 'idle';
  private elapsed = 0;
  private paused = false;
  private farDepth = 0;
  private protectedDepth: number = HALLWAY_COLLAPSE.minProtectedDepth;
  private userDepth: number | null = null;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private seed: number = HALLWAY_COLLAPSE.defaultSeed;
  private durationSeconds = 0;
  private patchMatureSeconds = 0;
  private placement: ReturnType<typeof cutoutPlacement> | null = null;
  private openingToCanonical: Matrix4 | null = null;
  private canonicalToOpening: Matrix4 | null = null;
  private worldToOpening: Matrix4 | null = null;
  private blasts: Blast[] = [];

  /** Call only after the actual broom glitch-out completes, never on manual Hide. */
  arm(hole: HoleTurnGeometry, finalPresentation: Transform, sourceOpening: CutOpening,
    farDepth: number, positionWorld: Point3, options: { blastSeconds?: number; seed?: number } = {}): boolean {
    if (this.phase !== 'idle') return false;
    const final = rigidMatrix(finalPresentation), duration = options.blastSeconds ?? HALLWAY_COLLAPSE.blastSeconds;
    const seed = options.seed ?? HALLWAY_COLLAPSE.defaultSeed;
    const turn = new HoleWorldRotation();
    if (!final || !validSource(sourceOpening) || !finitePoint(positionWorld) ||
        !Number.isFinite(farDepth) || farDepth <= 0 || farDepth > 1000 ||
        !Number.isFinite(duration) || duration <= 0 || duration > 30 ||
        !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !turn.start(hole)) {
      this.cancel(); return false;
    }
    for (let index = 0; index < 8; index++) turn.update(.5, true);
    if (turn.matrix().elements.some((value, index) => Math.abs(value - final.elements[index]) > 1e-7)) {
      this.cancel(); return false;
    }
    // Copy every source/geometry value: the captured mouth survives return legs.
    const source: CutOpening = { origin: [...sourceOpening.origin], across: [...sourceOpening.across],
      up: [...sourceOpening.up], along: [...sourceOpening.along], width: sourceOpening.width, height: sourceOpening.height };
    const mouth = { open: hole.open, floorY: hole.floorY, startZ: hole.startZ, endZ: hole.endZ,
      nearBounds: hole.nearBounds ? [...hole.nearBounds] : null,
      farBounds: hole.farBounds ? [...hole.farBounds] : null, routeToWorld: [...hole.routeToWorld] };
    const floorBounds = hole.floorSide === 'end' ? mouth.farBounds! : mouth.nearBounds!;
    const guide: Point3 = [(floorBounds[0] + floorBounds[1]) / 2, hole.floorY,
      hole.floorSide === 'end' ? hole.endZ : hole.startZ];
    this.placement = cutoutPlacement(source, mouth, guide);
    this.openingToCanonical = this.placement.sourceToWorld.clone().multiply(this.placement.rawToOpening.clone().invert());
    this.canonicalToOpening = this.openingToCanonical.clone().invert();
    this.worldToOpening = this.canonicalToOpening.clone().multiply(final.clone().invert());
    this.farDepth = farDepth; this.sourceWidth = source.width; this.sourceHeight = source.height;
    this.userDepth = new Vector3(...positionWorld).applyMatrix4(this.worldToOpening).z;
    this.protectedDepth = Math.max(HALLWAY_COLLAPSE.minProtectedDepth, this.userDepth + HALLWAY_COLLAPSE.userClearance);
    this.elapsed = 0; this.paused = false; this.seed = seed; this.durationSeconds = 0;
    const minBlastDepth = this.protectedDepth + HALLWAY_COLLAPSE.blastClearance;
    const maxBlastDepth = farDepth - 1, span = maxBlastDepth - minBlastDepth;
    if (span < .5) { this.phase = 'suppressed'; return true; }
    const random = randomFromSeed(seed), firstSide = random() < .5 ? -1 : 1;
    let start = 0;
    this.blasts = Array.from({ length: HALLWAY_COLLAPSE.blastCount }, (_, id) => {
      if (id > 0) start += HALLWAY_COLLAPSE.minStaggerSeconds +
        random() * (HALLWAY_COLLAPSE.maxStaggerSeconds - HALLWAY_COLLAPSE.minStaggerSeconds);
      const side = (id % 2 === 0 ? firstSide : -firstSide) as -1 | 1;
      const jitter = id > 0 && id < HALLWAY_COLLAPSE.blastCount - 1 ? (random() - .5) * span * .035 : 0;
      return { id, side, depth: maxBlastDepth - span * id / (HALLWAY_COLLAPSE.blastCount - 1) + jitter,
        across: side * (source.width / 2 - .02 - .1 * random()),
        height: Math.max(.25, Math.min(source.height - .25, source.height * (.2 + .65 * random()))),
        start, duration, radiusAcross: 1.1 + .5 * random(), radiusUp: .8 + .6 * random(),
        radiusDepth: Math.max(.65, (farDepth - minBlastDepth) / HALLWAY_COLLAPSE.spotsPerSide * 1.3 * (.85 + .3 * random())),
        seed: random() * 997 };
    });
    this.patchMatureSeconds = this.blasts.at(-1)!.start + Math.max(duration, HALLWAY_COLLAPSE.patchSeconds);
    this.durationSeconds = this.patchMatureSeconds + HALLWAY_COLLAPSE.residualSeconds;
    this.phase = 'fracturing';
    return true;
  }

  reset(): void {
    this.phase = 'idle'; this.elapsed = 0; this.paused = false; this.farDepth = 0;
    this.protectedDepth = HALLWAY_COLLAPSE.minProtectedDepth; this.userDepth = null; this.sourceWidth = 0; this.sourceHeight = 0;
    this.seed = HALLWAY_COLLAPSE.defaultSeed; this.durationSeconds = 0; this.patchMatureSeconds = 0;
    this.placement = null; this.openingToCanonical = null; this.canonicalToOpening = null; this.worldToOpening = null; this.blasts = [];
  }
  cancel(): void { this.phase = 'cancelled'; this.elapsed = 0; this.paused = false; }

  update(sample: HallwayCollapseSample): void {
    if (this.phase === 'idle' || this.phase === 'cancelled') return;
    const presentation = rigidMatrix(sample.presentation);
    if (!sample.eligible || !finitePoint(sample.positionWorld) || !presentation ||
        !Number.isFinite(sample.dt) || sample.dt < 0 || sample.dt > .5 || typeof sample.upright !== 'boolean') {
      this.cancel(); return;
    }
    this.worldToOpening = this.canonicalToOpening!.clone().multiply(presentation.invert());
    this.userDepth = new Vector3(...sample.positionWorld).applyMatrix4(this.worldToOpening).z;
    this.protectedDepth = Math.max(this.protectedDepth, this.userDepth + HALLWAY_COLLAPSE.userClearance);
    // The conservative projection protects the entire supplied physical area,
    // including concave boundaries, without ever manufacturing one if absent.
    const boundary = sample.boundaryPoints ? normalizeBoundary(sample.boundaryPoints) : null;
    if (boundary) for (const point of boundary) this.protectedDepth = Math.max(this.protectedDepth,
      new Vector3(...point).applyMatrix4(this.worldToOpening).z + HALLWAY_COLLAPSE.boundaryClearance);
    this.paused = !sample.upright;
    if (this.paused || sample.dt === 0 || this.phase === 'suppressed' || this.phase === 'complete') return;
    this.elapsed = Math.min(this.durationSeconds, this.elapsed + sample.dt);
    if (this.elapsed + 1e-9 >= this.durationSeconds) this.elapsed = this.durationSeconds;
    this.phase = this.elapsed >= this.durationSeconds ? 'complete' : 'disintegrating';
  }

  /** Exact bilinear mouth mapping for fracture FX; the affine matrix is for depth. */
  canonicalPoint(xAcross: number, yHeight: number, depth: number): Point3 | null {
    if (!this.placement || ![xAcross, yHeight, depth].every(Number.isFinite)) return null;
    return this.placement.map(new Vector3(xAcross, yHeight, depth)).applyMatrix4(this.placement.routeToWorld).toArray();
  }
  worldPoint(openingPoint: Point3, presentation: Transform): Point3 | null {
    const transform = rigidMatrix(presentation);
    if (!finitePoint(openingPoint) || !transform) return null;
    const canonical = this.canonicalPoint(...openingPoint);
    return canonical ? new Vector3(...canonical).applyMatrix4(transform).toArray() : null;
  }

  private progress(): number {
    return this.phase === 'idle' || this.phase === 'cancelled' || this.phase === 'suppressed' ? 0
      : this.durationSeconds > 0 ? Math.max(0, Math.min(1, this.elapsed / this.durationSeconds)) : 0;
  }
  /** Local envelope before the renderer's ragged noise, never a whole depth plane. */
  removalAtOpening(point: Point3): number {
    const state = this.snapshot();
    if (!state.maskActive || !finitePoint(point) || point[2] <= state.protectedDepth) return 0;
    let loss = 0;
    for (const patch of state.patches) {
      if (!patch.active || patch.fadeProgress <= 0) continue;
      const growth = .25 + .75 * easeHoleTurn(patch.fadeProgress);
      const distance = Math.hypot((point[0] - patch.centerOpening[0]) / (patch.radiusAcross * growth),
        (point[1] - patch.centerOpening[1]) / (patch.radiusUp * growth),
        (point[2] - patch.centerOpening[2]) / (patch.radiusDepth * growth));
      const t = Math.max(0, Math.min(1, 1 - distance));
      loss = Math.max(loss, patch.fadeProgress * t * t * (3 - 2 * t));
    }
    if(Math.abs(point[0])>this.sourceWidth/2+.3||point[1]<-.3||point[1]>this.sourceHeight+.3)return loss;
    const clearing=state.residualProgress*easeHoleTurn((point[2]-state.protectedDepth)/3);
    return 1-(1-loss)*(1-clearing);
  }
  snapshot() {
    const progress = this.progress(), enabled = !['idle', 'cancelled', 'suppressed'].includes(this.phase);
    const residualProgress = enabled ? Math.max(0,Math.min(1,(this.elapsed-this.patchMatureSeconds)/HALLWAY_COLLAPSE.residualSeconds)) : 0;
    const patches: CollapseDamagePatch[] = this.blasts.map(blast => {
      const age = this.elapsed - blast.start, suppressed = blast.depth - HALLWAY_COLLAPSE.blastRadius <= this.protectedDepth;
      return { id: blast.id, centerOpening: [blast.across, blast.height, blast.depth], age,
        fadeProgress: Math.max(0, Math.min(1, age / HALLWAY_COLLAPSE.patchSeconds)),
        radiusAcross: blast.radiusAcross, radiusUp: blast.radiusUp, radiusDepth: blast.radiusDepth, seed: blast.seed,
        active: enabled && age >= -1e-9 && !suppressed };
    });
    // Compatibility readouts only. Rendering uses the 3D local patches, never
    // this nearest affected depth as a full-cross-section clipping plane.
    const authoredFrontDepth = Math.min(this.farDepth, ...patches.filter(patch => patch.age > 0)
      .map(patch => patch.centerOpening[2] - patch.radiusDepth * easeHoleTurn(patch.fadeProgress)));
    const frontDepth = Math.max(this.protectedDepth, authoredFrontDepth);
    const maskActive = enabled && patches.some(patch => patch.active && patch.fadeProgress > 0) && this.protectedDepth < this.farDepth;
    const blastEndSeconds = Math.max(0, ...this.blasts.filter(blast =>
      blast.depth - HALLWAY_COLLAPSE.blastRadius > this.protectedDepth).map(blast => blast.start + blast.duration));
    const explosionsFinished = this.phase === 'suppressed' || (enabled && this.elapsed + 1e-9 >= blastEndSeconds);
    return { phase: this.phase, active: enabled, paused: this.paused, elapsedSeconds: this.elapsed,
      blastEndSeconds, explosionsFinished,
      progress, durationSeconds: this.durationSeconds, patchMatureSeconds:this.patchMatureSeconds, residualProgress, seed: this.seed,
      farDepth: this.farDepth, protectedDepth: this.protectedDepth, userDepth: this.userDepth,
      authoredFrontDepth, frontDepth, edgeWidth: HALLWAY_COLLAPSE.edgeWidth, feather: HALLWAY_COLLAPSE.edgeWidth,
      openingWidth: this.sourceWidth, openingHeight: this.sourceHeight, maskActive,
      patches,
      mask: { active: maskActive, frontDepth, protectedDepth: this.protectedDepth, feather: HALLWAY_COLLAPSE.edgeWidth, patches, residualProgress },
      rawToOpening: this.placement?.rawToOpening.toArray() ?? null,
      openingToCanonical: this.openingToCanonical?.toArray() ?? null,
      canonicalToOpening: this.canonicalToOpening?.toArray() ?? null,
      worldToOpening: this.worldToOpening?.toArray() ?? null,
      blasts: this.blasts.map(blast => {
        const age = this.elapsed - blast.start, suppressed = blast.depth - HALLWAY_COLLAPSE.blastRadius <= this.protectedDepth;
        return { ...blast, age, radius: HALLWAY_COLLAPSE.blastRadius, suppressed,
          active: enabled && age >= -1e-9 && age + 1e-9 < blast.duration && !suppressed,
          progress: Math.max(0, Math.min(1, age / blast.duration)),
          openingPosition: [blast.across, blast.height, blast.depth] as Point3 };
      }),
    };
  }
}
