export interface Vec2 {
  x: number;
  y: number;
}

export type ElectricPaletteId = 'lime' | 'violet' | 'cyan' | 'amber' | 'spectrum';

export interface ElectricPalette {
  id: Exclude<ElectricPaletteId, 'spectrum'>;
  label: string;
  core: string;
  inner: string;
  glow: string;
  outer: string;
  sparkCore: string;
  sparkTail: string;
  anchorRing: string;
  bodyTheme: string;
}

export const ELECTRIC_PALETTES: Record<Exclude<ElectricPaletteId, 'spectrum'>, ElectricPalette> = {
  lime: {
    id: 'lime',
    label: 'Volt Lime',
    core: '#fcffe6',
    inner: '#d9ff52',
    glow: '#a6ea57',
    outer: '#4d9e19',
    sparkCore: '#ffffff',
    sparkTail: '#e7ff7a',
    anchorRing: '#f6dc7a',
    bodyTheme: '',
  },
  violet: {
    id: 'violet',
    label: 'Ion Violet',
    core: '#fff5ff',
    inner: '#f5b4ff',
    glow: '#e879f9',
    outer: '#9333ea',
    sparkCore: '#ffffff',
    sparkTail: '#f0abfc',
    anchorRing: '#fbcfe8',
    bodyTheme: 'theme-violet',
  },
  cyan: {
    id: 'cyan',
    label: 'Arc Cyan',
    core: '#f0fcff',
    inner: '#7dd3fc',
    glow: '#38bdf8',
    outer: '#0284c7',
    sparkCore: '#ffffff',
    sparkTail: '#bae6fd',
    anchorRing: '#a5f3fc',
    bodyTheme: 'theme-cyan',
  },
  amber: {
    id: 'amber',
    label: 'Tesla Amber',
    core: '#fffbeb',
    inner: '#fde68a',
    glow: '#fbbf24',
    outer: '#d97706',
    sparkCore: '#ffffff',
    sparkTail: '#fcd34d',
    anchorRing: '#fed7aa',
    bodyTheme: 'theme-amber',
  },
};

export const SPECTRUM_ORDER: Array<Exclude<ElectricPaletteId, 'spectrum'>> = [
  'lime',
  'violet',
  'cyan',
  'amber',
];

export type StringPresetId = 'single' | 'duo' | 'harp' | 'prism';

export interface SimConfig {
  tension: number; // 0.4 .. 2.0 (spring stiffness multiplier)
  reverb: number; // 0.4 .. 2.0 (sustain / inverse damping multiplier)
  sparkIntensity: number; // 0.0 .. 2.0
  voltage: number; // 0.4 .. 2.0 (plasma fork & crackle amplitude)
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  tension: 1.0,
  reverb: 1.15,
  sparkIntensity: 1.1,
  voltage: 1.0,
};

export interface SpringGrabState {
  touchId: string;
  nodeIndex: number;
  pullDist: number;
  targetX: number;
  targetY: number;
}

export interface ElectricString {
  id: number;
  start: Vec2;
  end: Vec2;
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
  nodeCount: number;
  /** 2D spring-mass node world X positions (px) */
  px: Float32Array;
  /** 2D spring-mass node world Y positions (px) */
  py: Float32Array;
  /** 2D spring-mass node X velocities (px/s) */
  vx: Float32Array;
  /** 2D spring-mass node Y velocities (px/s) */
  vy: Float32Array;
  /** Inverse mass per node (0 for pinned anchors at 0 and nodeCount-1, 1 for interior masses) */
  invMass: Float32Array;
  /** Signed transverse displacement perpendicular to rest axis (derived each step for rendering/telemetry) */
  u: Float32Array;
  /** Signed transverse velocity perpendicular to rest axis (derived each step) */
  v: Float32Array;
  /** Localized electrical charge along the line (0..2) */
  charge: Float32Array;
  /** Aggregate live mechanical + electrical vibration energy (0..2) */
  energy: number;
  /** Flash envelope at start/end anchors (0..1) */
  anchorFlash: number;
  /** Random seed for deterministic per-string plasma noise */
  seed: number;
  /** Last pluck timestamp in seconds (for cooldown) */
  lastPluckTime: number;
  /** Active bowstring pull/grab coupling from a pressed mouse or touch point */
  grab: SpringGrabState | null;
  /** Optional dynamic anchor tag (e.g. held by a pinched hand) */
  heldBy?: string | null;
}

export interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  life: number;
  maxLife: number;
  size: number;
  coreColor: string;
  tailColor: string;
}

export interface CoronaArc {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  intensity: number;
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
  seed: number;
}

export interface PluckEvent {
  stringId: number;
  t: number; // 0..1 along string
  contactX: number;
  contactY: number;
  strength: number; // 0..1 normalized intensity
  frequencyHz: number;
  pan: number; // -1..1
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
}

export interface SweptTouch {
  id: string;
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  down?: boolean;
  radius?: number;
}

export interface ProximityResonancePair {
  stringAId: number;
  stringBId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  distance: number;
  intensity: number; // 0..1
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
}

export interface ProximityResonanceState {
  /** Overall faint dissonant hum amplitude driven by nearby vibrating strings (0..1) */
  intensity: number;
  /** Weighted brooding hum fundamental in Hz (low-mid register) */
  baseFreqHz: number;
  /** Minor-second / close-interval detuning ratio (~1.055..1.085) for dissonant beating */
  dissonanceRatio: number;
  /** Acoustic interference beat rate in Hz (~2.2..8.5 Hz) */
  beatHz: number;
  /** Spatial stereo pan of the strongest vibrating pair (-0.85..0.85) */
  pan: number;
  /** Active nearby vibrating string pairs for subtle visual field filaments */
  activePairs: ProximityResonancePair[];
}

export interface SimulationState {
  strings: ElectricString[];
  sparks: SparkParticle[];
  coronaArcs: CoronaArc[];
  proximityResonance: ProximityResonanceState;
  nextId: number;
  spectrumCursor: number;
  time: number;
  totalPlucks: number;
}

