import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rewriteScenesHtmlToBundle } from './build-scenes-bundle.mjs';

test('rewriteScenesHtmlToBundle swaps ./src/main.js to ./bundle.js idempotently', () => {
  const raw =
    '<!doctype html><html><head></head><body><script type="module" src="./src/main.js"></script></body></html>';
  const rewritten = rewriteScenesHtmlToBundle(raw);
  assert.ok(rewritten.includes('<script type="module" src="./bundle.js"></script>'));
  assert.ok(!rewritten.includes('./src/main.js'));
  assert.equal(rewriteScenesHtmlToBundle(rewritten), rewritten);

  const versioned =
    '<!doctype html><html><body><script type="module" src="./src/main.js?v=13"></script></body></html>';
  assert.ok(
    rewriteScenesHtmlToBundle(versioned).includes('<script type="module" src="./bundle.js"></script>')
  );
});

test('public/scenes contains embedded bridge and bundle-safe AudioWorklet/BreathWorklet URLs', () => {
  const root = process.cwd();
  const scenesHtml = fs.readFileSync(path.join(root, 'public/scenes/index.html'), 'utf8');
  assert.ok(scenesHtml.includes('id="lc-embed-nav-override"'));
  assert.ok(scenesHtml.includes('id="lc-embed-nav-bridge"'));
  assert.ok(scenesHtml.includes('src="./src/main.js"'));

  const audioEngine = fs.readFileSync(path.join(root, 'public/scenes/src/engine/AudioEngine.js'), 'utf8');
  assert.ok(
    audioEngine.includes("new URL( './src/engine/audio-worklet.js', window.location.href )"),
    'AudioEngine must resolve audio-worklet.js from document URL so bundled mode finds it'
  );
  assert.ok(fs.existsSync(path.join(root, 'public/scenes/src/engine/audio-worklet.js')));

  const breathInput = fs.readFileSync(path.join(root, 'public/scenes/src/engine/BreathInput.js'), 'utf8');
  assert.ok(
    breathInput.includes("new URL( './src/engine/breath-worklet.js', window.location.href )"),
    'BreathInput must resolve breath-worklet.js from document URL so bundled mode finds it'
  );
  assert.ok(fs.existsSync(path.join(root, 'public/scenes/src/engine/breath-worklet.js')));
});

test('public/scenes/src/main.js supports extensible per-scene customHandTracking and clean sensor teardown', () => {
  const root = process.cwd();
  const mainJs = fs.readFileSync(path.join(root, 'public/scenes/src/main.js'), 'utf8');
  assert.ok(mainJs.includes('demo.customHandTracking'));
  assert.ok(mainJs.includes('currentDemo.toggleHands'));
  assert.ok(mainJs.includes('currentDemo.stopHands'));
  assert.ok(mainJs.includes('demo.getExtraDockControls'));
  assert.ok(mainJs.includes("ev.data.type === 'lc:stop-sensors'"));
  assert.ok(mainJs.includes("window.addEventListener( 'pagehide'"));
});

test('Arc String uses dedicated src/vision/handTracker.ts with original spec parameters', () => {
  const root = process.cwd();
  const trackerTs = fs.readFileSync(path.join(root, 'src/vision/handTracker.ts'), 'utf8');
  assert.ok(trackerTs.includes("const MP_VERSION = '1.2.3';"));
  assert.ok(trackerTs.includes('minHandDetectionConfidence: 0.4'));
  assert.ok(trackerTs.includes('const enterThresh = 0.34;'));
  assert.ok(trackerTs.includes('const exitThresh = 0.47;'));
  assert.ok(trackerTs.includes('dTip > dPip * 1.07'));
  assert.ok(trackerTs.includes('width: { ideal: 1280 }'));
  assert.ok(trackerTs.includes('height: { ideal: 720 }'));
});
