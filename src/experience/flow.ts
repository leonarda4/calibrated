// Pure installation sequence. No renderer, XR objects, or persisted authority.
export type Position3 = readonly [number, number, number];
export type VoiceCue = 'purpose' | 'badge' | 'congratulations' | 'reversed';
export type ExperiencePhase = 'idle' | 'ready' | 'exploring' | 'badge' | 'rotating' | 'reversed' | 'stopped';

export interface InstallationConfig {
  centerX: number;
  centerZ: number;
  floorY: number;
  /** Provisional cross-section width; the operator verifies this on site. */
  hallwayWidth: number;
  boxWidth: number;
  boxDepth: number;
  boxHeight: number;
  /** Orb centre above the measured floor, rather than above the box. */
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
  if (config.orbHeight <= config.boxHeight + config.orbRadius || config.orbHeight > 5) {
    throw new Error('The orb must be above the box and no more than 5 metres above the floor');
  }
  if (config.explorationSeconds < 0 || config.explorationSeconds > 600) {
    throw new Error('Exploration must last between 0 and 600 seconds');
  }
  if (config.rotationSeconds < 1 || config.rotationSeconds > 30) {
    throw new Error('Rotation must last between 1 and 30 seconds');
  }
}

export function orbPosition(config: InstallationConfig): Position3 {
  return [config.centerX, config.floorY + config.orbHeight, config.centerZ];
}

export function validOrbContact(contact: FingertipContact, config: InstallationConfig, nowMs: number): boolean {
  if (!contact.tracked || contact.emulatedPosition || !Number.isFinite(nowMs) ||
      !Number.isFinite(contact.timestampMs) || nowMs < contact.timestampMs ||
      nowMs - contact.timestampMs > 100 || !Array.isArray(contact.position) ||
      contact.position.length !== 3 || !contact.position.every(Number.isFinite)) return false;
  const target = orbPosition(config);
  return Math.hypot(...contact.position.map((value, i) => value - target[i])) <= config.orbRadius;
}

/** Monotonic ease-in/out with exact endpoints, avoiding transform accumulation. */
export function rotationYaw(elapsedSeconds: number, durationSeconds: number): number {
  const t = Math.min(1, Math.max(0, elapsedSeconds / durationSeconds));
  return Math.PI * (t * t * (3 - 2 * t));
}

export class InstallationFlow {
  private state: ExperienceSnapshot;
  private cues: VoiceCue[] = [];

  constructor(config: InstallationConfig = { ...DEFAULT_INSTALLATION_CONFIG }) {
    validateInstallationConfig(config);
    this.state = {
      phase: 'idle', config: { ...config }, calibrated: false,
      placementConfirmed: false, stationaryConfirmed: false,
      preview: false, yaw: 0, elapsedSeconds: 0,
      status: 'Draft placement. Calibrate, then check the real box and hallway midpoint.',
    };
  }

  snapshot(): ExperienceSnapshot {
    return { ...this.state, config: { ...this.state.config } };
  }

  drainCues(): VoiceCue[] {
    return this.cues.splice(0);
  }

  setCalibrated(): void {
    this.clear('ready', 'Fit applied. Check independent landmarks and the physical box before starting.');
    this.state.calibrated = true;
    this.state.placementConfirmed = false;
  }

  configure(config: InstallationConfig): void {
    validateInstallationConfig(config);
    if (this.isActive() || this.state.phase === 'reversed' || this.state.yaw !== 0) {
      throw new Error('Stop and reset the sequence before changing placement.');
    }
    this.clear(this.state.calibrated ? 'ready' : 'idle', 'Placement changed. Confirm its position and dimensions again.');
    this.state.config = { ...config };
    this.state.placementConfirmed = false;
  }

  confirmPlacement(confirmed: boolean): void {
    this.state.placementConfirmed = confirmed;
    if (!confirmed && this.isActive()) this.stop('Placement check withdrawn. Sequence stopped.');
  }

  confirmStationary(confirmed: boolean): void {
    this.state.stationaryConfirmed = confirmed;
    if (!confirmed && this.state.phase === 'rotating') this.stop('Support confirmation withdrawn. Turn stopped.');
  }

  start(preview = false): boolean {
    if (this.isActive() || this.state.phase === 'stopped' || this.state.phase === 'reversed') return false;
    if (!preview && (!this.state.calibrated || !this.state.placementConfirmed)) {
      this.state.status = 'Start requires a current fit and a checked real box / hallway placement.';
      return false;
    }
    this.clear('exploring', preview ? 'DESKTOP PREVIEW: find your purpose and bring it back here.' : 'Find your purpose and bring it back here.');
    this.state.preview = preview;
    this.cues.push('purpose');
    return true;
  }

  previewAdvance(): void {
    if (this.state.preview && this.state.phase === 'exploring') this.showBadge();
  }

  simulateCollection(): boolean {
    if (!this.state.preview || this.state.phase !== 'badge' || !this.state.stationaryConfirmed) return false;
    this.collect();
    return true;
  }

  update(deltaSeconds: number, contacts: readonly FingertipContact[], nowMs: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    if (this.state.phase === 'exploring') {
      this.state.elapsedSeconds += deltaSeconds;
      if (this.state.elapsedSeconds >= this.state.config.explorationSeconds) this.showBadge();
    } else if (this.state.phase === 'badge' && !this.state.preview && this.state.stationaryConfirmed) {
      if (contacts.some(contact => validOrbContact(contact, this.state.config, nowMs))) this.collect();
    } else if (this.state.phase === 'rotating') {
      this.state.elapsedSeconds += deltaSeconds;
      this.state.yaw = rotationYaw(this.state.elapsedSeconds, this.state.config.rotationSeconds);
      if (this.state.elapsedSeconds >= this.state.config.rotationSeconds) {
        this.state.phase = 'reversed';
        this.state.status = '180° complete. Step down with the operator. Reversed walls need new alignment checks.';
        this.state.yaw = Math.PI;
        this.state.stationaryConfirmed = false;
        this.cues.push('reversed');
      }
    }
  }

  stop(reason = 'STOPPED. Stay still and follow the operator. Reset only when ready.'): void {
    this.state.phase = 'stopped';
    this.state.status = reason;
    this.state.stationaryConfirmed = false;
    this.cues = [];
  }

  invalidate(reason: string): void {
    this.stop(reason);
    this.state.calibrated = false;
    this.state.placementConfirmed = false;
  }

  reset(): void {
    this.clear(this.state.calibrated ? 'ready' : 'idle', 'Baseline restored. Recheck placement before starting.');
    this.state.placementConfirmed = false;
  }

  private isActive(): boolean {
    return ['exploring', 'badge', 'rotating'].includes(this.state.phase);
  }

  private clear(phase: ExperiencePhase, status: string): void {
    Object.assign(this.state, { phase, status, stationaryConfirmed: false, preview: false, yaw: 0, elapsedSeconds: 0 });
    this.cues = [];
  }

  private showBadge(): void {
    this.state.phase = 'badge';
    this.state.elapsedSeconds = 0;
    this.state.status = 'Get your badge. Claim your education. The orb waits above the box.';
    this.cues.push('badge');
  }

  private collect(): void {
    this.state.phase = 'rotating';
    this.state.elapsedSeconds = 0;
    this.state.status = 'Congratulations. Stay still on the box while the hallway turns.';
    this.cues.push('congratulations');
  }
}
