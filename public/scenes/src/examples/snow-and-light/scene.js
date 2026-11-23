import * as THREE from 'three/webgpu';
import {
	createCollisionEngine,
	createCollider,
	createLightShaft
} from '../../engine/index.js';
import { SNOW_AND_LIGHT_CONFIG } from './config.js';
import { createSnowLightStudio } from './studio.js';
import { createOrbVisuals } from './orbVisuals.js';
import { createSnowSwarm } from './swarm.js';

// "Snow & Light" interactive experience built on the `src/engine` framework.

export async function createSnowAndLightExperience( {
	container,
	config = SNOW_AND_LIGHT_CONFIG,
	audio = null
} ) {

	const engine = await createCollisionEngine( {
		container,
		background: config.background,
		tiers: config.tiers,
		camera: config.camera,
		post: config.post,
		enableOverlayScene: true
	} );

	const { renderer, scene, overlayScene, camera, frame, quality, post, colliders, triggers } = engine;

	const collider = createCollider( {
		camera,
		element: container,
		mode: 'plane',
		planeNormal: new THREE.Vector3( 0, 0, 1 ),
		planeConstant: 0,
		radius: config.orb.shieldRadius,
		stiffness: config.orb.stiffness,
		damping: config.orb.damping,
		maxSpeed: config.orb.maxSpeed,
		depthSway: config.orb.depthSway,
		idleAfter: config.orb.idleAfter,
		chargeScale: config.orb.chargeScale,
		floorY: config.world.floorY,
		onPress: ( nx ) => {

			if ( audio ) audio.triggerPlink( THREE.MathUtils.clamp( nx * 0.85, - 0.85, 0.85 ), 0.68 );

		}
	} );
	colliders.add( collider );
	collider.setBounds( frame.halfWidth, frame.halfHeight, frame.centerY );

	const orbVisuals = createOrbVisuals( { scene, config, quality, collider } );
	engine.addSystem( orbVisuals );

	const studio = createSnowLightStudio( { scene, renderer, config, orbLight: orbVisuals.light } );
	engine.trackDisposable( studio );

	const deepBlueShafts = ( config.light.deepBlueShafts || [] ).map( ( cfg ) => {

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

	const shaft = createLightShaft( {
		scene,
		camera,
		apex: config.light.spot.position,
		target: config.light.spot.target,
		angle: config.light.spot.angle,
		color: config.light.spot.color,
		strength: config.light.shaft,
		renderOrder: 2
	} );
	engine.trackDisposable( shaft );

	const swarm = createSnowSwarm( {
		scene,
		overlayScene,
		config,
		quality,
		collider,
		orbLight: orbVisuals.light,
		rig: studio.rig,
		environment: studio.environment,
		lens: post.lens,
		frame
	} );
	engine.addSystem( swarm );

	let rayIntensity = 1.0;
	let userFieldMode = 'repel';
	let effectiveVortex = false;
	let userBlizzardDrift = 1.0;
	let userFieldRadius = 1.0;
	let breathEnergy = 0;
	let handDriverActive = false;
	let breathSteerActive = false;
	let prevHandVortexHold = false;
	let stillWarmAccum = 0;

	function syncVortexState( handPinchOrFist = false ) {

		const nextVortex = userFieldMode === 'vortex' || handPinchOrFist;
		if ( nextVortex !== effectiveVortex ) {

			effectiveVortex = nextVortex;
			swarm.setFieldMode( effectiveVortex ? 'vortex' : 'repel' );
			orbVisuals.setVortexMode( effectiveVortex );

		}

	}

	// ---- Serene drifting prisms: Starlight Drift (score-free visual + glass-chime ripples) ----
	const BEACON_COUNT = 5;
	const beaconGroup = new THREE.Group();
	beaconGroup.visible = false;
	scene.add( beaconGroup );

	const beaconCoreGeo = new THREE.OctahedronGeometry( 0.11, 0 );
	beaconCoreGeo.scale( 0.78, 1.38, 0.78 );
	const beaconHaloGeo = new THREE.OctahedronGeometry( 0.21, 0 );
	beaconHaloGeo.scale( 0.85, 1.35, 0.85 );

	const beaconCoreMat = new THREE.MeshBasicNodeMaterial( {
		color: 0xd8f3ff,
		transparent: true,
		opacity: 0.94,
		blending: THREE.AdditiveBlending,
		depthWrite: false
	} );
	const beaconHaloMat = new THREE.MeshBasicNodeMaterial( {
		color: 0x56c8ff,
		transparent: true,
		opacity: 0.34,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		wireframe: true
	} );

	const beacons = [];
	let gameMode = false;
	let elapsedTime = 0;

	function pickStarlightAnchor( out, avoid ) {

		const rx = Math.max( 1.2, frame.halfWidth * 0.68 );
		const minY = config.world.floorY + 0.58;
		const maxY = Math.max( minY + 1.2, frame.centerY + frame.halfHeight * 0.62 );

		for ( let attempt = 0; attempt < 16; attempt ++ ) {

			const x = ( Math.random() * 2 - 1 ) * rx;
			const y = minY + Math.random() * ( maxY - minY );
			const z = ( Math.random() * 2 - 1 ) * 0.38;
			out.set( x, y, z );
			if ( ! avoid || out.distanceTo( avoid ) > 1.35 ) break;

		}

		return out;

	}

	for ( let i = 0; i < BEACON_COUNT; i ++ ) {

		const holder = new THREE.Group();
		const core = new THREE.Mesh( beaconCoreGeo, beaconCoreMat );
		const halo = new THREE.Mesh( beaconHaloGeo, beaconHaloMat );
		holder.add( core, halo );
		beaconGroup.add( holder );

		const anchor = pickStarlightAnchor( new THREE.Vector3(), null );
		holder.position.copy( anchor );

		const beacon = {
			holder,
			halo,
			anchor,
			phase: i * 1.43,
			bornAt: 0,
			trigger: null
		};

		beacon.trigger = triggers.addTrigger( {
			id: `starlight_${ i }`,
			position: holder.position,
			radius: 0.24,
			enabled: false,
			cooldown: 0.45,
			onImpact: () => {

				if ( ! gameMode ) return;

				const hitPos = holder.position.clone();
				const pan = THREE.MathUtils.clamp( hitPos.x / Math.max( 1.5, frame.halfWidth ), - 0.85, 0.85 );

				swarm.triggerFrostGust( hitPos, 1.35 );
				studio.flashGust( 1.0 );
				if ( audio ) audio.triggerChime( pan, 0.72 );

				pickStarlightAnchor( beacon.anchor, collider.position );
				beacon.bornAt = elapsedTime;
				holder.position.copy( beacon.anchor );

			}
		} );

		beacons.push( beacon );

	}

	engine.trackDisposable( {
		dispose() {

			if ( beaconGroup.parent ) beaconGroup.parent.remove( beaconGroup );
			beaconCoreGeo.dispose();
			beaconHaloGeo.dispose();
			beaconCoreMat.dispose();
			beaconHaloMat.dispose();

		}
	} );

	engine.onUpdate( ( dt, elapsed ) => {

		elapsedTime = elapsed;
		studio.update( orbVisuals.reveal, dt );
		for ( const s of deepBlueShafts ) s.update( orbVisuals.reveal * rayIntensity );
		shaft.update( orbVisuals.reveal * ( 0.75 + 0.25 * rayIntensity ) );

		if ( gameMode ) {

			for ( const b of beacons ) {

				const age = Math.max( 0, elapsed - b.bornAt );
				const pop = Math.min( 1, age * 4.0 );
				const pulse = 0.9 + Math.sin( elapsed * 3.4 + b.phase ) * 0.14;
				const s = pop * pulse;

				b.holder.position.set(
					b.anchor.x + Math.sin( elapsed * 0.9 + b.phase ) * 0.08,
					b.anchor.y + Math.sin( elapsed * 1.65 + b.phase * 1.3 ) * 0.1,
					b.anchor.z
				);
				b.holder.scale.setScalar( s );
				b.holder.rotation.y = elapsed * 1.15 + b.phase;
				b.halo.rotation.z = - elapsed * 0.85 + b.phase;

			}

		}

		if ( audio ) {

			const activeUserSpeed = collider.autopilot < 0.75 ? Math.min( 2.0, collider.pointer.speed * 0.22 ) : 0;
			if ( collider.autopilot < 0.75 && activeUserSpeed < 0.12 ) {

				stillWarmAccum = Math.min( 1, stillWarmAccum + dt * 0.35 );

			} else {

				stillWarmAccum = Math.max( 0, stillWarmAccum - dt * 0.75 );

			}

			audio.updateTelemetry( {
				speed: activeUserSpeed,
				pan: THREE.MathUtils.clamp( collider.pointer.ndc.x * 0.85, - 0.85, 0.85 ),
				pressure: collider.radiusScale,
				breath: breathEnergy,
				vortex: effectiveVortex,
				stillGlow: stillWarmAccum
			}, dt );

		}

	} );

	engine.setPostStateProvider( () => ( {
		focusWorldPoint: collider.position,
		hazeWorldPos: collider.position,
		hazeLightColor: orbVisuals.light.color,
		hazeIntensity: orbVisuals.light.intensity
	} ) );

	engine.start();

	function fireFrostGust() {

		swarm.triggerFrostGust( collider.position, 1.25 );
		studio.flashGust( 1.0 );
		if ( audio ) audio.triggerGust( THREE.MathUtils.clamp( collider.pointer.ndc.x * 0.85, - 0.85, 0.85 ) );

	}

	return {
		engine,
		collider,
		orbVisuals,
		studio,
		swarm,
		setFieldMode( mode ) {

			userFieldMode = mode === 'vortex' ? 'vortex' : 'repel';
			syncVortexState( false );

		},
		setBlizzardDrift( scale ) {

			userBlizzardDrift = scale;
			swarm.setBlizzardDrift( userBlizzardDrift + breathEnergy * 1.35 );

		},
		setFrozenRays( scale ) {

			rayIntensity = Math.max( 0.15, Math.min( 2.8, scale ) );
			studio.setRayIntensity( rayIntensity );

		},
		setFieldRadius( scale ) {

			userFieldRadius = Math.max( 0.5, Math.min( 2.2, scale ) );
			collider.baseRadius = config.orb.shieldRadius * userFieldRadius;
			orbVisuals.setFieldRadiusScale( userFieldRadius );

		},
		triggerFrostGust: fireFrostGust,
		setGameMode( active ) {

			gameMode = !! active;
			beaconGroup.visible = gameMode;

			for ( const b of beacons ) {

				b.trigger.enabled = gameMode;
				if ( gameMode ) {

					pickStarlightAnchor( b.anchor, collider.position );
					b.bornAt = elapsedTime;
					b.holder.position.copy( b.anchor );

				}

			}

		},
		applyBreath( breath ) {

			if ( ! breath || ! breath.active ) {

				breathEnergy = 0;
				swarm.setBlizzardDrift( userBlizzardDrift );
				if ( breathSteerActive && ! handDriverActive ) {

					breathSteerActive = false;
					collider.setExternalDriver( null );

				}
				return;

			}

			breathEnergy = breath.energy;
			swarm.setBlizzardDrift( userBlizzardDrift + breathEnergy * 1.45 );

			if ( breath.puff ) fireFrostGust();

			if ( breath.mode === 'steer' && breath.energy > 0.08 && ! handDriverActive ) {

				breathSteerActive = true;
				collider.setExternalDriver( {
					active: true,
					ndcX: breath.steerX,
					ndcY: breath.steerY,
					radiusMul: 0.92 + breath.energy * 0.72,
					pressed: breath.energy > 0.48,
					suppressMouseHover: false
				} );

			} else if ( breathSteerActive && ! handDriverActive ) {

				breathSteerActive = false;
				collider.setExternalDriver( null );

			}

		},
		applyHands( hand ) {

			if ( ! hand || ! hand.enabled || ! hand.detected ) {

				if ( handDriverActive ) {

					handDriverActive = false;
					prevHandVortexHold = false;
					collider.setExternalDriver( null );
					orbVisuals.setFieldRadiusScale( userFieldRadius );
					swarm.setBlizzardDrift( userBlizzardDrift + breathEnergy * 1.45 );
					syncVortexState( false );

				}
				return;

			}

			handDriverActive = true;
			breathSteerActive = false;

			// Pinch or closed fist pulls crystals into magnetic Crystal Vortex; opening your hand bursts them outward!
			const holdVortex = hand.isPinched || hand.posture === 'fist';
			const justOpenedFromHold = prevHandVortexHold && ! holdVortex && hand.posture === 'open';
			prevHandVortexHold = holdVortex;
			syncVortexState( holdVortex );

			if ( hand.pinchJustReleased || justOpenedFromHold || hand.sweepTriggered ) {

				fireFrostGust();

			}

			// Open palm adds a living aurora breeze lift across the snowfall
			const openDriftBoost = hand.posture === 'open' ? ( 0.35 + hand.proximity * 0.55 ) : 0;
			swarm.setBlizzardDrift( userBlizzardDrift + breathEnergy * 1.45 + openDriftBoost );

			// Z-axis distance to camera & single-finger vs. open-palm scale both physical radius and orb visual size
			const effectiveRadiusMul = THREE.MathUtils.clamp( hand.radiusScale, 0.50, 2.1 );
			orbVisuals.setFieldRadiusScale( THREE.MathUtils.clamp( userFieldRadius * effectiveRadiusMul, 0.48, 2.2 ) );

			collider.setExternalDriver( {
				active: true,
				ndcX: hand.ndcX,
				ndcY: hand.ndcY,
				radiusMul: effectiveRadiusMul,
				pressed: holdVortex,
				suppressMouseHover: true
			} );

		},
		dispose: () => engine.dispose()
	};

}
