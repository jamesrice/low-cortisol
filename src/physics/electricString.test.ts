import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPreset,
  computeProximityResonance,
  computeStringFrequency,
  createElectricString,
  createSimulationState,
  DEFAULT_SIM_CONFIG,
  exciteString,
  findNearestAnchor,
  interactTouchesWithStrings,
  PROXIMITY_RESONANCE_RADIUS,
  rescaleStrings,
  segmentIntersectionT,
  segmentToSegmentClosest,
  stepSimulation,
} from './electricString';

test('createElectricString builds a pinned 2D spring-mass chain and rejects tiny lines', () => {
  const state = createSimulationState();
  const tooShort = createElectricString(state, { x: 100, y: 100 }, { x: 120, y: 105 }, 'lime');
  assert.equal(tooShort, null);
  assert.equal(state.strings.length, 0);

  const valid = createElectricString(state, { x: 100, y: 300 }, { x: 600, y: 300 }, 'violet');
  assert.ok(valid);
  assert.equal(valid.palette, 'violet');
  assert.equal(state.strings.length, 1);
  assert.equal(valid.invMass[0], 0, 'start anchor mass must be pinned');
  assert.equal(valid.invMass[valid.nodeCount - 1], 0, 'end anchor mass must be pinned');
  assert.equal(valid.invMass[Math.floor(valid.nodeCount / 2)], 1, 'interior mass must be dynamic');
  assert.equal(valid.px[0], 100);
  assert.equal(valid.px[valid.nodeCount - 1], 600);
});

test('spectrum palette cycles across all electric colors', () => {
  const state = createSimulationState();
  const s1 = createElectricString(state, { x: 0, y: 0 }, { x: 200, y: 0 }, 'spectrum');
  const s2 = createElectricString(state, { x: 0, y: 50 }, { x: 200, y: 50 }, 'spectrum');
  const s3 = createElectricString(state, { x: 0, y: 100 }, { x: 200, y: 100 }, 'spectrum');
  const s4 = createElectricString(state, { x: 0, y: 150 }, { x: 200, y: 150 }, 'spectrum');
  assert.deepEqual(
    [s1?.palette, s2?.palette, s3?.palette, s4?.palette],
    ['lime', 'violet', 'cyan', 'amber']
  );
});

test('swept segment intersection detects fast finger crossings accurately', () => {
  const tMid = segmentIntersectionT(300, 100, 300, 500, 100, 300, 500, 300);
  assert.ok(tMid !== null);
  assert.ok(Math.abs(tMid - 0.5) < 1e-6);

  const miss = segmentIntersectionT(300, 100, 300, 200, 100, 300, 500, 300);
  assert.equal(miss, null);
});

test('spring-mass chain vibrates across zero and decays smoothly over time after a pluck', () => {
  const state = createSimulationState();
  const str = createElectricString(state, { x: 200, y: 400 }, { x: 800, y: 400 }, 'lime', {
    initialEnergy: 0,
  });
  assert.ok(str);

  stepSimulation(state, 0.1, DEFAULT_SIM_CONFIG);

  const plucks = interactTouchesWithStrings(
    state,
    [
      {
        id: 'finger-1',
        prevX: 500,
        prevY: 360,
        x: 500,
        y: 440,
        vx: 0,
        vy: 900,
        down: true,
      },
    ],
    DEFAULT_SIM_CONFIG,
    1440
  );

  assert.equal(plucks.length, 1);
  assert.equal(state.totalPlucks, 1);
  assert.ok(state.sparks.length > 5, 'pluck must emit directional sparks');

  const midIdx = Math.floor(str.nodeCount / 2);
  let minU = Infinity;
  let maxU = -Infinity;
  let earlyPeak = 0;
  let latePeak = 0;

  // Simulate 3 seconds (180 frames at 60Hz) and verify oscillation + decay
  for (let frame = 0; frame < 180; frame++) {
    stepSimulation(state, 1 / 60, DEFAULT_SIM_CONFIG);
    const uMid = str.u[midIdx];
    minU = Math.min(minU, uMid);
    maxU = Math.max(maxU, uMid);
    if (frame < 40) earlyPeak = Math.max(earlyPeak, Math.abs(uMid));
    if (frame > 140) latePeak = Math.max(latePeak, Math.abs(uMid));
  }

  assert.ok(maxU > 4 && minU < -4, `expected true bipolar oscillation, got min=${minU}, max=${maxU}`);
  assert.ok(
    latePeak < earlyPeak * 0.45,
    `expected damped decay over time: earlyPeak=${earlyPeak}, latePeak=${latePeak}`
  );
  assert.equal(str.px[0], 200, 'start anchor X must stay pinned');
  assert.equal(str.py[0], 400, 'start anchor Y must stay pinned');
  assert.equal(str.px[str.nodeCount - 1], 800, 'end anchor X must stay pinned');
  assert.equal(str.py[str.nodeCount - 1], 400, 'end anchor Y must stay pinned');
});

