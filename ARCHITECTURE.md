# Low Cortisol Architecture

**Author:** James Rice

This document describes both layers of the **Low Cortisol** playground:
1. The **Unified React/Vite Host & Arc String Engine** (`src/` + `scripts/build-scenes-bundle.mjs`)
2. The **WebGPU Interactive Collision Engine** (`public/scenes/src/engine/`), built on **WebGPU**, **Three.js r187**, and **TSL (Three Shading Language)**

---

## 1. Unified App Host & Build Pipeline

| Component | Responsibilities |
|---|---|
| `src/App.tsx` | Top-level scene router (`?demo=arc\|moss\|snow\|dog\|film`), Arc String `requestAnimationFrame` simulation/render loop (automatically paused when viewing WebGPU scenes), pointer/hand gesture orchestration, and same-origin WebGPU scene iframe host (`/scenes/index.html`) |
| `src/physics/electricString.ts` | 2D coupled spring-mass solver (36 nodes/chain, up to 16 strings, Hooke's law structural + 2nd-neighbor bending + home-restoring springs, 20 Symplectic Euler sub-steps/frame), bowstring pull-and-snap grabs, swept-segment plucking, sympathetic inter-string coupling, and proximity dissonance resonance |
| `src/renderer/canvasRenderer.ts` | Zero-`shadowBlur` additive inverse-square feathered plasma bloom, braided filaments, calibrated ruler ticks, directional motion-blurred spark streaks, translucent proximity resonance bridges with constructive-interference flashes & chromatic color-shimmering, mirrored webcam cover backdrop, and `Tracker Rig` / `Gossamer` hand overlays |
| `src/audio/electricAudio.ts` | Web Audio Lydian-pentatonic electric harp synthesizer, stereo panning, feedback delay reverb, band-passed electrostatic crackle bursts, subtle `C2 + G2` ambient drone, and faint minor-second/tritone dissonant proximity hum with automatic context suspension when muted |
| `src/vision/handTracker.ts` | Lazy-loaded MediaPipe `HandLandmarker` (`@mediapipe/tasks-vision@1.2.3`) with cover-fit mirrored landmark mapping, resolution-independent pinch hysteresis, sample-delta fingertip velocities, and clean WASM/WebGL teardown (`dispose()`) |
| `src/components/ScenePicker.tsx` & `sceneCatalog.ts` | Accessible dropdown scene switcher (`ArrowUp`/`ArrowDown`/`Home`/`End`/`Escape`), `?demo=` alias resolution, and allowlisted runtime flag forwarding (`q`, `dpr`, `drs`, `webgl`, `debug`, `breed`, `surface`, `debug-input`) |
| `scripts/build-scenes-bundle.mjs` | Deterministic offline `esbuild` step during `npm run build` that bundles `public/scenes/src/main.js` into a single minified `dist/scenes/bundle.js` (keeping Three.js external via browser import map), rewrites `dist/scenes/index.html`, and retains `audio-worklet.js` & `breath-worklet.js` at `dist/scenes/src/engine/` |

In development (`npm run dev`), Vite serves `public/scenes/` verbatim as native ES modules. In production (`npm run build`), the entire app deploys cleanly to **Cloudflare Workers Static Assets** (`wrangler.jsonc`) with zero external runtime proxying.

---

## 2. WebGPU Engine Module Graph (`public/scenes/src/engine/`)

| Module | Responsibilities |
|---|---|
| `Quality.js` | Quality tier profiles (`low`–`ultra`), pixel-budget DPR capping, URL runtime flags (`?q`, `?dpr`, `?drs`, `?webgl`, `?debug`, `?demo`) |
| `Engine.js` | `WebGPURenderer` lifecycle (with optional WebGL2 fallback), dual solid + overlay scenes, 60fps Dynamic Resolution Governor, pluggable system loop |
| `CameraRig.js` | Responsive camera framing, smooth pointer parallax, pixel-exact view-offset `inspect()` magnifier |
| `Collider.js` | Pointer raycasting (`plane`, `surface`, and `custom` modes), idle Lissajous autopilot, sub-stepped spring-damper motion, press-to-swell charge, `ColliderBank` |
| `CollisionTriggers.js` | CPU-side swept-segment CCD (`sweptPointDistance`) with `onEnter`, `onStay`, `onExit`, and `onImpact` callbacks synchronized with GPU physics |
| `GPUBodySystem.js` | `instancedArray` GPU storage buffers, TSL compute pass lifecycle, zero-readback GPU-instanced `THREE.Mesh`, draw-fraction scaling |
| `AudioEngine.js` & `audio-worklet.js` | 48 kHz procedural `AudioWorklet` soundscape synthesizer (modal resonators, Minnaert bubble plinks, airflow/fur whisper, frost micro-grains, Hadamard FDN stereo reverb) |
| `BreathInput.js` & `breath-worklet.js` | 3-phase microphone breath DSP (`Off → Breeze → Steer`) |
| `HandInput.js` | Lazy-loaded MediaPipe `HandLandmarker` + One Euro Filter 5-digit tracking and Z-axis camera proximity |
| `tsl/noise.js` | Lattice `hash33`, single-pass analytical 3D `noiseGradient`, divergence-free bitangent `curlNoise`, quaternion rotation & integration |
| `tsl/physics.js` | Potential-flow dipole wake, vortex swirl, swept-segment continuous sphere collision, analytic capsule/floor/wall SDF collisions |
| `tsl/shadows.js` | Per-pixel rotated Vogel-disc soft point-light PCF shadow filter |
| `Lighting.js` | Procedural animated fractal-noise gobo `SpotLight`, procedural PMREM environment builder |
| `LightShaft.js` | Camera-pivoting volumetric light beam ribbon with analytical progressive blur of angular noise octaves |
| `DepthOfField.js` | 3-pass ½-res Vogel-disc scatter-as-gather optical depth of field with background bleed protection and foreground bokeh spill |
| `PostPipeline.js` | `THREE.RenderPipeline`, shared-depth additive overlay pass, closed-form volumetric point-light haze, Bloom, CA, ACES, vignette, film grain |

---

## 3. Core WebGPU Technical Systems

### A. Zero-Readback GPU Instancing via `instancedArray`
Instead of CPU-side `InstancedMesh` matrix updates, every simulated family allocates `vec4` GPU storage buffers via `instancedArray(Float32Array, 'vec4')`:
- `pos`: `(x, y, z, heat/activation)`
- `vel`: `(vx, vy, vz, aux)`
- `rot`: `(qx, qy, qz, qw)` unit quaternion
- `ang`: `(wx, wy, wz, 0)` angular velocity
- `data`: `(size, inertia, seed, modeFlag)`
- `home`: `(hx, hy, hz, shellOffset)`

Each frame calls `renderer.compute(computeNode)` to advance all instances on the GPU. Rendering binds `buffer.toAttribute()` directly inside `material.positionNode` on a standard `THREE.Mesh(geometry, material)` with `mesh.count = N`. Shadow maps automatically inherit the deformed positions without duplicating vertex logic.

### B. Analytical Bitangent Curl Noise
In `public/scenes/src/engine/tsl/noise.js`, `noiseGradient(x)` evaluates the exact analytical gradient of 3D quintic gradient noise in one lattice pass (no 6-sample finite differences). Taking `cross(noiseGradient(p), noiseGradient(p + offset))` yields a strictly divergence-free 3D velocity field ("bitangent noise") so suspended particles swirl cleanly like fluid without clumping.

### C. Swept-Segment Continuous Collision Detection (CCD) + Potential-Flow Dipole Wake
Fast pointer motion would tunnel through particles if tested only against the current sphere position. The collider integrates a sub-stepped spring-damper (`h <= 1/120s`) and uploads both `previous` and `position` plus `velocity` every frame:
1. **Potential-flow dipole wake**:
   $$\mathbf{v}_{\text{wake}} = \frac{1}{2}\left(\frac{R}{\max(r, 0.85R)}\right)^3 \big(3(\mathbf{v}_c \cdot \hat{\mathbf{n}})\hat{\mathbf{n}} - \mathbf{v}_c\big)$$
   Displaces surrounding air ahead of the collider, wraps around its flanks, and closes behind it.
2. **Swept capsule projection**: Projects each particle onto segment $[\text{prev}, \text{curr}]$ via `along = clamp(dot(p - prev, sweep) / dot(sweep, sweep), 0, 1)`.
3. **Cushioned repulsion + hard inner core**: Applies an elastic outward spring weighted by `1 / sqrt(inertia)`, asymmetric critical damping (higher on incoming approach than recoil), and a hard inner core clamp at `shell * coreFraction`.
4. **Impact energy (`heat`) & torque**: Records `impact = max(-approach, 0)` to drive both collision spin kicks (`cross(n, spinAxis)`) and decaying visual activation (`heat`).

### D. Unified Dual-Pass Optical Depth of Field + Per-Particle Scatter Bokeh
Screen-space gather DoF cannot expand sub-pixel bright glints into crisp bokeh discs. The engine solves this with a **shared `lens` uniform struct** (`focus`, `focusSlab`, `focalRange`, `bokehPx`) driving two synchronized paths:
1. **Solid scene** renders into HDR `scenePass` → closed-form volumetric haze integral ($\int_0^{L} |o + t d - P|^{-2} dt$ solved analytically via `atan` up to `sceneDepth`) → 3-pass ½-res Vogel-disc DoF (`prefilter` → `gather` rotated per pixel by `interleavedGradientNoise` → full-res 4-tap tent `composite`).
2. **Overlay optical particle scene** (`overlayScene`) renders via a second `pass(overlayScene, camera, { depthTexture: scenePass.renderTarget.depthTexture, autoClearDepth: false })` so solid meshes occlude particles while each particle expands analytically to its exact Circle of Confusion (`cocPx`) with energy conservation (`flakeEnergy` → `discEnergy`) and zero-fill-rate collapsing of invisible particles.

### E. Dynamic Resolution Governor (DRS)
High-DPI (4K/5K) canvases are first clamped by a `maxPixels` budget (`dpr = min(devicePixelRatio, maxDpr, sqrt(maxPixels / (w*h)))`). At runtime, after a 4-second warmup, the engine averages 45-frame windows:
- If `frameMs > 1.3 * targetMs`: downscales `resolutionScale` immediately (`* 0.86`, floor `0.55`).
- If `frameMs < 1.1 * targetMs`: waits `patience` calm windows before tentatively climbing (`* 1.1`, cap `1.0`). If a climb triggers a drop, `patience` doubles (up to 96 windows), preventing oscillation.

---

## 4. Game & Scene Building Blocks

- **Pluggable `Collider` projection modes**: `'plane'` (2.5D arenas such as **Snow & Light**), `'surface'` (3D mesh raycasting with normal offset & plane fallback—used in **Macro Moss Tree & Dandelion Pappus** so the cursor hugs curved tree bark), and `'custom'` (driven by player movement, projectiles, or AI).
- **`ColliderBank`**: Supports multiple simultaneous dynamic colliders.
- **`CollisionTriggers`**: CPU-side swept-segment CCD (`sweptPointDistance`) matching the GPU solver so game code can attach `onEnter`, `onStay`, `onExit`, and `onImpact` callbacks to targets, collectibles, and hazards in lockstep with GPU forces.
- **Analytic GPU obstacle primitives (`TSL.collideCapsule`, `TSL.collideFloorPlane`, `TSL.collideBackWall`)**: Allows floating GPU bodies (such as snowflakes or dandelion pappus) to collide smoothly against tree trunks, limbs, walls, and arenas.
