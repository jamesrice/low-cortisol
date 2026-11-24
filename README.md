# Low Cortisol — Interactive Sensory & WebGPU Collision Playground

**Author:** James Rice

A unified, self-contained sensory playground combining a **React 19 + TypeScript + Canvas2D + Web Audio** electric plasma string synthesizer (**Arc String**) with a general-purpose **WebGPU + Three.js r187 + TSL** interactive collision and GPU-simulation engine powering four tactile scenes—all switchable from a single glass **Scene Picker**.

---

## Interactive Scenes

1. **Moss & Pappus** *(default, `?demo=moss`)* — A macro-focused gnarled forest tree covered in 32k–145k GPU-simulated moss cushion fronds, swaying sporophytes, rising optical-bokeh spores, and sculpted 3D dandelion pappus parachutes floating in woodland sunbeams, with dipole air wakes and serene `Drift Blooms`.

2. **Snow & Light** (`?demo=snow`) — Tens of thousands of procedural 3D dendritic ice crystals and optical-bokeh frost dust swirling before shimmering frozen glass and deep blue rays, with live Field Mode (`Repel Shield` / `Crystal Vortex`), `Blizzard Drift`, `Frozen Rays`, `Field Radius`, `Frost Gust`, and `Starlight Drift`.

3. **Petting Fur** (`?demo=dog`, optional `&breed=labrador|husky|bernese`) — A touch-first macro view of petting a dog's living double-coat fur (38k–136k GPU-simulated anisotropic strands + sunlit coat motes). Supports multi-touch petting (up to 5 independent fingers or webcam digits), breath wind ripples, and live GPU morphing between **Black Labrador**, **Husky**, and **Bernese Mountain Dog**.

4. **Film Bloom** (`?demo=film`, optional `&surface=lake|veined|fracture`) — Physically modeled 9-band CIE two-beam thin-film interference over a coupled 2D capillary-ripple and Marangoni nanometer-thickness fluid simulation on a nocturnal still lake, featuring 3D falling liquid beads, live-morphing surface presets (`Still Lake`, `Micro-Veined`, `Fracture Lines`), GPU meniscus mist motes, and Minnaert water-drop bubble synthesis.

5. **Arc String** (`?demo=arc`) — Interactive 2D coupled spring-mass electric plasma lines (`src/physics/electricString.ts`, `src/renderer/canvasRenderer.ts`, `src/audio/electricAudio.ts`).
   - **Physics**: Up to 16 pinned 36-node chains simulated with Hooke's law structural springs, second-neighbor bending springs, equilibrium restoring forces, and viscous/relative damping at 20 Symplectic Euler sub-steps per frame.
   - **Touch, Mouse & Bowstring Pull**: Press and drag gently to bow a line until release or snap (`68px`); fast swipes, hovers, and multi-touch crossings impart 2D velocity impulses, live corona tether arcs, and radial sparks.
   - **Proximity Resonance & Shimmer**: Vibrating strings within `290px` couple sympathetically, display translucent interior resonance bridges scaled by hum intensity, and ignite constructive-interference flashes and chromatic color-shimmering at high proximity.
   - **Procedural Electric Harp Audio**: Lydian-pentatonic synthesis (`C3–G5`, shorter strings = higher pitch) with stereo panning, feedback echo reverb, band-passed spark crackle bursts, a subtle `C2 + G2` ambient drone, and a faint minor-second/tritone dissonant proximity hum.
   - **Webcam Hand Tracking (`@mediapipe/tasks-vision`)**: Two-hand pinch & stretch draws a dashed charging line and anchors it on release; single-hand pinch grabs and tilts an existing endpoint; extended fingertips pluck strings. Toggle **Tracker Rig** vs. **Gossamer** overlays and 3-state **Camera View** (**Full View**, **50%**, or **Off**).
   - **Controls & Shortcuts**: `Strum` / `Draw` modes (or `Shift` + drag), 5 palettes (`Lime`, `Violet`, `Cyan`, `Amber`, `Mix`), 4 layout presets (`Single`, `Duo`, `Harp`, `Prism`), sliders for `String Tension`, `Reverb Sustain`, `Spark Shower`, and `Arc Voltage`, plus keyboard shortcuts: `D` (toggle Draw/Strum), `Space` (pulse all strings), `C` (clear stage).

### Multi-Sensory Controls (Top-Right Dock)
- **Procedural Audio**: Web Audio electric harp synthesis in **Arc String**, and 48 kHz `AudioWorklet` physical-modeling & ASMR synthesis (modal resonators, Minnaert bubble plinks, dual-SVF airflow/velvet fur whisper, refracted frost micro-grains, Hadamard FDN stereo reverb) across the four WebGPU scenes.
- **3-Phase Breath Input (`AudioWorklet` Mic DSP on WebGPU scenes)**: Cycles **Off → Breeze → Steer**; gentle exhales create wind across moss, snow, fur, or water, puffs trigger scene bursts, and Steer guides motion via breath brightness.
- **Webcam Hand Tracking (`@mediapipe/tasks-vision`)**: Lazy-loaded on demand across all five scenes with zero network cost until toggled on.

