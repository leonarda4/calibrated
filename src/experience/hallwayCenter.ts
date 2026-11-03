/** Local appearance-based corridor estimate. This is not surveyed wall geometry. */
export type HallwayPoint = readonly [number, number, number];

/** A world-space fitted wall; its unit normal points into the corridor. */
export interface HallwayWallPlane {
  point: HallwayPoint;
  normal: HallwayPoint;
  residual: number;
}

export interface HallwayWallPlanes {
  left: HallwayWallPlane;
  right: HallwayWallPlane;
}

/** Signed inward point-to-plane distances, independently measured in world metres. */
export function measureWallDistances(walls: HallwayWallPlanes, worldPoint: HallwayPoint): {
  left: number; right: number; imbalance: number;
} {
  if (!finitePoint(worldPoint)) throw new Error('Wall measurements need a finite world point.');
  const distance = (wall: HallwayWallPlane): number => {
    if (!wall?.point || !wall.normal || !finitePoint(wall.point) || !finitePoint(wall.normal)
      || !Number.isFinite(wall.residual) || wall.residual < 0
      || Math.abs(Math.hypot(...wall.normal) - 1) > 1e-8) {
      throw new Error('Wall measurements need finite points and unit inward normals.');
    }
    const value = (worldPoint[0] - wall.point[0]) * wall.normal[0]
      + (worldPoint[1] - wall.point[1]) * wall.normal[1]
      + (worldPoint[2] - wall.point[2]) * wall.normal[2];
    if (!Number.isFinite(value)) throw new Error('Wall measurement exceeds finite world coordinates.');
    return value;
  };
  const left = distance(walls.left), right = distance(walls.right);
  return { left, right, imbalance: Math.abs(left - right) };
}

export interface HallwayCenterOptions {
  /** Raw scan XYZ values; a fourth padding/component value is ignored with stride 4. */
  centers: ArrayLike<number>;
  stride?: 3 | 4;
  /** Column-major scan-local to XR-world affine matrix. */
  modelMatrix: ArrayLike<number>;
  seedRaw: HallwayPoint;
  floorY: number;
  corridorDirectionRaw?: HallwayPoint;
  /** The full fitting section is twice this length, in world metres. */
  longitudinalHalfWindow?: number;
}

export interface WallEvidence {
  occupiedCells: number;
  longitudinalSpan: number;
  heightSpan: number;
  residual: number;
}

export interface HallwayCenterEvidence {
  scannedPoints: number;
  eligiblePoints: number;
  occupiedCells: number;
  left?: WallEvidence;
  right?: WallEvidence;
}

export type HallwayCenterResult = {
  ok: true;
  /** Box base; its Y is exactly the floorY supplied by the caller. */
  centerWorld: [number, number, number];
  centerRaw: [number, number, number];
  directionWorld: [number, number, number];
  /** Independent local wall fits, before the shared-heading confidence check. */
  wallPlanes: HallwayWallPlanes;
  /** Effective width: the sum of measured perpendicular distances at the centre. */
  width: number;
  /** Centre-to-wall distances. Subtract the box half-width for box-edge clearance. */
  clearanceLeft: number;
  clearanceRight: number;
  residual: number;
  evidence: HallwayCenterEvidence;
} | {
  ok: false;
  reason: string;
  evidence: HallwayCenterEvidence;
};

interface Cell {
  along: number;
  lateral: number;
  height: number;
  count: number;
}

interface Line {
  intercept: number;
  slope: number;
  cells: Cell[];
  residual: number;
  longitudinalSpan: number;
  heightSpan: number;
}

const LATERAL_RADIUS = 3;
const MIN_WALL_OFFSET = 0.25;
const LOW_HEIGHT = 0.4;
const HIGH_HEIGHT = 1.8;
const ALONG_CELL = 0.1;
const LATERAL_CELL = 0.025;
const HEIGHT_CELL = 0.15;
const HISTOGRAM_CELL = 0.025;
const BAND = 0.075;
const MAX_ANGLE = Math.PI / 15; // 12 degrees either side of the supplied direction.
const ANGLE_STEPS = 32;