const DEFAULT_NODE_COUNT = 36;
const MIN_STRING_LENGTH = 56;
const MAX_SPARKS = 460;
const MAX_STRINGS = 16;
const MAX_PULL_SNAP_DIST = 68;
const MAX_NODE_DISPLACEMENT = 135;
export const PROXIMITY_RESONANCE_RADIUS = 290;

export function createEmptyProximityResonance(): ProximityResonanceState {
  return {
    intensity: 0,
    baseFreqHz: 110,
    dissonanceRatio: 1.06,
    beatHz: 3.2,
    pan: 0,
    activePairs: [],
  };
}

// Lush Lydian-pentatonic frequencies (C3 .. G5) for calm, always-consonant electric chords
const HARMONIC_SCALE_HZ = [
  130.81, // C3
  146.83, // D3
  164.81, // E3
  185.0,  // F#3
  196.0,  // G3
  220.0,  // A3
  246.94, // B3
  261.63, // C4
  293.66, // D4
  329.63, // E4
  369.99, // F#4
  392.0,  // G4
  440.0,  // A4
  493.88, // B4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  739.99, // F#5
  783.99, // G5
];

export function createSimulationState(): SimulationState {
  return {
    strings: [],
    sparks: [],
    coronaArcs: [],
    proximityResonance: createEmptyProximityResonance(),
    nextId: 1,
    spectrumCursor: 0,
    time: 0,
    totalPlucks: 0,
  };
}

export function resolvePaletteForNewString(
  state: SimulationState,
  selected: ElectricPaletteId
): Exclude<ElectricPaletteId, 'spectrum'> {
  if (selected !== 'spectrum') return selected;
  const pick = SPECTRUM_ORDER[state.spectrumCursor % SPECTRUM_ORDER.length];
  state.spectrumCursor += 1;
  return pick;
}

export function stringLength(s: Pick<ElectricString, 'start' | 'end'>): number {
  return Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
}

/** Maps a string's pixel length to a consonant harmonic frequency in Hz (shorter = higher). */
export function computeStringFrequency(lengthPx: number, viewportDiag = 1600): number {
  const norm = Math.max(0.06, Math.min(1.0, lengthPx / Math.max(400, viewportDiag * 0.72)));
  const t = 1 - Math.pow(norm, 0.78);
  const idx = Math.max(
    0,
    Math.min(HARMONIC_SCALE_HZ.length - 1, Math.round(t * (HARMONIC_SCALE_HZ.length - 1)))
  );
  return HARMONIC_SCALE_HZ[idx];
}

/** Recomputes derived signed transverse displacement `u` and velocity `v` from 2D spring-mass nodes. */
function syncTransverseProjections(str: ElectricString): void {
  const N = str.nodeCount;
  const dx = str.end.x - str.start.x;
  const dy = str.end.y - str.start.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const restX = str.start.x + dx * t;
    const restY = str.start.y + dy * t;
    str.u[i] = (str.px[i] - restX) * nx + (str.py[i] - restY) * ny;
    str.v[i] = str.vx[i] * nx + str.vy[i] * ny;
  }
}

/** Proportionally scale all spring-mass node positions and anchors when viewport resizes. */
export function rescaleStrings(state: SimulationState, scaleX: number, scaleY: number): void {
  for (const s of state.strings) {
    s.start.x *= scaleX;
    s.start.y *= scaleY;
    s.end.x *= scaleX;
    s.end.y *= scaleY;
    for (let i = 0; i < s.nodeCount; i++) {
      s.px[i] *= scaleX;
      s.py[i] *= scaleY;
    }
    syncTransverseProjections(s);
  }
}

export function createElectricString(
  state: SimulationState,
  start: Vec2,
  end: Vec2,
  paletteChoice: ElectricPaletteId,
  options?: { nodeCount?: number; heldBy?: string | null; initialEnergy?: number }
): ElectricString | null {
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  if (len < MIN_STRING_LENGTH) return null;

  const nodeCount = options?.nodeCount ?? DEFAULT_NODE_COUNT;
  const palette = resolvePaletteForNewString(state, paletteChoice);
  const id = state.nextId++;

  const px = new Float32Array(nodeCount);
  const py = new Float32Array(nodeCount);
  const vx = new Float32Array(nodeCount);
  const vy = new Float32Array(nodeCount);
  const invMass = new Float32Array(nodeCount);
  const u = new Float32Array(nodeCount);
  const v = new Float32Array(nodeCount);
  const charge = new Float32Array(nodeCount);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const initE = options?.initialEnergy ?? 0.55;

  for (let i = 0; i < nodeCount; i++) {
    const t = i / (nodeCount - 1);
    px[i] = start.x + dx * t;
    py[i] = start.y + dy * t;
    invMass[i] = i === 0 || i === nodeCount - 1 ? 0 : 1.0;
    if (i > 0 && i < nodeCount - 1) {
      charge[i] = initE * Math.sin(Math.PI * t);
    }
  }

  const str: ElectricString = {
    id,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    palette,
    nodeCount,
    px,
    py,
    vx,
    vy,
    invMass,
    u,
    v,
    charge,
    energy: initE,
    anchorFlash: 1.0,
    seed: (id * 1.61803398875) % 100,
    lastPluckTime: -10,
    grab: null,
    heldBy: options?.heldBy ?? null,
  };

  if (state.strings.length >= MAX_STRINGS) {
    state.strings.shift();
  }
  state.strings.push(str);
  return str;
}

