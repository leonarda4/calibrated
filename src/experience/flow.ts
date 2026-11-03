// Pure installation sequence. No renderer, XR objects, or persisted authority.
export type Position3 = readonly [number, number, number];
export type VoiceCue = 'purpose' | 'badge' | 'congratulations' | 'reversed';
export type ExperiencePhase = 'idle' | 'ready' | 'box' | 'rotating' | 'reversed' | 'stopped';

export interface InstallationConfig {
  centerX: number;
  centerZ: number;
  floorY: number;
  /** Provisional cross-section width; the operator verifies this on site. */
  hallwayWidth: number;
  boxWidth: number;
  boxDepth: number;
  boxHeight: number;
  /** Retained config compatibility only; the manual flow creates no orb. */
  orbHeight: number;
  orbRadius: number;
  explorationSeconds: number;
  rotationSeconds: number;
}

const DEFAULT_BOX_HEIGHT = 0.43;

export const DEFAULT_INSTALLATION_CONFIG: Readonly<InstallationConfig> = {
  // World-space draft values only. A new scan needs an explicit placement;
  // these values are not an authored scan anchor or a physical acceptance.
  centerX: 0, centerZ: 0, floorY: 0, hallwayWidth: 2.1,
  boxWidth: 0.36, boxDepth: 0.36, boxHeight: DEFAULT_BOX_HEIGHT,
  orbHeight: 2.1, orbRadius: 0.14,
  explorationSeconds: 20, rotationSeconds: 4,
};

export interface FingertipContact {
  position: Position3;
  tracked: boolean;
  /** performance.now() clock; a stale previous-frame pose has no authority. */
  timestampMs: number;
  emulatedPosition?: boolean;
}

export interface ExperienceSnapshot {
  phase: ExperiencePhase;
  config: InstallationConfig;
  calibrated: boolean;
  placementConfirmed: boolean;
  stationaryConfirmed: boolean;
  preview: boolean;
  yaw: number;
  elapsedSeconds: number;
  status: string;
}

export function validateInstallationConfig(config: InstallationConfig): void {
  for (const key of Object.keys(DEFAULT_INSTALLATION_CONFIG) as (keyof InstallationConfig)[]) {
    if (!Number.isFinite(config[key])) throw new Error(`${key} must be a finite number`);
  }
  if (config.hallwayWidth <= 0 || config.hallwayWidth > 20 || config.boxWidth >= config.hallwayWidth) {
    throw new Error('Hallway width must be positive and leave space on both sides of the centred box');
  }
  for (const key of ['boxWidth', 'boxDepth', 'boxHeight', 'orbRadius'] as const) {
    if (config[key] <= 0 || config[key] > 5) throw new Error(`${key} must be greater than 0 and at most 5 metres`);
  }
  if (config.orbHeight <= 0 || config.orbHeight > 5) throw new Error('Legacy orb height must be positive and at most 5 metres');
  if (config.explorationSeconds < 0 || config.explorationSeconds > 600) {
    throw new Error('Exploration must last between 0 and 600 seconds');
  }
  if (config.rotationSeconds < 1 || config.rotationSeconds > 30) {
    throw new Error('Rotation must last between 1 and 30 seconds');
  }
}

/** Monotonic ease-in/out with exact endpoints, avoiding transform accumulation. */
export function rotationYaw(elapsedSeconds: number, durationSeconds: number): number {
  const t = Math.min(1, Math.max(0, elapsedSeconds / durationSeconds));
  return Math.PI * (t * t * (3 - 2 * t));
}

export class InstallationFlow {
  private state: ExperienceSnapshot;

  constructor(config: InstallationConfig = { ...DEFAULT_INSTALLATION_CONFIG }) {
    validateInstallationConfig(config);
    this.state = {
      phase: 'idle', config: { ...config }, calibrated: false,
      placementConfirmed: false, stationaryConfirmed: false,
      preview: false, yaw: 0, elapsedSeconds: 0,
      status: 'Set the box placement, then press Show box. Calibrate first for a live headset view.',
    };
  }

