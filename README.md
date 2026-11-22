# WebGPU Interactive Collision Engine (Three.js r187 + TSL)

**Author:** James Rice

A general-purpose **WebGPU + Three.js r187 + TSL** interactive collision and GPU-simulation framework, paired with four complete low-cortisol interactive experiences:

1. **Macro Moss Tree & Dandelion Pappus** *(default)* — A macro-focused gnarled forest tree covered in 32k–145k GPU-simulated moss cushion fronds, swaying sporophytes, rising optical-bokeh spores, and sculpted 3D dandelion pappus parachutes floating in woodland sunbeams. Moving your pointer, finger, breath, or hand glides over the 3D bark to brush, ripple, unfurl, and illuminate the moss while swirling dandelion pappus through dipole air wakes, with serene `Drift Blooms`.
2. **Snow & Light** — Tens of thousands of procedural 3D dendritic ice crystals and optical-bokeh frost dust swirling before ambiently reflective shimmering frozen glass and deep blue rays, with live Field Mode (`Repel Shield` / `Crystal Vortex`), `Blizzard Drift`, `Frozen Rays`, `Field Radius`, `Frost Gust`, and `Starlight Drift`.
3. **Petting Fur** — A tactile, touch-first macro view of petting a dog's living double-coat fur (38k–136k GPU-simulated anisotropic strands + sunlit coat motes). Supports multi-touch petting (up to 5 independent fingers or webcam digits), breath wind ripples, and morphs live on the GPU between **Black Labrador**, **Husky**, and **Bernese Mountain Dog**, with controls for `Touch Pressure`, `Coat Softness`, `Sunbeam Warmth`, `Shake Off`, and `Smooth Coat`.
4. **Film Bloom** — Physically modeled 9-band CIE two-beam thin-film interference over a coupled 2D capillary-ripple and Marangoni nanometer-thickness fluid simulation on a dark nocturnal still lake. Features 3D falling liquid beads, hold/pinch-to-swell drops, live-morphing surface characters (`Still Lake`, `Micro-Veined`, `Fracture Lines`), GPU meniscus mist motes, and Minnaert water-drop bubble synthesis.

### Multi-Sensory Global Controls (Top-Right Dock)
- **Ambient Procedural Audio (`AudioWorklet`)**: Real-time 48 kHz physical-modeling & ASMR synthesis (modal resonators, Minnaert water-drop bubble plinks, dual-SVF airflow/velvet fur whisper, refracted frost micro-grains, Hadamard FDN stereo reverb) consistent to each scene and independent of input method.
- **3-Phase Breath Input (`AudioWorklet` Mic DSP)**: Cycles **Off → Breeze → Steer**, paired with a subtle ambient breath waveform. Gentle exhales create living wind across moss, snow, fur, or still water; strong puffs trigger `Send Pulse`, `Frost Gust`, `Shake Off`, or `Marangoni Gust`; Phase 2 (`Steer`) guides motion via breath brightness (or stereo L/R balance on stereo mics).
- **Webcam Hand Tracking (`@mediapipe/tasks-vision` + One Euro Filter)**: Lazy-loaded on demand with a pure gossamer light-line hand overlay, independent 5-digit finger tracking, Z-axis camera proximity scaling pressure/radius, and distinct single-finger vs. open-palm vs. pinch/fist responses.

---

## Running Locally

Zero build step required (native ES modules + browser `<script type="importmap">`):

```bash
python3 -m http.server 8080
```

Then open in a WebGPU-capable browser (Chrome / Edge / Safari Technology Preview):
- **Default (Macro Moss & Pappus):** `http://localhost:8080/`
- **Snow & Light:** `http://localhost:8080/?demo=snow`
- **Petting Fur:** `http://localhost:8080/?demo=dog` (optional `&breed=labrador|husky|bernese`)
- **Film Bloom:** `http://localhost:8080/?demo=film` (optional `&surface=lake|veined|fracture`)

### Supported URL Flags
- `?q=low|medium|high|ultra` — Override automatic quality tier
- `?dpr=1.5` — Force device pixel ratio
- `?drs=0` — Disable dynamic resolution scaling governor
- `?webgl` — Force WebGL2 fallback backend
- `?debug` — Expose `window.__collisionEngine` and `window.__activeDemo` (including `engine.inspect(cx, cy, zoom)`)

---

## Project Structure

