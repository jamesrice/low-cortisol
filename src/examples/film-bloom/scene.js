import * as THREE from 'three/webgpu';
import {
	createCollisionEngine,
	createGoboSpotLight,
	createProceduralEnvironment
} from '../../engine/index.js';
import { FILM_BLOOM_CONFIG } from './config.js';
import { createFilmSimulation } from './simulation.js';
import { createFilmSurface } from './surface.js';
import { createLakeMistSystem } from './mist.js';

// "Film Bloom" — real-time WebGPU thin-film interference on a dark nocturnal still lake.
// Features coupled 2D capillary ripples + Marangoni nanometer film thickness plumes,
// physically modeled 9-band CIE two-beam interference, 3 live-morphing surface textures
// (Still Lake, Micro-Veined, Fracture Lines), 3D falling liquid droplets, and full
// multi-touch / OLED wheel / 5-digit webcam hand / 3-phase breath / AudioWorklet ASMR.

export async function createFilmBloomExperience( { container, config = FILM_BLOOM_CONFIG, audio = null } ) {

	const engine = await createCollisionEngine( {
		container,
		background: config.background,
		tiers: config.tiers,
		camera: config.camera,
		post: config.post,
		enableOverlayScene: true
	} );

	const { renderer, scene, overlayScene, camera, quality, post } = engine;

	// ---- Nocturnal twilight reflections & grazing studio lighting ----
	const envTarget = createProceduralEnvironment( renderer, config.light.environment );
	const environment = envTarget.texture;
	engine.trackDisposable( { dispose: () => envTarget.dispose() } );

	const keyCfg = config.light.key;
	const keyRig = createGoboSpotLight( {
		scene,
		position: keyCfg.position,
		target: keyCfg.target,
		color: keyCfg.color,
		intensity: keyCfg.intensity,
		angle: keyCfg.angle,
		penumbra: keyCfg.penumbra,
		decay: keyCfg.decay,
		goboScale: 1.85,
		goboSpeed: 0.012,
		goboContrast: 0.16,
		rimTint: [ 0.72, 0.90, 1.0 ]
	} );

	const rimCfg = config.light.rim;
	const rimLight = new THREE.PointLight( rimCfg.color, rimCfg.intensity, rimCfg.distance, rimCfg.decay );
	rimLight.position.fromArray( rimCfg.position );
	scene.add( rimLight );

	const fillCfg = config.light.fill;
	const fillLight = new THREE.PointLight( fillCfg.color, fillCfg.intensity, fillCfg.distance, fillCfg.decay );
	fillLight.position.fromArray( fillCfg.position );
	scene.add( fillLight );

	const hemiCfg = config.light.hemisphere;
	const hemiLight = new THREE.HemisphereLight( hemiCfg.sky, hemiCfg.ground, hemiCfg.intensity );
	scene.add( hemiLight );

	const touchCfg = config.light.touchLight;
	const touchLight = new THREE.PointLight( touchCfg.color, 0, touchCfg.distance, touchCfg.decay );
	touchLight.position.set( 0, 0.6, 0.8 );
	scene.add( touchLight );

	const sceneLights = [ keyRig.spot, rimLight, fillLight, hemiLight, touchLight ];

	engine.trackDisposable( {
		dispose() {

			scene.remove( keyRig.spot, keyRig.spot.target, rimLight, fillLight, hemiLight, touchLight );
			keyRig.spot.dispose();
			rimLight.dispose();
			fillLight.dispose();
			hemiLight.dispose();
			touchLight.dispose();

		}
	} );

	// ---- Coupled 2D Shallow-Water & Thin-Film Marangoni Simulation ----
	let mistRef = null;

	const sim = createFilmSimulation( {
		resolution: quality.simRes || 200,
		simSpan: config.surface.simSpan,
		onImpact( { x, z, size, pan } ) {

			if ( mistRef ) mistRef.triggerImpact( x, z, size );
			if ( audio ) {

				const intensity = THREE.MathUtils.clamp( 0.34 + size * 0.36, 0.25, 1.0 );
				audio.triggerDrop?.( pan, size, intensity );

			}

		}
	} );
	engine.trackDisposable( sim );

	// ---- 3D Displaced Still Lake, Falling Droplets & Impact Crowns ----
	const surface = createFilmSurface( {
		scene,
		config,
		quality,
		sim,
		environment,
		sceneLights,
		keyLightPos: keyRig.spot.position,
		rimLightPos: rimLight.position
	} );
	engine.trackDisposable( surface );

	// ---- GPU Meniscus Mist & Dew Micro-Motes ----
	const mist = createLakeMistSystem( {
		overlayScene,
		config,
		quality,
		lens: post.lens
	} );
	mistRef = mist;
	engine.addSystem( mist );

	// ---- Lake Plane Raycasting (World <-> Local XZ) ----
	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const tiltX = config.surface.tiltX;
	const lakeNormal = new THREE.Vector3( 0, Math.cos( tiltX ), Math.sin( tiltX ) ).normalize();
	const lakePlane = new THREE.Plane( lakeNormal, 0 );
	const hitWorld = new THREE.Vector3();
	const hitLocal = new THREE.Vector3();
	const invLakeQuat = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), - tiltX );
	const fwdLakeQuat = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), tiltX );

	function projectNdcToLake( nx, ny, outWorld, outLocal ) {

		ndc.x = THREE.MathUtils.clamp( nx, - 1, 1 );
		ndc.y = THREE.MathUtils.clamp( ny, - 1, 1 );
		raycaster.setFromCamera( ndc, camera );
		if ( ! raycaster.ray.intersectPlane( lakePlane, outWorld ) ) return false;

		outLocal.copy( outWorld ).applyQuaternion( invLakeQuat );
		// Keep softly inside active sim domain
		const lim = config.surface.simSpan * 0.46;
		outLocal.x = THREE.MathUtils.clamp( outLocal.x, - lim, lim );
		outLocal.z = THREE.MathUtils.clamp( outLocal.z, - lim, lim );
		outLocal.y = 0;
		return true;

	}

	function projectClientToLake( clientX, clientY, outWorld, outLocal ) {

		const rect = container.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return false;
		const nx = ( ( clientX - rect.left ) / rect.width ) * 2 - 1;
		const ny = - ( ( clientY - rect.top ) / rect.height ) * 2 + 1;
		return projectNdcToLake( nx, ny, outWorld, outLocal );

	}

	// ---- Multi-Touch / Pointer / OLED Wheel Wake & Hold-Drop Tracking ----
	const MAX_SLOTS = config.interaction.maxTouches || 5;
	const slots = Array.from( { length: MAX_SLOTS }, () => ( {
		pointerId: null,
		isMouse: false,
		active: false,
		pressing: false,
		downTime: 0,
		downClientX: 0,
		downClientY: 0,
		dragged: false,
		pressure: 1.0,
		radiusScale: 1.0,
		localPos: new THREE.Vector3(),
		prevLocalPos: new THREE.Vector3(),
		targetLocalPos: new THREE.Vector3(),
		worldPos: new THREE.Vector3(),
		localVel: new THREE.Vector3(),
		lastMoveTime: - 10
	} ) );

	let elapsedNow = 0;
	let lastUserInteractElapsed = - 10;
	let rainScale = config.interaction.defaultRain;
	let nextAutoDropTime = 0.58; // Immediate opening drop right after fade-in
	let lastAutoX = 0.4;
	let lastAutoZ = 0.2;
	let liveBreathEnergy = 0;
	let handsControlling = false;
	const activeHandIds = new Set();

	// Webcam pinch-to-hold-and-drop state
	let handPinchHolding = false;
	let handPinchStart = 0;
	let handPinchX = 0;
	let handPinchZ = 0;

	// Pointer hold-to-swell state (tracks primary pressed non-dragged slot)
	let pointerHoldSlot = null;

	function findSlot( id ) {

		for ( const s of slots ) if ( s.pointerId === id ) return s;
		return null;

	}

	function acquireSlot( id, isMouse ) {

		const existing = findSlot( id );
		if ( existing ) return existing;
		for ( const s of slots ) {

			if ( ! s.active && s.pointerId === null ) {

				s.pointerId = id;
				s.isMouse = isMouse;
				return s;

			}

		}
		if ( ! isMouse ) {

			for ( const s of slots ) {

				if ( s.isMouse ) {

					s.pointerId = id;
					s.isMouse = false;
					return s;

				}

			}

		}
		return null;

	}

	function releaseSlot( id ) {

		const s = findSlot( id );
		if ( ! s ) return;
		if ( pointerHoldSlot === s ) pointerHoldSlot = null;
		s.active = false;
		s.pressing = false;
		s.dragged = false;
		s.pointerId = null;
		s.isMouse = false;

	}

	let wheelActive = false;
	let wheelAnchorX = 0;
	let wheelAnchorY = 0;
	let wheelX = 0;
	let wheelY = 0;
	let lastWheelMs = - Infinity;
	let restingMouseX = NaN;
	let restingMouseY = NaN;
	let preTouchMouseX = NaN;
	let preTouchMouseY = NaN;

	function onPointerDown( e ) {

		if ( e.target !== container && ! container.contains( e.target ) ) return;

		wheelActive = false;
		releaseSlot( 'wheel' );
		lastUserInteractElapsed = elapsedNow;

		const isMouse = e.pointerType === 'mouse';
		const key = isMouse ? 'mouse' : e.pointerId;
		const slot = acquireSlot( key, isMouse );
		if ( ! slot ) return;

		if ( ! isMouse && container.setPointerCapture ) {

			try { container.setPointerCapture( e.pointerId ); } catch {}

		}

		if ( projectClientToLake( e.clientX, e.clientY, hitWorld, hitLocal ) ) {

			slot.localPos.copy( hitLocal );
			slot.prevLocalPos.copy( hitLocal );
			slot.targetLocalPos.copy( hitLocal );
			slot.worldPos.copy( hitWorld );
			slot.localVel.set( 0, 0, 0 );
			slot.active = true;
			slot.pressing = true;
			slot.dragged = false;
			slot.downTime = elapsedNow;
			slot.downClientX = e.clientX;
			slot.downClientY = e.clientY;
			slot.lastMoveTime = elapsedNow;
			slot.pressure = isMouse ? 1.05 : 1.15;
			slot.radiusScale = 1.0;

			// Begin potential hold-to-swell droplet on primary contact
			pointerHoldSlot = slot;

		}

	}

	function onPointerMove( e ) {

		const isMouse = e.pointerType === 'mouse';
		const key = isMouse ? 'mouse' : e.pointerId;

		if ( isMouse ) {

			if ( handsControlling ) return;
			const now = performance.now();
			if (
				( now - lastWheelMs ) < 350 &&
				Number.isFinite( preTouchMouseX ) &&
				Math.hypot( e.clientX - preTouchMouseX, e.clientY - preTouchMouseY ) < 28
			) {

				wheelActive = false;
				return;

			}

			if ( Number.isFinite( restingMouseX ) && Math.hypot( e.clientX - restingMouseX, e.clientY - restingMouseY ) > 12 ) {

				preTouchMouseX = restingMouseX;
				preTouchMouseY = restingMouseY;

			}
			restingMouseX = e.clientX;
			restingMouseY = e.clientY;
			wheelActive = false;

		}

		let slot = findSlot( key );
		if ( ! slot && isMouse ) slot = acquireSlot( 'mouse', true );
		if ( ! slot ) return;

		if ( projectClientToLake( e.clientX, e.clientY, hitWorld, hitLocal ) ) {

			const wasInactive = ! slot.active;
			slot.targetLocalPos.copy( hitLocal );
			slot.worldPos.copy( hitWorld );
			if ( wasInactive ) {

				slot.localPos.copy( hitLocal );
				slot.prevLocalPos.copy( hitLocal );
				slot.localVel.set( 0, 0, 0 );

			}

			// If finger/mouse moves >14px while pressed, switch smoothly from hold-drop into liquid wake glide
			if ( slot.pressing && ! slot.dragged ) {

				if ( Math.hypot( e.clientX - slot.downClientX, e.clientY - slot.downClientY ) > 14 ) {

					slot.dragged = true;
					if ( pointerHoldSlot === slot ) pointerHoldSlot = null;

				}

			}

			slot.active = true;
			slot.lastMoveTime = elapsedNow;
			slot.pressure = isMouse ? ( slot.pressing ? 1.18 : 0.62 ) : 1.12;
			slot.radiusScale = 1.0;
			lastUserInteractElapsed = elapsedNow;

		}

	}

	function onPointerUp( e ) {

		const isMouse = e.pointerType === 'mouse';
		const key = isMouse ? 'mouse' : e.pointerId;
		const slot = findSlot( key );

		if ( slot && slot.pressing && ! slot.dragged ) {

			// Tap or Press-Hold release -> release a glistening 3D water bead right into the lake!
			const heldSec = Math.max( 0, elapsedNow - slot.downTime );
			const swell = THREE.MathUtils.clamp( ( heldSec - 0.10 ) / 1.15, 0, 1 );
			const dropSize = 0.85 + swell * 0.95;
			const startH = swell > 0.08 ? ( 0.56 - swell * 0.14 ) : 1.28;
			const style = swell > 0.52 ? 2 : - 1;
			sim.releaseDrop( slot.localPos.x, slot.localPos.z, dropSize, style, startH );
			lastUserInteractElapsed = elapsedNow;

		}

		if ( pointerHoldSlot === slot ) pointerHoldSlot = null;

		if ( isMouse ) {

			if ( slot ) {

				slot.pressing = false;
				slot.dragged = false;
				slot.pressure = 0.62;

			}
			return;

		}

		releaseSlot( e.pointerId );

	}

	function onPointerLeave() {

		releaseSlot( 'mouse' );

	}

	// macOS OLED touchscreen Chrome converts single-finger drags into continuous pixel wheel events
	function onWheel( e ) {

		if ( e.ctrlKey || e.deltaMode !== 0 ) return;
		if ( e.target !== container && ! container.contains( e.target ) ) return;
		if ( e.cancelable ) e.preventDefault();

		const rect = container.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return;

		releaseSlot( 'mouse' );

		const now = performance.now();
		const isFreshGesture = ! wheelActive ||
			( now - lastWheelMs ) > 220 ||
			Math.hypot( e.clientX - wheelAnchorX, e.clientY - wheelAnchorY ) > 18;

		if ( isFreshGesture ) {

			wheelAnchorX = e.clientX;
			wheelAnchorY = e.clientY;
			wheelX = e.clientX;
			wheelY = e.clientY;
			wheelActive = true;

		}

		wheelX = Math.max( rect.left, Math.min( rect.right, wheelX - e.deltaX ) );
		wheelY = Math.max( rect.top, Math.min( rect.bottom, wheelY - e.deltaY ) );
		lastWheelMs = now;

		const slot = acquireSlot( 'wheel', false );
		if ( ! slot ) return;

		if ( projectClientToLake( wheelX, wheelY, hitWorld, hitLocal ) ) {

			slot.targetLocalPos.copy( hitLocal );
			slot.worldPos.copy( hitWorld );
			if ( isFreshGesture || ! slot.active ) {

				slot.localPos.copy( hitLocal );
				slot.prevLocalPos.copy( hitLocal );
				slot.localVel.set( 0, 0, 0 );

			}

			slot.active = true;
			slot.dragged = true;
			slot.lastMoveTime = elapsedNow;
			slot.pressure = 1.15;
			slot.radiusScale = 1.05;
			lastUserInteractElapsed = elapsedNow;

		}

	}

	container.addEventListener( 'pointerdown', onPointerDown );
	container.addEventListener( 'pointermove', onPointerMove );
	container.addEventListener( 'pointerup', onPointerUp );
	container.addEventListener( 'pointercancel', onPointerUp );
	container.addEventListener( 'pointerleave', onPointerLeave );
	container.addEventListener( 'wheel', onWheel, { passive: false } );

	engine.trackDisposable( {
		dispose() {

			container.removeEventListener( 'pointerdown', onPointerDown );
			container.removeEventListener( 'pointermove', onPointerMove );
			container.removeEventListener( 'pointerup', onPointerUp );
			container.removeEventListener( 'pointercancel', onPointerUp );
			container.removeEventListener( 'pointerleave', onPointerLeave );
			container.removeEventListener( 'wheel', onWheel );

		}
	} );

	// ---- Camera parallax & DoF focal tracking ----
	const focusPoint = new THREE.Vector3( 0, 0, 0 );
	const parallaxTarget = new THREE.Vector3( 0, 0, 0 );
	const scratchWorld = new THREE.Vector3();
	const scratchVelWorld = new THREE.Vector3();

	engine.setCameraFocusProvider( () => parallaxTarget );

	function pickNextAutoDropLocation() {

		// Choose organically balanced points across the visible still lake, well separated from last drop
		for ( let tries = 0; tries < 8; tries ++ ) {

			const rx = ( Math.random() * 2 - 1 ) * 2.15;
			const rz = ( Math.random() * 2 - 1 ) * 1.18 - 0.08;
			if ( Math.hypot( rx - lastAutoX, rz - lastAutoZ ) > 1.05 ) {

				lastAutoX = rx;
				lastAutoZ = rz;
				return [ rx, rz ];

			}

		}
		lastAutoX = - lastAutoX * 0.8;
		lastAutoZ = - lastAutoZ * 0.7;
		return [ lastAutoX, lastAutoZ ];

	}

	engine.onUpdate( ( dt, elapsed ) => {

		elapsedNow = elapsed;

		// 1. Always-alive gentle lone raindrop cadence (never completely motionless!)
		const userActiveRecently = ( elapsed - lastUserInteractElapsed ) < 3.0;
		if ( elapsed >= nextAutoDropTime ) {

			const [ ax, az ] = pickNextAutoDropLocation();
			const dropSize = 0.78 + Math.random() * 0.58;
			sim.releaseDrop( ax, az, dropSize, - 1, 1.35 + Math.random() * 0.35 );

			const baseInterval = ( 3.1 + Math.random() * 2.1 ) / Math.max( 0.25, rainScale );
			// Politely ease cadence slightly while the user is actively painting/dropping
			nextAutoDropTime = elapsed + baseInterval * ( userActiveRecently ? 1.55 : 1.0 );

		}

		// 2. Process multi-touch / mouse / wheel / hand-digit wake slots
		let strongestSpeed = 0;
		let primarySlot = null;
		let totalPan = 0;
		let totalWeight = 0;

		for ( let i = 0; i < MAX_SLOTS; i ++ ) {

			const slot = slots[ i ];

			// Gently retire stationary hover mouse slot after 1.6s of stillness
			if ( slot.isMouse && slot.active && ! slot.pressing && ( elapsed - slot.lastMoveTime ) > 1.6 ) {

				slot.active = false;

			}

			// Retire macOS touchscreen wheel slot shortly after finger lift
			if ( slot.pointerId === 'wheel' && slot.active && ( performance.now() - lastWheelMs ) > 170 ) {

				releaseSlot( 'wheel' );

			}

			if ( ! slot.active ) continue;

			slot.prevLocalPos.copy( slot.localPos );
			const k = 1 - Math.exp( - dt * 22.0 );
			slot.localPos.lerp( slot.targetLocalPos, k );
			slot.localVel.subVectors( slot.localPos, slot.prevLocalPos ).divideScalar( Math.max( dt, 1 / 240 ) );
			slot.localVel.clampLength( 0, 9.0 );

			const sp = slot.localVel.length();
			// Avoid stirring while deliberately holding still to swell a suspended droplet
			const holdingStill = slot === pointerHoldSlot && ! slot.dragged;
			if ( ! holdingStill && sp > 0.06 ) {

				sim.applyWake( slot.localPos.x, slot.localPos.z, slot.localVel.x, slot.localVel.z, slot.pressure, slot.radiusScale );

				if ( sp > strongestSpeed ) {

					strongestSpeed = sp;
					primarySlot = slot;

				}

				totalPan += THREE.MathUtils.clamp( slot.localPos.x * 0.28, - 0.85, 0.85 ) * sp;
				totalWeight += sp;

			}

		}

		// 3. Update Hold-to-Swell suspended droplet preview (either pointer hold OR webcam pinch)
		if ( handPinchHolding ) {

			const swell = THREE.MathUtils.clamp( ( elapsed - handPinchStart ) / 1.15, 0, 1 );
			surface.setHoldPreview( true, handPinchX, handPinchZ, swell );

		} else if ( pointerHoldSlot && pointerHoldSlot.pressing && ! pointerHoldSlot.dragged && ( elapsed - pointerHoldSlot.downTime ) > 0.11 ) {

			const swell = THREE.MathUtils.clamp( ( elapsed - pointerHoldSlot.downTime - 0.11 ) / 1.15, 0, 1 );
			surface.setHoldPreview( true, pointerHoldSlot.localPos.x, pointerHoldSlot.localPos.z, swell );

		} else {

			surface.setHoldPreview( false );

		}

		// 4. Advance coupled 2D wave + thin-film Marangoni PDE & update 3D lake surface
		sim.step( dt );
		surface.update( dt, elapsed );

		// 5. Feed GPU mist motes + subtle specular touch light + gentle parallax
		if ( primarySlot ) {

			scratchWorld.copy( primarySlot.localPos ).applyQuaternion( fwdLakeQuat );
			scratchVelWorld.copy( primarySlot.localVel ).applyQuaternion( fwdLakeQuat );
			mist.setWake( scratchWorld, scratchVelWorld, Math.min( 1.0, strongestSpeed * 0.35 ) );

			touchLight.position.lerp(
				scratchWorld.clone().add( lakeNormal.clone().multiplyScalar( 0.65 ) ),
				1 - Math.exp( - dt * 10.0 )
			);
			const targetInt = touchCfg.activeIntensity * Math.min( 1.0, strongestSpeed * 0.35 );
			touchLight.intensity += ( targetInt - touchLight.intensity ) * ( 1 - Math.exp( - dt * 8.0 ) );
			parallaxTarget.lerp( scratchWorld, 1 - Math.exp( - dt * 2.4 ) );

		} else {

			mist.setWake( null, null, 0 );
			touchLight.intensity *= Math.exp( - dt * 5.0 );
			// Subtle organic twilight camera breathing even when hands-off so viewing-angle iridescence gently shimmers
			const driftX = Math.sin( elapsed * 0.24 ) * 0.42;
			const driftY = Math.cos( elapsed * 0.19 ) * 0.24;
			parallaxTarget.lerp( scratchWorld.set( driftX, driftY, 0 ), 1 - Math.exp( - dt * 1.6 ) );

		}

		// 6. Stream live physical telemetry to the 48 kHz AudioWorklet ASMR engine
		if ( audio ) {

			const avgPan = totalWeight > 0.01 ? ( totalPan / totalWeight ) : 0;
			const glideSpeed = Math.min( 2.0, strongestSpeed * 0.26 );
			audio.updateTelemetry( {
				speed: glideSpeed,
				pan: avgPan,
				pressure: 0.55 + sim.rippleEnergy * 0.5,
				breath: liveBreathEnergy,
				stillGlow: sim.bloomEnergy,
				slowGlide: glideSpeed > 0.08 && glideSpeed < 0.9 ? 0.75 : 0
			}, dt );

		}

	} );

	engine.setPostStateProvider( () => ( {
		focusWorldPoint: focusPoint,
		hazeWorldPos: keyRig.spot.position,
		hazeLightColor: keyRig.spot.color,
		hazeIntensity: 0.025
	} ) );

	engine.start();

	return {
		engine,
		sim,
		surface,
		mist,
		setSurfaceMode( mode ) {

			surface.setSurfaceMode( mode );

		},
		setThicknessScale( v ) {

			const clamped = THREE.MathUtils.clamp( v, 0.45, 1.9 );
			surface.setThicknessScale( clamped );
			mist.setThicknessScale( clamped );

		},
		setViscosity( v ) {

			sim.setViscosity( v );

		},
		setRainRate( v ) {

			rainScale = THREE.MathUtils.clamp( v, 0.3, 2.5 );
			// Nudge next drop sooner if user turned Still Drops up
			const maxWait = 4.6 / rainScale;
			if ( nextAutoDropTime - elapsedNow > maxWait ) nextAutoDropTime = elapsedNow + maxWait * 0.5;

		},
		triggerDropBead() {

			const jx = ( Math.random() - 0.5 ) * 0.48;
			const jz = ( Math.random() - 0.5 ) * 0.32;
			sim.releaseDrop( jx, jz, 1.25, - 1, 1.45 );
			lastUserInteractElapsed = elapsedNow;

		},
		triggerMarangoniGust() {

			sim.triggerMarangoniGust( 0, 0 );
			if ( audio ) audio.triggerGust( 0 );
			lastUserInteractElapsed = elapsedNow;

		},
		applyBreath( breath ) {

			if ( ! breath || ! breath.active ) {

				liveBreathEnergy = 0;
				sim.setBreathWind( 0, 0 );
				mist.setBreathWind( 0, 0 );
				releaseSlot( 'breath' );
				return;

			}

			liveBreathEnergy = breath.energy;
			sim.setBreathWind( breath.energy, breath.steerX );
			mist.setBreathWind( breath.energy, breath.steerX );

			// Strong breath puff -> dramatic Marangoni starburst gust + satellite drops!
			if ( breath.puff ) {

				const gx = breath.mode === 'steer' ? breath.steerX * 1.4 : 0;
				sim.triggerMarangoniGust( gx, 0 );
				if ( audio ) audio.triggerGust( breath.steerX * 0.6 );
				lastUserInteractElapsed = elapsedNow;

			}

			// Phase 2 ('steer'): blowing guides a soft airy wake horizontally across the still lake
			if ( breath.mode === 'steer' && breath.energy > 0.08 ) {

				const slot = acquireSlot( 'breath', false );
				if ( slot && projectNdcToLake( breath.steerX * 0.80, breath.steerY * 0.45, hitWorld, hitLocal ) ) {

					const wasInactive = ! slot.active;
					slot.targetLocalPos.copy( hitLocal );
					slot.worldPos.copy( hitWorld );
					if ( wasInactive ) {

						slot.localPos.copy( hitLocal );
						slot.prevLocalPos.copy( hitLocal );
						slot.localVel.set( 0, 0, 0 );

					}
					slot.active = true;
					slot.dragged = true;
					slot.lastMoveTime = elapsedNow;
					slot.pressure = 0.55 + breath.energy * 0.8;
					slot.radiusScale = 1.25;
					lastUserInteractElapsed = elapsedNow;

				}

			} else {

				releaseSlot( 'breath' );

			}

		},
		applyHands( hand ) {

			if ( ! hand || ! hand.enabled || ! hand.detected ) {

				if ( handsControlling ) {

					handsControlling = false;
					if ( handPinchHolding ) {

						handPinchHolding = false;
						sim.releaseDrop( handPinchX, handPinchZ, 1.15, - 1, 0.56 );

					}
					for ( const id of activeHandIds ) releaseSlot( id );
					activeHandIds.clear();

				}
				return;

			}

			handsControlling = true;
			releaseSlot( 'mouse' );
			lastUserInteractElapsed = elapsedNow;

			// Hand Sweep triggers a graceful Marangoni Gust!
			if ( hand.sweepTriggered ) {

				sim.triggerMarangoniGust( 0, 0 );
				if ( audio ) audio.triggerGust( hand.ndcX * 0.6 );

			}

			// Pinch holds a glowing suspended water drop; releasing the pinch drops it into the lake!
			if ( hand.posture === 'pinch' ) {

				if ( projectNdcToLake( hand.ndcX, hand.ndcY, hitWorld, hitLocal ) ) {

					if ( ! handPinchHolding ) {

						handPinchHolding = true;
						handPinchStart = elapsedNow;

					}
					handPinchX += ( hitLocal.x - handPinchX ) * 0.35;
					handPinchZ += ( hitLocal.z - handPinchZ ) * 0.35;

				}

			} else if ( handPinchHolding ) {

				const swell = THREE.MathUtils.clamp( ( elapsedNow - handPinchStart ) / 1.15, 0, 1 );
				sim.releaseDrop( handPinchX, handPinchZ, 0.92 + swell * 0.95, swell > 0.45 ? 2 : - 1, 0.54 - swell * 0.12 );
				handPinchHolding = false;

			}

			// Open palm hovering closer (Z-depth) presses a serene air-cushion halo onto the still lake
			if ( hand.posture === 'open' && projectNdcToLake( hand.ndcX, hand.ndcY, hitWorld, hitLocal ) ) {

				sim.applyPalmCushion( hitLocal.x, hitLocal.z, 0.32 + hand.proximity * 0.72, 0.9 + hand.proximity * 0.85 );

			}

			// Release stale digit IDs first so posture transitions never starve multi-digit slots
			const nextIds = new Set( hand.digits.map( ( d ) => d.id ) );
			for ( const id of activeHandIds ) {

				if ( ! nextIds.has( id ) ) {

					releaseSlot( id );
					activeHandIds.delete( id );

				}

			}

			// Map extended webcam digits cleanly onto water wakes (skip while pinching to hold a drop)
			if ( hand.posture !== 'pinch' ) {

				for ( const d of hand.digits ) {

					activeHandIds.add( d.id );
					const slot = acquireSlot( d.id, false );
					if ( ! slot ) continue;

					if ( projectNdcToLake( d.ndcX, d.ndcY, hitWorld, hitLocal ) ) {

						const wasInactive = ! slot.active;
						slot.targetLocalPos.copy( hitLocal );
						slot.worldPos.copy( hitWorld );
						if ( wasInactive ) {

							slot.localPos.copy( hitLocal );
							slot.prevLocalPos.copy( hitLocal );
							slot.localVel.set( 0, 0, 0 );

						}
						slot.active = true;
						slot.dragged = true;
						slot.lastMoveTime = elapsedNow;
						slot.pressure = d.pressure * ( hand.posture === 'point' ? 1.15 : 0.82 );
						slot.radiusScale = hand.posture === 'point'
							? ( 0.65 + hand.proximity * 0.35 )
							: ( 0.85 + hand.proximity * 0.55 );

					}

				}

			}

		},
		dispose: () => engine.dispose()
	};

}
