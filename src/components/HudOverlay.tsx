import { Hand, SlidersHorizontal, Sparkles, Trash2, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import type { ElectricPaletteId, SimConfig, StringPresetId } from '../physics/electricString';
import type { CameraViewMode, SkeletonStyle } from '../renderer/canvasRenderer';
import type { LowCortisolSceneId } from './sceneCatalog';
import { ScenePicker } from './ScenePicker';

export type InteractionMode = 'strum' | 'draw';

export interface HudStats {
  stringCount: number;
  fps: number;
  totalPlucks: number;
}

export interface HudOverlayProps {
  activeScene: LowCortisolSceneId;
  onSelectScene: (scene: LowCortisolSceneId) => void;
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
  palette: ElectricPaletteId;
  onPaletteChange: (palette: ElectricPaletteId) => void;
  activePreset: StringPresetId | null;
  onApplyPreset: (preset: StringPresetId) => void;
  onClearStrings: () => void;
  onPulseAll: () => void;
  config: SimConfig;
  onConfigChange: (patch: Partial<SimConfig>) => void;
  handsActive: boolean;
  handsLoading: boolean;
  handsCount: number;
  onToggleHands: () => void;
  cameraViewMode: CameraViewMode;
  onCameraViewModeChange: (mode: CameraViewMode) => void;
  onCycleCameraViewMode: () => void;
  skeletonStyle: SkeletonStyle;
  onSkeletonStyleChange: (style: SkeletonStyle) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  toastMessage: string | null;
  stats: HudStats;
}

const PALETTE_OPTIONS: ReadonlyArray<{ id: ElectricPaletteId; label: string }> = [
  { id: 'lime', label: 'Lime' },
  { id: 'violet', label: 'Violet' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'amber', label: 'Amber' },
  { id: 'spectrum', label: 'Mix' },
];

const PRESET_OPTIONS: ReadonlyArray<{ id: StringPresetId; label: string }> = [
  { id: 'single', label: 'Single' },
  { id: 'duo', label: 'Duo' },
  { id: 'harp', label: 'Harp' },
  { id: 'prism', label: 'Prism' },
];

const CAMERA_VIEW_OPTIONS: ReadonlyArray<{ id: CameraViewMode; label: string }> = [
  { id: 'full', label: 'Full View' },
  { id: 'dim', label: '50%' },
  { id: 'off', label: 'Off' },
];

export function HudOverlay({
  activeScene,
  onSelectScene,
  mode,
  onModeChange,
  controlsOpen,
  onToggleControls,
  palette,
  onPaletteChange,
  activePreset,
  onApplyPreset,
  onClearStrings,
  onPulseAll,
  config,
  onConfigChange,
  handsActive,
  handsLoading,
  handsCount,
  onToggleHands,
  cameraViewMode,
  onCameraViewModeChange,
  onCycleCameraViewMode,
  skeletonStyle,
  onSkeletonStyleChange,
  audioEnabled,
  onToggleAudio,
  toastMessage,
  stats,
}: HudOverlayProps) {
  const hintText = handsActive
    ? handsCount >= 2
      ? 'Pinch both hands to stretch a line · Swipe index finger across any line to reverberate'
      : 'Show both hands to pinch-draw a line · Point index finger through any line to shock it'
    : mode === 'draw'
      ? 'Drag anywhere to stretch a new electric line · Release to anchor it in space'
      : 'Swipe across any electric line to shock & reverberate · Drag an anchor node to stretch';

  const mobileHintText = handsActive
    ? 'Pinch two hands to draw · Finger to pluck'
    : mode === 'draw'
      ? 'Drag to draw a new electric line'
      : 'Swipe across lines to shock & pluck';

  return (
    <>
      {/* Top-Left Low-Cortisol Glass HUD */}
      <aside
        className="fixed top-4 left-4 z-20 flex flex-col items-start gap-2 max-w-[calc(100vw-32px)] sm:max-w-[calc(100vw-150px)] pointer-events-none"
        aria-label="Scene controls"
      >
        <div className="lc-glass pointer-events-auto flex items-center gap-1 p-1 rounded-xl overflow-visible">
          <ScenePicker activeScene={activeScene} onSelectScene={onSelectScene} align="left" />
          <div className="w-px h-4 bg-[var(--glass-border)] mx-0.5 shrink-0" aria-hidden="true" />

          <button
            type="button"
            onClick={() => onModeChange('strum')}
            aria-pressed={mode === 'strum'}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'strum'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5'
            }`}
          >
            Strum
          </button>

          <button
            type="button"
            onClick={() => onModeChange('draw')}
            aria-pressed={mode === 'draw'}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'draw'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5'
            }`}
          >
            Draw
          </button>

          <div className="w-px h-4 bg-[var(--glass-border)] mx-0.5 shrink-0" aria-hidden="true" />

          <button
            type="button"
            onClick={onToggleControls}
            aria-expanded={controlsOpen}
            aria-controls="arc-controls-panel"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              controlsOpen
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Controls</span>
          </button>
        </div>

        {/* Collapsible Low-Cortisol Controls Drawer */}
        {controlsOpen && (
          <section
            id="arc-controls-panel"
            className="lc-glass pointer-events-auto w-[min(308px,calc(100vw-32px))] p-3.5 rounded-xl flex flex-col gap-3 text-xs max-h-[calc(100vh-110px)] overflow-y-auto"
            aria-label="Electric string parameters"
          >
            {/* Electric Palette */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[var(--muted)]">
                <strong className="font-medium text-[var(--text)]">Electric Color</strong>
              </div>
              <div className="grid grid-cols-5 gap-1 p-1 rounded-lg bg-black/35">
                {PALETTE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onPaletteChange(opt.id)}
                    aria-pressed={palette === opt.id}
                    className={`py-1.5 px-1 text-[11px] rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      palette === opt.id
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* String Presets */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[var(--muted)]">
                <strong className="font-medium text-[var(--text)]">Layout Preset</strong>
              </div>
              <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-black/35">
                {PRESET_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onApplyPreset(opt.id)}
                    aria-pressed={activePreset === opt.id}
                    className={`py-1.5 px-1 text-[11px] rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      activePreset === opt.id
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Physics Sliders */}
            <div className="flex flex-col gap-2.5 pt-1 border-t border-[var(--glass-border)]">
              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[var(--muted)]">
                  <strong className="font-medium text-[var(--text)]">String Tension</strong>
                  <span className="font-mono-nums">{config.tension.toFixed(2)}x</span>
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={2.0}
                  step={0.05}
                  value={config.tension}
                  onChange={(e) => onConfigChange({ tension: parseFloat(e.target.value) })}
                  className="lc-range"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[var(--muted)]">
                  <strong className="font-medium text-[var(--text)]">Reverb Sustain</strong>
                  <span className="font-mono-nums">{config.reverb.toFixed(2)}x</span>
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={2.0}
                  step={0.05}
                  value={config.reverb}
                  onChange={(e) => onConfigChange({ reverb: parseFloat(e.target.value) })}
                  className="lc-range"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[var(--muted)]">
                  <strong className="font-medium text-[var(--text)]">Spark Shower</strong>
                  <span className="font-mono-nums">{config.sparkIntensity.toFixed(2)}x</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2.0}
                  step={0.05}
                  value={config.sparkIntensity}
                  onChange={(e) => onConfigChange({ sparkIntensity: parseFloat(e.target.value) })}
                  className="lc-range"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[var(--muted)]">
                  <strong className="font-medium text-[var(--text)]">Arc Voltage</strong>
                  <span className="font-mono-nums">{config.voltage.toFixed(2)}x</span>
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={2.0}
                  step={0.05}
                  value={config.voltage}
                  onChange={(e) => onConfigChange({ voltage: parseFloat(e.target.value) })}
                  className="lc-range"
                />
              </label>
            </div>

            {/* Hand Skeleton & Self-View Camera */}
            <div className="flex flex-col gap-2 pt-1 border-t border-[var(--glass-border)]">
              <div className="flex items-center justify-between text-[var(--muted)]">
                <strong className="font-medium text-[var(--text)]">Hand Overlay</strong>
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black/35">
                <button
                  type="button"
                  onClick={() => onSkeletonStyleChange('tracker')}
                  aria-pressed={skeletonStyle === 'tracker'}
                  className={`py-1.5 px-2 text-[11px] rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    skeletonStyle === 'tracker'
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Tracker Rig
                </button>
                <button
                  type="button"
                  onClick={() => onSkeletonStyleChange('gossamer')}
                  aria-pressed={skeletonStyle === 'gossamer'}
                  className={`py-1.5 px-2 text-[11px] rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    skeletonStyle === 'gossamer'
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Gossamer
                </button>
              </div>
              <div className="flex items-center justify-between text-[var(--muted)] pt-0.5">
                <strong className="font-medium text-[var(--text)]">Camera View</strong>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/35">
                {CAMERA_VIEW_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onCameraViewModeChange(opt.id)}
                    aria-pressed={cameraViewMode === opt.id}
                    className={`py-1.5 px-1.5 text-[11px] rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      cameraViewMode === opt.id
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Row */}
            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                onClick={onPulseAll}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[var(--glass-border)] bg-white/5 hover:bg-[var(--accent-hover)] hover:border-[var(--accent-border)] text-[var(--text)] font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Strum All</span>
              </button>
              <button
                type="button"
                onClick={onClearStrings}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-[var(--glass-border)] bg-white/5 hover:bg-red-500/15 hover:border-red-400/40 text-[var(--text)] font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            </div>

            {/* Quiet Unboxed Telemetry Footer (low-cortisol style) */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border)] text-[11px] text-[var(--muted)] font-mono-nums">
              <span>{stats.stringCount} {stats.stringCount === 1 ? 'line' : 'lines'}</span>
              <span aria-hidden="true">·</span>
              <span>{stats.totalPlucks} plucks</span>
              <span aria-hidden="true">·</span>
              <span>{stats.fps > 0 ? `${stats.fps} fps` : '-- fps'}</span>
            </div>
          </section>
        )}
      </aside>

      {/* Top-Right Sensory Dock (Webcam Hands, Video Backdrop, Ambient Audio) */}
      <div
        className="fixed top-[66px] sm:top-4 right-4 z-10 sm:z-20 flex items-center gap-2 pointer-events-none"
        aria-label="Webcam and audio controls"
      >
        {handsActive && (
          <button
            type="button"
            onClick={onCycleCameraViewMode}
            data-camera-mode={cameraViewMode}
            aria-pressed={cameraViewMode !== 'off'}
            aria-label={
              cameraViewMode === 'full'
                ? 'Camera view: Full View (click for 50% opacity)'
                : cameraViewMode === 'dim'
                  ? 'Camera view: 50% Opacity (click for Off)'
                  : 'Camera view: Off (click for Full View)'
            }
            title={
              cameraViewMode === 'full'
                ? 'Camera: Full View (click for 50% opacity)'
                : cameraViewMode === 'dim'
                  ? 'Camera: 50% Opacity (click for Off)'
                  : 'Camera: Off (click for Full View)'
            }
            className={`lc-glass relative pointer-events-auto w-11 h-11 sm:w-10 sm:h-10 rounded-full inline-flex items-center justify-center transition-all cursor-pointer ${
              cameraViewMode === 'full'
                ? 'bg-[var(--accent-soft)]! border-[var(--accent-border)]! text-[var(--accent)]'
                : cameraViewMode === 'dim'
                  ? 'bg-[var(--accent-soft)]! border-[var(--accent-border)]! text-[var(--accent)] opacity-80'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {cameraViewMode === 'off' ? (
              <VideoOff className="w-[18px] h-[18px]" aria-hidden="true" />
            ) : (
              <Video className="w-[18px] h-[18px]" aria-hidden="true" />
            )}
            <span
              className="absolute bottom-[4px] left-1/2 -translate-x-1/2 flex gap-[3px] pointer-events-none"
              aria-hidden="true"
            >
              <span
                className={`w-[3.5px] h-[3.5px] rounded-full bg-current transition-opacity ${
                  cameraViewMode === 'off' ? 'opacity-25' : 'opacity-95'
                }`}
              />
              <span
                className={`w-[3.5px] h-[3.5px] rounded-full bg-current transition-opacity ${
                  cameraViewMode === 'full' ? 'opacity-95' : 'opacity-25'
                }`}
              />
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleHands}
          disabled={handsLoading}
          aria-pressed={handsActive}
          aria-label={handsActive ? 'Turn off webcam hand tracking' : 'Enable webcam hand tracking'}
          title={handsActive ? 'Webcam Hand Tracking (On)' : 'Enable Webcam Hand Tracking'}
          className={`lc-glass pointer-events-auto w-11 h-11 sm:w-10 sm:h-10 rounded-full inline-flex items-center justify-center transition-all cursor-pointer ${
            handsActive
              ? 'bg-[var(--accent)]! border-[var(--accent)]! text-[var(--accent-ink)]'
              : 'text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-border)]'
          } ${handsLoading ? 'opacity-60' : ''}`}
        >
          <Hand className="w-[18px] h-[18px]" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onToggleAudio}
          aria-pressed={audioEnabled}
          aria-label={audioEnabled ? 'Mute electric harp audio' : 'Enable electric harp audio'}
          title={audioEnabled ? 'Electric Harp Audio (On)' : 'Electric Harp Audio (Muted)'}
          className={`lc-glass pointer-events-auto w-11 h-11 sm:w-10 sm:h-10 rounded-full inline-flex items-center justify-center transition-all cursor-pointer ${
            audioEnabled
              ? 'bg-[var(--accent)]! border-[var(--accent)]! text-[var(--accent-ink)]'
              : 'text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-border)]'
          }`}
        >
          {audioEnabled ? (
            <Volume2 className="w-[18px] h-[18px]" aria-hidden="true" />
          ) : (
            <VolumeX className="w-[18px] h-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Transient Status Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="lc-glass fixed top-[120px] sm:top-16 right-4 z-20 px-3.5 py-2 rounded-lg text-xs text-[var(--text)] max-w-[280px] pointer-events-none"
        >
          {toastMessage}
        </div>
      )}

      {/* Calm Bottom Interaction Hint */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none max-w-[calc(100vw-32px)]">
        <p className="lc-glass m-0 px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs text-[var(--muted)] text-center whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="hidden sm:inline">{hintText}</span>
          <span className="sm:hidden">{mobileHintText}</span>
        </p>
      </div>
    </>
  );
}