```text
src/
├── main.js                        # App launcher & minimal glass controls HUD
├── engine/                        # General-purpose WebGPU + TSL collision framework
│   ├── index.js                   # Barrel exports
│   ├── Engine.js                  # WebGPURenderer, dual scenes, DRS governor, loop
│   ├── Quality.js                 # Quality tiers, pixel budget, URL flag parser
│   ├── CameraRig.js               # Responsive framing, parallax rig, inspect magnifier
│   ├── Collider.js                # PointerCollider (plane/surface/custom) & ColliderBank
│   ├── CollisionTriggers.js       # CPU swept-segment CCD triggers for game logic
│   ├── GPUBodySystem.js           # Storage buffer + compute + instanced mesh helper
│   ├── DepthOfField.js            # 3-pass ½-res Vogel-disc optical depth of field
│   ├── PostPipeline.js            # Shared-lens HDR pipeline (haze, DoF, bloom, CA, ACES)
│   ├── Lighting.js                # Procedural gobo SpotLight & PMREM environment builder
│   ├── LightShaft.js              # Analytical progressive-blur volumetric light shaft
│   └── tsl/
│       ├── noise.js               # Analytical 3D noiseGradient, curlNoise, quaternion ops
│       ├── physics.js             # Dipole wake, vortex swirl, swept-sphere CCD, capsule SDF
│       └── shadows.js             # Soft Vogel-disc point-light PCF shadow filter
└── examples/
    ├── moss-tree/                 # Macro moss-covered tree + dandelion pappus + Bloom Hunt
    │   ├── config.js
    │   ├── trunk.js               # Procedural gnarled trunk/limb + bark TSL + forest bokeh
    │   ├── moss.js                # GPU cushion fronds, sporophytes & scatter-bokeh spores
    │   ├── dandelion.js           # 3D botanical pappus geometry + GPU aerodynamics/collision
    │   └── scene.js
    ├── snow-and-light/            # Snow & Light frozen-glass snowflakes + Starlight Hunt
    │   ├── config.js
    │   ├── studio.js
    │   ├── orbVisuals.js
    │   ├── swarm.js
    │   └── scene.js
    └── dog-fur/                   # Touch-first macro petting dog fur (Labrador, Husky, Bernese)
        ├── config.js
        ├── body.js                # Curved canine back surface, breed markings & golden bokeh
        ├── fur.js                 # GPU multi-touch fur physics, Kajiya-Kay shading & motes
        └── scene.js
```

---

## Building Your Own Interactive Collision Game

Here is a minimal blueprint showing how to combine `createCollisionEngine`, `createCollider`, `createGPUBodySystem`, `TSL` physics primitives, and `engine.triggers` to build an interactive collision game:

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

// 1. Create a tactile spring-damped player/pointer collider
const player = createCollider( {
	camera: engine.camera,
	element: document.getElementById( 'stage' ),
	mode: 'plane', // or 'surface' with `surfaceMeshes`, or 'custom' for WASD/gamepad
	radius: 0.85,
	stiffness: 65,
	damping: 0.65
} );
engine.colliders.add( player );

// 2. Register CPU swept-segment game triggers (pickups, checkpoints, enemies)
let score = 0;
engine.triggers.addTrigger( {
	position: new THREE.Vector3( 1.2, 0.4, 0 ),
	radius: 0.35,
	cooldown: 0.5,
	onImpact: ( { speed, normal } ) => {
		score += Math.round( 10 + speed * 2 );
		console.log( 'Hit!', { score, normal } );
	}
} );

// 3. Create a GPU body swarm reacting to `player.uniforms` via swept-segment CCD
const count = 20000;
const buffers = createStorageBuffers( count, {
	pos: {}, vel: {}, rot: {}, ang: {}, data: {}, home: {}
} );

const bodies = createGPUBodySystem( {
	name: 'Game Debris',
	count,
	buffers,
	geometry: new THREE.BoxGeometry( 0.08, 0.08, 0.08 ),
	material: /* MeshStandardNodeMaterial reading buffers.pos.toAttribute() */ new THREE.MeshStandardNodeMaterial(),
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

For a complete live example of `engine.triggers` coupled with GPU moss shockwaves, open the **Controls** menu in the Macro Moss scene and toggle **Bloom Hunt**, or inspect `src/examples/moss-tree/scene.js`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical architecture breakdown.
