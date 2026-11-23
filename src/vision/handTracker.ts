import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export const HAND_CONNECTIONS: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export interface TrackedFinger {
  tipIndex: number;
  x: number; // viewport CSS px
  y: number; // viewport CSS px
  vx: number;
  vy: number;
  extended: boolean;
}

export interface TrackedHand {
  id: number;
  /** Mirrored 21 landmarks in viewport CSS pixels */
  landmarks: Array<{ x: number; y: number; z: number }>;
  /** Midpoint between thumb tip (#4) and index tip (#8) in viewport CSS pixels */
  pinchX: number;
  pinchY: number;
  isPinched: boolean;
  pinchStrength: number; // 0..1
  /** Primary pointing fingertip (index tip #8) */
  indexTip: TrackedFinger;
  /** All extended fingertips for multi-finger strumming */
  fingers: TrackedFinger[];
}

export interface HandTrackerSnapshot {
  active: boolean;
  loading: boolean;
  hands: TrackedHand[];
  video: HTMLVideoElement | null;
}

const MP_VERSION = '1.2.3';
const MP_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const FINGER_TIPS: ReadonlyArray<{ tip: number; pip: number }> = [
  { tip: 8, pip: 6 },   // index
  { tip: 12, pip: 10 }, // middle
  { tip: 16, pip: 14 }, // ring
  { tip: 20, pip: 18 }, // pinky
];

interface SmoothedHandMemory {
  landmarks: Array<{ x: number; y: number; z: number }>;
  prevTips: Map<number, { x: number; y: number }>;
  isPinched: boolean;
}

export interface HandTrackerController {
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
  update(viewportWidth: number, viewportHeight: number, dt: number): HandTrackerSnapshot;
  getSnapshot(): HandTrackerSnapshot;
}

