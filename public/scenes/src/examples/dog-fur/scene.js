import * as THREE from 'three/webgpu';
import {
	createCollisionEngine,
	createGoboSpotLight,
	createProceduralEnvironment,
	createLightShaft
} from '../../engine/index.js';
import { DOG_FUR_CONFIG } from './config.js';
import { createDogBody, evalDogSurface, evalBreathAmount } from './body.js';
import { createDogFurSystem } from './fur.js';

// "Petting Fur" — tactile macro interactive dog coat experience designed for
// touch screens (multi-touch / 5-digit hand petting), breath, and pointer interfaces.
// Morphs live between Black Labrador, Husky, and Bernese Mountain Dog coats.

export async function createDogFurExperience( { container, config = DOG_FUR_CONFIG, audio = null } ) {

	const engine = await createCollisionEngine( {
		container,
		background: config.background,
		tiers: config.tiers,
		camera: config.camera,
		post: config.post,
		enableOverlayScene: true
	} );

	const { renderer, scene, overlayScene, camera, quality, post } = engine;

	// ---- Golden-hour living room studio lighting ----
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
		goboScale: 1.65,
		goboSpeed: 0.018,
		goboContrast: 0.24,
		rimTint: [ 1.0, 0.84, 0.56 ]
	} );
	keyRig.spot.castShadow = true;
	keyRig.spot.shadow.mapSize.setScalar( quality.shadowMap || 1536 );
	keyRig.spot.shadow.bias = keyCfg.shadowBias;
	keyRig.spot.shadow.normalBias = keyCfg.shadowNormalBias;
	keyRig.spot.shadow.camera.near = 1.0;
	keyRig.spot.shadow.camera.far = keyCfg.distance;

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

	// Subtle warm haptic light hovering gently above the active petting fingertip
	const touchCfg = config.light.touchLight;
	const touchLight = new THREE.PointLight( touchCfg.color, 0, touchCfg.distance, touchCfg.decay );
	touchLight.position.set( 0, 0.4, 1.2 );
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

	// ---- Warm afternoon sunbeams softly filtering behind the backlit fur crest ----
	const sunShafts = ( config.light.sunShafts || [] ).map( ( cfg ) => {

		const s = createLightShaft( {
			scene,
			camera,
			apex: cfg.apex,
			target: cfg.target,
			angle: cfg.angle,
			color: cfg.color,
			rimTint: cfg.rimTint,
			strength: cfg.strength,
			blurGrowth: cfg.blurGrowth,
			renderOrder: 1
		} );
		engine.trackDisposable( s );
		return s;

	} );

	// ---- Curved canine body undercoat & GPU fur coat + floating sunlit motes ----
	const dogBody = createDogBody( { scene, config, environment, sceneLights } );
	engine.trackDisposable( dogBody );

	const fur = createDogFurSystem( {
		scene,
		overlayScene,
		config,
		quality,
		environment,
		sceneLights,
		keyLightPos: keyRig.spot.position,
		rimLightPos: rimLight.position,
		lens: post.lens
	} );
	engine.addSystem( fur );

	// ---- Multi-touch & pointer surface petting tracker (up to 3 simultaneous fingers) ----
	const MAX_SLOTS = config.interaction.maxTouches || 3;
	const slots = Array.from( { length: MAX_SLOTS }, () => ( {
		pointerId: null,
		isMouse: false,
		active: false,
		activeSmooth: 0,
		pressure: 1.0,
		pos: new THREE.Vector3( 0, - 99, 0 ),
		prevPos: new THREE.Vector3( 0, - 99, 0 ),
		targetPos: new THREE.Vector3( 0, 0.1, 0.65 ),
		vel: new THREE.Vector3(),
		lastMoveTime: - 10
	} ) );

	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const fallbackPlane = new THREE.Plane( new THREE.Vector3( 0, 0.25, 0.968 ).normalize(), - 0.58 );
	const hitScratch = new THREE.Vector3();
	const autoPos = new THREE.Vector3();
	const autoNorm = new THREE.Vector3();

	let mouseDown = false;
	let hasUserInteracted = false;
	let lastInteractElapsed = - 10;
	let elapsedNow = 0;
	let userPressureSetting = config.interaction.defaultPressure;
	let liveBreathEnergy = 0;
	let handsControlling = false;
	let targetRadiusScale = 1.0;
	let smoothRadiusScale = 1.0;
	const activeHandIds = new Set();

	function projectNdcToDogSurface( nx, ny, out ) {

		ndc.x = THREE.MathUtils.clamp( nx, - 1, 1 );
		ndc.y = THREE.MathUtils.clamp( ny, - 1, 1 );

		raycaster.setFromCamera( ndc, camera );
		const hits = raycaster.intersectObject( dogBody.mesh, false );
		if ( hits.length > 0 ) {

			out.copy( hits[ 0 ].point );
			return true;

		}

		// Graceful fallback across the sunlit top silhouette crest so sweeping fingers
		// (or upright open webcam fingertips) right along the glowing ridge still brush the fur!
		if ( raycaster.ray.intersectPlane( fallbackPlane, hitScratch ) ) {

			if ( hitScratch.y > 0.44 ) {

				const uClamp = THREE.MathUtils.clamp( hitScratch.x / 2.25, - 0.92, 0.92 );
				evalDogSurface( uClamp, 0.72, out, autoNorm, null );
				return true;

			}

			out.copy( hitScratch );
			return true;

		}

		return false;

	}

	function projectToDogSurface( clientX, clientY, out ) {

		const rect = container.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return false;

		const nx = ( ( clientX - rect.left ) / rect.width ) * 2 - 1;
		const ny = - ( ( clientY - rect.top ) / rect.height ) * 2 + 1;
		return projectNdcToDogSurface( nx, ny, out );

	}

	function findSlotByPointer( id ) {

		for ( const s of slots ) if ( s.pointerId === id ) return s;
		return null;

	}

	function acquireSlot( pointerId, isMouse ) {

		const existing = findSlotByPointer( pointerId );
		if ( existing ) return existing;

		// Prefer inactive slots first
		for ( const s of slots ) {

			if ( ! s.active && s.pointerId === null ) {

				s.pointerId = pointerId;
				s.isMouse = isMouse;
				return s;

			}

		}

		// Touch takes priority over hover mouse slot
		if ( ! isMouse ) {

			for ( const s of slots ) {

				if ( s.isMouse ) {

					s.pointerId = pointerId;
					s.isMouse = false;
					return s;

				}

			}

		}

		return null;

	}

	function releaseSlot( pointerId ) {

		const s = findSlotByPointer( pointerId );
		if ( ! s ) return;
		s.active = false;
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

		// Ignore taps on HUD controls overlaid above the canvas
		if ( e.target !== container && ! container.contains( e.target ) ) return;

		wheelActive = false;
		releaseSlot( 'wheel' );
		hasUserInteracted = true;
		lastInteractElapsed = elapsedNow;

		const isMouse = e.pointerType === 'mouse';
		if ( isMouse ) mouseDown = true;

		const key = isMouse ? 'mouse' : e.pointerId;
		const slot = acquireSlot( key, isMouse );
		if ( ! slot ) return;

		if ( ! isMouse && container.setPointerCapture ) {

			try { container.setPointerCapture( e.pointerId ); } catch {}

		}

		if ( projectToDogSurface( e.clientX, e.clientY, hitScratch ) ) {

			slot.targetPos.copy( hitScratch );
			// Snap immediately on fresh touch contact to avoid velocity jump
			if ( ! slot.active ) {

				slot.pos.copy( hitScratch );
				slot.prevPos.copy( hitScratch );
				slot.vel.set( 0, 0, 0 );

			}

			slot.active = true;
			slot.lastMoveTime = elapsedNow;
			const nativeP = typeof e.pressure === 'number' && e.pressure > 0.05 ? e.pressure : 0.5;
			slot.pressure = isMouse ? 1.32 : ( 0.88 + nativeP * 0.65 );

			if ( audio ) {

				const pan = THREE.MathUtils.clamp( slot.targetPos.x * 0.42, - 0.85, 0.85 );
				audio.triggerPlink( pan, 0.35 );

			}

		}

	}

	function onPointerMove( e ) {

		const isMouse = e.pointerType === 'mouse';
		const key = isMouse ? 'mouse' : e.pointerId;

		if ( isMouse ) {

			if ( handsControlling ) return;

			const now = performance.now();
			// Ignore macOS touchscreen's automatic cursor snap-back right after a finger-swipe ends
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

		let slot = findSlotByPointer( key );
		if ( ! slot && isMouse ) {

			// Desktop hover glides gently over the fur without needing click-hold
			slot = acquireSlot( 'mouse', true );

		}
		if ( ! slot ) return;

		if ( projectToDogSurface( e.clientX, e.clientY, hitScratch ) ) {

			const wasInactive = ! slot.active;
			slot.targetPos.copy( hitScratch );
			if ( wasInactive ) {

				slot.pos.copy( hitScratch );
				slot.prevPos.copy( hitScratch );
				slot.vel.set( 0, 0, 0 );

			}

			slot.active = true;
			slot.lastMoveTime = elapsedNow;
			hasUserInteracted = true;
			lastInteractElapsed = elapsedNow;

			if ( isMouse ) {

				slot.pressure = mouseDown ? 1.35 : 0.85;

			} else {

				const nativeP = typeof e.pressure === 'number' && e.pressure > 0.05 ? e.pressure : 0.55;
				slot.pressure = 0.88 + nativeP * 0.65;

			}

		}

	}

	function onPointerUp( e ) {

		const isMouse = e.pointerType === 'mouse';
		if ( isMouse ) {

			mouseDown = false;
			const slot = findSlotByPointer( 'mouse' );
			if ( slot ) slot.pressure = 0.85;
			return;

		}

		releaseSlot( e.pointerId );

	}

	function onPointerLeave() {

		mouseDown = false;
		releaseSlot( 'mouse' );

	}

	// macOS touchscreen Chrome converts single-finger drags into continuous pixel wheel events
	// anchored at the touch-start point (deltaX/Y are negative CSS pixels of finger movement).
	// Leaves iOS multi-touch (no wheel events) and desktop mouse hover/click 100% unchanged.
	function onWheel( e ) {

		if ( e.ctrlKey || e.deltaMode !== 0 ) return;
		if ( e.target !== container && ! container.contains( e.target ) ) return;
		if ( e.cancelable ) e.preventDefault();

		const rect = container.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return;

		// Pause stationary mouse hover slot so the finger swipe owns the coat cleanly
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

		if ( projectToDogSurface( wheelX, wheelY, hitScratch ) ) {

			slot.targetPos.copy( hitScratch );
			if ( isFreshGesture || ! slot.active ) {

				slot.pos.copy( hitScratch );
				slot.prevPos.copy( hitScratch );
				slot.vel.set( 0, 0, 0 );

			}

			slot.active = true;
			slot.lastMoveTime = elapsedNow;
			slot.pressure = 1.28;
			hasUserInteracted = true;
			lastInteractElapsed = elapsedNow;

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

	// ---- Sunbeam warmth lighting controller ----
	let sunWarmth = config.interaction.defaultWarmth;
	const coolKeyColor = new THREE.Color( 0xd8e6ff );
	const warmKeyColor = new THREE.Color( 0xffca84 );
	const coolRimColor = new THREE.Color( 0xb6d4ff );
	const warmRimColor = new THREE.Color( 0xffaa52 );

	function applySunWarmthLighting( w ) {

		const t = THREE.MathUtils.clamp( ( w - 0.25 ) / 1.4, 0, 1 );
		keyRig.spot.color.copy( coolKeyColor ).lerp( warmKeyColor, t );
		keyRig.spot.intensity = keyCfg.intensity * ( 0.65 + 0.52 * w );
		rimLight.color.copy( coolRimColor ).lerp( warmRimColor, t );
		rimLight.intensity = rimCfg.intensity * ( 0.52 + 0.68 * w );
		hemiLight.intensity = hemiCfg.intensity * ( 0.78 + 0.25 * w );

	}
	applySunWarmthLighting( sunWarmth );

	// ---- Focus & parallax tracking ----
	const focusPoint = new THREE.Vector3( 0, 0.14, 0.68 );
	const parallaxTarget = new THREE.Vector3( 0, 0.10, 0.5 );

	engine.setCameraFocusProvider( () => parallaxTarget );

	engine.onUpdate( ( dt, elapsed ) => {

		elapsedNow = elapsed;

		// Keep undercoat markings and breathing synced smoothly with fur coat
		const weights = fur.getBreedWeights();
		dogBody.setBreedWeights( weights.labrador, weights.husky, weights.bernese );
		dogBody.update( elapsed );

		for ( const s of sunShafts ) s.update( fur.reveal * sunWarmth );

		// Smooth touch radius scaling driven by webcam Z-proximity & hand posture (1.0 for mouse/touch)
		smoothRadiusScale += ( targetRadiusScale - smoothRadiusScale ) * ( 1 - Math.exp( - dt * 10.0 ) );
		fur.setTouchRadiusScale( smoothRadiusScale );

		// Idle gentle invisible petting caress when untouched for a few seconds so
		// first-time visitors immediately feel the living softness of the coat
		const idleSeconds = elapsed - lastInteractElapsed;
		const useAutopilot = ! hasUserInteracted || idleSeconds > 5.5;

		let primarySlot = null;
		let strongestActive = 0;
		let totalPetSpeed = 0;
		let totalPanWeighted = 0;
		let totalAgainstWeighted = 0;
		let activeCount = 0;

		for ( let i = 0; i < MAX_SLOTS; i ++ ) {

			const slot = slots[ i ];

			// Fade desktop hover slot softly if mouse stops moving for > 2.4s without press
			if ( slot.isMouse && slot.active && ! mouseDown && ( elapsed - slot.lastMoveTime ) > 2.4 ) {

				slot.active = false;

			}

			// Release macOS touchscreen wheel-swipe slot shortly after the finger lifts
			if ( slot.pointerId === 'wheel' && slot.active && ( performance.now() - lastWheelMs ) > 180 ) {

				releaseSlot( 'wheel' );

			}

			if ( i === 0 && useAutopilot && ! slot.active ) {

				// Slow, affectionate figure-eight petting stroke along the dog's shoulder & back
				const phase = elapsed * 0.68;
				const uAuto = Math.sin( phase ) * 0.52;
				const vAuto = 0.08 + Math.sin( phase * 2.0 ) * 0.26;
				evalDogSurface( uAuto, vAuto, autoPos, autoNorm, null );

				slot.prevPos.copy( slot.pos );
				if ( slot.pos.y < - 20 ) {

					slot.pos.copy( autoPos );
					slot.prevPos.copy( autoPos );

				} else {

					slot.pos.lerp( autoPos, 1 - Math.exp( - dt * 8.0 ) );

				}

				slot.vel.subVectors( slot.pos, slot.prevPos ).divideScalar( Math.max( dt, 1 / 240 ) );
				slot.vel.clampLength( 0, 4.5 );
				const autoStrength = 0.58 * ( 0.65 + 0.35 * Math.cos( phase ) );
				slot.activeSmooth += ( autoStrength - slot.activeSmooth ) * ( 1 - Math.exp( - dt * 5.0 ) );

			} else {

				slot.prevPos.copy( slot.pos );
				const followK = 1 - Math.exp( - dt * 22.0 );
				slot.pos.lerp( slot.targetPos, followK );

				if ( slot.active ) {

					slot.vel.subVectors( slot.pos, slot.prevPos ).divideScalar( Math.max( dt, 1 / 240 ) );
					slot.vel.clampLength( 0, 6.5 );

				} else {

					slot.vel.multiplyScalar( Math.exp( - dt * 12.0 ) );

				}

				const targetA = slot.active ? slot.pressure : 0;
				const fadeRate = slot.active ? 16.0 : 6.5;
				slot.activeSmooth += ( targetA - slot.activeSmooth ) * ( 1 - Math.exp( - dt * fadeRate ) );

			}

			fur.setTouchSlot( i, slot.pos, slot.vel, slot.activeSmooth );

			if ( slot.activeSmooth > strongestActive ) {

				strongestActive = slot.activeSmooth;
				primarySlot = slot;

			}

			// Aggregate tactile petting telemetry for AudioEngine (independent of input source)
			if ( slot.activeSmooth > 0.05 && ! ( i === 0 && useAutopilot && ! slot.active ) ) {

				const sp = slot.vel.length();
				totalPetSpeed += sp * slot.activeSmooth;
				totalPanWeighted += THREE.MathUtils.clamp( slot.pos.x * 0.42, - 0.85, 0.85 ) * slot.activeSmooth;
				// Negative X velocity strokes against the coat's natural neck-to-hip grain
				const ag = slot.vel.x < - 0.05 ? Math.min( 1, ( - slot.vel.x ) / Math.max( 0.25, sp ) ) : 0;
				totalAgainstWeighted += ag * slot.activeSmooth;
				activeCount += slot.activeSmooth;

			}

		}

		if ( audio ) {

			const avgSpeed = activeCount > 0.01 ? Math.min( 2.2, ( totalPetSpeed / activeCount ) * 0.34 ) : 0;
			const avgPan = activeCount > 0.01 ? ( totalPanWeighted / activeCount ) : 0;
			const avgAgainst = activeCount > 0.01 ? ( totalAgainstWeighted / activeCount ) : 0;

			audio.updateTelemetry( {
				speed: avgSpeed,
				pan: avgPan,
				pressure: userPressureSetting * Math.max( 0.65, Math.min( 1.6, strongestActive ) ),
				breath: liveBreathEnergy,
				dogBreath: evalBreathAmount( elapsed ),
				breedLab: weights.labrador,
				breedHusky: weights.husky,
				breedBernese: weights.bernese,
				againstGrain: avgAgainst
			}, dt );

		}

		// Smoothly float warm haptic touch pool & camera focus around active petting zone
		if ( primarySlot && strongestActive > 0.04 ) {

			touchLight.position.lerp(
				hitScratch.copy( primarySlot.pos ).add( new THREE.Vector3( 0, 0.22, 0.42 ) ),
				1 - Math.exp( - dt * 10.0 )
			);
			const targetLightInt = touchCfg.activeIntensity * Math.min( 1.25, strongestActive ) * ( 0.45 + 0.55 * sunWarmth );
			touchLight.intensity += ( targetLightInt - touchLight.intensity ) * ( 1 - Math.exp( - dt * 8.0 ) );

			parallaxTarget.lerp( primarySlot.pos, 1 - Math.exp( - dt * 3.5 ) );
			focusPoint.lerp( primarySlot.pos, 1 - Math.exp( - dt * 4.5 ) );

		} else {

			touchLight.intensity *= Math.exp( - dt * 6.0 );
			parallaxTarget.lerp( hitScratch.set( 0, 0.10, 0.55 ), 1 - Math.exp( - dt * 2.0 ) );
			focusPoint.lerp( hitScratch.set( 0, 0.14, 0.68 ), 1 - Math.exp( - dt * 2.0 ) );

		}

	} );

	engine.setPostStateProvider( () => ( {
		focusWorldPoint: focusPoint,
		hazeWorldPos: keyRig.spot.position,
		hazeLightColor: keyRig.spot.color,
		hazeIntensity: 0.75 * sunWarmth
	} ) );

	engine.start();

	return {
		engine,
		dogBody,
		fur,
		setBreed( breed ) {

			fur.setBreed( breed );

		},
		setTouchPressure( v ) {

			userPressureSetting = Math.max( 0.25, Math.min( 2.2, v ) );
			fur.setTouchPressure( userPressureSetting );

		},
		setCoatSoftness( v ) {

			fur.setCoatSoftness( v );

		},
		setSunbeamWarmth( v ) {

			sunWarmth = Math.max( 0.2, Math.min( 2.2, v ) );
			fur.setSunWarmth( sunWarmth );
			dogBody.setSunWarmth( sunWarmth );
			applySunWarmthLighting( sunWarmth );

		},
		triggerShakeOff() {

			fur.triggerShakeOff();
			if ( audio ) audio.triggerShakeOff();

		},
		triggerSmoothCoat() {

			fur.triggerSmoothCoat();
			if ( audio ) audio.triggerSmoothCoat();

		},
		applyBreath( breath ) {

			if ( ! breath || ! breath.active ) {

				liveBreathEnergy = 0;
				fur.setBreathWind( 0, 0 );
				releaseSlot( 'breath' );
				return;

			}

			liveBreathEnergy = breath.energy;
			fur.setBreathWind( breath.energy, breath.steerX );

			// Strong breath puff triggers Shake Off!
			if ( breath.puff ) {

				fur.triggerShakeOff();
				if ( audio ) audio.triggerShakeOff();

			}

			// Phase 2 ('steer'): blowing glides a gentle warm air caress horizontally across the coat
			if ( breath.mode === 'steer' && breath.energy > 0.08 ) {

				const slot = acquireSlot( 'breath', false );
				if ( slot && projectNdcToDogSurface( breath.steerX * 0.82, breath.steerY * 0.45, hitScratch ) ) {

					const wasInactive = ! slot.active;
					slot.targetPos.copy( hitScratch );
					if ( wasInactive ) {

						slot.pos.copy( hitScratch );
						slot.prevPos.copy( hitScratch );
						slot.vel.set( 0, 0, 0 );

					}
					slot.active = true;
					slot.lastMoveTime = elapsedNow;
					slot.pressure = 0.65 + breath.energy * 0.85;
					hasUserInteracted = true;
					lastInteractElapsed = elapsedNow;

				}

			} else {

				releaseSlot( 'breath' );

			}

		},
		applyHands( hand ) {

			if ( ! hand || ! hand.enabled || ! hand.detected ) {

				if ( handsControlling ) {

					handsControlling = false;
					targetRadiusScale = 1.0;
					fur.setTouchPressure( userPressureSetting );
					if ( liveBreathEnergy < 0.01 ) fur.setBreathWind( 0, 0 );
					for ( const id of activeHandIds ) releaseSlot( id );
					activeHandIds.clear();

				}
				return;

			}

			handsControlling = true;
			releaseSlot( 'mouse' );

			// Z-axis distance to camera & single-finger vs. open-palm scale pressure & touch area size
			fur.setTouchPressure( THREE.MathUtils.clamp( userPressureSetting * hand.pressureScale, 0.35, 2.2 ) );
			targetRadiusScale = hand.posture === 'point'
				? THREE.MathUtils.clamp( 0.48 + hand.proximity * 0.42, 0.45, 1.05 )
				: ( hand.posture === 'open'
					? THREE.MathUtils.clamp( 0.85 + hand.proximity * 0.78, 0.75, 1.75 )
					: THREE.MathUtils.clamp( 0.75 + hand.proximity * 0.70, 0.65, 1.65 ) );

			// Subtle warm palm-breeze wake when holding an open hand close to the coat
			if ( liveBreathEnergy < 0.05 ) {

				const palmBreeze = hand.posture === 'open' ? ( 0.14 + hand.proximity * 0.28 ) : 0;
				fur.setBreathWind( palmBreeze, hand.ndcX );

			}

			if ( hand.sweepTriggered ) {

				fur.triggerShakeOff();
				if ( audio ) audio.triggerShakeOff();

			}

			// Release stale hand digit IDs FIRST so fist -> 5-finger open transitions never starve slots!
			const nextIds = new Set( hand.digits.map( ( d ) => d.id ) );
			for ( const id of activeHandIds ) {

				if ( ! nextIds.has( id ) ) {

					releaseSlot( id );
					activeHandIds.delete( id );

				}

			}

			// Map up to 5 independently tracked extended digits simultaneously across slots 0..4
			for ( const d of hand.digits ) {

				activeHandIds.add( d.id );
				const slot = acquireSlot( d.id, false );
				if ( ! slot ) continue;

				if ( projectNdcToDogSurface( d.ndcX, d.ndcY, hitScratch ) ) {

					const wasInactive = ! slot.active;
					slot.targetPos.copy( hitScratch );
					if ( wasInactive ) {

						slot.pos.copy( hitScratch );
						slot.prevPos.copy( hitScratch );
						slot.vel.set( 0, 0, 0 );

					}

					slot.active = true;
					slot.lastMoveTime = elapsedNow;
					slot.pressure = d.pressure;
					hasUserInteracted = true;
					lastInteractElapsed = elapsedNow;

				}

			}

		},
		dispose: () => engine.dispose()
	};

}
