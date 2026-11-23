import { SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createElectricAudio, type ElectricAudioController } from './audio/electricAudio';
import { HudOverlay, type HudStats, type InteractionMode } from './components/HudOverlay';
import {
  buildEmbeddedSceneUrl,
  getSceneById,
  resolveSceneFromQuery,
  type LowCortisolSceneId,
} from './components/sceneCatalog';
import { ScenePicker } from './components/ScenePicker';
import {
  applyPreset,
  clearStrings,
  createElectricString,
  createSimulationState,
  DEFAULT_SIM_CONFIG,
  ELECTRIC_PALETTES,
  exciteString,
  findNearestAnchor,
  interactTouchesWithStrings,
  rescaleStrings,
  resolvePaletteForNewString,
  SPECTRUM_ORDER,
  stepSimulation,
  type ElectricPaletteId,
  type SimConfig,
  type SimulationState,
  type StringPresetId,
  type SweptTouch,
  type Vec2,
} from './physics/electricString';
import {
  renderElectricScene,
  type ActiveCursorVisual,
  type PreviewLine,
  type SkeletonStyle,
} from './renderer/canvasRenderer';
import { createHandTracker, type HandTrackerController } from './vision/handTracker';

interface PointerTrack {
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  down: boolean;
  lastTime: number;
}

interface ActiveDrawGesture {
  pointerId: number;
  start: Vec2;
  end: Vec2;
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
}

interface ActiveAnchorDrag {
  pointerId: number;
  stringId: number;
  end: 'start' | 'end';
}

interface TwoHandPinchState {
  active: boolean;
  start: Vec2;
  end: Vec2;
  palette: Exclude<ElectricPaletteId, 'spectrum'>;
}

interface HeldAnchorByHand {
  handIndex: number;
  stringId: number;
  end: 'start' | 'end';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const remoteIframeRef = useRef<HTMLIFrameElement | null>(null);

  // React UI state (only updated on deliberate user actions or ~4Hz stats sync — never at 60Hz)
  const [activeScene, setActiveScene] = useState<LowCortisolSceneId>(() =>
    resolveSceneFromQuery(new URLSearchParams(window.location.search).get('demo'))
  );
  const initialRemoteDemoRef = useRef<string | null>(
    activeScene === 'arc' ? null : (getSceneById(activeScene).liveDemoParam ?? 'moss')
  );
  const [mode, setMode] = useState<InteractionMode>('strum');
  const [controlsOpen, setControlsOpen] = useState<boolean>(false);
  const [remoteControlsOpen, setRemoteControlsOpen] = useState<boolean>(false);
  const [palette, setPalette] = useState<ElectricPaletteId>('lime');
  const [activePreset, setActivePreset] = useState<StringPresetId | null>('single');
  const [config, setConfig] = useState<SimConfig>(DEFAULT_SIM_CONFIG);
  const [handsActive, setHandsActive] = useState<boolean>(false);
  const [handsLoading, setHandsLoading] = useState<boolean>(false);
  const [handsCount, setHandsCount] = useState<number>(0);
  const [showCameraBackdrop, setShowCameraBackdrop] = useState<boolean>(true);
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>('tracker');
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<HudStats>({ stringCount: 1, fps: 60, totalPlucks: 0 });
  const [humIntensity, setHumIntensity] = useState<number>(0);

  // Live simulation refs accessed directly by the 60fps requestAnimationFrame loop
  const activeSceneRef = useRef<LowCortisolSceneId>(activeScene);
  const simRef = useRef<SimulationState>(createSimulationState());
  const configRef = useRef<SimConfig>(DEFAULT_SIM_CONFIG);
  const modeRef = useRef<InteractionMode>('strum');
  const paletteRef = useRef<ElectricPaletteId>('lime');
  const showCameraRef = useRef<boolean>(true);
  const skeletonStyleRef = useRef<SkeletonStyle>('tracker');
  const audioRef = useRef<ElectricAudioController | null>(null);
  const trackerRef = useRef<HandTrackerController | null>(null);

