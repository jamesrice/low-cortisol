import type { PluckEvent, ProximityResonanceState } from '../physics/electricString';

export interface ElectricAudioController {
  readonly enabled: boolean;
  setEnabled(next: boolean): Promise<boolean>;
  toggle(): Promise<boolean>;
  triggerPluck(ev: PluckEvent, reverbScale: number): void;
  triggerAnchorSnap(pan?: number): void;
  updateAmbientEnergy(totalEnergy: number, resonance?: ProximityResonanceState): void;
  dispose(): void;
}

export function createElectricAudio(): ElectricAudioController {
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let delayNode: DelayNode | null = null;
  let delayFeedback: GainNode | null = null;
  let delayFilter: BiquadFilterNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let droneOscA: OscillatorNode | null = null;
  let droneOscB: OscillatorNode | null = null;
  let droneGain: GainNode | null = null;
  // Faint dissonant proximity hum layer (minor-2nd beating pair + ghostly tritone shadow)
  let humOscA: OscillatorNode | null = null;
  let humOscB: OscillatorNode | null = null;
  let humOscTritone: OscillatorNode | null = null;
  let humFilter: BiquadFilterNode | null = null;
  let humPanner: StereoPannerNode | null = null;
  let humGain: GainNode | null = null;
  let suspendTimer: number | null = null;
  let enabled = false;

  function ensureContext(): boolean {
    if (ctx && masterGain) return true;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    ctx = new AudioCtx({ latencyHint: 'interactive' });
    masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    // Gentle soft-clipping / warm bus filter so layered electric plucks stay calm and low-cortisol
    const busFilter = ctx.createBiquadFilter();
    busFilter.type = 'lowpass';
    busFilter.frequency.value = 6400;
    busFilter.Q.value = 0.7;

    // Lush stereo feedback echo for harmonic reverberation
    delayNode = ctx.createDelay(1.2);
    delayNode.delayTime.value = 0.24;

    delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.34;

    delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 2600;

    masterGain.connect(busFilter);
    busFilter.connect(ctx.destination);

    // Wet feedback loop
    busFilter.connect(delayNode);
    delayNode.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayFilter.connect(ctx.destination);

    // Pre-generate 1.5s white noise buffer for electrostatic spark crackle bursts
    const sampleRate = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, Math.floor(sampleRate * 1.5), sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Sparse crackle impulses + soft air hiss
      const r = Math.random();
      data[i] = r > 0.96 ? (Math.random() * 2 - 1) * 1.0 : (Math.random() * 2 - 1) * 0.22;
    }

    // Whisper-soft low-cortisol ambient field bed (warm fifth drone at C2 + G2)
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.018;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 220;

    droneOscA = ctx.createOscillator();
    droneOscA.type = 'sine';
    droneOscA.frequency.value = 65.41; // C2

    droneOscB = ctx.createOscillator();
    droneOscB.type = 'triangle';
    droneOscB.frequency.value = 98.0; // G2

    droneOscA.connect(droneFilter);
    droneOscB.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(masterGain);

    droneOscA.start();
    droneOscB.start();

    // Faint dissonant proximity hum synthesizer (silent until nearby strings vibrate together)
    humGain = ctx.createGain();
    humGain.gain.value = 0.0001;

    humPanner = ctx.createStereoPanner();
    humPanner.pan.value = 0;

    humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 340;
    humFilter.Q.value = 2.1;

    humOscA = ctx.createOscillator();
    humOscA.type = 'sawtooth';
    humOscA.frequency.value = 110;

    humOscB = ctx.createOscillator();
    humOscB.type = 'triangle';
    humOscB.frequency.value = 116.54; // Minor second tension (~semitone beating)

    humOscTritone = ctx.createOscillator();
    humOscTritone.type = 'sine';
    humOscTritone.frequency.value = 155.56; // Faint tritone shadow (sqrt(2))

    const humOscAGain = ctx.createGain();
    humOscAGain.gain.value = 0.36;
    const humOscBGain = ctx.createGain();
    humOscBGain.gain.value = 0.42;
    const humTritoneGain = ctx.createGain();
    humTritoneGain.gain.value = 0.24;

    humOscA.connect(humOscAGain);
    humOscB.connect(humOscBGain);
    humOscTritone.connect(humTritoneGain);
    humOscAGain.connect(humFilter);
    humOscBGain.connect(humFilter);
    humTritoneGain.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(humPanner);
    humPanner.connect(masterGain);

    humOscA.start();
    humOscB.start();
    humOscTritone.start();

    return true;
  }

  async function setEnabled(next: boolean): Promise<boolean> {
    enabled = Boolean(next);
    if (suspendTimer !== null) {
      window.clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    if (enabled) {
      if (!ensureContext() || !ctx || !masterGain) {
        enabled = false;
        return false;
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(0.68, now, 0.08);
    } else if (ctx && masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(0, now, 0.06);
      const audioCtx = ctx;
      suspendTimer = window.setTimeout(() => {
        suspendTimer = null;
        if (!enabled && audioCtx.state === 'running') {
          audioCtx.suspend().catch(() => {});
        }
      }, 240);
    }
    return enabled;
  }

  function triggerPluck(ev: PluckEvent, reverbScale: number): void {
    if (!enabled || !ctx || !masterGain || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const decay = Math.max(0.45, Math.min(2.8, 1.15 * reverbScale));
    const amp = 0.12 + ev.strength * 0.16;

    // Stereo panning following finger contact X
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, ev.pan)), now);
    panner.connect(masterGain);

    // 1. Resonant harmonic string body (fundamental + crystalline 2nd & 3rd overtone modulated by pluck position)
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(amp, now + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0008, now + decay);

    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(1600 + ev.strength * 3200, now);
    toneFilter.frequency.exponentialRampToValueAtTime(420 + ev.frequencyHz * 1.4, now + decay * 0.85);
    toneFilter.Q.value = 2.4;

    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    // Slight subtle pitch bend down on impact like a taut vibrating electric wire
    osc1.frequency.setValueAtTime(ev.frequencyHz * (1 + 0.018 * ev.strength), now);
    osc1.frequency.exponentialRampToValueAtTime(ev.frequencyHz, now + 0.09);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    // Plucking closer to an anchor brings out brighter octave/fifth shimmer
    const edgeFactor = Math.abs(ev.t - 0.5) * 2;
    osc2.frequency.setValueAtTime(ev.frequencyHz * (edgeFactor > 0.45 ? 3 : 2), now);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.26 + edgeFactor * 0.25, now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.01, now + decay * 0.55);

    osc1.connect(toneFilter);
    osc2.connect(osc2Gain);
    osc2Gain.connect(toneFilter);
    toneFilter.connect(bodyGain);
    bodyGain.connect(panner);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + decay + 0.05);
    osc2.stop(now + decay + 0.05);

    // 2. Crisp electrostatic spark burst (short band-passed crackle)
    if (noiseBuffer) {
      const sparkSrc = ctx.createBufferSource();
      sparkSrc.buffer = noiseBuffer;
      const startOffset = Math.random() * 0.9;

      const sparkFilter = ctx.createBiquadFilter();
      sparkFilter.type = 'bandpass';
      sparkFilter.frequency.setValueAtTime(2800 + ev.strength * 2400, now);
      sparkFilter.Q.value = 1.9;

      const sparkGain = ctx.createGain();
      const crackleAmp = 0.045 + ev.strength * 0.09;
      sparkGain.gain.setValueAtTime(0.0001, now);
      sparkGain.gain.linearRampToValueAtTime(crackleAmp, now + 0.003);
      sparkGain.gain.exponentialRampToValueAtTime(0.0004, now + 0.095 + ev.strength * 0.07);

      sparkSrc.connect(sparkFilter);
      sparkFilter.connect(sparkGain);
      sparkGain.connect(panner);
      sparkSrc.start(now, startOffset, 0.2);
    }

    if (delayFeedback) {
      delayFeedback.gain.setTargetAtTime(Math.min(0.48, 0.22 + reverbScale * 0.14), now, 0.08);
    }
  }

  function triggerAnchorSnap(pan = 0): void {
    if (!enabled || !ctx || !masterGain || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-0.8, Math.min(0.8, pan)), now);
    panner.connect(masterGain);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.09);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.24);

    osc.connect(gain);
    gain.connect(panner);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  function updateAmbientEnergy(totalEnergy: number, resonance?: ProximityResonanceState): void {
    if (!enabled || !ctx || !droneGain || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const clamped = Math.max(0, Math.min(2.5, totalEnergy));
    const target = 0.015 + clamped * 0.022;
    droneGain.gain.setTargetAtTime(target, now, 0.14);

    if (humGain && humOscA && humOscB && humOscTritone && humFilter && humPanner) {
      const humIntensity = resonance ? Math.max(0, Math.min(1, resonance.intensity)) : 0;
      if (humIntensity > 0.004 && resonance) {
        const base = Math.max(60, Math.min(240, resonance.baseFreqHz));
        const dissonantFreq = base * resonance.dissonanceRatio + resonance.beatHz * 0.18;
        const tritoneFreq = base * 1.41421356;

        // Faint, atmospheric presence (max ~0.048 gain) that adds depth without harshness
        const targetHumGain = 0.0001 + Math.pow(humIntensity, 0.85) * 0.048;
        humGain.gain.setTargetAtTime(targetHumGain, now, 0.12);
        humOscA.frequency.setTargetAtTime(base, now, 0.16);
        humOscB.frequency.setTargetAtTime(dissonantFreq, now, 0.16);
        humOscTritone.frequency.setTargetAtTime(tritoneFreq, now, 0.18);
        humFilter.frequency.setTargetAtTime(240 + humIntensity * 340, now, 0.16);
        humPanner.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, resonance.pan)), now, 0.18);
      } else {
        humGain.gain.setTargetAtTime(0.0001, now, 0.24);
      }
    }
  }

  function dispose(): void {
    enabled = false;
    if (suspendTimer !== null) {
      window.clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    try {
      droneOscA?.stop();
      droneOscB?.stop();
      humOscA?.stop();
      humOscB?.stop();
      humOscTritone?.stop();
      ctx?.close();
    } catch {
      // ignore teardown errors
    }
    ctx = null;
    masterGain = null;
    delayNode = null;
    delayFeedback = null;
    delayFilter = null;
    droneOscA = null;
    droneOscB = null;
    droneGain = null;
    humOscA = null;
    humOscB = null;
    humOscTritone = null;
    humFilter = null;
    humPanner = null;
    humGain = null;
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled,
    toggle: () => setEnabled(!enabled),
    triggerPluck,
    triggerAnchorSnap,
    updateAmbientEnergy,
    dispose,
  };
}