function finitePoint(point: ArrayLike<number>): boolean {
  return point.length === 3 && Number.isFinite(point[0]) && Number.isFinite(point[1])
    && Number.isFinite(point[2]);
}

function pointThrough(matrix: ArrayLike<number>, point: HallwayPoint): [number, number, number] {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function inverseAffine(matrix: ArrayLike<number>): number[] | null {
  if (matrix.length !== 16 || Array.from(matrix).some(value => !Number.isFinite(value))) return null;
  if (Math.abs(matrix[3]) > 1e-9 || Math.abs(matrix[7]) > 1e-9
    || Math.abs(matrix[11]) > 1e-9 || Math.abs(matrix[15] - 1) > 1e-9) return null;
  const a = matrix[0], b = matrix[4], c = matrix[8];
  const d = matrix[1], e = matrix[5], f = matrix[9];
  const g = matrix[2], h = matrix[6], i = matrix[10];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const inverse = [
    (e * i - f * h) / determinant, (f * g - d * i) / determinant, (d * h - e * g) / determinant, 0,
    (c * h - b * i) / determinant, (a * i - c * g) / determinant, (b * g - a * h) / determinant, 0,
    (b * f - c * e) / determinant, (c * d - a * f) / determinant, (a * e - b * d) / determinant, 0,
    0, 0, 0, 1,
  ];
  const translation = pointThrough(inverse, [matrix[12], matrix[13], matrix[14]]);
  inverse[12] = -translation[0]; inverse[13] = -translation[1]; inverse[14] = -translation[2];
  return inverse;
}

/** Bounded histogram median: constant memory and a linear pass, without sorting splats. */
function median(values: number[]): number {
  let minimum = Infinity, maximum = -Infinity;
  for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  if (maximum - minimum < 1e-8) return minimum;
  const bins = new Uint32Array(512);
  const step = (maximum - minimum) / (bins.length - 1);
  for (const value of values) bins[Math.min(bins.length - 1, Math.floor((value - minimum) / step))]++;
  const middle = values.length / 2;
  let count = 0, target = 0;
  for (; target < bins.length; target++) { count += bins[target]; if (count >= middle) break; }
  let sum = 0, n = 0;
  for (const value of values) {
    if (Math.min(bins.length - 1, Math.floor((value - minimum) / step)) === target) { sum += value; n++; }
  }
  return n ? sum / n : minimum + target * step;
}

function regression(cells: Cell[]): { slope: number; variance: number } {
  let along = 0, lateral = 0;
  for (const cell of cells) { along += cell.along; lateral += cell.lateral; }
  along /= cells.length; lateral /= cells.length;
  let covariance = 0, variance = 0;
  for (const cell of cells) {
    const delta = cell.along - along;
    covariance += delta * (cell.lateral - lateral);
    variance += delta * delta;
  }
  return { slope: covariance / Math.max(variance, 1e-12), variance: variance / cells.length };
}

function fitLine(candidates: Cell[], intercept: number, slope: number): Line | null {
  let cells = candidates.filter(cell => Math.abs(cell.lateral - intercept - slope * cell.along) <= BAND);
  if (cells.length < 24) return null;
  for (let pass = 0; pass < 3; pass++) {
    intercept = median(cells.map(cell => cell.lateral - slope * cell.along));
    const deviations = cells.map(cell => Math.abs(cell.lateral - intercept - slope * cell.along));
    const limit = Math.min(BAND, Math.max(0.025, median(deviations) * 3));
    cells = cells.filter(cell => Math.abs(cell.lateral - intercept - slope * cell.along) <= limit);
    if (cells.length < 24) return null;
    slope = regression(cells).slope;
  }
  intercept = median(cells.map(cell => cell.lateral - slope * cell.along));
  let residual = 0, minAlong = Infinity, maxAlong = -Infinity, minHeight = Infinity, maxHeight = -Infinity;
  const alongBins = new Set<number>(), heightBins = new Set<number>();
  for (const cell of cells) {
    residual += (cell.lateral - intercept - slope * cell.along) ** 2;
    minAlong = Math.min(minAlong, cell.along); maxAlong = Math.max(maxAlong, cell.along);
    minHeight = Math.min(minHeight, cell.height); maxHeight = Math.max(maxHeight, cell.height);
    alongBins.add(Math.floor(cell.along / 0.2)); heightBins.add(Math.floor(cell.height / 0.2));
  }
  residual = Math.sqrt(residual / cells.length) / Math.sqrt(1 + slope * slope);
  if (alongBins.size < 5 || heightBins.size < 3) return null;
  return { intercept, slope, cells, residual, longitudinalSpan: maxAlong - minAlong, heightSpan: maxHeight - minHeight };
}

/**
 * Scan once, then fit a bounded 2 m cross-section. Voxel occupancy balances unequal
 * splat densities; fixed angle/position histograms find two independently supported
 * parallel walls. The fitting workload/memory is bounded independently of scan size.
 * Run only on an explicit placement action or after a scan transform changes.
 */
export function estimateHallwayCenter(options: HallwayCenterOptions): HallwayCenterResult {
  const evidence: HallwayCenterEvidence = { scannedPoints: 0, eligiblePoints: 0, occupiedCells: 0 };
  const fail = (reason: string): HallwayCenterResult => ({ ok: false, reason, evidence });
  const stride = options.stride ?? 3;
  if ((stride !== 3 && stride !== 4) || options.centers.length % stride !== 0) return fail('Invalid splat-centre stride.');
  if (!finitePoint(options.seedRaw) || !Number.isFinite(options.floorY)) return fail('Placement coordinates must be finite.');
  const inverse = inverseAffine(options.modelMatrix);
  if (!inverse) return fail('Scan transform must be finite and invertible.');
  const rawDirection = options.corridorDirectionRaw ?? [0, 1, 0];
  if (!finitePoint(rawDirection)) return fail('Corridor direction must be finite.');
  const matrix = options.modelMatrix;
  const direction = [
    matrix[0] * rawDirection[0] + matrix[4] * rawDirection[1] + matrix[8] * rawDirection[2],
    matrix[1] * rawDirection[0] + matrix[5] * rawDirection[1] + matrix[9] * rawDirection[2],
    matrix[2] * rawDirection[0] + matrix[6] * rawDirection[1] + matrix[10] * rawDirection[2],
  ];
  const horizontalLength = Math.hypot(direction[0], direction[2]);
  if (!Number.isFinite(horizontalLength) || !Number.isFinite(direction[1])
    || horizontalLength < 1e-9 || Math.abs(direction[1]) > horizontalLength * 0.2) {
    return fail('Corridor direction is not horizontal in the current scan transform.');
  }
  const dx = direction[0] / horizontalLength, dz = direction[2] / horizontalLength;
  const ux = dz, uz = -dx;
  const seed = pointThrough(matrix, options.seedRaw);
  if (!seed.every(Number.isFinite)) return fail('Transformed placement coordinates must be finite.');
  const halfWindow = options.longitudinalHalfWindow ?? 1;
  if (!Number.isFinite(halfWindow) || halfWindow < 0.75 || halfWindow > 2) return fail('Wall-fitting half-window must be 0.75–2 metres.');

  const cellsByKey = new Map<string, Cell>();
  evidence.scannedPoints = options.centers.length / stride;
  for (let offset = 0; offset < options.centers.length; offset += stride) {
    const x = options.centers[offset], y = options.centers[offset + 1], z = options.centers[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const wx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const wy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const wz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    const height = wy - options.floorY;
    if (height < LOW_HEIGHT || height > HIGH_HEIGHT) continue;
    const along = (wx - seed[0]) * dx + (wz - seed[2]) * dz;
    if (Math.abs(along) > halfWindow) continue;
    const lateral = (wx - seed[0]) * ux + (wz - seed[2]) * uz;
    if (Math.abs(lateral) > LATERAL_RADIUS) continue;
    evidence.eligiblePoints++;
    const key = `${Math.floor(along / ALONG_CELL)},${Math.floor(lateral / LATERAL_CELL)},${Math.floor(height / HEIGHT_CELL)}`;
    const cell = cellsByKey.get(key);
    if (cell) {
      cell.count++;
      cell.along += (along - cell.along) / cell.count;
      cell.lateral += (lateral - cell.lateral) / cell.count;
      cell.height += (height - cell.height) / cell.count;
    } else cellsByKey.set(key, { along, lateral, height, count: 1 });
  }
  const cells = Array.from(cellsByKey.values());
  evidence.occupiedCells = cells.length;
  if (cells.length < 64) return fail('Too few wall samples at this station; pick both floor edges instead.');

  const histogramRadius = LATERAL_RADIUS + halfWindow * Math.tan(MAX_ANGLE) + 0.1;
  const histogramLength = Math.ceil(2 * histogramRadius / HISTOGRAM_CELL) + 1;
  let best: { score: number; slope: number; left: number; right: number; leftContrast: number; rightContrast: number } | null = null;
  for (let angleIndex = 0; angleIndex <= ANGLE_STEPS; angleIndex++) {
    const slope = Math.tan(-MAX_ANGLE + 2 * MAX_ANGLE * angleIndex / ANGLE_STEPS);
    const histogram = new Uint32Array(histogramLength);
    for (const cell of cells) {
      const bin = Math.round((cell.lateral - slope * cell.along + histogramRadius) / HISTOGRAM_CELL);
      if (bin >= 0 && bin < histogram.length) histogram[bin]++;
    }
    let leftCount = 0, rightCount = 0, left = 0, right = 0;
    for (let bin = 2; bin < histogram.length - 2; bin++) {
      const offset = bin * HISTOGRAM_CELL - histogramRadius;
      if (Math.abs(offset) < MIN_WALL_OFFSET || Math.abs(offset) > LATERAL_RADIUS) continue;
      const count = histogram[bin - 2] + histogram[bin - 1] + histogram[bin] + histogram[bin + 1] + histogram[bin + 2];
      if (offset < 0 && count > leftCount) { leftCount = count; left = offset; }
      if (offset > 0 && count > rightCount) { rightCount = count; right = offset; }
    }
    const baseline = cells.length * (5 * HISTOGRAM_CELL) / (2 * LATERAL_RADIUS);
    const score = 2 * leftCount * rightCount / Math.max(leftCount + rightCount, 1);
    if (!best || score > best.score) best = { score, slope, left, right, leftContrast: leftCount / baseline, rightContrast: rightCount / baseline };
  }
  if (!best || best.leftContrast < 2.5 || best.rightContrast < 2.5) {
    return fail('Two distinct walls could not be identified; pick both floor edges instead.');
  }
  const left = fitLine(cells, best.left, best.slope), right = fitLine(cells, best.right, best.slope);
  const wallEvidence = (line: Line): WallEvidence => ({ occupiedCells: line.cells.length, longitudinalSpan: line.longitudinalSpan, heightSpan: line.heightSpan, residual: line.residual });
  if (left) evidence.left = wallEvidence(left);
  if (right) evidence.right = wallEvidence(right);
  if (!left || !right || left.longitudinalSpan < halfWindow || right.longitudinalSpan < halfWindow
    || left.heightSpan < 0.55 || right.heightSpan < 0.55) {
    return fail('Both walls need support across the section and above the floor; pick both floor edges instead.');
  }
  if (Math.abs(left.slope - right.slope) > 0.08 || Math.max(Math.abs(left.slope), Math.abs(right.slope)) > Math.tan(MAX_ANGLE)
    || left.residual > 0.05 || right.residual > 0.05) {
    return fail('Local wall fits are inconsistent; pick both floor edges instead.');
  }
  const plane = (line: Line, inwardSign: number): HallwayWallPlane => {
    const length = Math.hypot(1, line.slope);
    return {
      point: [seed[0] + line.intercept * ux, options.floorY, seed[2] + line.intercept * uz],
      normal: [inwardSign * (ux - line.slope * dx) / length, 0,
        inwardSign * (uz - line.slope * dz) / length],
      residual: line.residual,
    };
  };
  const wallPlanes: HallwayWallPlanes = { left: plane(left, 1), right: plane(right, -1) };
  // Equal wall weighting keeps one densely sampled side from pulling the common direction.
  const leftFit = regression(left.cells), rightFit = regression(right.cells);
  const slope = (leftFit.slope * leftFit.variance + rightFit.slope * rightFit.variance)
    / (leftFit.variance + rightFit.variance);
  const leftIntercept = median(left.cells.map(cell => cell.lateral - slope * cell.along));
  const rightIntercept = median(right.cells.map(cell => cell.lateral - slope * cell.along));
  const normalLength = Math.sqrt(1 + slope * slope);
  const commonResidual = (line: Line, intercept: number) => Math.sqrt(line.cells.reduce(
    (sum, cell) => sum + (cell.lateral - intercept - slope * cell.along) ** 2, 0,
  ) / line.cells.length) / normalLength;
  const leftCommonResidual = commonResidual(left, leftIntercept);
  const rightCommonResidual = commonResidual(right, rightIntercept);
  if (Math.max(leftCommonResidual, rightCommonResidual) > 0.05) {
    return fail('The shared parallel-wall fit is uncertain; pick both floor edges instead.');
  }
  const commonWidth = (rightIntercept - leftIntercept) / normalLength;
  if (leftIntercept >= -MIN_WALL_OFFSET || rightIntercept <= MIN_WALL_OFFSET || commonWidth < 0.75 || commonWidth > 4.2) {
    return fail('The seed is not inside a plausible opposing-wall section; pick both floor edges instead.');
  }
  // Solve equal NORMALISED distances to the independent walls at the same
  // longitudinal station. Averaging intercepts is insufficient for tapered walls.
  const leftLength = Math.hypot(1, left.slope), rightLength = Math.hypot(1, right.slope);
  const midpoint = (left.intercept / leftLength + right.intercept / rightLength)
    / (1 / leftLength + 1 / rightLength);
  const centerWorld: [number, number, number] = [seed[0] + midpoint * ux, options.floorY, seed[2] + midpoint * uz];
  const centerRaw = pointThrough(inverse, centerWorld);
  const distances = measureWallDistances(wallPlanes, centerWorld);
  if (Math.min(distances.left, distances.right) <= 0) return fail('The fitted centre lies outside the opposing walls.');
  const width = distances.left + distances.right;
  // The wall-normal bisector defines the average corridor heading; retain the
  // supplied forward sense without forcing the independently fitted walls parallel.
  const bx = wallPlanes.left.normal[0] - wallPlanes.right.normal[0];
  const bz = wallPlanes.left.normal[2] - wallPlanes.right.normal[2];
  const bisectorLength = Math.hypot(bx, bz);
  const forwardSign = -bz * dx + bx * dz >= 0 ? 1 : -1;
  const directionWorld: [number, number, number] = [forwardSign * -bz / bisectorLength, 0, forwardSign * bx / bisectorLength];
  return {
    ok: true, centerRaw, centerWorld, directionWorld, wallPlanes, width,
    clearanceLeft: distances.left, clearanceRight: distances.right,
    residual: Math.max(left.residual, right.residual, leftCommonResidual, rightCommonResidual), evidence,
  };
}