---

## Running Locally

**Prerequisites:** Node.js 22+ (no API keys or `.env` file required).

```bash
# 1. Install dependencies
npm install

# 2. Start the local Vite dev server
npm run dev
```

Open the local URL printed by Vite (default `http://localhost:5173/`):
- **Moss & Pappus (default):** `/?demo=moss` (alias `moss-tree`)
- **Snow & Light:** `/?demo=snow` (aliases `snow-and-light`, `light`)
- **Petting Fur:** `/?demo=dog` (aliases `fur`, `dog-fur`, `petting`; optional `&breed=labrador|husky|bernese`)
- **Film Bloom:** `/?demo=film` (aliases `film-bloom`, `bloom`, `lake`; optional `&surface=lake|veined|fracture`)
- **Arc String:** `/?demo=arc` (aliases `arc-string`, `electric`, `shock`, `string`)

### Supported WebGPU URL Flags
Runtime flags on the top-level URL are forwarded automatically to the embedded WebGPU engine:
- `?q=low|medium|high|ultra` — Override automatic quality tier
- `?dpr=1.5` — Force device pixel ratio
- `?drs=0` — Disable dynamic resolution scaling governor
- `?webgl` — Force WebGL2 fallback backend
- `?debug` — Expose `window.__collisionEngine` and `window.__activeDemo` inside the WebGPU scene frame

### Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server (serves React app + live unbundled `public/scenes/`) |
| `npm test` | Run unit tests (`tsx --test`) across physics, catalog, renderer & scene build |
| `npm run lint` | Run TypeScript type checking (`tsc --noEmit`) |
| `npm run build` | Build React SPA into `dist/` and bundle WebGPU scenes into `dist/scenes/bundle.js` |
| `npm run preview` | Preview the production `dist/` build locally |
| `npm run deploy:cloudflare` | Build production assets and deploy to Cloudflare Workers (`wrangler deploy`) |
| `npm run clean` | Remove `dist/` |

---

## Project Structure

```text
.
├── index.html                               # Vite SPA entry HTML & social metadata
├── vite.config.ts                           # Vite 8 + React 19 + Tailwind CSS v4 config
├── wrangler.jsonc                           # Cloudflare Workers Static Assets config (dist/)
├── ARCHITECTURE.md                          # WebGPU + TSL engine & unified host architecture
├── CLOUDFLARE_SETUP.md                      # Cloudflare Workers & GitHub Actions auto-deploy guide
├── scripts/
│   ├── build-scenes-bundle.mjs              # Offline esbuild bundler for public/scenes/ -> dist/scenes/bundle.js
│   └── build-scenes-bundle.test.ts          # Build & AudioWorklet path verification tests
├── src/                                     # Unified React host + native Arc String app
│   ├── main.tsx                             # React root mount
│   ├── App.tsx                              # Arc String rAF loop, hand/pointer input & WebGPU scene host
│   ├── index.css                            # Theme tokens & glassmorphic UI utilities
│   ├── physics/
│   │   ├── electricString.ts                # 2D coupled spring-mass solver, bowstring grab & proximity resonance
│   │   └── electricString.test.ts           # Physics & resonance unit tests
│   ├── renderer/
│   │   ├── canvasRenderer.ts                # Feathered optical bloom, sparks, interference shimmer & hand rigs
│   │   └── canvasRenderer.test.ts           # Opacity, shimmer & color-mixing tests
│   ├── audio/
│   │   └── electricAudio.ts                 # Procedural Web Audio electric harp, crackle & dissonant hum
│   ├── vision/
│   │   └── handTracker.ts                   # MediaPipe HandLandmarker wrapper with cover-fit mapping
│   └── components/
│       ├── HudOverlay.tsx                   # Arc String controls drawer, sensory dock & hints
│       ├── ScenePicker.tsx                  # Accessible keyboard + pointer dropdown scene switcher
│       ├── sceneCatalog.ts                  # 5-scene catalog, ?demo= aliases & flag forwarding
│       └── sceneCatalog.test.ts             # Catalog & URL builder unit tests
└── public/
    ├── og-cover.jpg                         # Open Graph social card image
    └── scenes/                              # Self-hosted WebGPU + Three.js r187 + TSL scenes
        ├── index.html                       # WebGPU host shell with embedded postMessage bridge
        └── src/
            ├── main.js                      # WebGPU scene launcher & controls binding
            ├── engine/                      # General-purpose WebGPU + TSL collision framework
            │   ├── index.js                 # Barrel exports
            │   ├── Engine.js                # WebGPURenderer, dual scenes, DRS governor, loop
            │   ├── Quality.js               # Quality tiers, pixel budget, URL flag parser
            │   ├── CameraRig.js             # Responsive framing, parallax rig, inspect magnifier
            │   ├── Collider.js              # PointerCollider (plane/surface/custom) & ColliderBank
            │   ├── CollisionTriggers.js     # CPU swept-segment CCD triggers for game logic
            │   ├── GPUBodySystem.js         # Storage buffer + compute + instanced mesh helper
            │   ├── DepthOfField.js          # 3-pass ½-res Vogel-disc optical depth of field
            │   ├── PostPipeline.js          # Shared-lens HDR pipeline (haze, DoF, bloom, CA, ACES)
            │   ├── Lighting.js              # Procedural gobo SpotLight & PMREM environment builder
            │   ├── LightShaft.js            # Analytical progressive-blur volumetric light shaft
            │   ├── AudioEngine.js           # Procedural AudioWorklet soundscape controller
            │   ├── audio-worklet.js         # 48 kHz ASMR/physical-modeling AudioWorklet processor
            │   ├── BreathInput.js           # 3-phase microphone breath input controller
            │   ├── breath-worklet.js        # Breath DSP AudioWorklet processor
            │   ├── HandInput.js             # MediaPipe + One Euro Filter 5-digit webcam tracking
            │   └── tsl/
            │       ├── noise.js             # Analytical 3D noiseGradient, curlNoise, quaternion ops
            │       ├── physics.js           # Dipole wake, vortex swirl, swept-sphere CCD, capsule SDF
            │       └── shadows.js           # Soft Vogel-disc point-light PCF shadow filter
            └── examples/
                ├── moss-tree/               # Macro moss-covered tree + dandelion pappus + Drift Blooms
                ├── snow-and-light/          # Frozen-glass snowflakes + Starlight Drift
                ├── dog-fur/                 # Touch-first macro petting dog fur (Labrador, Husky, Bernese)
                └── film-bloom/              # 9-band CIE thin-film water optics & capillary ripples
```

