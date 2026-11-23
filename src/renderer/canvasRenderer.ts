import {
  ELECTRIC_PALETTES,
  type ElectricPaletteId,
  type ElectricString,
  type SimConfig,
  type SimulationState,
  type Vec2,
} from '../physics/electricString';
import { HAND_CONNECTIONS, type TrackedHand } from '../vision/handTracker';

export type SkeletonStyle = 'tracker' | 'gossamer';

export type CameraViewMode = 'full' | 'dim' | 'off';

export function getCameraViewOpacity(mode: CameraViewMode): number {
  if (mode === 'full') return 1;
  if (mode === 'dim') return 0.5;
  return 0;
}

export function getNextCameraViewMode(mode: CameraViewMode): CameraViewMode {
  if (mode === 'full') return 'dim';
  if (mode === 'dim') return 'off';
  return 'full';
}

export interface PreviewLine {
  start: Vec2;
  end: Vec2;
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
  source: 'pointer' | 'hands';
}

export interface ActiveCursorVisual {
  x: number;
  y: number;
  active: boolean;
  mode: 'strum' | 'draw';
}

export interface RenderOptions {
  width: number;
  height: number;
  dpr: number;
  config: SimConfig;
  activePalette: ElectricPaletteId;
  previewLine: PreviewLine | null;
  hands: TrackedHand[];
  video: HTMLVideoElement | null;
  cameraViewMode: CameraViewMode;
  skeletonStyle: SkeletonStyle;
  cursor: ActiveCursorVisual | null;
  humIntensity?: number;
}

export const HIGH_PROXIMITY_HUM_THRESHOLD = 0.22;

export interface InterferenceShimmerState {
  /** True only when strings enter high-proximity resonance */
  active: boolean;
  /** 0..1 smooth chromatic shimmer blend along connected nodes */
  shimmerMix: number;
  /** 0..1 constructive-interference flash pulse intensity */
  flashLevel: number;
  /** 0..1 travelling wave position sliding between the connected nodes */
  travelT: number;
}

/** Pure opacity curve for proximity resonance connection lines and nodes, scaled by humIntensity (0..1). */
export function computeProximityResonanceOpacity(humIntensity: number, pairIntensity: number): number {
  const hum = Math.max(0, Math.min(1, humIntensity));
  const pair = Math.max(0, Math.min(1, pairIntensity));
  if (hum <= 0.01 || pair <= 0.03) return 0;
  return Math.min(0.42, (0.1 + pair * 0.34) * hum);
}

/**
 * Pure calculation for subtle high-proximity interference flash and chromatic shimmer.
 * Remains completely dormant below HIGH_PROXIMITY_HUM_THRESHOLD and ramps smoothly with humIntensity.
 */
export function computeInterferenceShimmer(
  humIntensity: number,
  pairIntensity: number,
  time: number,
  beatHz: number,
  seed = 0
): InterferenceShimmerState {
  const hum = Math.max(0, Math.min(1, humIntensity));
  const pair = Math.max(0, Math.min(1, pairIntensity));
  const highHum = (hum - HIGH_PROXIMITY_HUM_THRESHOLD) / (1 - HIGH_PROXIMITY_HUM_THRESHOLD);

  if (highHum <= 0 || pair < 0.12) {
    return { active: false, shimmerMix: 0, flashLevel: 0, travelT: 0.5 };
  }

  const pairScale = Math.min(1, (pair - 0.08) / 0.62);
  const strength = Math.min(1, Math.pow(highHum, 0.78) * pairScale);

  const safeBeat = Math.max(0.8, beatHz);
  const shimmerWave = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * (safeBeat * 0.45) + seed * 1.9);
  const shimmerMix = Math.max(0, Math.min(1, strength * (0.42 + 0.58 * shimmerWave)));

  // Two slightly detuned harmonic waves yield organic, brief constructive-interference flashes
  const waveA = Math.sin(time * Math.PI * 2 * Math.max(1.1, safeBeat * 0.65) + seed * 2.7);
  const waveB = Math.sin(time * Math.PI * 2 * Math.max(1.4, safeBeat * 0.83) + seed * 4.1);
  const constructive = Math.max(0, (waveA * waveB + 1) * 0.5);
  const flashLevel = Math.max(0, Math.min(1, strength * Math.pow(constructive, 2.8)));

  const travelT = 0.5 + 0.42 * Math.sin(time * (2.6 + Math.min(4, safeBeat * 0.35)) + seed * 1.37);

  return {
    active: true,
    shimmerMix,
    flashLevel,
    travelT,
  };
}

const INTERFERENCE_SHIMMER_HUES: Record<
  Exclude<ElectricPaletteId, 'spectrum'>,
  { accent: string; outerAccent: string; flash: string }
> = {
  lime: { accent: '#38f2ff', outerAccent: '#0ea5e9', flash: '#eefeff' },
  violet: { accent: '#48f5ff', outerAccent: '#06b6d4', flash: '#f7ecff' },
  cyan: { accent: '#d47aff', outerAccent: '#9333ea', flash: '#f0fbff' },
  amber: { accent: '#5cf5d0', outerAccent: '#0d9488', flash: '#fff8dc' },
};

/** Fast deterministic hash in [-1, 1] for crisp high-frequency lightning jitter */
function hash11(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453123;
  return (s - Math.floor(s)) * 2 - 1;
}

function drawCoverVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  opacity: number
): void {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const scale = Math.max(width / vw, height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (width - drawW) * 0.5;
  const offsetY = (height - drawH) * 0.5;

  ctx.save();
  // Mirror horizontally for natural front-camera interaction
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, width - (offsetX + drawW), offsetY, drawW, drawH);
  ctx.restore();

  // Subtle contrast vignette scrim so luminous electric plasma pops crisply over bright rooms
  const scrimScale = 0.55 + 0.45 * Math.max(0, Math.min(1, opacity));
  const grad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.18,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.78
  );
  grad.addColorStop(0, `rgba(4, 6, 8, ${(0.18 * scrimScale).toFixed(3)})`);
  grad.addColorStop(1, `rgba(4, 6, 8, ${(0.56 * scrimScale).toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function drawStudioBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  paletteId: ElectricPaletteId,
  aggregateEnergy: number
): void {
  const basePal = ELECTRIC_PALETTES[paletteId === 'spectrum' ? 'cyan' : paletteId];

  ctx.fillStyle = '#050708';
  ctx.fillRect(0, 0, width, height);

  // Subtle low-cortisol radial ambient glow reacting calmly to aggregate string energy
  const glowRadius = Math.max(width, height) * (0.48 + Math.min(0.24, aggregateEnergy * 0.1));
  const bgGrad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    0,
    width * 0.5,
    height * 0.5,
    glowRadius
  );
  bgGrad.addColorStop(0, hexWithAlpha(basePal.outer, 0.12 + Math.min(0.14, aggregateEnergy * 0.08)));
  bgGrad.addColorStop(0.55, hexWithAlpha(basePal.outer, 0.035));
  bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Ultra-quiet precision field grid dots (optical instrument feel without clutter)
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  const spacing = 56;
  const startX = (width % spacing) * 0.5;
  const startY = (height % spacing) * 0.5;
  for (let y = startY; y < height; y += spacing) {
    for (let x = startX; x < width; x += spacing) {
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }
  ctx.restore();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Linear RGB blend between two #rrggbb hex colors for smooth spectral color-shimmering. */
export function mixHexColor(hexA: string, hexB: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  const rA = parseInt(a.slice(0, 2), 16);
  const gA = parseInt(a.slice(2, 4), 16);
  const bA = parseInt(a.slice(4, 6), 16);
  const rB = parseInt(b.slice(0, 2), 16);
  const gB = parseInt(b.slice(2, 4), 16);
  const bB = parseInt(b.slice(4, 6), 16);
  const r = Math.round(rA + (rB - rA) * clamped);
  const g = Math.round(gA + (gB - gA) * clamped);
  const bl = Math.round(bA + (bB - bA) * clamped);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

/** Draw glowing starburst + concentric reticle anchor cap matching the screenshots */
function drawAnchorNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  paletteId: Exclude<ElectricPaletteId, 'spectrum'>,
  flash: number,
  isCharging = false,
  shimmer?: InterferenceShimmerState
): void {
  const pal = ELECTRIC_PALETTES[paletteId];
  const shimmerHue = INTERFERENCE_SHIMMER_HUES[paletteId];
  const shift = shimmer?.active ? Math.min(0.82, shimmer.shimmerMix * 0.78) : 0;
  const flashBoost = shimmer?.active ? shimmer.flashLevel : 0;
  const glowColor = shift > 0 ? mixHexColor(pal.glow, shimmerHue.accent, shift) : pal.glow;
  const coreColor = flashBoost > 0 ? mixHexColor(pal.core, shimmerHue.flash, flashBoost * 0.85) : pal.core;
  const ringColor = shift > 0 ? mixHexColor(pal.anchorRing, shimmerHue.accent, shift) : pal.anchorRing;
  const r = (isCharging ? 10 : 7) + (flash + flashBoost * 0.45) * 5;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Soft outer radial halo
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
  halo.addColorStop(0, hexWithAlpha(coreColor, 0.92));
  halo.addColorStop(0.32, hexWithAlpha(glowColor, 0.58 + flashBoost * 0.2));
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
  ctx.fill();

  // Concentric crosshair ring (prominent during pinch/charge or impact)
  ctx.strokeStyle = isCharging ? '#ffb35c' : ringColor;
  ctx.globalAlpha = isCharging ? 0.92 : Math.min(1, 0.65 + (flash + flashBoost * 0.5) * 0.35);
  ctx.lineWidth = isCharging ? 1.8 : 1.3;
  ctx.beginPath();
  ctx.arc(x, y, r * (isCharging ? 0.92 : 0.72), 0, Math.PI * 2);
  ctx.stroke();

  if (isCharging) {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
    ctx.globalAlpha = 0.45;
    ctx.stroke();
  }

  // Crisp 4-point starburst reticle
  const spike = r * (1.35 + (flash + flashBoost * 0.55) * 0.6);
  ctx.strokeStyle = coreColor;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - spike, y);
  ctx.lineTo(x + spike, y);
  ctx.moveTo(x, y - spike);
  ctx.lineTo(x, y + spike);
  ctx.stroke();

  // White-hot center core
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.98;
  ctx.beginPath();
  ctx.arc(x, y, isCharging ? 3.2 : 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Render a live electric string with feathered optical glow, sleek braided plasma filaments, and calibrated ruler ticks */
function drawElectricString(
  ctx: CanvasRenderingContext2D,
  str: ElectricString,
  time: number,
  config: SimConfig,
  shimmer?: InterferenceShimmerState
): void {
  const basePal = ELECTRIC_PALETTES[str.palette];
  const shimmerHue = INTERFERENCE_SHIMMER_HUES[str.palette];
  const activeShimmer = shimmer?.active ? shimmer : undefined;
  const colorShift = activeShimmer ? Math.min(0.86, 0.24 + activeShimmer.shimmerMix * 0.62) : 0;
  const flashBoost = activeShimmer ? activeShimmer.flashLevel : 0;
  const pal = activeShimmer
    ? {
        ...basePal,
        outer: mixHexColor(basePal.outer, shimmerHue.outerAccent, colorShift),
        glow: mixHexColor(basePal.glow, shimmerHue.accent, colorShift),
        inner: mixHexColor(basePal.inner, shimmerHue.accent, Math.min(0.92, colorShift * 0.9 + flashBoost * 0.25)),
        core: mixHexColor(basePal.core, shimmerHue.flash, Math.min(1, 0.2 + flashBoost * 0.8)),
      }
    : basePal;
  const dx = str.end.x - str.start.x;
  const dy = str.end.y - str.start.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const N = str.nodeCount;
  const voltage = config.voltage;

  const ptsX = new Float32Array(N);
  const ptsY = new Float32Array(N);
  const timeSlot = Math.floor(time * 36);

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const env = Math.sin(Math.PI * t);
    const localCharge = str.charge[i];
    // Subtle high-voltage micro-shimmer overlaid onto the true 2D spring-mass positions
    const jitter =
      hash11(i * 1.73 + timeSlot * 0.91 + str.seed) *
      (0.42 + localCharge * 1.85 * voltage) *
      env;
    ptsX[i] = str.px[i] + nx * jitter;
    ptsY[i] = str.py[i] + ny * jitter;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Crisp straight laser reference axis + calibrated perpendicular ruler ticks (matching IMG_2041 & IMG_2038)
  ctx.strokeStyle = hexWithAlpha(pal.inner, 0.24 + Math.min(0.24, str.energy * 0.18));
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(str.start.x, str.start.y);
  ctx.lineTo(str.end.x, str.end.y);
  ctx.stroke();

  const tickStep = Math.max(20, Math.min(30, len / 22));
  const tickCount = Math.floor(len / tickStep);
  ctx.strokeStyle = hexWithAlpha(pal.core, 0.44 + Math.min(0.38, str.energy * 0.32));
  ctx.lineWidth = 0.95;
  ctx.beginPath();
  for (let ti = 1; ti < tickCount; ti++) {
    const t = ti / tickCount;
    const nodeIdx = Math.min(N - 1, Math.round(t * (N - 1)));
    const isMajor = ti % 3 === 0;
    const tickH = (isMajor ? 7.5 : 3.4) + Math.min(6, str.charge[nodeIdx] * 3.2);
    const baseX = str.start.x + dx * t;
    const baseY = str.start.y + dy * t;
    ctx.moveTo(baseX - nx * (tickH * 0.25), baseY - ny * (tickH * 0.25));
    ctx.lineTo(baseX + nx * tickH, baseY + ny * tickH);
  }
  ctx.stroke();

  // Smooth quadratic Bezier helper for silky optical curves
  const traceSmoothWave = (xs: Float32Array, ys: Float32Array) => {
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length - 1; i++) {
      const mx = (xs[i] + xs[i + 1]) * 0.5;
      const my = (ys[i] + ys[i + 1]) * 0.5;
      ctx.quadraticCurveTo(xs[i], ys[i], mx, my);
    }
    ctx.lineTo(xs[xs.length - 1], ys[ys.length - 1]);
  };

  // 2. Feathered inverse-square optical bloom (zero-shadowBlur additive stack for locked 60fps across 5-16 strings)
  ctx.strokeStyle = hexWithAlpha(pal.outer, 0.075 + Math.min(0.08, str.energy * 0.055));
  ctx.lineWidth = 24 + Math.min(10, str.energy * 6.5);
  traceSmoothWave(ptsX, ptsY);
  ctx.stroke();

  ctx.strokeStyle = hexWithAlpha(pal.glow, 0.15 + Math.min(0.14, str.energy * 0.09));
  ctx.lineWidth = 13 + Math.min(6, str.energy * 3.8);
  traceSmoothWave(ptsX, ptsY);
  ctx.stroke();

  ctx.strokeStyle = hexWithAlpha(pal.glow, 0.34 + Math.min(0.24, str.energy * 0.16));
  ctx.lineWidth = 6.0 + Math.min(2.6, str.energy * 1.6);
  traceSmoothWave(ptsX, ptsY);
  ctx.stroke();

  ctx.strokeStyle = hexWithAlpha(pal.inner, 0.62 + Math.min(0.26, str.energy * 0.18));
  ctx.lineWidth = 2.9 + Math.min(1.2, str.energy * 0.8);
  traceSmoothWave(ptsX, ptsY);
  ctx.stroke();

  // 3. Sleek braided electrical plasma filaments hugging the vibrating 2D spring-mass chain
  const filamentCount = str.energy > 0.22 ? 2 : 1;
  const filX = new Float32Array(N);
  const filY = new Float32Array(N);
  for (let f = 0; f < filamentCount; f++) {
    const phase = f * 13.7 + timeSlot * 0.83 + str.seed;
    const freqMul = f === 0 ? 3.0 : 5.0;
    const speedMul = f === 0 ? 22 : -29;

    filX[0] = str.start.x;
    filY[0] = str.start.y;
    filX[N - 1] = str.end.x;
    filY[N - 1] = str.end.y;

    for (let i = 1; i < N - 1; i++) {
      const t = i / (N - 1);
      const env = Math.sin(Math.PI * t);
      const restX = str.start.x + dx * t;
      const restY = str.start.y + dy * t;
      const blend = f === 0 ? 0.8 : 0.48;
      const anchorX = restX + (str.px[i] - restX) * blend;
      const anchorY = restY + (str.py[i] - restY) * blend;

      const localE = Math.min(1.6, 0.16 + str.charge[i] * 0.75 + Math.abs(str.u[i]) * 0.025);
      const braid =
        Math.sin(t * Math.PI * freqMul + time * speedMul + f * 2.1) *
        (2.8 + localE * 8.5 * voltage);
      const microKink =
        hash11(Math.floor(i * 0.65) * 3.17 + phase) *
        (1.4 + localE * 5.2 * voltage);
      const offset = (braid + microKink) * env;
      filX[i] = anchorX + nx * offset;
      filY[i] = anchorY + ny * offset;
    }

    ctx.strokeStyle = hexWithAlpha(
      f === 0 ? pal.inner : pal.core,
      Math.min(0.84, 0.3 + str.energy * 0.48)
    );
    ctx.lineWidth = f === 0 ? 1.35 : 0.9;
    traceSmoothWave(filX, filY);
    ctx.stroke();
  }

  // 4. Razor-sharp incandescent white-hot plasma core
  ctx.strokeStyle = pal.core;
  ctx.lineWidth = 1.7 + Math.min(1.0, str.energy * 0.65);
  traceSmoothWave(ptsX, ptsY);
  ctx.stroke();

  ctx.restore();

  // 5. Anchor endpoint starbursts & concentric reticles
  drawAnchorNode(ctx, str.start.x, str.start.y, str.palette, str.anchorFlash, false, activeShimmer);
  drawAnchorNode(ctx, str.end.x, str.end.y, str.palette, str.anchorFlash, false, activeShimmer);
}

/** Render dashed charging preview line when drawing via touch/mouse or two-hand pinch (matching IMG_2038!) */
function drawPreviewLine(
  ctx: CanvasRenderingContext2D,
  preview: PreviewLine,
  time: number
): void {
  const pal = ELECTRIC_PALETTES[preview.palette];
  const dx = preview.end.x - preview.start.x;
  const dy = preview.end.y - preview.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const nx = -dy / len;
  const ny = dx / len;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Soft outer charging glow
  ctx.strokeStyle = hexWithAlpha(pal.glow, 0.35);
  ctx.lineWidth = 6;
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -time * 42;
  ctx.beginPath();
  ctx.moveTo(preview.start.x, preview.start.y);
  ctx.lineTo(preview.end.x, preview.end.y);
  ctx.stroke();

  // Crisp inner dashed core
  ctx.strokeStyle = pal.core;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(preview.start.x, preview.start.y);
  ctx.lineTo(preview.end.x, preview.end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Fine ruler tick marks along the charging segment
  const step = 14;
  const count = Math.floor(len / step);
  ctx.strokeStyle = hexWithAlpha(pal.inner, 0.62);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const h = i % 4 === 0 ? 7 : 3.5;
    const x = preview.start.x + dx * t;
    const y = preview.start.y + dy * t;
    ctx.moveTo(x, y);
    ctx.lineTo(x + nx * h, y + ny * h);
  }
  ctx.stroke();
  ctx.restore();

  drawAnchorNode(ctx, preview.start.x, preview.start.y, preview.palette, 0.9, true);
  drawAnchorNode(ctx, preview.end.x, preview.end.y, preview.palette, 0.9, true);
}

/** Render live corona tether arcs snapping between a nearby fingertip and an electric string */
function drawCoronaArcs(ctx: CanvasRenderingContext2D, state: SimulationState, voltage: number): void {
  if (state.coronaArcs.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const arc of state.coronaArcs) {
    const pal = ELECTRIC_PALETTES[arc.palette];
    const dx = arc.toX - arc.fromX;
    const dy = arc.toY - arc.fromY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;
    const segs = 7;

    // Glow pass
    ctx.strokeStyle = hexWithAlpha(pal.glow, 0.25 + arc.intensity * 0.55);
    ctx.lineWidth = 3.5 * arc.intensity + 1.5;
    ctx.beginPath();
    ctx.moveTo(arc.fromX, arc.fromY);
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const jag = hash11(i * 3.7 + arc.seed) * (8 + 12 * voltage) * Math.sin(Math.PI * t);
      ctx.lineTo(arc.fromX + dx * t + nx * jag, arc.fromY + dy * t + ny * jag);
    }
    ctx.lineTo(arc.toX, arc.toY);
    ctx.stroke();

    // Hot white core
    ctx.strokeStyle = hexWithAlpha(pal.core, 0.4 + arc.intensity * 0.6);
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  ctx.restore();
}

/** Render directional motion-blurred spark streaks */
function drawSparks(ctx: CanvasRenderingContext2D, state: SimulationState): void {
  if (state.sparks.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const p of state.sparks) {
    const ratio = Math.max(0, Math.min(1, p.life / p.maxLife));
    const tailX = p.x - p.vx * 0.022;
    const tailY = p.y - p.vy * 0.022;

    // Outer chromatic streak
    ctx.strokeStyle = hexWithAlpha(p.tailColor, ratio * 0.9);
    ctx.lineWidth = p.size * (0.9 + ratio * 0.65);
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // Hot white incandescent spark tip (proper affine blend along velocity vector)
    const midX = tailX * 0.45 + p.x * 0.55;
    const midY = tailY * 0.45 + p.y * 0.55;
    ctx.strokeStyle = hexWithAlpha(p.coreColor, Math.min(1, ratio * 1.35));
    ctx.lineWidth = Math.max(0.9, p.size * 0.55);
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  ctx.restore();
}

/** Render tracked webcam hands in either classic green/red MediaPipe Tracker style (screenshots) or low-cortisol Gossamer style */
function drawTrackedHands(
  ctx: CanvasRenderingContext2D,
  hands: TrackedHand[],
  style: SkeletonStyle,
  paletteId: ElectricPaletteId
): void {
  if (hands.length === 0) return;
  const pal = ELECTRIC_PALETTES[paletteId === 'spectrum' ? 'lime' : paletteId];

  for (const hand of hands) {
    const lms = hand.landmarks;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (style === 'tracker') {
      // Crisp green skeleton bones + red landmark nodes + distinct thumb (#4) & index (#8) active tips
      ctx.strokeStyle = 'rgba(26, 214, 62, 0.88)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = lms[a];
        const pb = lms[b];
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();

      // Standard joint nodes
      for (let i = 0; i < lms.length; i++) {
        if (i === 4 || i === 8) continue;
        const p = lms[i];
        ctx.fillStyle = '#e11d24';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Thumb tip (#4): warm amber-gold core with white ring + subtle horizontal tick
      const thumb = lms[4];
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(thumb.x, thumb.y, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(thumb.x, thumb.y, 7.0, 0, Math.PI * 2);
      ctx.stroke();

      // Index tip (#8): electric cyan/crimson target with crisp white double ring
      const indexTip = lms[8];
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(indexTip.x, indexTip.y, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(indexTip.x, indexTip.y, 7.6, 0, Math.PI * 2);
      ctx.stroke();

      // Connect thumb & index with a fine tension bridge when approaching pinch
      if (hand.isPinched || hand.pinchStrength > 0.35) {
        ctx.strokeStyle = hand.isPinched ? 'rgba(255, 195, 110, 0.9)' : 'rgba(125, 211, 252, 0.45)';
        ctx.lineWidth = hand.isPinched ? 1.8 : 1.1;
        ctx.beginPath();
        ctx.moveTo(thumb.x, thumb.y);
        ctx.lineTo(indexTip.x, indexTip.y);
        ctx.stroke();
      }
    } else {
      // Low-cortisol Gossamer mode: delicate translucent light filaments + distinct thumb & index halos
      ctx.strokeStyle = hexWithAlpha(pal.glow, 0.28);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = lms[a];
        const pb = lms[b];
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();

      for (const finger of hand.fingers) {
        if (!finger.extended) continue;
        const grad = ctx.createRadialGradient(finger.x, finger.y, 0, finger.x, finger.y, 16);
        grad.addColorStop(0, hexWithAlpha(pal.core, 0.8));
        grad.addColorStop(0.5, hexWithAlpha(pal.glow, 0.28));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(finger.x, finger.y, 16, 0, Math.PI * 2);
        ctx.fill();
      }

      // Distinct thumb (#4) amber halo and index (#8) electric ring
      const thumb = lms[4];
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.78)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(thumb.x, thumb.y, 6.2, 0, Math.PI * 2);
      ctx.stroke();

      const indexTip = lms[8];
      ctx.strokeStyle = hexWithAlpha(pal.core, 0.92);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(indexTip.x, indexTip.y, 7.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pinch reticle glow when thumb + index are pinched (matches the bright orange-white rings in IMG_2041 & IMG_2038)
    if (hand.isPinched) {
      drawAnchorNode(ctx, hand.pinchX, hand.pinchY, pal.id, 0.85, true);
    }

    ctx.restore();
  }
}

/** Subtle luminous fingertip cursor reticle for mouse/touch mode */
function drawPointerReticle(
  ctx: CanvasRenderingContext2D,
  cursor: ActiveCursorVisual,
  paletteId: ElectricPaletteId
): void {
  const pal = ELECTRIC_PALETTES[paletteId === 'spectrum' ? 'cyan' : paletteId];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const r = cursor.mode === 'draw' ? 14 : 18;
  const grad = ctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, r);
  grad.addColorStop(0, hexWithAlpha(pal.core, cursor.active ? 0.55 : 0.24));
  grad.addColorStop(0.45, hexWithAlpha(pal.glow, cursor.active ? 0.26 : 0.1));
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
  ctx.fill();

  if (cursor.mode === 'draw') {
    ctx.strokeStyle = hexWithAlpha(pal.inner, 0.72);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cursor.x - 8, cursor.y);
    ctx.lineTo(cursor.x + 8, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - 8);
    ctx.lineTo(cursor.x, cursor.y + 8);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Render the proximity resonance layer: faint, translucent connection lines and coupling nodes
 * between closely vibrating strings, scaling their opacity smoothly with `humIntensity`, and
 * triggering subtle color-shimmer & constructive-interference flashes at high proximity resonance.
 */
function drawProximityResonanceLayer(
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  humIntensity: number,
  voltage: number
): void {
  const { activePairs, beatHz } = state.proximityResonance;
  const clampedHum = Math.max(0, Math.min(1, humIntensity));
  if (clampedHum <= 0.01 || activePairs.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const slot = Math.floor(state.time * 24);
  const beatPulse = 0.86 + 0.14 * Math.sin(state.time * Math.PI * 2 * Math.max(1, beatHz));
  const stringById = new Map<number, ElectricString>();
  for (const s of state.strings) {
    stringById.set(s.id, s);
  }

  // Interior sample fractions so parallel/converging strings reveal resonance nodes across their vibrating span
  const interiorFracs = [0.28, 0.5, 0.72];

  for (const pair of activePairs) {
    const baseAlpha = computeProximityResonanceOpacity(clampedHum, pair.intensity) * beatPulse;
    if (baseAlpha <= 0.005) continue;

    const pal = ELECTRIC_PALETTES[pair.palette];
    const shimmerHue = INTERFERENCE_SHIMMER_HUES[pair.palette];
    const strA = stringById.get(pair.stringAId);
    const strB = stringById.get(pair.stringBId);

    // Collect coupled node bridges: prefer live vibrating interior nodes when strings run closely side-by-side,
    // falling back to the primary closest coupling coordinates for crossing or angled strings.
    const bridges: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      idxA: number;
      idxB: number;
      weight: number;
      seedOffset: number;
    }> = [];

    if (strA && strB && strA.nodeCount > 6 && strB.nodeCount > 6) {
      const nA = strA.nodeCount - 1;
      const nB = strB.nodeCount - 1;
      for (let m = 0; m < interiorFracs.length; m++) {
        const frac = interiorFracs[m];
        const idxA = Math.max(3, Math.min(nA - 3, Math.round(frac * nA)));
        const ax = strA.px[idxA];
        const ay = strA.py[idxA];

        // Find nearest interior node on string B
        let bestIdxB = Math.max(3, Math.min(nB - 3, Math.round(frac * nB)));
        let bestDist = Infinity;
        for (let j = 3; j <= nB - 3; j += 2) {
          const d = Math.hypot(ax - strB.px[j], ay - strB.py[j]);
          if (d < bestDist) {
            bestDist = d;
            bestIdxB = j;
          }
        }

        if (bestDist < 295) {
          const localProx = Math.max(0.28, 1 - bestDist / 310);
          const centerBias = m === 1 ? 1.0 : 0.78;
          bridges.push({
            x1: ax,
            y1: ay,
            x2: strB.px[bestIdxB],
            y2: strB.py[bestIdxB],
            idxA,
            idxB: bestIdxB,
            weight: Math.min(1, localProx * centerBias * 1.15),
            seedOffset: m * 2.13,
          });
        }
      }
    }

    if (bridges.length === 0) {
      bridges.push({
        x1: pair.fromX,
        y1: pair.fromY,
        x2: pair.toX,
        y2: pair.toY,
        idxA: -1,
        idxB: -1,
        weight: 1,
        seedOffset: 0,
      });
    }

    for (const bridge of bridges) {
      const alpha = baseAlpha * bridge.weight;
      if (alpha <= 0.005) continue;

      const pairSeed = pair.stringAId * 1.73 + pair.stringBId * 3.11 + bridge.seedOffset;
      const shimmer = computeInterferenceShimmer(
        clampedHum,
        pair.intensity,
        state.time,
        beatHz,
        pairSeed
      );

      const filamentColor = shimmer.active
        ? mixHexColor(pal.inner, shimmerHue.accent, Math.min(1, 0.25 + shimmer.shimmerMix * 0.72))
        : pal.inner;
      const auraColor = shimmer.active
        ? mixHexColor(pal.glow, shimmerHue.accent, Math.min(1, 0.2 + shimmer.shimmerMix * 0.68))
        : pal.glow;
      const coreColor = shimmer.active
        ? mixHexColor(pal.core, shimmerHue.flash, Math.min(1, 0.2 + shimmer.flashLevel * 0.8))
        : pal.core;

      const dx = bridge.x2 - bridge.x1;
      const dy = bridge.y2 - bridge.y1;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;

      // 1. Faint straight translucent tether connecting the two proximity resonance nodes
      const tetherGrad = ctx.createLinearGradient(bridge.x1, bridge.y1, bridge.x2, bridge.y2);
      tetherGrad.addColorStop(
        0,
        hexWithAlpha(coreColor, Math.min(0.72, alpha * (0.95 + shimmer.flashLevel * 0.85)))
      );
      if (shimmer.active) {
        const midStop = Math.max(0.15, Math.min(0.85, shimmer.travelT));
        tetherGrad.addColorStop(
          midStop,
          hexWithAlpha(
            mixHexColor(shimmerHue.accent, shimmerHue.flash, shimmer.flashLevel * 0.72),
            Math.min(0.68, alpha * (0.78 + shimmer.shimmerMix * 0.55 + shimmer.flashLevel * 0.9))
          )
        );
      } else {
        tetherGrad.addColorStop(0.5, hexWithAlpha(auraColor, alpha * 0.5));
      }
      tetherGrad.addColorStop(
        1,
        hexWithAlpha(coreColor, Math.min(0.72, alpha * (0.95 + shimmer.flashLevel * 0.85)))
      );

      ctx.strokeStyle = tetherGrad;
      ctx.lineWidth = 0.9 + shimmer.shimmerMix * 0.35 + shimmer.flashLevel * 0.65;
      ctx.beginPath();
      ctx.moveTo(bridge.x1, bridge.y1);
      ctx.lineTo(bridge.x2, bridge.y2);
      ctx.stroke();

      // 2. Soft translucent resonance glow envelope + subtle harmonic interference filament
      const segs = 8;
      const ptsX = new Float32Array(segs + 1);
      const ptsY = new Float32Array(segs + 1);
      ptsX[0] = bridge.x1;
      ptsY[0] = bridge.y1;
      ptsX[segs] = bridge.x2;
      ptsY[segs] = bridge.y2;

      for (let k = 1; k < segs; k++) {
        const t = k / segs;
        const env = Math.sin(Math.PI * t);
        const wave =
          Math.sin(t * Math.PI * 3 + state.time * 20 + pair.stringAId + bridge.seedOffset) *
            4.5 *
            pair.intensity +
          hash11(k * 4.1 + slot * 0.7 + pair.stringBId + bridge.seedOffset) *
            3.6 *
            voltage *
            pair.intensity;
        ptsX[k] = bridge.x1 + dx * t + nx * wave * env;
        ptsY[k] = bridge.y1 + dy * t + ny * wave * env;
      }

      // Wide whisper-faint aura band (shimmers smoothly toward complementary hue at high proximity)
      ctx.strokeStyle = hexWithAlpha(
        auraColor,
        Math.min(0.42, alpha * (0.32 + shimmer.shimmerMix * 0.38 + shimmer.flashLevel * 0.35))
      );
      ctx.lineWidth = 5.0 + pair.intensity * 3.2 + shimmer.flashLevel * 3.0;
      ctx.beginPath();
      ctx.moveTo(ptsX[0], ptsY[0]);
      for (let k = 1; k <= segs; k++) ctx.lineTo(ptsX[k], ptsY[k]);
      ctx.stroke();

      // Crisp translucent harmonic connection filament
      ctx.strokeStyle = hexWithAlpha(
        filamentColor,
        Math.min(0.74, alpha * (0.95 + shimmer.shimmerMix * 0.55))
      );
      ctx.lineWidth = 0.9 + pair.intensity * 0.55;
      ctx.beginPath();
      ctx.moveTo(ptsX[0], ptsY[0]);
      for (let k = 1; k <= segs; k++) ctx.lineTo(ptsX[k], ptsY[k]);
      ctx.stroke();

      // High-proximity constructive-interference flash veil, travelling shimmer bead, and string-node sheen
      if (shimmer.active) {
        if (shimmer.flashLevel > 0.04) {
          ctx.strokeStyle = hexWithAlpha(
            shimmerHue.flash,
            Math.min(0.72, alpha * (0.55 + shimmer.flashLevel * 1.45))
          );
          ctx.lineWidth = 0.75 + shimmer.flashLevel * 1.1;
          ctx.beginPath();
          ctx.moveTo(ptsX[0], ptsY[0]);
          for (let k = 1; k <= segs; k++) ctx.lineTo(ptsX[k], ptsY[k]);
          ctx.stroke();
        }

        // Travelling luminous interference bead gliding along the deformed filament
        const segPos = shimmer.travelT * segs;
        const idx = Math.max(0, Math.min(segs - 1, Math.floor(segPos)));
        const frac = segPos - idx;
        const beadX = ptsX[idx] + (ptsX[idx + 1] - ptsX[idx]) * frac;
        const beadY = ptsY[idx] + (ptsY[idx + 1] - ptsY[idx]) * frac;
        const beadR = 5.5 + shimmer.shimmerMix * 4.2 + shimmer.flashLevel * 5.8;
        const beadAlpha = Math.min(
          0.74,
          alpha * (0.8 + shimmer.shimmerMix * 0.65 + shimmer.flashLevel * 1.15)
        );

        const beadGrad = ctx.createRadialGradient(beadX, beadY, 0, beadX, beadY, beadR);
        beadGrad.addColorStop(0, hexWithAlpha(shimmerHue.flash, beadAlpha));
        beadGrad.addColorStop(0.45, hexWithAlpha(shimmerHue.accent, beadAlpha * 0.62));
        beadGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = beadGrad;
        ctx.beginPath();
        ctx.arc(beadX, beadY, beadR, 0, Math.PI * 2);
        ctx.fill();

        // Subtle chromatic interference sheen along the local connected string segments
        if (strA && strB && bridge.idxA >= 0 && bridge.idxB >= 0) {
          const sheenAlpha = Math.min(
            0.52,
            alpha * (0.48 + shimmer.shimmerMix * 0.55 + shimmer.flashLevel * 0.85)
          );
          ctx.strokeStyle = hexWithAlpha(shimmerHue.accent, sheenAlpha);
          ctx.lineWidth = 3.2 + shimmer.flashLevel * 2.6;
          for (const [str, centerIdx] of [
            [strA, bridge.idxA],
            [strB, bridge.idxB],
          ] as const) {
            const startI = Math.max(1, centerIdx - 3);
            const endI = Math.min(str.nodeCount - 2, centerIdx + 3);
            ctx.beginPath();
            ctx.moveTo(str.px[startI], str.py[startI]);
            for (let k = startI + 1; k <= endI; k++) {
              ctx.lineTo(str.px[k], str.py[k]);
            }
            ctx.stroke();
          }
        }
      }

      // 3. Subtle proximity resonance nodes anchored at both coupling points
      const nodeR = 2.8 + pair.intensity * 2.4;
      for (const [nodeX, nodeY] of [
        [bridge.x1, bridge.y1],
        [bridge.x2, bridge.y2],
      ] as const) {
        const haloRadius = nodeR * (3.4 + shimmer.shimmerMix * 0.8 + shimmer.flashLevel * 1.8);
        const halo = ctx.createRadialGradient(nodeX, nodeY, 0, nodeX, nodeY, haloRadius);
        halo.addColorStop(
          0,
          hexWithAlpha(coreColor, Math.min(0.86, alpha * (1.05 + shimmer.flashLevel * 1.25)))
        );
        halo.addColorStop(
          0.42,
          hexWithAlpha(auraColor, Math.min(0.62, alpha * (0.55 + shimmer.shimmerMix * 0.52)))
        );
        halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = hexWithAlpha(
          filamentColor,
          Math.min(0.8, alpha * (0.95 + shimmer.shimmerMix * 0.55))
        );
        ctx.lineWidth = 0.95 + shimmer.flashLevel * 0.5;
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, nodeR, 0, Math.PI * 2);
        ctx.stroke();

        // Subtle high-proximity interference flash ripple & optical 4-point micro-glint at connected nodes
        if (shimmer.active && shimmer.flashLevel > 0.04) {
          const rippleR = nodeR * (1.7 + shimmer.flashLevel * 1.85);
          ctx.strokeStyle = hexWithAlpha(
            shimmerHue.accent,
            Math.min(0.68, alpha * (0.65 + shimmer.flashLevel * 1.35))
          );
          ctx.lineWidth = 0.85;
          ctx.beginPath();
          ctx.arc(nodeX, nodeY, rippleR, 0, Math.PI * 2);
          ctx.stroke();

          const spike = nodeR * (1.45 + shimmer.flashLevel * 1.85);
          ctx.strokeStyle = hexWithAlpha(
            shimmerHue.flash,
            Math.min(0.82, alpha * (0.7 + shimmer.flashLevel * 1.55))
          );
          ctx.lineWidth = 0.95;
          ctx.beginPath();
          ctx.moveTo(nodeX - spike, nodeY);
          ctx.lineTo(nodeX + spike, nodeY);
          ctx.moveTo(nodeX, nodeY - spike);
          ctx.lineTo(nodeX, nodeY + spike);
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
}

export function renderElectricScene(
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  opts: RenderOptions
): void {
  const {
    width,
    height,
    dpr,
    config,
    activePalette,
    previewLine,
    hands,
    video,
    cameraViewMode,
    skeletonStyle,
    cursor,
    humIntensity,
  } = opts;

  ctx.save();
  ctx.scale(dpr, dpr);

  let aggregateEnergy = 0;
  for (const s of state.strings) aggregateEnergy += s.energy;

  const videoOpacity = getCameraViewOpacity(cameraViewMode);
  if (videoOpacity > 0 && video && video.readyState >= 2) {
    if (videoOpacity < 1) {
      drawStudioBackdrop(ctx, width, height, activePalette, aggregateEnergy);
    }
    drawCoverVideo(ctx, video, width, height, videoOpacity);
  } else {
    drawStudioBackdrop(ctx, width, height, activePalette, aggregateEnergy);
  }

  // Resolve active high-proximity resonance per string so coupled strings visibly shimmer in hue & flash
  const effectiveHum = humIntensity ?? state.proximityResonance.intensity;
  const stringResonanceMap = new Map<number, number>();
  for (const pair of state.proximityResonance.activePairs) {
    const prevA = stringResonanceMap.get(pair.stringAId) ?? 0;
    if (pair.intensity > prevA) stringResonanceMap.set(pair.stringAId, pair.intensity);
    const prevB = stringResonanceMap.get(pair.stringBId) ?? 0;
    if (pair.intensity > prevB) stringResonanceMap.set(pair.stringBId, pair.intensity);
  }

  // Draw all active reverberating electric strings
  for (const str of state.strings) {
    const pairIntensity = stringResonanceMap.get(str.id) ?? 0;
    const strShimmer =
      pairIntensity > 0
        ? computeInterferenceShimmer(
            effectiveHum,
            pairIntensity,
            state.time,
            state.proximityResonance.beatHz,
            str.seed
          )
        : undefined;
    drawElectricString(ctx, str, state.time, config, strShimmer);
  }

  // Draw subtle proximity resonance connection lines and coupling nodes scaled by humIntensity
  drawProximityResonanceLayer(
    ctx,
    state,
    effectiveHum,
    config.voltage
  );

  // Draw live corona arcs from nearby fingers/pointers
  drawCoronaArcs(ctx, state, config.voltage);

  // Draw dashed tension preview line while stretching
  if (previewLine) {
    drawPreviewLine(ctx, previewLine, state.time);
  }

  // Draw directional electrical spark streaks
  drawSparks(ctx, state);

  // Draw webcam hand skeletons
  drawTrackedHands(ctx, hands, skeletonStyle, activePalette);

  // Draw subtle mouse/touch interaction reticle
  if (cursor && hands.length === 0) {
    drawPointerReticle(ctx, cursor, activePalette);
  }

  ctx.restore();
}