test('pressed touch bows the spring-mass chain and snaps into vibration upon release', () => {
  const state = createSimulationState();
  const str = createElectricString(state, { x: 200, y: 400 }, { x: 800, y: 400 }, 'cyan', {
    initialEnergy: 0,
  });
  assert.ok(str);
  stepSimulation(state, 0.1, DEFAULT_SIM_CONFIG);

  // Touch down gently on midpoint -> catches string as a bowstring grab
  interactTouchesWithStrings(
    state,
    [{ id: 'touch-1', prevX: 500, prevY: 400, x: 500, y: 405, vx: 0, vy: 80, down: true }],
    DEFAULT_SIM_CONFIG,
    1440
  );
  assert.ok(str.grab, 'pressed touch on string should catch spring-mass chain');

  // Pull down 45px smoothly
  for (let i = 1; i <= 5; i++) {
    const y = 405 + i * 8;
    interactTouchesWithStrings(
      state,
      [{ id: 'touch-1', prevX: 500, prevY: y - 8, x: 500, y, vx: 0, vy: 120, down: true }],
      DEFAULT_SIM_CONFIG,
      1440
    );
    stepSimulation(state, 1 / 60, DEFAULT_SIM_CONFIG);
  }
  const midIdx = Math.floor(str.nodeCount / 2);
  assert.ok(str.py[midIdx] > 425, `expected spring-mass node to bow downward, got y=${str.py[midIdx]}`);

  // Release finger -> triggers snap pluck
  const releasePlucks = interactTouchesWithStrings(
    state,
    [{ id: 'touch-1', prevX: 500, prevY: 445, x: 500, y: 445, vx: 0, vy: 0, down: false }],
    DEFAULT_SIM_CONFIG,
    1440
  );
  assert.equal(str.grab, null);
  assert.equal(releasePlucks.length, 1, 'releasing bowed spring-mass string must fire a pluck event');
});

test('2D spring-mass solver remains numerically stable over 600 frames at max tension', () => {
  const state = createSimulationState();
  applyPreset(state, 'harp', 1440, 900, 'spectrum');
  assert.equal(state.strings.length, 5);

  const highConfig = { tension: 2.0, reverb: 2.0, sparkIntensity: 2.0, voltage: 2.0 };
  interactTouchesWithStrings(
    state,
    [{ id: 'swipe', prevX: 720, prevY: 100, x: 720, y: 800, vx: 0, vy: 2200, down: true }],
    highConfig,
    1440
  );

  for (let frame = 0; frame < 600; frame++) {
    stepSimulation(state, 1 / 60, highConfig);
  }

  for (const s of state.strings) {
    assert.ok(Number.isFinite(s.energy), 'energy must remain finite');
    for (let i = 0; i < s.nodeCount; i++) {
      assert.ok(Number.isFinite(s.px[i]) && Number.isFinite(s.py[i]), 'node positions must remain finite');
      assert.ok(Number.isFinite(s.vx[i]) && Number.isFinite(s.vy[i]), 'node velocities must remain finite');
    }
  }
});

test('shorter strings produce higher consonant harmonic pitches and rescaleStrings preserves geometry', () => {
  const shortFreq = computeStringFrequency(140, 1440);
  const longFreq = computeStringFrequency(820, 1440);
  assert.ok(shortFreq > longFreq, `expected short (${shortFreq}) > long (${longFreq})`);

  const state = createSimulationState();
  const s = createElectricString(state, { x: 200, y: 300 }, { x: 800, y: 300 }, 'amber');
  assert.ok(s);
  rescaleStrings(state, 0.5, 0.5);
  assert.equal(s.start.x, 100);
  assert.equal(s.end.x, 400);
  assert.equal(s.px[0], 100);
  assert.equal(s.px[s.nodeCount - 1], 400);
});

test('findNearestAnchor locates string endpoints for dragging', () => {
  const state = createSimulationState();
  const s = createElectricString(state, { x: 250, y: 350 }, { x: 750, y: 350 }, 'cyan');
  assert.ok(s);
  const hitStart = findNearestAnchor(state, 255, 348, 20);
  assert.deepEqual(hitStart, { stringId: s.id, end: 'start' });
  const hitEnd = findNearestAnchor(state, 746, 355, 20);
  assert.deepEqual(hitEnd, { stringId: s.id, end: 'end' });
  const miss = findNearestAnchor(state, 500, 350, 20);
  assert.equal(miss, null);
});

test('segmentToSegmentClosest measures parallel and intersecting string distances accurately', () => {
  const parallel = segmentToSegmentClosest(100, 200, 700, 200, 100, 280, 700, 280);
  assert.ok(Math.abs(parallel.dist - 80) < 1e-4, `expected 80px parallel gap, got ${parallel.dist}`);

  const crossing = segmentToSegmentClosest(100, 200, 700, 400, 100, 400, 700, 200);
  assert.equal(crossing.dist, 0, 'crossing strings must have zero separation');
});