---

## Building Your Own WebGPU Collision Scene

The collision framework lives under `public/scenes/src/engine/` and can be used standalone or added as a new scene:

```js
import * as THREE from 'three/webgpu';
import { Fn, instanceIndex, vec4, float } from 'three/tsl';
import {
	createCollisionEngine,
	createCollider,
	createStorageBuffers,
	createGPUBodySystem,
	TSL
} from './src/engine/index.js';

const engine = await createCollisionEngine( {
	container: document.getElementById( 'stage' ),
	background: 0x06090c,
	camera: { fov: 32, distance: 10 },
	post: { focusSlab: 0.6, focalRange: 3.0, bokeh: 12 }
} );

const player = createCollider( {
	camera: engine.camera,
	element: document.getElementById( 'stage' ),
	mode: 'plane',
	radius: 0.85,
	stiffness: 65,
	damping: 0.65
} );
engine.colliders.add( player );

const count = 20000;
const buffers = createStorageBuffers( count, {
	pos: {}, vel: {}, rot: {}, ang: {}, data: {}, home: {}
} );

const bodies = createGPUBodySystem( {
	name: 'Game Debris',
	count,
	buffers,
	geometry: new THREE.BoxGeometry( 0.08, 0.08, 0.08 ),
	material: new THREE.MeshStandardNodeMaterial(),
	targetScene: engine.scene,
	buildComputeFn: ( B ) => Fn( () => {
		const P = B.pos.element( instanceIndex );
		const V = B.vel.element( instanceIndex );
		const p = P.xyz.toVar();
		const v = V.xyz.toVar();

		const hit = TSL.applySweptSphereCollision( {
			p, v,
			prev: player.uniforms.previous,
			curr: player.uniforms.position,
			colliderVel: player.uniforms.velocity,
			radius: player.uniforms.radius,
			stiffness: float( 420 ),
			damping: float( 26 ),
			dt: float( 1 / 60 )
		} );

		p.addAssign( v.mul( 1 / 60 ) );
		P.assign( vec4( p, TSL.decayHeat( P.w, hit.impact, 1.5, 0.12, float( 1 / 60 ) ) ) );
		V.assign( vec4( v, 0 ) );
	} )
} );

engine.addSystem( {
	bodyCount: count,
	update: ( dt, time, { renderer } ) => bodies.dispatch( renderer ),
	dispose: () => bodies.dispose()
} );

engine.start();
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full technical architecture breakdown and [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md) for deployment instructions.

---

## License

Released under the [MIT License](LICENSE). © 2026 James Rice.