  snapshot(): ExperienceSnapshot {
    return { ...this.state, config: { ...this.state.config } };
  }

  drainCues(): VoiceCue[] {
    return []; // Narrative cues are operator-controlled separately.
  }

  setCalibrated(): void {
    this.clear('ready', 'Fit applied. Show the box when ready.');
    this.state.calibrated = true;
    this.state.placementConfirmed = false;
  }

  configure(config: InstallationConfig): void {
    validateInstallationConfig(config);
    if (this.state.phase === 'rotating' || this.state.phase === 'reversed' || this.state.yaw !== 0) {
      throw new Error('Stop and reset the sequence before changing placement.');
    }
    const shown = this.state.phase === 'box';
    const preview = this.state.preview;
    this.clear(shown ? 'box' : this.state.calibrated ? 'ready' : 'idle',
      shown ? 'Box placement updated. Press Rotate hallway when ready.' : 'Placement updated. Press Show box when ready.');
    this.state.preview = shown && preview;
    this.state.config = { ...config };
    this.state.placementConfirmed = false;
  }

  confirmPlacement(confirmed: boolean): void {
    this.state.placementConfirmed = confirmed;
  }

  /** Compatibility only: manual rotation has no step/support detection gate. */
  confirmStationary(_confirmed: boolean): void {
    this.state.stationaryConfirmed = false;
  }

  showBox(preview = false): boolean {
    if (this.state.phase === 'rotating' || this.state.phase === 'stopped' || this.state.phase === 'reversed') return false;
    if (!preview && !this.state.calibrated) {
      this.state.status = 'Calibrate the current headset session before showing the box in VR.';
      return false;
    }
    if (this.state.phase === 'box') return true;
    this.clear('box', preview ? 'DESKTOP PREVIEW: box shown. Press Rotate hallway to preview the turn.' : 'Box shown. Press Rotate hallway when ready.');
    this.state.preview = preview;
    return true;
  }

  rotateHallway(): boolean {
    if (this.state.phase !== 'box' || (!this.state.preview && !this.state.calibrated)) return false;
    this.state.phase = 'rotating';
    this.state.elapsedSeconds = 0;
    this.state.status = 'Rotating hallway 180 degrees. The box stays fixed.';
    return true;
  }

  /** Legacy entry points cannot reintroduce time/contact-driven progression. */
  start(preview = false): boolean { return this.showBox(preview); }
  previewAdvance(): void {}
  simulateCollection(): boolean { return false; }

  update(deltaSeconds: number, _contacts: readonly FingertipContact[] = [], _nowMs = 0): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    if (this.state.phase === 'rotating') {
      this.state.elapsedSeconds += deltaSeconds;
      this.state.yaw = rotationYaw(this.state.elapsedSeconds, this.state.config.rotationSeconds);
      if (this.state.elapsedSeconds >= this.state.config.rotationSeconds) {
        this.state.phase = 'reversed';
        this.state.status = '180 degrees complete. Reset restores the fitted hallway heading.';
        this.state.yaw = Math.PI;
        this.state.stationaryConfirmed = false;
      }
    }
  }

  stop(reason = 'STOPPED. Stay still and follow the operator. Reset only when ready.'): void {
    this.state.phase = 'stopped';
    this.state.status = reason;
    this.state.stationaryConfirmed = false;
  }

  invalidate(reason: string): void {
    this.stop(reason);
    this.state.calibrated = false;
    this.state.placementConfirmed = false;
  }

  reset(): void {
    this.clear(this.state.calibrated ? 'ready' : 'idle', 'Baseline restored. Press Show box when ready.');
    this.state.placementConfirmed = false;
  }

  private clear(phase: ExperiencePhase, status: string): void {
    Object.assign(this.state, { phase, status, stationaryConfirmed: false, preview: false, yaw: 0, elapsedSeconds: 0 });
  }
}