export function applyPreset(
  state: SimulationState,
  preset: StringPresetId,
  width: number,
  height: number,
  paletteChoice: ElectricPaletteId
): void {
  state.strings = [];
  state.sparks = [];
  state.coronaArcs = [];
  state.proximityResonance = createEmptyProximityResonance();
  state.spectrumCursor = 0;

  const cx = width * 0.5;
  const cy = height * 0.5;
  const spanX = Math.min(width * 0.62, 760);
  const spanY = Math.min(height * 0.56, 460);

  if (preset === 'single') {
    const s = createElectricString(
      state,
      { x: cx - spanX * 0.5, y: cy + spanY * 0.03 },
      { x: cx + spanX * 0.5, y: cy - spanY * 0.03 },
      paletteChoice,
      { initialEnergy: 0.72 }
    );
    if (s) {
      exciteString(state, s, 0.5, 420, 0.65, DEFAULT_SIM_CONFIG, width, true);
    }
  } else if (preset === 'duo') {
    const s1 = createElectricString(
      state,
      { x: cx - spanX * 0.48, y: cy - spanY * 0.16 },
      { x: cx + spanX * 0.48, y: cy - spanY * 0.22 },
      paletteChoice,
      { initialEnergy: 0.65 }
    );
    const s2 = createElectricString(
      state,
      { x: cx - spanX * 0.4, y: cy + spanY * 0.18 },
      { x: cx + spanX * 0.4, y: cy + spanY * 0.12 },
      paletteChoice === 'spectrum' ? 'spectrum' : paletteChoice,
      { initialEnergy: 0.65 }
    );
    if (s1) exciteString(state, s1, 0.42, 340, 0.5, DEFAULT_SIM_CONFIG, width, true);
    if (s2) exciteString(state, s2, 0.58, -340, 0.5, DEFAULT_SIM_CONFIG, width, true);
  } else if (preset === 'harp') {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const y = cy - spanY * 0.44 + frac * spanY * 0.88;
      const halfLen = spanX * (0.34 + frac * 0.2);
      const s = createElectricString(
        state,
        { x: cx - halfLen, y },
        { x: cx + halfLen, y: y - 14 + frac * 24 },
        paletteChoice,
        { initialEnergy: 0.5 }
      );
      if (s && i === 2) {
        exciteString(state, s, 0.5, 320, 0.45, DEFAULT_SIM_CONFIG, width, true);
      }
    }
  } else if (preset === 'prism') {
    const r = Math.min(spanX, spanY) * 0.48;
    const pts: Vec2[] = [
      { x: cx, y: cy - r * 0.92 },
      { x: cx + r * 0.96, y: cy + r * 0.66 },
      { x: cx - r * 0.96, y: cy + r * 0.66 },
    ];
    for (let i = 0; i < 3; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 3];
      const s = createElectricString(state, a, b, paletteChoice, { initialEnergy: 0.58 });
      if (s && i === 0) {
        exciteString(state, s, 0.5, 350, 0.5, DEFAULT_SIM_CONFIG, width, true);
      }
    }
  }
}

export function clearStrings(state: SimulationState): void {
  state.strings = [];
  state.coronaArcs = [];
  state.proximityResonance = createEmptyProximityResonance();
}

/**
 * Exact 2D segment-segment intersection test.
 * Returns parameter `t` along segment B (the electric string) in [0, 1] if segments cross.
 */
export function segmentIntersectionT(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): number | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-6) return null;

  const qpx = cx - ax;
  const qpy = cy - ay;
  const u = (qpx * sY - qpy * sX) / denom;
  const t = (qpx * rY - qpy * rX) / denom;

  if (u >= 0 && u <= 1 && t >= 0.02 && t <= 0.98) {
    return t;
  }
  return null;
}