export function createHandTracker(): HandTrackerController {
  let landmarker: HandLandmarker | null = null;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let active = false;
  let loading = false;
  let lastVideoTime = -1;
  let lastDetectMs = 0;
  let prevSampleMs = 0;
  let latestHands: TrackedHand[] = [];
  const memory: SmoothedHandMemory[] = [];

  async function ensureLandmarker(): Promise<HandLandmarker> {
    if (landmarker) return landmarker;
    const mod = await import('@mediapipe/tasks-vision');
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM_URL);
    try {
      landmarker = await mod.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MP_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    } catch {
      landmarker = await mod.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MP_MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    }
    return landmarker;
  }

  async function start(): Promise<void> {
    if (active || loading) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Webcam access is not supported in this browser.');
    }

    loading = true;
    try {
      const [mediaStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        }),
        ensureLandmarker(),
      ]);

      stream = mediaStream;
      video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      await video.play();

      memory.length = 0;
      latestHands = [];
      lastVideoTime = -1;
      lastDetectMs = 0;
      prevSampleMs = performance.now();
      active = true;
    } catch (err) {
      stop();
      throw err;
    } finally {
      loading = false;
    }
  }

  function stop(): void {
    active = false;
    loading = false;
    latestHands = [];
    memory.length = 0;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      stream = null;
    }
    if (video) {
      video.srcObject = null;
      video = null;
    }
  }

  function dispose(): void {
    stop();
    if (landmarker) {
      try {
        landmarker.close();
      } catch {
        // ignore teardown errors
      }
      landmarker = null;
    }
  }

  /** Cover-fit transform so mirrored video and landmarks align 1:1 on screen. */
  function mapLandmarkToViewport(
    lm: NormalizedLandmark,
    vw: number,
    vh: number,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number; z: number } {
    const scale = Math.max(viewportWidth / Math.max(1, vw), viewportHeight / Math.max(1, vh));
    const drawW = vw * scale;
    const drawH = vh * scale;
    const offsetX = (viewportWidth - drawW) * 0.5;
    const offsetY = (viewportHeight - drawH) * 0.5;
    return {
      x: offsetX + (1 - lm.x) * drawW,
      y: offsetY + lm.y * drawH,
      z: lm.z,
    };
  }

  function update(viewportWidth: number, viewportHeight: number, _dt: number): HandTrackerSnapshot {
    if (!active || !video || !landmarker || video.readyState < 2) {
      return { active, loading, hands: latestHands, video };
    }

    if (video.currentTime !== lastVideoTime) {
      const nowMs = Math.max(performance.now(), lastDetectMs + 1);
      const sampleDt = Math.max(0.008, Math.min(0.1, (nowMs - prevSampleMs) / 1000));
      lastVideoTime = video.currentTime;
      lastDetectMs = nowMs;
      prevSampleMs = nowMs;

      let rawHands: NormalizedLandmark[][] = [];
      try {
        const result = landmarker.detectForVideo(video, nowMs);
        rawHands = result.landmarks ?? [];
      } catch {
        return { active, loading, hands: latestHands, video };
      }
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 360;

      const parsed: TrackedHand[] = [];
      const alpha = 1 - Math.exp(-sampleDt * 24);

      for (let hi = 0; hi < rawHands.length; hi++) {
        const raw = rawHands[hi];
        if (!memory[hi]) {
          memory[hi] = {
            landmarks: raw.map((lm) => mapLandmarkToViewport(lm, vw, vh, viewportWidth, viewportHeight)),
            prevTips: new Map(),
            isPinched: false,
          };
        }

        const mem = memory[hi];
        const smoothed: Array<{ x: number; y: number; z: number }> = [];
        for (let i = 0; i < raw.length; i++) {
          const target = mapLandmarkToViewport(raw[i], vw, vh, viewportWidth, viewportHeight);
          const prev = mem.landmarks[i] ?? target;
          const next = {
            x: prev.x + (target.x - prev.x) * alpha,
            y: prev.y + (target.y - prev.y) * alpha,
            z: prev.z + (target.z - prev.z) * alpha,
          };
          smoothed.push(next);
        }
        mem.landmarks = smoothed;

        // Hand scale from wrist (#0) to middle MCP (#9) for resolution-independent pinch threshold
        const wrist = smoothed[0];
        const middleMcp = smoothed[9];
        const handScale = Math.max(40, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));

        const thumbTip = smoothed[4];
        const indexTipPt = smoothed[8];
        const pinchDist = Math.hypot(thumbTip.x - indexTipPt.x, thumbTip.y - indexTipPt.y);
        const pinchRatio = pinchDist / handScale;

        // Hysteresis prevents accidental flicker when holding a pinch anchor
        const enterThresh = 0.34;
        const exitThresh = 0.47;
        mem.isPinched = mem.isPinched ? pinchRatio < exitThresh : pinchRatio < enterThresh;
        const pinchStrength = Math.max(0, Math.min(1, 1 - (pinchRatio - 0.14) / 0.36));

        const pinchX = (thumbTip.x + indexTipPt.x) * 0.5;
        const pinchY = (thumbTip.y + indexTipPt.y) * 0.5;

        const fingers: TrackedFinger[] = [];
        for (const spec of FINGER_TIPS) {
          const tip = smoothed[spec.tip];
          const pip = smoothed[spec.pip];
          const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
          const dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
          const extended = dTip > dPip * 1.07;

          const prevTip = mem.prevTips.get(spec.tip) ?? { x: tip.x, y: tip.y };
          const vx = (tip.x - prevTip.x) / sampleDt;
          const vy = (tip.y - prevTip.y) / sampleDt;
          mem.prevTips.set(spec.tip, { x: tip.x, y: tip.y });

          fingers.push({
            tipIndex: spec.tip,
            x: tip.x,
            y: tip.y,
            vx,
            vy,
            extended,
          });
        }

        parsed.push({
          id: hi,
          landmarks: smoothed,
          pinchX,
          pinchY,
          isPinched: mem.isPinched,
          pinchStrength,
          indexTip: fingers[0],
          fingers,
        });
      }

      if (rawHands.length < memory.length) {
        memory.length = rawHands.length;
      }
      latestHands = parsed;
    }

    return { active, loading, hands: latestHands, video };
  }

  return {
    start,
    stop,
    dispose,
    update,
    getSnapshot: () => ({ active, loading, hands: latestHands, video }),
  };
}
