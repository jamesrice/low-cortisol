import * as THREE from 'three/webgpu';
import { resolveQuality, parseRuntimeFlags } from './Quality.js';
import { createCameraRig } from './CameraRig.js';
import { createColliderBank } from './Collider.js';
import { createCollisionTriggers } from './CollisionTriggers.js';
import { createPostPipeline } from './PostPipeline.js';

// Core WebGPU + Three.js r187 interactive collision engine.
//
// Owns:
//   - WebGPURenderer (+ optional WebGL2 fallback)
//   - Solid `scene` + depth-tested `overlayScene` (additive/bokeh particle layer)
//   - CameraRig (responsive framing, DPR budget, parallax, inspect magnifier)
//   - ColliderBank (kinematic dynamic colliders) + CollisionTriggers (CPU game events)
//   - PostPipeline (shared-lens DoF, haze, bloom, chromatic aberration, ACES, grain)
//   - Adaptive 60fps Dynamic Resolution Governor with exponential backoff
//   - Pluggable system registry and fail-safe animation loop

export async function createCollisionEngine( {
	container,
	background = 0x040605,
	tiers = {},
	camera: cameraConfig = {},
	post: postConfig = {},
	enableOverlayScene = true,
	targetFps = 60,
	exposure = 1.0
} ) {

	const flags = parseRuntimeFlags();
	const quality = resolveQuality( tiers );

	const renderer = new THREE.WebGPURenderer( {
		antialias: false,
		powerPreference: 'high-performance',
		forceWebGL: flags.forceWebGL
	} );

	await renderer.init();

	renderer.shadowMap.enabled = quality.shadows;
	renderer.toneMappingExposure = postConfig.exposure ?? exposure;

	container.appendChild( renderer.domElement );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( background );

	const overlayScene = enableOverlayScene ? new THREE.Scene() : null;

	const cameraRig = createCameraRig( cameraConfig );
	const { camera, frame } = cameraRig;

	const colliders = createColliderBank();
	const triggers = createCollisionTriggers();

	const post = createPostPipeline( {
		renderer,
		scene,
		overlayScene,
		camera,
		config: {
			focusDistance: cameraConfig.distance ?? 10,
			...postConfig
		},
		dofTaps: quality.dofTaps
	} );

	const systems = [];
	const updateCallbacks = [];
	const resizeCallbacks = [];
	const disposables = [];

	let resolutionScale = 1;
	let time = 0;
	let last = performance.now();
	let ready = false;
	let sampleTime = 0;
	let sampleFrames = 0;
	let running = false;
	let disposed = false;

	const stats = {
		fps: 0,
		frameMs: 0,
		resolutionScale: 1,
		tier: quality.name,
		backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
		bodies: 0,
		error: null
	};

	// Resolution governor: immediate drop on frame-rate dip, tentative exponential-backoff climb
	const governor = { calm: 0, patience: 6, climbed: false };

	function govern( frameMs ) {

		const target = 1000 / targetFps;

		if ( frameMs > target * 1.3 ) {

			governor.calm = 0;

			if ( resolutionScale > 0.56 ) {

				if ( governor.climbed ) governor.patience = Math.min( governor.patience * 2, 96 );
				governor.climbed = false;

				resolutionScale = Math.max( 0.55, resolutionScale * 0.86 );
				resize();

			}

		} else if ( frameMs < target * 1.1 ) {

			governor.calm ++;

			if ( governor.calm >= governor.patience && resolutionScale < 1 ) {

				governor.calm = 0;
				governor.climbed = true;

				resolutionScale = Math.min( 1, resolutionScale * 1.1 );
				resize();

			}

		}

		stats.resolutionScale = resolutionScale;

	}

	function resize() {

		if ( disposed ) return;

		cameraRig.measure( container.clientWidth, container.clientHeight, quality, resolutionScale );

		renderer.setPixelRatio( frame.dpr );
		renderer.setSize( frame.width, frame.height );

		colliders.setBounds( frame.halfWidth, frame.halfHeight, frame.centerY );
		post.setSize( frame.width * frame.dpr, frame.height * frame.dpr, cameraRig.inspectZoom );

		for ( const sys of systems ) {

			if ( sys.setFrame ) sys.setFrame( frame );

		}

		for ( const fn of resizeCallbacks ) fn( frame );

	}

	function inspect( cx = 0.5, cy = 0.5, zoom = 1 ) {

		cameraRig.setInspect( cx, cy, zoom );
		resize();

	}

	// Register a modular system `{ update?(dt, time, ctx), setFrame?(frame), dispose?(), bodyCount? }`
	function addSystem( system ) {

		systems.push( system );
		if ( system.setFrame ) system.setFrame( frame );
		recomputeBodyCount();
		return system;

	}

	function removeSystem( system ) {

		const idx = systems.indexOf( system );
		if ( idx >= 0 ) systems.splice( idx, 1 );
		recomputeBodyCount();

	}

	function recomputeBodyCount() {

		let total = 0;
		for ( const sys of systems ) {

			if ( typeof sys.bodyCount === 'number' ) total += sys.bodyCount;

		}
		stats.bodies = total;

	}

	function onUpdate( fn ) {

		updateCallbacks.push( fn );
		return () => {

			const idx = updateCallbacks.indexOf( fn );
			if ( idx >= 0 ) updateCallbacks.splice( idx, 1 );

		};

	}

	function onResize( fn ) {

		resizeCallbacks.push( fn );
		return () => {

			const idx = resizeCallbacks.indexOf( fn );
			if ( idx >= 0 ) resizeCallbacks.splice( idx, 1 );

		};

	}

	function trackDisposable( item ) {

		disposables.push( item );
		return item;

	}

	// Custom post-update provider set by scenes (focus point, haze light, etc.)
	let postStateProvider = null;

	function setPostStateProvider( fn ) {

		postStateProvider = fn;

	}

	// Custom camera focus provider (defaults to primary collider position)
	let cameraFocusProvider = () => colliders.primary ? colliders.primary.position : null;

	function setCameraFocusProvider( fn ) {

		cameraFocusProvider = fn;

	}

	const resizeObserver = new ResizeObserver( resize );
	resizeObserver.observe( container );
	window.addEventListener( 'resize', resize );

	// Perform initial measure so systems mounted immediately see valid frame bounds
	resize();

	function tick() {

		const now = performance.now();
		const rawDt = ( now - last ) / 1000;
		last = now;

		const dt = Math.min( Math.max( rawDt, 1 / 240 ), 1 / 30 );
		time += dt;

		// 1. Update kinematic colliders and game triggers
		colliders.update( dt, time );
		triggers.update( colliders, time );

		// 2. Update camera rig (parallax + matrices)
		const camFocus = cameraFocusProvider ? cameraFocusProvider( dt, time ) : null;
		cameraRig.update( dt, time, camFocus );

		// 3. Update registered scene systems (GPU compute passes, shaders, shafts, gameplay)
		const ctx = { engine: handle, renderer, scene, overlayScene, camera, frame, colliders, triggers, post, quality };

		for ( const fn of updateCallbacks ) fn( dt, time, ctx );

		for ( const sys of systems ) {

			if ( sys.update ) sys.update( dt, time, ctx );

		}

		// 4. Post-processing & optical render
		const postState = postStateProvider ? postStateProvider( dt, time, ctx ) : {};
		post.update( postState );
		post.render();

		if ( ready === false ) {

			ready = true;
			container.classList.add( 'is-ready' );

		}

		// 5. Rolling frame telemetry & adaptive dynamic resolution governor
		if ( rawDt < 0.1 && document.visibilityState === 'visible' ) {

			sampleTime += rawDt;
			sampleFrames ++;

			if ( sampleFrames >= 45 ) {

				const frameMs = ( sampleTime / sampleFrames ) * 1000;
				stats.frameMs = frameMs;
				stats.fps = 1000 / frameMs;

				sampleTime = 0;
				sampleFrames = 0;

				if ( flags.adaptiveResolution && time > 4 ) govern( frameMs );

			}

		}

	}

	function start() {

		if ( running || disposed ) return;
		running = true;
		last = performance.now();
		resize();

		renderer.setAnimationLoop( () => {

			try {

				tick();

			} catch ( error ) {

				renderer.setAnimationLoop( null );
				running = false;
				stats.error = String( error && error.stack || error );
				console.error( '[collision-engine] stopped due to runtime error', error );

			}

		} );

	}

	function stop() {

		running = false;
		renderer.setAnimationLoop( null );

	}

	function dispose() {

		if ( disposed ) return;
		disposed = true;
		stop();

		resizeObserver.disconnect();
		window.removeEventListener( 'resize', resize );

		for ( const sys of systems ) {

			if ( sys.dispose ) sys.dispose();

		}
		systems.length = 0;

		for ( const item of disposables ) {

			if ( item && typeof item.dispose === 'function' ) item.dispose();

		}
		disposables.length = 0;

		colliders.dispose();
		triggers.clear();
		post.dispose();
		renderer.dispose();
		renderer.domElement.remove();
		container.classList.remove( 'is-ready' );

	}

	const handle = {
		renderer,
		scene,
		overlayScene,
		camera,
		cameraRig,
		frame,
		colliders,
		triggers,
		post,
		quality,
		flags,
		stats,
		addSystem,
		removeSystem,
		onUpdate,
		onResize,
		trackDisposable,
		setPostStateProvider,
		setCameraFocusProvider,
		resize,
		inspect,
		start,
		stop,
		dispose
	};

	if ( flags.debug ) window.__collisionEngine = handle;

	return handle;

}