/** Distance from point P to segment AB, plus closest parameter t in [0, 1] and signed normal distance. */
export function pointToSegmentProjection(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; signedDist: number; t: number; closestX: number; closestY: number; nx: number; ny: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { dist: Math.hypot(px - ax, py - ay), signedDist: 0, t: 0, closestX: ax, closestY: ay, nx: 0, ny: -1 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  const len = Math.sqrt(lenSq);
  const nx = -dy / len;
  const ny = dx / len;
  const rx = px - closestX;
  const ry = py - closestY;
  const signedDist = rx * nx + ry * ny;
  return {
    dist: Math.hypot(rx, ry),
    signedDist,
    t,
    closestX,
    closestY,
    nx,
    ny,
  };
}

/**
 * Closest distance and midpoint-biased contact parameters between two 2D line segments AB and CD.
 * Uses interior-sampled checks + endpoint projections + exact crossing test so parallel/crossing
 * vibrating strings always yield smooth, stable nearest coupling points.
 */
export function segmentToSegmentClosest(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): { dist: number; tA: number; tB: number; ax: number; ay: number; bx: number; by: number } {
  const crossB = segmentIntersectionT(ax, ay, bx, by, cx, cy, dx, dy);
  if (crossB !== null) {
    const px = cx + (dx - cx) * crossB;
    const py = cy + (dy - cy) * crossB;
    const projA = pointToSegmentProjection(px, py, ax, ay, bx, by);
    return { dist: 0, tA: projA.t, tB: crossB, ax: px, ay: py, bx: px, by: py };
  }

  let bestDist = Infinity;
  let bestTA = 0.5;
  let bestTB = 0.5;
  let bestAx = (ax + bx) * 0.5;
  let bestAy = (ay + by) * 0.5;
  let bestBx = (cx + dx) * 0.5;
  let bestBy = (cy + dy) * 0.5;

  const consider = (tA: number, pAx: number, pAy: number, tB: number, pBx: number, pBy: number) => {
    const d = Math.hypot(pAx - pBx, pAy - pBy);
    if (d < bestDist - 1e-4) {
      bestDist = d;
      bestTA = tA;
      bestTB = tB;
      bestAx = pAx;
      bestAy = pAy;
      bestBx = pBx;
      bestBy = pBy;
    }
  };

  // Sample interior points along AB (biased toward center first so parallel strings couple at their midpoint)
  const sampleTs = [0.5, 0.35, 0.65, 0.2, 0.8, 0.05, 0.95];
  for (const tA of sampleTs) {
    const pAx = ax + (bx - ax) * tA;
    const pAy = ay + (by - ay) * tA;
    const projB = pointToSegmentProjection(pAx, pAy, cx, cy, dx, dy);
    consider(tA, pAx, pAy, projB.t, projB.closestX, projB.closestY);
  }
  for (const tB of sampleTs) {
    const pBx = cx + (dx - cx) * tB;
    const pBy = cy + (dy - cy) * tB;
    const projA = pointToSegmentProjection(pBx, pBy, ax, ay, bx, by);
    consider(projA.t, projA.closestX, projA.closestY, tB, pBx, pBy);
  }

  return { dist: bestDist, tA: bestTA, tB: bestTB, ax: bestAx, ay: bestAy, bx: bestBx, by: bestBy };
}

/** Measure pure live mechanical vibration amplitude of a spring-mass string (0..1.5). */
function measureStringVibration(str: ElectricString): number {
  const N = str.nodeCount;
  if (N <= 2) return 0;
  let sum = 0;
  for (let i = 1; i < N - 1; i++) {
    sum += Math.abs(str.u[i]) * 0.048 + Math.abs(str.v[i]) * 0.0022;
  }
  return Math.min(1.5, sum / (N - 2));
}

/**
 * Compute inter-string proximity resonance from all active vibrating strings.
 * When two or more strings vibrate within PROXIMITY_RESONANCE_RADIUS of each other,
 * produces acoustic parameters for a faint, beating dissonant hum.
 */
export function computeProximityResonance(
  strings: ElectricString[],
  viewportWidth = 1440,
  proximityRadius = PROXIMITY_RESONANCE_RADIUS
): ProximityResonanceState {
  if (strings.length < 2) {
    return createEmptyProximityResonance();
  }

  const vibLevels = strings.map(measureStringVibration);
  const activePairs: ProximityResonancePair[] = [];
  let totalWeight = 0;
  let weightedFreq = 0;
  let weightedDissonance = 0;
  let weightedBeat = 0;
  let weightedPan = 0;

  for (let i = 0; i < strings.length; i++) {
    const a = strings[i];
    const vibA = vibLevels[i];
    if (vibA < 0.015) continue;

    for (let j = i + 1; j < strings.length; j++) {
      const b = strings[j];
      const vibB = vibLevels[j];
      if (vibB < 0.015) continue;

      const closest = segmentToSegmentClosest(
        a.start.x,
        a.start.y,
        a.end.x,
        a.end.y,
        b.start.x,
        b.start.y,
        b.end.x,
        b.end.y
      );
      if (closest.dist >= proximityRadius) continue;

      const prox = 1 - closest.dist / proximityRadius;
      const proxCurve = Math.pow(prox, 1.05); // Responsive rise so Duo, Harp, Prism & drawn lines couple strongly on finger flicks
      // Geometric mean ensures BOTH strings must be vibrating to generate the dissonant interference hum
      const mutualVib = Math.min(1.8, Math.sqrt(vibA * vibB) * 2.65);
      const pairIntensity = Math.min(1, proxCurve * mutualVib);
      if (pairIntensity < 0.01) continue;

      const idxA = Math.max(1, Math.min(a.nodeCount - 2, Math.round(closest.tA * (a.nodeCount - 1))));
      const idxB = Math.max(1, Math.min(b.nodeCount - 2, Math.round(closest.tB * (b.nodeCount - 1))));

      activePairs.push({
        stringAId: a.id,
        stringBId: b.id,
        fromX: a.px[idxA],
        fromY: a.py[idxA],
        toX: b.px[idxB],
        toY: b.py[idxB],
        distance: closest.dist,
        intensity: pairIntensity,
        palette: a.palette,
      });

      const freqA = computeStringFrequency(stringLength(a), Math.max(viewportWidth, 1200));
      const freqB = computeStringFrequency(stringLength(b), Math.max(viewportWidth, 1200));
      // Brooding sub-octave fundamental (65..220 Hz)
      const pairBaseFreq = Math.max(62, Math.min(220, ((freqA + freqB) * 0.5) * 0.45));
      // Close minor-second detuned cluster (1.055..1.082), pulled slightly tighter as strings get closer
      const ratioSpread = Math.abs(freqA - freqB) / Math.max(freqA, freqB, 1);
      const pairDissRatio = 1.056 + (1 - prox) * 0.014 + Math.min(0.014, ratioSpread * 0.025);
      // Physical interference beat rate (~2.4 .. 8.2 Hz)
      const pairBeatHz = 2.4 + prox * 3.8 + pairIntensity * 2.0;
      const midX = (a.px[idxA] + b.px[idxB]) * 0.5;
      const pairPan = Math.max(-0.85, Math.min(0.85, (midX / Math.max(1, viewportWidth)) * 2 - 1));

      totalWeight += pairIntensity;
      weightedFreq += pairBaseFreq * pairIntensity;
      weightedDissonance += pairDissRatio * pairIntensity;
      weightedBeat += pairBeatHz * pairIntensity;
      weightedPan += pairPan * pairIntensity;
    }
  }

  if (totalWeight <= 0) {
    return createEmptyProximityResonance();
  }

  // Softly compress multiple overlapping pairs into [0, 1]
  const combinedIntensity = Math.min(1, 1 - Math.exp(-totalWeight * 1.75));

  return {
    intensity: combinedIntensity,
    baseFreqHz: weightedFreq / totalWeight,
    dissonanceRatio: weightedDissonance / totalWeight,
    beatHz: weightedBeat / totalWeight,
    pan: weightedPan / totalWeight,
    activePairs,
  };
}

/** Emit directional luminous electrical spark streaks from a contact point. */
export function emitSparks(
  state: SimulationState,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  paletteId: Exclude<ElectricPaletteId, 'spectrum'>,
  count: number,
  speedScale: number
): void {
  const pal = ELECTRIC_PALETTES[paletteId];
  const actualCount = Math.min(count, Math.max(0, MAX_SPARKS - state.sparks.length));
  for (let i = 0; i < actualCount; i++) {
    const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * Math.PI * 1.85;
    const speed = (95 + Math.random() * 380) * speedScale;
    const vx = Math.cos(angle) * speed + dirX * 0.2;
    const vy = Math.sin(angle) * speed + dirY * 0.2 - (18 + Math.random() * 60);
    const maxLife = 0.22 + Math.random() * 0.42;
    state.sparks.push({
      x,
      y,
      prevX: x,
      prevY: y,
      vx,
      vy,
      life: maxLife,
      maxLife,
      size: 1.2 + Math.random() * 2.2,
      coreColor: pal.sparkCore,
      tailColor: pal.sparkTail,
    });
  }
}

/**
 * Inject a 2D velocity impulse + electrical charge + radial spark burst into the spring-mass chain.
 * Supports both normal-only plucks and arbitrary 2D directional swipe vectors.
 */
export function exciteString(
  state: SimulationState,
  str: ElectricString,
  t: number,
  normalVelocity: number,
  strength: number,
  config: SimConfig,
  viewportWidth: number,
  suppressSparks = false,
  tangentialVelocity = 0
): PluckEvent {
  const clampedT = Math.max(0.04, Math.min(0.96, t));
  const N = str.nodeCount;
  const centerIdx = clampedT * (N - 1);
  const spread = Math.max(2.2, N * 0.11);

  const dx = str.end.x - str.start.x;
  const dy = str.end.y - str.start.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;

  const maxImpulse = 1650 * (0.65 + 0.55 * config.voltage);
  const nImp = Math.max(-maxImpulse, Math.min(maxImpulse, normalVelocity));
  const tImp = Math.max(-maxImpulse * 0.35, Math.min(maxImpulse * 0.35, tangentialVelocity));

  const impVx = nx * nImp + tx * tImp;
  const impVy = ny * nImp + ty * tImp;

  for (let i = 1; i < N - 1; i++) {
    const dist = (i - centerIdx) / spread;
    const g = Math.exp(-0.5 * dist * dist);
    str.vx[i] += impVx * g;
    str.vy[i] += impVy * g;
    str.charge[i] = Math.min(2.0, str.charge[i] + (0.65 + strength * 0.95) * g);
  }

  syncTransverseProjections(str);

  str.energy = Math.min(2.0, Math.max(str.energy, 0.38 + strength * 1.15));
  str.anchorFlash = 1.0;
  str.lastPluckTime = state.time;
  state.totalPlucks += 1;

  const contactIdx = Math.max(1, Math.min(N - 2, Math.round(centerIdx)));
  const contactX = str.px[contactIdx];
  const contactY = str.py[contactIdx];

  if (!suppressSparks && config.sparkIntensity > 0.05) {
    const sparkCount = Math.round((10 + strength * 26) * config.sparkIntensity);
    const sign = normalVelocity >= 0 ? 1 : -1;
    emitSparks(
      state,
      contactX,
      contactY,
      nx * sign * 180,
      ny * sign * 180,
      str.palette,
      sparkCount,
      0.7 + strength * 0.7
    );
  }

  const freq = computeStringFrequency(len, Math.max(viewportWidth, 1200));
  const pan = Math.max(-0.9, Math.min(0.9, (contactX / Math.max(1, viewportWidth)) * 2 - 1));

  return {
    stringId: str.id,
    t: clampedT,
    contactX,
    contactY,
    strength: Math.max(0.1, Math.min(1, strength)),
    frequencyHz: freq,
    pan,
    palette: str.palette,
  };
}

/**
 * Evaluate all mouse, multi-touch, and fingertip interactions against the 2D spring-mass chains:
 * - Pressed drag into a string bows/pulls the spring-mass chain like a taut bowstring until it snaps back
 *   or releases, unleashing a vibrant damped oscillation.
 * - Fast swipes or desktop hovers crossing a string impart instant 2D velocity impulses + sparks.
 * - Close proximity builds live corona arcs and gentle electrostatic pull on nearby masses.
 */
export function interactTouchesWithStrings(
  state: SimulationState,
  touches: SweptTouch[],
  config: SimConfig,
  viewportWidth: number
): PluckEvent[] {
  const plucks: PluckEvent[] = [];
  state.coronaArcs = [];

  const activeTouchMap = new Map<string, SweptTouch>();
  for (const t of touches) {
    activeTouchMap.set(t.id, t);
  }

  // 1. Update or release any active bowstring grabs on spring-mass chains
  for (const str of state.strings) {
    if (!str.grab) continue;
    const touch = activeTouchMap.get(str.grab.touchId);
    const N = str.nodeCount;
    const dx = str.end.x - str.start.x;
    const dy = str.end.y - str.start.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;
    const idx = str.grab.nodeIndex;
    const tNode = idx / (N - 1);
    const restX = str.start.x + dx * tNode;
    const restY = str.start.y + dy * tNode;

    if (!touch || !touch.down) {
      // Finger lifted: snap-release the tensioned spring-mass chain into free oscillation!
      const pullRatio = Math.min(1, str.grab.pullDist / MAX_PULL_SNAP_DIST);
      str.grab = null;
      if (pullRatio > 0.14) {
        const dispX = str.px[idx] - restX;
        const dispY = str.py[idx] - restY;
        const normalSign = dispX * nx + dispY * ny >= 0 ? -1 : 1;
        const ev = exciteString(
          state,
          str,
          tNode,
          normalSign * (220 + pullRatio * 540),
          0.35 + pullRatio * 0.65,
          config,
          viewportWidth
        );
        plucks.push(ev);
      }
      continue;
    }

    const pullX = touch.x - restX;
    const pullY = touch.y - restY;
    const pullDist = Math.hypot(pullX, pullY);
    str.grab.pullDist = pullDist;

    if (pullDist > MAX_PULL_SNAP_DIST) {
      // Pulled past tension snap threshold -> string slips off finger and snaps back!
      const normalSign = pullX * nx + pullY * ny >= 0 ? -1 : 1;
      str.grab = null;
      const ev = exciteString(
        state,
        str,
        tNode,
        normalSign * (420 + Math.min(580, Math.hypot(touch.vx, touch.vy) * 0.45)),
        0.85,
        config,
        viewportWidth
      );
      plucks.push(ev);
    } else {
      // Keep grab target synced; stepSimulation applies the live coupling spring across all sub-steps
      str.grab.targetX = touch.x;
      str.grab.targetY = touch.y;
      str.charge[idx] = Math.min(1.6, str.charge[idx] + 0.09);
      str.energy = Math.min(1.6, Math.max(str.energy, 0.28 + (pullDist / MAX_PULL_SNAP_DIST) * 0.72));

      // Live crackle sparks at high bowstring tension
      if (config.sparkIntensity > 0.1 && pullDist > 18 && Math.random() < 0.35 * config.sparkIntensity) {
        emitSparks(state, str.px[idx], str.py[idx], -pullX * 2.5, -pullY * 2.5, str.palette, 2, 0.55);
      }
    }
  }

  // 2. Process swept crossings, new grabs, grazing contacts, and corona proximity arcs
  for (const touch of touches) {
    const speed = Math.hypot(touch.vx, touch.vy);
    const touchRadius = touch.radius ?? 22;
    const coronaRadius = Math.max(76, touchRadius * 3.4);

    for (const str of state.strings) {
      const dx = str.end.x - str.start.x;
      const dy = str.end.y - str.start.y;
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;
      const tx = dx / len;
      const ty = dy / len;
      const nx = -ty;
      const ny = tx;

      // Skip new crossing/grab detection if this touch is already bowing this string
      if (str.grab && str.grab.touchId === touch.id) {
        const idx = str.grab.nodeIndex;
        state.coronaArcs.push({
          fromX: touch.x,
          fromY: touch.y,
          toX: str.px[idx],
          toY: str.py[idx],
          intensity: 0.95,
          palette: str.palette,
          seed: str.seed + state.time * 21.7,
        });
        continue;
      }

      const crossT = segmentIntersectionT(
        touch.prevX,
        touch.prevY,
        touch.x,
        touch.y,
        str.start.x,
        str.start.y,
        str.end.x,
        str.end.y
      );

      const proj = pointToSegmentProjection(
        touch.x,
        touch.y,
        str.start.x,
        str.start.y,
        str.end.x,
        str.end.y
      );

      const cooldownElapsed = state.time - str.lastPluckTime > 0.065;

      // Slow/deliberate pressed touch landing on a string catches it as a bowstring grab
      if (
        touch.down &&
        !str.grab &&
        proj.dist < touchRadius * 0.9 &&
        proj.t > 0.05 &&
        proj.t < 0.95 &&
        speed < 520 &&
        cooldownElapsed
      ) {
        const idx = Math.max(1, Math.min(str.nodeCount - 2, Math.round(proj.t * (str.nodeCount - 1))));
        str.grab = {
          touchId: touch.id,
          nodeIndex: idx,
          pullDist: proj.dist,
          targetX: touch.x,
          targetY: touch.y,
        };
        continue;
      }

      if (crossT !== null && cooldownElapsed) {
        const normalVel = touch.vx * nx + touch.vy * ny;
        const tangentialVel = touch.vx * tx + touch.vy * ty;
        const signedImpulse =
          (Math.abs(normalVel) > 60 ? normalVel : (normalVel >= 0 ? 1 : -1) * Math.max(280, speed)) * 0.95;
        const strength = Math.min(1.0, 0.35 + speed / 1200);
        const ev = exciteString(
          state,
          str,
          crossT,
          signedImpulse,
          strength,
          config,
          viewportWidth,
          false,
          tangentialVel * 0.35
        );
        plucks.push(ev);
      } else if (proj.dist < touchRadius && proj.t > 0.03 && proj.t < 0.97) {
        const normalVel = touch.vx * nx + touch.vy * ny;
        const tangentialVel = touch.vx * tx + touch.vy * ty;
        if (speed > 45 && cooldownElapsed) {
          const sign = normalVel !== 0 ? Math.sign(normalVel) : proj.signedDist >= 0 ? -1 : 1;
          const strength = Math.min(0.95, 0.25 + speed / 1300);
          const ev = exciteString(
            state,
            str,
            proj.t,
            sign * Math.max(260, Math.abs(normalVel) * 0.9),
            strength,
            config,
            viewportWidth,
            false,
            tangentialVel * 0.3
          );
          plucks.push(ev);
        } else {
          // Gentle electrostatic spring hum when resting pointer directly on the string
          const idx = Math.max(1, Math.min(str.nodeCount - 2, Math.round(proj.t * (str.nodeCount - 1))));
          str.charge[idx] = Math.min(1.8, str.charge[idx] + 0.14);
          str.energy = Math.min(1.6, Math.max(str.energy, 0.45));
          const buzz = (Math.random() - 0.5) * 140 * config.voltage;
          str.vx[idx] += nx * buzz;
          str.vy[idx] += ny * buzz;
          if (config.sparkIntensity > 0.1 && Math.random() < 0.25 * config.sparkIntensity) {
            emitSparks(state, str.px[idx], str.py[idx], proj.nx * 90, proj.ny * 90, str.palette, 2, 0.55);
          }
        }
      }

      // 3. Live corona arc tether + soft spring-field attraction on close hover
      if (proj.dist < coronaRadius && proj.t > 0.03 && proj.t < 0.97) {
        const proximity = 1 - proj.dist / coronaRadius;
        const idx = Math.max(1, Math.min(str.nodeCount - 2, Math.round(proj.t * (str.nodeCount - 1))));

        state.coronaArcs.push({
          fromX: touch.x,
          fromY: touch.y,
          toX: str.px[idx],
          toY: str.py[idx],
          intensity: proximity,
          palette: str.palette,
          seed: str.seed + state.time * 19.3,
        });

        // Soft 2D electrostatic spring pull toward nearby fingertip
        const pullForce = proximity * 6.5;
        str.vx[idx] += (touch.x - str.px[idx]) * pullForce;
        str.vy[idx] += (touch.y - str.py[idx]) * pullForce;
        str.charge[idx] = Math.min(1.4, str.charge[idx] + proximity * 0.035);
      }
    }
  }

  return plucks;
}

/**
 * Advance all electric strings using a 2D coupled spring-mass simulation
 * (pre-tensioned Hooke's law structural springs + 2nd-neighbor bending springs +
 * equilibrium home springs + viscous & relative damping, integrated with 20 sub-steps
 * of Semi-Implicit Symplectic Euler) and update all spark particles.
 */
export function stepSimulation(
  state: SimulationState,
  dtRaw: number,
  config: SimConfig,
  viewportWidth = 1440
): void {
  const dt = Math.min(0.033, Math.max(0.001, dtRaw));
  state.time += dt;

  // 20 sub-steps => subDt <= 0.00165s: unconditionally stable Symplectic Euler even at max tension (2.0x)
  const subSteps = 20;
  const subDt = dt / subSteps;

  // Hookean spring stiffnesses scaled by tension slider
  const kStruct = 34000 * (0.5 + 0.55 * config.tension);
  const kBend = 1400 * (0.5 + 0.6 * config.tension);
  const kRestore = 24 * config.tension;

  // Tensile preload ratio (< 1 means string is taut at rest so transverse vibration snaps briskly)
  const preloadRatio = 0.45;

  // Viscous decay damping & inter-node relative spring damping (controlled by Reverb Sustain)
  const cGlobal = 2.55 / Math.max(0.35, config.reverb);
  const cRel = 12.0 / Math.max(0.4, config.reverb);

  for (const str of state.strings) {
    const N = str.nodeCount;
    const px = str.px;
    const py = str.py;
    const vx = str.vx;
    const vy = str.vy;
    const invMass = str.invMass;
    const charge = str.charge;

    const dxLine = str.end.x - str.start.x;
    const dyLine = str.end.y - str.start.y;
    const lineLen = Math.max(1, Math.hypot(dxLine, dyLine));
    const segRestLen = lineLen / (N - 1);
    const unstretchedLen = segRestLen * preloadRatio;
    const bendRestLen = segRestLen * 2;

    // Scratch force accumulators (lightweight per-string arrays, N=36)
    const fx = new Float32Array(N);
    const fy = new Float32Array(N);

    for (let step = 0; step < subSteps; step++) {
      // Pin start & end anchor masses rigidly to their endpoints
      px[0] = str.start.x;
      py[0] = str.start.y;
      vx[0] = 0;
      vy[0] = 0;
      px[N - 1] = str.end.x;
      py[N - 1] = str.end.y;
      vx[N - 1] = 0;
      vy[N - 1] = 0;

      fx.fill(0);
      fy.fill(0);

      // 1. Pre-tensioned Hooke's law structural springs + relative dampers along (i, i+1)
      for (let i = 0; i < N - 1; i++) {
        const rx = px[i + 1] - px[i];
        const ry = py[i + 1] - py[i];
        const dist = Math.hypot(rx, ry);
        if (dist > 1e-5) {
          const stretch = dist - unstretchedLen;
          const forceMag = kStruct * stretch;
          const dirX = rx / dist;
          const dirY = ry / dist;

          // Relative velocity damping along the spring axis
          const relVx = vx[i + 1] - vx[i];
          const relVy = vy[i + 1] - vy[i];
          const springFx = forceMag * dirX + cRel * relVx;
          const springFy = forceMag * dirY + cRel * relVy;

          fx[i] += springFx;
          fy[i] += springFy;
          fx[i + 1] -= springFx;
          fy[i + 1] -= springFy;
        }
      }

      // 2. Second-neighbor bending springs (i, i+2) for crisp curvature and overtone dispersion
      for (let i = 0; i < N - 2; i++) {
        const rx = px[i + 2] - px[i];
        const ry = py[i + 2] - py[i];
        const dist = Math.hypot(rx, ry);
        if (dist > 1e-5) {
          const stretch = dist - bendRestLen;
          const scale = (kBend * stretch) / dist;
          const bfx = rx * scale;
          const bfy = ry * scale;
          fx[i] += bfx;
          fy[i] += bfy;
          fx[i + 2] -= bfx;
          fy[i + 2] -= bfy;
        }
      }

      // 3. Equilibrium home-restoring spring + global viscous damping + Symplectic Euler integration
      for (let i = 1; i < N - 1; i++) {
        const im = invMass[i];
        if (im === 0) continue;

        const t = i / (N - 1);
        const restX = str.start.x + dxLine * t;
        const restY = str.start.y + dyLine * t;

        fx[i] += kRestore * (restX - px[i]) - cGlobal * vx[i];
        fy[i] += kRestore * (restY - py[i]) - cGlobal * vy[i];

        vx[i] += fx[i] * im * subDt;
        vy[i] += fy[i] * im * subDt;

        px[i] += vx[i] * subDt;
        py[i] += vy[i] * subDt;

        // Soft radial displacement ceiling around rest position so extreme inputs remain graceful
        const offX = px[i] - restX;
        const offY = py[i] - restY;
        const offDist = Math.hypot(offX, offY);
        if (offDist > MAX_NODE_DISPLACEMENT) {
          const clampScale = MAX_NODE_DISPLACEMENT / offDist;
          px[i] = restX + offX * clampScale;
          py[i] = restY + offY * clampScale;
          vx[i] *= 0.45;
          vy[i] *= 0.45;
        }
      }

      // 4. Enforce live bowstring grab constraint cleanly inside every sub-step
      if (str.grab) {
        const gi = str.grab.nodeIndex;
        if (gi > 0 && gi < N - 1) {
          px[gi] += (str.grab.targetX - px[gi]) * 0.55;
          py[gi] += (str.grab.targetY - py[gi]) * 0.55;
          vx[gi] *= 0.5;
          vy[gi] *= 0.5;
        }
      }
    }

    syncTransverseProjections(str);

    // Diffuse & decay electrical charge along chain; measure true mechanical + charge energy
    let sumEnergy = 0;
    const chargeDecay = Math.exp(-dt * (1.8 / Math.max(0.4, config.reverb)));
    for (let i = 1; i < N - 1; i++) {
      const avgNeighbor = 0.25 * (charge[i - 1] + charge[i + 1]) + 0.5 * charge[i];
      charge[i] = avgNeighbor * chargeDecay;

      const t = i / (N - 1);
      const restX = str.start.x + dxLine * t;
      const restY = str.start.y + dyLine * t;
      const disp = Math.hypot(px[i] - restX, py[i] - restY);
      const vel = Math.hypot(vx[i], vy[i]);
      const mechEnergy = disp * 0.025 + vel * 0.0012;
      sumEnergy += mechEnergy + charge[i] * 0.35;
    }

    const avgEnergy = sumEnergy / Math.max(1, N - 2);
    str.energy = Math.min(2.0, str.energy * Math.exp(-dt * 1.4) + avgEnergy * (1 - Math.exp(-dt * 8)));
    str.anchorFlash = Math.max(0, str.anchorFlash - dt * 2.2);
  }

  // Inter-string electromagnetic sympathetic coupling + proximity dissonant resonance telemetry
  if (state.strings.length >= 2) {
    const couplingStrength = 14.5 * (0.65 + 0.35 * config.voltage);
    for (let i = 0; i < state.strings.length; i++) {
      const a = state.strings[i];
      for (let j = i + 1; j < state.strings.length; j++) {
        const b = state.strings[j];
        const closest = segmentToSegmentClosest(
          a.start.x,
          a.start.y,
          a.end.x,
          a.end.y,
          b.start.x,
          b.start.y,
          b.end.x,
          b.end.y
        );
        if (closest.dist >= PROXIMITY_RESONANCE_RADIUS) continue;

        const prox = 1 - closest.dist / PROXIMITY_RESONANCE_RADIUS;
        const idxA = Math.max(1, Math.min(a.nodeCount - 2, Math.round(closest.tA * (a.nodeCount - 1))));
        const idxB = Math.max(1, Math.min(b.nodeCount - 2, Math.round(closest.tB * (b.nodeCount - 1))));

        // Gentle bidirectional sympathetic velocity coupling between closest spring-mass regions
        const kCouple = prox * prox * couplingStrength * dt;
        const dvx = b.vx[idxB] - a.vx[idxA];
        const dvy = b.vy[idxB] - a.vy[idxA];

        for (let off = -2; off <= 2; off++) {
          const w = off === 0 ? 1 : off === -1 || off === 1 ? 0.62 : 0.25;
          const ia = idxA + off;
          const ib = idxB + off;
          if (ia > 0 && ia < a.nodeCount - 1) {
            a.vx[ia] += dvx * kCouple * w;
            a.vy[ia] += dvy * kCouple * w;
          }
          if (ib > 0 && ib < b.nodeCount - 1) {
            b.vx[ib] -= dvx * kCouple * w;
            b.vy[ib] -= dvy * kCouple * w;
          }
        }
      }
    }

    const rawRes = computeProximityResonance(state.strings, viewportWidth, PROXIMITY_RESONANCE_RADIUS);
    const prev = state.proximityResonance;
    // Smooth attack (~95ms) and atmospheric release (~540ms) so sequential multi-string flicks sustain resonance cleanly
    const alpha = rawRes.intensity > prev.intensity ? 1 - Math.exp(-dt * 11.0) : 1 - Math.exp(-dt * 1.85);
    const nextIntensity = prev.intensity + (rawRes.intensity - prev.intensity) * alpha;
    state.proximityResonance = {
      intensity: nextIntensity < 0.002 ? 0 : nextIntensity,
      baseFreqHz: rawRes.intensity > 0 ? rawRes.baseFreqHz : prev.baseFreqHz,
      dissonanceRatio: rawRes.intensity > 0 ? rawRes.dissonanceRatio : prev.dissonanceRatio,
      beatHz: rawRes.intensity > 0 ? rawRes.beatHz : prev.beatHz,
      pan: rawRes.intensity > 0 ? rawRes.pan : prev.pan,
      activePairs: rawRes.activePairs,
    };
  } else {
    state.proximityResonance = createEmptyProximityResonance();
  }

  // Integrate spark particles with mild gravity and aerodynamic drag
  const gravity = 460;
  const drag = Math.exp(-dt * 3.1);
  let writeIdx = 0;
  for (let i = 0; i < state.sparks.length; i++) {
    const p = state.sparks[i];
    p.life -= dt;
    if (p.life <= 0) continue;

    p.prevX = p.x;
    p.prevY = p.y;
    p.vx *= drag;
    p.vy = p.vy * drag + gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    state.sparks[writeIdx++] = p;
  }
  state.sparks.length = writeIdx;
}

/** Find an endpoint anchor near (x, y) so users can reposition existing strings. */
export function findNearestAnchor(
  state: SimulationState,
  x: number,
  y: number,
  maxDist = 26
): { stringId: number; end: 'start' | 'end' } | null {
  let bestDist = maxDist;
  let result: { stringId: number; end: 'start' | 'end' } | null = null;
  for (const s of state.strings) {
    const dStart = Math.hypot(x - s.start.x, y - s.start.y);
    if (dStart < bestDist) {
      bestDist = dStart;
      result = { stringId: s.id, end: 'start' };
    }
    const dEnd = Math.hypot(x - s.end.x, y - s.end.y);
    if (dEnd < bestDist) {
      bestDist = dEnd;
      result = { stringId: s.id, end: 'end' };
    }
  }
  return result;
}
