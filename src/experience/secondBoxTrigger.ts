import { measureWallDistances, type HallwayPoint, type HallwayWallPlanes } from './hallwayCenter.ts';

export const SECOND_BOX_INTERACTION = Object.freeze({ wallClearance: .10, triggerLength: 2, hallwayHeight: 2.60 });

/** A metric section between fitted walls, expressed in the calibrated hallway frame. */
export function headsetInSecondBoxSection(position: HallwayPoint, section: {
  walls: HallwayWallPlanes; stationZ: number; floorY: number;
}): boolean {
  if (position.length !== 3 || !position.every(Number.isFinite) ||
      ![section.stationZ, section.floorY].every(Number.isFinite) ||
      position[1] < section.floorY || position[1] > section.floorY + SECOND_BOX_INTERACTION.hallwayHeight ||
      Math.abs(position[2] - section.stationZ) > SECOND_BOX_INTERACTION.triggerLength / 2 + 1e-9) return false;
  try {
    const distances = measureWallDistances(section.walls, position);
    return distances.left >= -1e-9 && distances.right >= -1e-9;
  } catch { return false; }
}