  const pointersRef = useRef<Map<number, PointerTrack>>(new Map());
  const drawGestureRef = useRef<ActiveDrawGesture | null>(null);
  const anchorDragRef = useRef<ActiveAnchorDrag | null>(null);
  const twoHandPinchRef = useRef<TwoHandPinchState | null>(null);
  const heldAnchorHandRef = useRef<HeldAnchorByHand | null>(null);
  const cursorVisualRef = useRef<ActiveCursorVisual | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string, durationMs = 3200) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  const handleSelectScene = useCallback(
    (next: LowCortisolSceneId) => {
      activeSceneRef.current = next;
      if (next === 'arc') {
        // Explicitly stop any active webcam / mic / audio streams inside the outgoing WebGPU iframe before unmount
        remoteIframeRef.current?.contentWindow?.postMessage(
          { type: 'lc:stop-sensors' },
          window.location.origin
        );
        initialRemoteDemoRef.current = null;
      } else if (!initialRemoteDemoRef.current) {
        initialRemoteDemoRef.current = getSceneById(next).liveDemoParam ?? 'moss';
      } else {
        // Already inside the persistent embedded WebGPU host — switch instantaneously
        const win = remoteIframeRef.current?.contentWindow;
        if (win) {
          win.postMessage(
            { type: 'lc:select-scene', scene: getSceneById(next).liveDemoParam ?? 'moss' },
            window.location.origin
          );
        }
      }
      setActiveScene(next);
      setControlsOpen(false);
      setRemoteControlsOpen(false);
      if (next !== 'arc') {
        if (handsActive) {
          trackerRef.current?.stop();
          setHandsActive(false);
          setHandsCount(0);
        }
        if (audioRef.current?.enabled) {
          void audioRef.current.setEnabled(false);
          setAudioEnabled(false);
        }
      }
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('demo', next);
      window.history.replaceState({}, '', nextUrl.toString());
    },
    [handsActive]
  );

  const handleToggleRemoteControls = useCallback(() => {
    const win = remoteIframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: 'lc:toggle-controls' }, window.location.origin);
    }
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data && typeof ev.data === 'object' && ev.data.type === 'lc:controls-state') {
        setRemoteControlsOpen(Boolean(ev.data.open));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Keep body theme class synced with active scene or selected electric palette
  useEffect(() => {
    activeSceneRef.current = activeScene;
    paletteRef.current = palette;
    const body = document.body;
    body.classList.remove('theme-violet', 'theme-cyan', 'theme-amber', 'theme-spectrum');
    if (activeScene === 'snow') {
      body.classList.add('theme-cyan');
    } else if (activeScene === 'dog') {
      body.classList.add('theme-amber');
    } else if (activeScene === 'film') {
      body.classList.add('theme-spectrum');
    } else if (activeScene === 'arc') {
      if (palette === 'spectrum') {
        body.classList.add('theme-spectrum');
      } else {
        const cls = ELECTRIC_PALETTES[palette].bodyTheme;
        if (cls) body.classList.add(cls);
      }
    }
  }, [palette, activeScene]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    showCameraRef.current = showCameraBackdrop;
  }, [showCameraBackdrop]);

  useEffect(() => {
    skeletonStyleRef.current = skeletonStyle;
  }, [skeletonStyle]);

  const handlePaletteChange = useCallback((next: ElectricPaletteId) => {
    setPalette(next);
    const sim = simRef.current;
    // Immediately re-tint existing strings so palette changes feel tactile & instant
    sim.strings.forEach((s, idx) => {
      s.palette = next === 'spectrum' ? SPECTRUM_ORDER[idx % SPECTRUM_ORDER.length] : next;
      s.anchorFlash = 0.7;
    });
  }, []);

  const handleApplyPreset = useCallback(
    (preset: StringPresetId) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      applyPreset(simRef.current, preset, w, h, paletteRef.current);
      setActivePreset(preset);
      setStats((prev) => ({
        ...prev,
        stringCount: simRef.current.strings.length,
        totalPlucks: simRef.current.totalPlucks,
      }));
      audioRef.current?.triggerAnchorSnap(0);
    },
    []
  );

  const handleClearStrings = useCallback(() => {
    clearStrings(simRef.current);
    setActivePreset(null);
    setStats((prev) => ({ ...prev, stringCount: 0 }));
    showToast('Stage cleared · Switch to Draw or pick a preset');
  }, [showToast]);

  const handlePulseAll = useCallback(() => {
    const sim = simRef.current;
    const w = window.innerWidth;
    if (sim.strings.length === 0) {
      applyPreset(sim, 'single', w, window.innerHeight, paletteRef.current);
      setActivePreset('single');
    }
    sim.strings.forEach((s, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      const ev = exciteString(sim, s, 0.35 + ((i * 0.17) % 0.32), dir * 680, 0.72, configRef.current, w);
      audioRef.current?.triggerPluck(ev, configRef.current.reverb);
    });
    setStats((prev) => ({
      ...prev,
      stringCount: sim.strings.length,
      totalPlucks: sim.totalPlucks,
    }));
  }, []);

  const handleConfigChange = useCallback((patch: Partial<SimConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleToggleAudio = useCallback(async () => {
    if (!audioRef.current) {
      audioRef.current = createElectricAudio();
    }
    try {
      const next = await audioRef.current.toggle();
      setAudioEnabled(next);
      showToast(next ? 'Electric harp audio on' : 'Audio muted', 2000);
    } catch {
      showToast('Web Audio unavailable in this browser');
    }
  }, [showToast]);

  const handleToggleHands = useCallback(async () => {
    if (!trackerRef.current) {
      trackerRef.current = createHandTracker();
    }
    const tracker = trackerRef.current;
    if (handsActive) {
      tracker.stop();
      twoHandPinchRef.current = null;
      heldAnchorHandRef.current = null;
      setHandsActive(false);
      setHandsCount(0);
      showToast('Webcam hand tracking off', 2000);
      return;
    }

    setHandsLoading(true);
    showToast('Starting webcam & hand model…', 4500);
    try {
      await tracker.start();
      setHandsActive(true);
      showToast('Webcam ready · Pinch two hands to draw, finger to shock', 4200);
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission denied · Touch & mouse remain active'
          : err instanceof Error && err.name === 'NotFoundError'
            ? 'No webcam detected · Use touch or mouse to draw & strum'
            : 'Could not start webcam · Touch & mouse remain active';
      showToast(message, 4200);
      setHandsActive(false);
    } finally {
      setHandsLoading(false);
    }
  }, [handsActive, showToast]);

  // Mount initial preset, animation loop, keyboard shortcuts, and pointer handlers once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    audioRef.current = createElectricAudio();
    trackerRef.current = createHandTracker();

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const prevW = width;
      const prevH = height;
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      // Proportionally rescale existing spring-mass chains on viewport resize so they stay framed
      if (prevW > 0 && prevH > 0 && simRef.current.strings.length > 0) {
        rescaleStrings(simRef.current, width / prevW, height / prevH);
      }
    };

    resize();
    // Seed initial glowing electric line right in the sweet spot like the screenshots
    applyPreset(simRef.current, 'single', width, height, paletteRef.current);
    setStats({ stringCount: simRef.current.strings.length, fps: 60, totalPlucks: simRef.current.totalPlucks });

    window.addEventListener('resize', resize);

    const onKeyDown = (e: KeyboardEvent) => {
      if (activeSceneRef.current !== 'arc') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'd' || e.key === 'D') {
        setMode((m) => (m === 'draw' ? 'strum' : 'draw'));
      } else if (e.key === 'c' || e.key === 'C') {
        clearStrings(simRef.current);
        setActivePreset(null);
      } else if (e.key === ' ') {
        e.preventDefault();
        const sim = simRef.current;
        sim.strings.forEach((s, i) => {
          const ev = exciteString(sim, s, 0.5, (i % 2 === 0 ? 1 : -1) * 650, 0.7, configRef.current, width);
          audioRef.current?.triggerPluck(ev, configRef.current.reverb);
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Frame loop
    let rafId = 0;
    let lastMs = performance.now();
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let lastStatsSyncMs = lastMs;
    let lastHandCountSync = 0;

    const tick = (nowMs: number) => {
      rafId = window.requestAnimationFrame(tick);
      if (activeSceneRef.current !== 'arc') {
        lastMs = nowMs;
        lastStatsSyncMs = nowMs;
        fpsAccumulator = 0;
        fpsFrames = 0;
        return;
      }
      const dt = Math.min(0.033, Math.max(0.001, (nowMs - lastMs) / 1000));
      lastMs = nowMs;

      fpsAccumulator += dt;
      fpsFrames += 1;

      const sim = simRef.current;
      const cfg = configRef.current;
      const sweptTouches: SweptTouch[] = [];

      // 1. Collect active mouse & multi-touch swept motions (when not actively drawing or dragging an anchor)
      for (const [pid, ptr] of pointersRef.current.entries()) {
        if (drawGestureRef.current?.pointerId === pid || anchorDragRef.current?.pointerId === pid) {
          ptr.prevX = ptr.x;
          ptr.prevY = ptr.y;
          continue;
        }
        const dx = ptr.x - ptr.prevX;
        const dy = ptr.y - ptr.prevY;
        const moveDt = Math.max(0.008, dt);
        sweptTouches.push({
          id: `ptr-${pid}`,
          prevX: ptr.prevX,
          prevY: ptr.prevY,
          x: ptr.x,
          y: ptr.y,
          vx: dx / moveDt,
          vy: dy / moveDt,
          down: ptr.down,
          radius: ptr.down ? 26 : 18,
        });
        ptr.prevX = ptr.x;
        ptr.prevY = ptr.y;
      }

      // 2. Poll MediaPipe webcam hand tracker & run two-hand pinch-to-draw + fingertip plucking
      const handSnap = trackerRef.current
        ? trackerRef.current.update(width, height, dt)
        : { active: false, loading: false, hands: [], video: null };

      if (handSnap.hands.length !== lastHandCountSync) {
        lastHandCountSync = handSnap.hands.length;
        setHandsCount(handSnap.hands.length);
      }

      const hands = handSnap.hands;

      if (hands.length >= 2) {
        const h0 = hands[0];
        const h1 = hands[1];

        if (h0.isPinched && h1.isPinched) {
          // Two-hand pinch & pull creates a dashed charging line between both pinched nodes (IMG_2038)
          if (!twoHandPinchRef.current) {
            twoHandPinchRef.current = {
              active: true,
              start: { x: h0.pinchX, y: h0.pinchY },
              end: { x: h1.pinchX, y: h1.pinchY },
              palette: resolvePaletteForNewString(sim, paletteRef.current),
            };
          } else {
            twoHandPinchRef.current.start = { x: h0.pinchX, y: h0.pinchY };
            twoHandPinchRef.current.end = { x: h1.pinchX, y: h1.pinchY };
          }
          heldAnchorHandRef.current = null;
        } else if (twoHandPinchRef.current) {
          // Releasing either pinch anchors the stretched electric line live in mid-air!
          const created = createElectricString(
            sim,
            twoHandPinchRef.current.start,
            twoHandPinchRef.current.end,
            twoHandPinchRef.current.palette,
            { initialEnergy: 0.9 }
          );
          if (created) {
            setActivePreset(null);
            audioRef.current?.triggerAnchorSnap(
              ((created.start.x + created.end.x) * 0.5 / Math.max(1, width)) * 2 - 1
            );
            // If one hand is STILL pinched, keep holding that endpoint so the other hand can pluck it (IMG_2041!)
            if (h0.isPinched && !h1.isPinched) {
              heldAnchorHandRef.current = { handIndex: 0, stringId: created.id, end: 'start' };
            } else if (h1.isPinched && !h0.isPinched) {
              heldAnchorHandRef.current = { handIndex: 1, stringId: created.id, end: 'end' };
            }
          }
          twoHandPinchRef.current = null;
        }
      } else if (twoHandPinchRef.current) {
        // One hand exited frame while pinching -> finalize line if long enough
        const created = createElectricString(
          sim,
          twoHandPinchRef.current.start,
          twoHandPinchRef.current.end,
          twoHandPinchRef.current.palette,
          { initialEnergy: 0.85 }
        );
        if (created) {
          setActivePreset(null);
          audioRef.current?.triggerAnchorSnap(
            ((created.start.x + created.end.x) * 0.5 / Math.max(1, width)) * 2 - 1
          );
        }
        twoHandPinchRef.current = null;
      }

      // Single-hand pinch can hold & tilt an existing string anchor while the other hand plucks it!
      if (!twoHandPinchRef.current) {
        if (heldAnchorHandRef.current) {
          const held = heldAnchorHandRef.current;
          const hand = hands[held.handIndex];
          const str = sim.strings.find((s) => s.id === held.stringId);
          if (hand && hand.isPinched && str) {
            if (held.end === 'start') {
              str.start.x = hand.pinchX;
              str.start.y = hand.pinchY;
            } else {
              str.end.x = hand.pinchX;
              str.end.y = hand.pinchY;
            }
            str.anchorFlash = Math.max(str.anchorFlash, 0.45);
          } else {
            heldAnchorHandRef.current = null;
          }
        } else {
          // Check if a pinched hand grabbed near any existing anchor endpoint
          for (let hi = 0; hi < hands.length; hi++) {
            const h = hands[hi];
            if (!h.isPinched) continue;
            const near = findNearestAnchor(sim, h.pinchX, h.pinchY, 54);
            if (near) {
              heldAnchorHandRef.current = { handIndex: hi, stringId: near.stringId, end: near.end };
              break;
            }
          }
        }
      }

      // Convert non-pinched extended fingertips into swept touches that shock & pluck strings
      for (let hi = 0; hi < hands.length; hi++) {
        const h = hands[hi];
        if (h.isPinched) continue;
        for (const finger of h.fingers) {
          if (!finger.extended) continue;
          const prevX = finger.x - finger.vx * dt;
          const prevY = finger.y - finger.vy * dt;
          sweptTouches.push({
            id: `hand-${hi}-${finger.tipIndex}`,
            prevX,
            prevY,
            x: finger.x,
            y: finger.y,
            vx: finger.vx,
            vy: finger.vy,
            radius: finger.tipIndex === 8 ? 24 : 18,
          });
        }
      }

      // 3. Evaluate swept interactions -> plucks, corona arcs, audio
      const plucks = interactTouchesWithStrings(sim, sweptTouches, cfg, width);
      if (plucks.length > 0 && audioRef.current) {
        for (const ev of plucks) {
          audioRef.current.triggerPluck(ev, cfg.reverb);
        }
      }

      // 4. Advance 2D coupled spring-mass simulation + proximity resonance + sparks
      stepSimulation(sim, dt, cfg, width);

      if (audioRef.current?.enabled) {
        let sumE = 0;
        for (const s of sim.strings) sumE += s.energy;
        audioRef.current.updateAmbientEnergy(sumE, sim.proximityResonance);
      }

      // 5. Build preview line (either pointer draw or two-hand pinch)
      let previewLine: PreviewLine | null = null;
      if (twoHandPinchRef.current) {
        previewLine = {
          start: twoHandPinchRef.current.start,
          end: twoHandPinchRef.current.end,
          palette: twoHandPinchRef.current.palette,
          source: 'hands',
        };
      } else if (drawGestureRef.current) {
        previewLine = {
          start: drawGestureRef.current.start,
          end: drawGestureRef.current.end,
          palette: drawGestureRef.current.palette,
          source: 'pointer',
        };
      }

      // 6. Render frame
      renderElectricScene(ctx, sim, {
        width,
        height,
        dpr,
        config: cfg,
        activePalette: paletteRef.current,
        previewLine,
        hands,
        video: handSnap.video,
        showCameraBackdrop: showCameraRef.current && handSnap.active,
        skeletonStyle: skeletonStyleRef.current,
        cursor: cursorVisualRef.current,
        humIntensity: sim.proximityResonance.intensity,
      });

      // 7. Throttled HUD telemetry sync (~4Hz)
      if (nowMs - lastStatsSyncMs > 260) {
        const measuredFps = fpsAccumulator > 0 ? Math.round(fpsFrames / fpsAccumulator) : 60;
        fpsAccumulator = 0;
        fpsFrames = 0;
        lastStatsSyncMs = nowMs;
        setStats({
          stringCount: sim.strings.length,
          fps: Math.min(120, Math.max(1, measuredFps)),
          totalPlucks: sim.totalPlucks,
        });
        setHumIntensity(Number(sim.proximityResonance.intensity.toFixed(2)));
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      audioRef.current?.dispose();
      trackerRef.current?.dispose();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Pointer & Multi-Touch Handlers on the full-viewport canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer events without an active pointer
    }

    pointersRef.current.set(e.pointerId, {
      prevX: x,
      prevY: y,
      x,
      y,
      down: true,
      lastTime: performance.now(),
    });

    cursorVisualRef.current = { x, y, active: true, mode: modeRef.current };

    if (modeRef.current === 'draw' || e.shiftKey) {
      // Begin stretching a new electric line
      const previewPalette = resolvePaletteForNewString(simRef.current, paletteRef.current);
      drawGestureRef.current = {
        pointerId: e.pointerId,
        start: { x, y },
        end: { x, y },
        palette: previewPalette,
      };
      return;
    }

    // In Strum mode: check if user grabbed an anchor endpoint to reposition/stretch an existing line
    const anchorHit = findNearestAnchor(simRef.current, x, y, 28);
    if (anchorHit) {
      anchorDragRef.current = {
        pointerId: e.pointerId,
        stringId: anchorHit.stringId,
        end: anchorHit.end,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const existing = pointersRef.current.get(e.pointerId);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.lastTime = performance.now();
    } else if (e.pointerType === 'mouse') {
      // Allow effortless hover strumming on desktop mouse
      pointersRef.current.set(e.pointerId, {
        prevX: x,
        prevY: y,
        x,
        y,
        down: false,
        lastTime: performance.now(),
      });
    }

    cursorVisualRef.current = {
      x,
      y,
      active: Boolean(existing?.down),
      mode: modeRef.current,
    };

    if (drawGestureRef.current && drawGestureRef.current.pointerId === e.pointerId) {
      drawGestureRef.current.end = { x, y };
      return;
    }

    if (anchorDragRef.current && anchorDragRef.current.pointerId === e.pointerId) {
      const drag = anchorDragRef.current;
      const target = simRef.current.strings.find((s) => s.id === drag.stringId);
      if (target) {
        if (drag.end === 'start') {
          target.start.x = x;
          target.start.y = y;
        } else {
          target.end.x = x;
          target.end.y = y;
        }
        target.anchorFlash = 0.65;
      }
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawGestureRef.current && drawGestureRef.current.pointerId === e.pointerId) {
      const gesture = drawGestureRef.current;
      drawGestureRef.current = null;
      const created = createElectricString(
        simRef.current,
        gesture.start,
        gesture.end,
        gesture.palette,
        { initialEnergy: 0.85 }
      );
      if (created) {
        setActivePreset(null);
        // Gentle launch vibration so newly anchored lines hum alive immediately
        const ev = exciteString(
          simRef.current,
          created,
          0.5,
          360,
          0.45,
          configRef.current,
          window.innerWidth
        );
        audioRef.current?.triggerPluck(ev, configRef.current.reverb);
        setStats((prev) => ({
          ...prev,
          stringCount: simRef.current.strings.length,
          totalPlucks: simRef.current.totalPlucks,
        }));
      }
    }

    if (anchorDragRef.current && anchorDragRef.current.pointerId === e.pointerId) {
      anchorDragRef.current = null;
    }

    if (e.pointerType === 'mouse') {
      const ptr = pointersRef.current.get(e.pointerId);
      if (ptr) ptr.down = false;
      if (cursorVisualRef.current) cursorVisualRef.current.active = false;
    } else {
      pointersRef.current.delete(e.pointerId);
      cursorVisualRef.current = null;
    }
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && !drawGestureRef.current && !anchorDragRef.current) {
      pointersRef.current.delete(e.pointerId);
      cursorVisualRef.current = null;
    }
  };

  const currentSceneMeta = getSceneById(activeScene);
  const isArcScene = activeScene === 'arc';

  return (
    <main
      className="relative w-full h-full overflow-hidden select-none"
      data-testid="arc-string-stage"
      data-scene={activeScene}
      data-mode={mode}
      data-palette={palette}
      data-string-count={stats.stringCount}
      data-plucks={stats.totalPlucks}
      data-hum-intensity={humIntensity}
      data-hands={handsActive ? 'on' : 'off'}
    >
      <canvas
        ref={canvasRef}
        data-testid="electric-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerLeave={handlePointerLeave}
        className={`fixed inset-0 w-full h-full block touch-none ${
          mode === 'draw' ? 'cursor-crosshair' : 'cursor-pointer'
        } ${isArcScene ? '' : 'opacity-0 pointer-events-none'}`}
        aria-label="Interactive electric arc string stage"
      />

      {isArcScene ? (
        <HudOverlay
          activeScene={activeScene}
          onSelectScene={handleSelectScene}
          mode={mode}
          onModeChange={setMode}
          controlsOpen={controlsOpen}
          onToggleControls={() => setControlsOpen((v) => !v)}
          palette={palette}
          onPaletteChange={handlePaletteChange}
          activePreset={activePreset}
          onApplyPreset={handleApplyPreset}
          onClearStrings={handleClearStrings}
          onPulseAll={handlePulseAll}
          config={config}
          onConfigChange={handleConfigChange}
          handsActive={handsActive}
          handsLoading={handsLoading}
          handsCount={handsCount}
          onToggleHands={handleToggleHands}
          showCameraBackdrop={showCameraBackdrop}
          onToggleCameraBackdrop={() => setShowCameraBackdrop((v) => !v)}
          skeletonStyle={skeletonStyle}
          onSkeletonStyleChange={setSkeletonStyle}
          audioEnabled={audioEnabled}
          onToggleAudio={handleToggleAudio}
          toastMessage={toastMessage}
          stats={stats}
        />
      ) : (
        <>
          <iframe
            ref={remoteIframeRef}
            key="low-cortisol-host"
            title={`${currentSceneMeta.name} — Low Cortisol`}
            src={buildEmbeddedSceneUrl(
              initialRemoteDemoRef.current ?? currentSceneMeta.liveDemoParam ?? 'moss',
              window.location.search
            )}
            onLoad={() => {
              const targetDemo = currentSceneMeta.liveDemoParam ?? 'moss';
              if (targetDemo !== initialRemoteDemoRef.current) {
                remoteIframeRef.current?.contentWindow?.postMessage(
                  { type: 'lc:select-scene', scene: targetDemo },
                  window.location.origin
                );
              }
            }}
            className="fixed inset-0 w-full h-full border-0 bg-black"
            allow="camera; microphone; autoplay"
          />
          <aside
            aria-label="Scene navigation"
            className="fixed top-4 left-4 z-30 flex flex-col items-start gap-2 max-w-[calc(100vw-32px)] pointer-events-none"
          >
            <div className="lc-glass pointer-events-auto flex items-center gap-1 p-1 rounded-xl overflow-visible">
              <ScenePicker
                activeScene={activeScene}
                onSelectScene={handleSelectScene}
                align="left"
              />
              <div className="w-px h-4 bg-[var(--glass-border)] mx-0.5 shrink-0" aria-hidden="true" />
              <button
                type="button"
                onClick={handleToggleRemoteControls}
                aria-expanded={remoteControlsOpen}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  remoteControlsOpen
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Controls</span>
              </button>
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
