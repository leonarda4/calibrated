import { GAMEPLAY_TIMING } from './gameplayTiming.ts';

/** Appearance-driven instructions; no timer, audio, renderer or pose ownership. */
export class SecondBoxPrompts {
  private waitingForSeat = false;
  private seatSent = false;
  private classroomAt: number | null = null;
  private classroomSent = false;
  private lastTime = 0;
  private generation = 0;

  private readonly callbacks: { onSit(): void; onClassroom(): void };
  constructor(callbacks: { onSit(): void; onClassroom(): void }) { this.callbacks = callbacks; }

  requestSit(newAppearance = false): void {
    if (newAppearance) this.seatSent = false;
    if (!this.seatSent) this.waitingForSeat = true;
  }

  wallAppeared(now: number): boolean {
    if (!Number.isFinite(now) || now < this.lastTime || this.classroomAt !== null || this.classroomSent) return false;
    this.classroomAt = now + GAMEPLAY_TIMING.classroomAfterWallSeconds;
    return true;
  }

  cancelWall(): void { this.classroomAt = null; this.classroomSent = false; }
  reset(): void {
    this.generation++;
    this.waitingForSeat = this.seatSent = false;
    this.cancelWall(); this.lastTime = 0;
  }

  update(now: number, box: { visible: boolean; settled: boolean }): void {
    if (!Number.isFinite(now) || now < this.lastTime) { this.reset(); return; }
    this.lastTime = now;
    const token = this.generation;
    if (!box.visible) this.waitingForSeat = this.seatSent = false;
    if (this.waitingForSeat && box.visible && box.settled) {
      this.waitingForSeat = false; this.seatSent = true;
      this.callbacks.onSit();
    }
    if (token !== this.generation) return;
    if (this.classroomAt !== null && now + 1e-9 >= this.classroomAt) {
      this.classroomAt = null; this.classroomSent = true;
      this.callbacks.onClassroom();
    }
  }

  snapshot() { return { waitingForSeat:this.waitingForSeat, seatSent:this.seatSent,
    classroomAt:this.classroomAt, classroomSent:this.classroomSent }; }
}