test('nearby vibrating strings create a faint dissonant hum, couple sympathetically, and decay cleanly', () => {
  // 1. Far-apart vibrating strings -> zero proximity hum
  const farState = createSimulationState();
  const farA = createElectricString(farState, { x: 200, y: 120 }, { x: 800, y: 120 }, 'lime', { initialEnergy: 0 });
  const farB = createElectricString(farState, { x: 200, y: 120 + PROXIMITY_RESONANCE_RADIUS + 80 }, { x: 800, y: 120 + PROXIMITY_RESONANCE_RADIUS + 80 }, 'cyan', { initialEnergy: 0 });
  assert.ok(farA && farB);
  exciteString(farState, farA, 0.5, 650, 0.8, DEFAULT_SIM_CONFIG, 1440, true);
  exciteString(farState, farB, 0.5, -650, 0.8, DEFAULT_SIM_CONFIG, 1440, true);
  stepSimulation(farState, 1 / 60, DEFAULT_SIM_CONFIG, 1440);
  assert.equal(farState.proximityResonance.intensity, 0, 'far-apart strings must not trigger proximity hum');

  // 2. Nearby strings at rest -> zero proximity hum
  const nearState = createSimulationState();
  const nearA = createElectricString(nearState, { x: 200, y: 360 }, { x: 800, y: 360 }, 'lime', { initialEnergy: 0 });
  const nearB = createElectricString(nearState, { x: 200, y: 425 }, { x: 800, y: 425 }, 'violet', { initialEnergy: 0 });
  assert.ok(nearA && nearB);
  assert.equal(computeProximityResonance(nearState.strings, 1440).intensity, 0, 'resting nearby strings must stay silent');

  // 3. Plucking only string A sympathetically excites close neighbor B via electromagnetic coupling
  exciteString(nearState, nearA, 0.5, 760, 0.85, DEFAULT_SIM_CONFIG, 1440, true);
  for (let f = 0; f < 18; f++) {
    stepSimulation(nearState, 1 / 60, DEFAULT_SIM_CONFIG, 1440);
  }
  const midIdx = Math.floor(nearB.nodeCount / 2);
  assert.ok(
    Math.abs(nearB.u[midIdx]) > 0.05 || Math.abs(nearB.v[midIdx]) > 1,
    `expected sympathetic motion on close neighbor B, got u=${nearB.u[midIdx]}, v=${nearB.v[midIdx]}`
  );

  // 4. Both nearby strings vibrating -> strong dissonant hum with minor-second detuning & beating
  exciteString(nearState, nearB, 0.45, -720, 0.85, DEFAULT_SIM_CONFIG, 1440, true);
  let peakHum = 0;
  let peakRatio = 0;
  let peakBeat = 0;
  let activePairsSeen = 0;
  for (let f = 0; f < 30; f++) {
    stepSimulation(nearState, 1 / 60, DEFAULT_SIM_CONFIG, 1440);
    if (nearState.proximityResonance.intensity > peakHum) {
      peakHum = nearState.proximityResonance.intensity;
      peakRatio = nearState.proximityResonance.dissonanceRatio;
      peakBeat = nearState.proximityResonance.beatHz;
      activePairsSeen = nearState.proximityResonance.activePairs.length;
    }
  }
  assert.ok(peakHum > 0.15, `expected positive dissonant hum intensity, got ${peakHum}`);
  assert.ok(peakRatio > 1.04 && peakRatio < 1.12, `expected minor-second dissonance ratio, got ${peakRatio}`);
  assert.ok(peakBeat > 2.0, `expected beating interference rate > 2Hz, got ${peakBeat}`);
  assert.equal(activePairsSeen, 1, 'expected 1 active resonant pair');

  // 5. After vibrations damp out over 4 seconds, the dissonant hum decays back down cleanly
  for (let f = 0; f < 240; f++) {
    stepSimulation(nearState, 1 / 60, DEFAULT_SIM_CONFIG, 1440);
  }
  assert.ok(
    nearState.proximityResonance.intensity < peakHum * 0.25,
    `expected dissonant hum to decay with string energy: peak=${peakHum}, end=${nearState.proximityResonance.intensity}`
  );
});

test('flicking multiple strings in Duo preset reliably crosses high-proximity resonance threshold', () => {
  const state = createSimulationState();
  applyPreset(state, 'duo', 1440, 900, 'lime');
  assert.equal(state.strings.length, 2);

  // Simulate two sequential finger flicks across both strings
  interactTouchesWithStrings(
    state,
    [{ id: 'flick-1', prevX: 720, prevY: 260, x: 720, y: 640, vx: 0, vy: 1500, down: true }],
    DEFAULT_SIM_CONFIG,
    1440
  );

  let peakHum = 0;
  let peakPair = 0;
  for (let f = 0; f < 25; f++) {
    stepSimulation(state, 1 / 60, DEFAULT_SIM_CONFIG, 1440);
    peakHum = Math.max(peakHum, state.proximityResonance.intensity);
    for (const pair of state.proximityResonance.activePairs) {
      peakPair = Math.max(peakPair, pair.intensity);
    }
  }

  assert.ok(peakHum > 0.35, `expected Duo multi-string flick peakHum > 0.35, got ${peakHum}`);
  assert.ok(peakPair > 0.2, `expected Duo active pair intensity > 0.2, got ${peakPair}`);
});
