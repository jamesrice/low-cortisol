import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGH_PROXIMITY_HUM_THRESHOLD,
  computeInterferenceShimmer,
  computeProximityResonanceOpacity,
  mixHexColor,
} from './canvasRenderer';

test('computeProximityResonanceOpacity returns zero when humIntensity or pairIntensity is dormant', () => {
  assert.equal(computeProximityResonanceOpacity(0, 0.8), 0);
  assert.equal(computeProximityResonanceOpacity(0.005, 0.8), 0);
  assert.equal(computeProximityResonanceOpacity(0.8, 0.01), 0);
});

test('computeProximityResonanceOpacity scales monotonically with humIntensity and stays subtly translucent', () => {
  const faint = computeProximityResonanceOpacity(0.25, 0.6);
  const medium = computeProximityResonanceOpacity(0.6, 0.6);
  const strong = computeProximityResonanceOpacity(1.0, 1.0);

  assert.ok(faint > 0 && faint < medium, `expected faint (${faint}) < medium (${medium})`);
  assert.ok(medium < strong, `expected medium (${medium}) < strong (${strong})`);
  assert.ok(strong <= 0.42, `expected translucent ceiling <= 0.42, got ${strong}`);
});

test('computeInterferenceShimmer remains inactive below high-proximity resonance threshold', () => {
  const dormant = computeInterferenceShimmer(0, 0.9, 1.2, 4.5, 1);
  const lowHum = computeInterferenceShimmer(HIGH_PROXIMITY_HUM_THRESHOLD - 0.05, 0.9, 1.2, 4.5, 1);
  const lowPair = computeInterferenceShimmer(0.85, 0.08, 1.2, 4.5, 1);

  for (const res of [dormant, lowHum, lowPair]) {
    assert.equal(res.active, false);
    assert.equal(res.shimmerMix, 0);
    assert.equal(res.flashLevel, 0);
  }
});

test('computeInterferenceShimmer activates and scales smoothly with humIntensity at high proximity', () => {
  let maxFlashMid = 0;
  let maxFlashHigh = 0;
  let maxShimmerMid = 0;
  let maxShimmerHigh = 0;

  for (let i = 0; i < 60; i++) {
    const t = i * 0.05;
    const mid = computeInterferenceShimmer(0.55, 0.85, t, 5.2, 2.3);
    const high = computeInterferenceShimmer(0.95, 0.85, t, 5.2, 2.3);

    assert.equal(mid.active, true);
    assert.equal(high.active, true);
    assert.ok(high.shimmerMix >= mid.shimmerMix, 'shimmerMix should increase with humIntensity');
    assert.ok(high.flashLevel >= mid.flashLevel, 'flashLevel should increase with humIntensity');
    assert.ok(high.shimmerMix >= 0 && high.shimmerMix <= 1);
    assert.ok(high.flashLevel >= 0 && high.flashLevel <= 1);
    assert.ok(high.travelT > 0 && high.travelT < 1);

    maxFlashMid = Math.max(maxFlashMid, mid.flashLevel);
    maxFlashHigh = Math.max(maxFlashHigh, high.flashLevel);
    maxShimmerMid = Math.max(maxShimmerMid, mid.shimmerMix);
    maxShimmerHigh = Math.max(maxShimmerHigh, high.shimmerMix);
  }

  assert.ok(maxFlashHigh > maxFlashMid && maxFlashHigh > 0.4, `expected clear flash peak at high hum, got ${maxFlashHigh}`);
  assert.ok(maxShimmerHigh > maxShimmerMid && maxShimmerHigh > 0.6, `expected strong shimmer at high hum, got ${maxShimmerHigh}`);
});

test('mixHexColor interpolates RGB channels cleanly and clamps endpoints', () => {
  assert.equal(mixHexColor('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHexColor('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHexColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHexColor('#ff0000', '#0000ff', -1), '#ff0000');
  assert.equal(mixHexColor('#ff0000', '#0000ff', 2), '#0000ff');
});
