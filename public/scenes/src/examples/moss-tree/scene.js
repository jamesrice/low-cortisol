import * as THREE from 'three/webgpu';
import {
	uniform, float, vec3, vec4, uv, length, exp, cos, sin, smoothstep
} from 'three/tsl';
import {
	createCollisionEngine,
	createCollider,
	createGoboSpotLight,
	createProceduralEnvironment,
	createLightShaft,
	TSL
} from '../../engine/index.js';
import { MOSS_CONFIG } from './config.js';
import { createMossyTree, evalMainTrunkSurface, evalBranchSurface } from './trunk.js';
import { createMossSystem } from './moss.js';
import { createDandelionSystem } from './dandelion.js';

// Flagship example: Macro Moss-Covered Tree & Interactive Dandelion Pappus.
// Demonstrates how to build an organic, tactile WebGPU + TSL interactive scene
// (plus an optional Bloom Hunt collision mini-game) on top of `src/engine`.

export async function createMossTreeExperience( { container, config = MOSS_CONFIG, audio = null } ) {

	const engine = await createCollisionEngine( {
		container,
		background: config.background,
		tiers: config.tiers,
		camera: config.camera,
		post: config.post,
		enableOverlayScene: true
	} );

	const { renderer, scene, overlayScene, camera, quality, post, colliders, triggers } = engine;

	// -------------------------------------------------- 1. Forest Lighting Rig
	const sunCfg = config.light.sun;
	const sunRig = createGoboSpotLight( {
		scene,
		...sunCfg,
		rimTint: [ 1.0, 0.90, 0.65 ]
	} );

	const skyRim = new THREE.DirectionalLight( config.light.skyRim.color, config.light.skyRim.intensity );
	skyRim.position.fromArray( config.light.skyRim.direction ).multiplyScalar( 16 );

	const mossBounce = new THREE.DirectionalLight( config.light.mossBounce.color, config.light.mossBounce.intensity );
	mossBounce.position.fromArray( config.light.mossBounce.direction ).multiplyScalar( 16 );

	const frontFill = new THREE.DirectionalLight( config.light.frontFill.color, config.light.frontFill.intensity );
	frontFill.position.fromArray( config.light.frontFill.direction ).multiplyScalar( 16 );

	scene.add( skyRim, mossBounce, frontFill );

	// Gentle woodland sun-mote point light riding slightly above the interactive collider
	// (linear decay = 1 avoids 1/r^2 close-surface hotspot blowout on macro moss)
	const cursorLight = new THREE.PointLight( config.collider.lightColor, 0, 3.6, 1 );
	cursorLight.castShadow = quality.shadows;
	cursorLight.shadow.mapSize.setScalar( quality.shadowSize );
	cursorLight.shadow.camera.near = 0.18;
	cursorLight.shadow.camera.far = 12;
	cursorLight.shadow.bias = - 0.002;
	cursorLight.shadow.filterNode = TSL.createSoftPointShadow( {
		samples: quality.shadowSamples,
		spread: 0.032,
		near: cursorLight.shadow.camera.near,
		far: cursorLight.shadow.camera.far,
		bias: cursorLight.shadow.bias
	} );
	scene.add( cursorLight );

	const sceneLights = [ cursorLight, sunRig.spot, skyRim, mossBounce, frontFill ];

	const envTarget = createProceduralEnvironment( renderer, {
		background: 0x030704,
		sigma: 0.04,
		cards: [
			{ width: 9, height: 9, color: 0xffe8b4, intensity: 4.5, position: [ 7, 10, 5 ] }, // dappled sun canopy
			{ width: 12, height: 6, color: 0x5caac8, intensity: 1.4, position: [ - 9, 8, - 4 ] }, // cool forest sky
			{ width: 14, height: 5, color: 0x387824, intensity: 1.2, position: [ 3, - 8, 5 ] }, // lush moss bounce
			{ width: 8, height: 10, color: 0x82b852, intensity: 0.95, position: [ 10, 2, - 3 ] } // sunlit fern side fill
		]
	} );
	engine.trackDisposable( envTarget );

	const rig = {
		sunPosition: sunRig.uniforms.position,
		sunDirection: sunRig.uniforms.direction,
		sunConeCos: sunRig.uniforms.coneCos
	};

	// -------------------------------------------------- 2. Interactive Collider
	// Glides directly along the curved 3D bark surface when hovering the tree,
	// and transitions smoothly onto the macro focal plane in open air to swirl pappus.
	const tmpWanderPos = new THREE.Vector3();
	const tmpWanderNorm = new THREE.Vector3();

	const collider = createCollider( {
		camera,
		element: container,
		mode: 'surface',
		planeNormal: new THREE.Vector3( 0, 0, 1 ),
		planeConstant: - config.collider.fallbackPlaneZ,
		surfaceOffset: config.collider.surfaceOffset,
		radius: config.collider.radius,
		stiffness: config.collider.stiffness,
		damping: config.collider.damping,
		maxSpeed: config.collider.maxSpeed,
		depthSway: config.collider.depthSway,
		idleAfter: config.collider.idleAfter,
		chargeScale: config.collider.chargeScale,
		initialPosition: new THREE.Vector3( - 0.15, 0.18, 0.65 ),
		onPress: ( nx ) => {

			if ( audio ) audio.triggerPlink( THREE.MathUtils.clamp( nx * 0.85, - 0.85, 0.85 ), 0.68 );

		},
		wanderFn: ( t, bounds, out, outNorm ) => {

			// Graceful idle figure-8 that strokes both the mossy trunk & the sunlit pappus clearing
			const phase = t * 0.42;
			const mixClearing = Math.sin( phase * 0.65 ) * 0.5 + 0.5;

			if ( mixClearing < 0.68 ) {

				// Sweep gently over the camera-facing mossy bark surface
				const y = Math.sin( phase * 1.1 ) * 0.78;
				const theta = ( 0.42 + 0.24 * Math.cos( phase * 0.85 ) ) * Math.PI;
				evalMainTrunkSurface( y, theta, tmpWanderPos, tmpWanderNorm );
				out.copy( tmpWanderPos ).addScaledVector( tmpWanderNorm, config.collider.surfaceOffset + 0.04 );
				outNorm.copy( tmpWanderNorm );

			} else {

				// Arc smoothly along the mossy branch and out through floating dandelion pappus
				const u = 0.25 + 0.55 * ( Math.sin( phase * 1.4 ) * 0.5 + 0.5 );
				evalBranchSurface( u, Math.PI * 0.65, tmpWanderPos, tmpWanderNorm );
				out.set(
					tmpWanderPos.x + 0.25,
					tmpWanderPos.y + 0.48 + 0.35 * Math.sin( phase * 1.9 ),
					0.78 + 0.2 * Math.cos( phase * 1.3 )
				);
				outNorm.set( 0, 0, 1 );

			}

		}
	} );
	colliders.add( collider );

	// ------------------------------------------ 3. Delicate Organic Cursor Halo
	const uHaloGlow = uniform( 0 );
	const uHaloScale = uniform( 1 );

	const haloMat = new THREE.SpriteNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	} );

	{

		const d = length( uv().sub( 0.5 ) ).mul( 2.8 );
		const softCore = exp( d.mul( d ).mul( - 12.0 ) ).mul( 0.14 );
		const ringDist = d.sub( uHaloScale.mul( 0.85 ) ).div( 0.11 );
		const rippleRing = exp( ringDist.mul( ringDist ).negate() ).mul( 0.075 );
		const edgeFade = float( 1 ).sub( smoothstep( 0.7, 1.38, d ) );
		const tint = vec3( 0.78, 0.96, 0.44 );

		haloMat.colorNode = vec4( tint.mul( softCore.add( rippleRing ) ).mul( edgeFade ).mul( uHaloGlow ), 1 );

	}

	const cursorHalo = new THREE.Sprite( haloMat );
	cursorHalo.scale.setScalar( config.collider.radius * 1.45 );
	overlayScene.add( cursorHalo );
	engine.trackDisposable( haloMat );

	// ----------------------------------------------- 4. Tree, Moss & Dandelions
	const tree = createMossyTree( {
		scene,
		quality,
		sceneLights,
		environment: envTarget.texture,
		envIntensity: config.light.environmentIntensity,
		collider
	} );
	collider.setSurfaceMeshes( tree.surfaceMeshes );
	engine.addSystem( tree );

	const moss = createMossSystem( {
		scene,
		overlayScene,
		config,
		quality,
		collider,
		rig,
		sceneLights,
		environment: envTarget.texture,
		lens: post.lens
	} );
	engine.addSystem( moss );

	const dandelions = createDandelionSystem( {
		scene,
		config,
		quality,
		collider,
		capsules: tree.capsules,
		rig,
		sceneLights,
		environment: envTarget.texture
	} );
	engine.addSystem( dandelions );

	// -------------------------------------------------- 5. Canopy Light Shafts
	const mainShaft = createLightShaft( {
		scene,
		camera,
		apex: [ 4.5, 6.2, 1.2 ],
		target: [ 0.35, - 2.3, - 1.1 ],
		angle: 0.25,
		color: 0xffeeb8,
		rimTint: [ 0.96, 0.92, 0.64 ],
		strength: config.light.shaftStrength,
		blurGrowth: 0.38
	} );

	const sideShaft = createLightShaft( {
		scene,
		camera,
		apex: [ 6.2, 6.8, - 1.6 ],
		target: [ 1.9, - 2.5, - 3.6 ],
		angle: 0.22,
		color: 0xfff3c8,
		rimTint: [ 0.92, 0.94, 0.66 ],
		strength: config.light.shaftStrength * 0.72,
		blurGrowth: 0.42
	} );
	engine.trackDisposable( mainShaft );
	engine.trackDisposable( sideShaft );

	// ------------------------- 6. Optional "Bloom Hunt" Collision Game Example
	// Demonstrates how `engine.triggers` (CPU swept-segment CCD) integrates with
	// GPU moss pulses and visuals to build interactive collision games in ~50 lines!
	const gameRand = TSL.mulberry32( 0x9a3e5eed );
	const gameGroup = new THREE.Group();
	gameGroup.visible = false;
	scene.add( gameGroup );

	const budGeom = new THREE.IcosahedronGeometry( 0.068, 2 );
	const budMat = new THREE.MeshBasicNodeMaterial();
	budMat.colorNode = vec4( vec3( 1.9, 1.55, 0.38 ), 1 );

	const budHaloMat = new THREE.SpriteNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	} );
	{

		const bd = length( uv().sub( 0.5 ) ).mul( 2.2 );
		const bglow = exp( bd.mul( bd ).mul( - 4.5 ) );
		budHaloMat.colorNode = vec4( vec3( 1.2, 1.15, 0.35 ).mul( bglow ), 1 );

	}

	engine.trackDisposable( budGeom );
	engine.trackDisposable( budMat );
	engine.trackDisposable( budHaloMat );

	const buds = [];
	let gameEnabled = false;

	const placeBud = ( bud ) => {

		const sample = tree.sampleMossyBarkPoint( gameRand );
		bud.anchor.copy( sample.position ).addScaledVector( sample.normal, 0.14 );
		bud.mesh.position.copy( bud.anchor );
		bud.trigger.position.copy( bud.anchor );
		bud.spawnTime = currentTime;

	};

	let currentTime = 0;

	for ( let i = 0; i < 5; i ++ ) {

		const mesh = new THREE.Mesh( budGeom, budMat );
		const glow = new THREE.Sprite( budHaloMat );
		glow.scale.setScalar( 0.46 );
		mesh.add( glow );
		gameGroup.add( mesh );

		const bud = {
			mesh,
			anchor: new THREE.Vector3(),
			phase: i * 1.37,
			spawnTime: 0,
			trigger: null
		};

		bud.trigger = triggers.addTrigger( {
			id: `dew_bud_${ i }`,
			position: bud.anchor.clone(),
			radius: 0.14,
			enabled: false,
			cooldown: 0.45,
			onImpact: () => {

				if ( ! gameEnabled ) return;

				const pan = THREE.MathUtils.clamp( bud.anchor.x * 0.55, - 0.85, 0.85 );
				// Emit a serene luminous shockwave & warm pentatonic chime (zero score pressure)
				moss.triggerPulse( bud.anchor, 1.45 );
				if ( audio ) audio.triggerChime( pan, 0.72 );
				placeBud( bud );

			}
		} );

		placeBud( bud );
		buds.push( bud );

	}

	// --------------------------------------------------- 7. Live Control State
	const controls = {
		focusMode: 'moss', // 'moss' (locked on mossy bark) | 'pointer' (rack focus with mouse)
		manualFocusOffset: 0.0,
		windScale: 1.0,
		activationDecay: config.moss.activationDecay
	};

	let breathEnergy = 0;
	let handOpenBoost = 0;
	let handDriverActive = false;
	let breathSteerActive = false;
	let slowGlideAccum = 0;

	function syncWindUniforms() {

		const totalScale = controls.windScale * ( 1 + breathEnergy * 1.45 + handOpenBoost * 0.55 );
		dandelions.uniforms.flowAmplitude.value = config.dandelion.flowAmplitude * totalScale;
		dandelions.uniforms.prevailingWind.value.fromArray( config.dandelion.prevailingWind ).multiplyScalar( totalScale );
		moss.uniforms.breezeAmp.value = config.moss.breezeAmp * ( controls.windScale + breathEnergy * 1.15 );

	}

	const smoothedFocusPos = new THREE.Vector3( - 0.1, 0.05, 0.62 );
	let reveal = 0;

	engine.onUpdate( ( dt, time ) => {

		currentTime = time;
		reveal = Math.min( 1, reveal + dt / 1.8 );
		const eased = reveal * reveal * ( 3 - 2 * reveal );

		// Sync interactive woodland cursor light (lifted slightly off bark so it never clips) & halo
		cursorLight.position.copy( collider.position ).addScaledVector( collider.surfaceNormal, 0.28 );
		cursorHalo.position.copy( collider.position );

		const speedFactor = Math.min( 1.0, collider.pointer.speed * 0.22 );
		const chargeBoost = 1 + ( collider.radiusScale - 1 ) * 0.75;
		const breathe = 0.92 + 0.08 * Math.sin( time * 2.6 );

		cursorLight.intensity = config.collider.lightIntensity * eased * breathe * chargeBoost * ( 0.72 + speedFactor * 0.45 + breathEnergy * 0.28 );
		uHaloGlow.value = eased * ( 0.22 + speedFactor * 0.45 + ( collider.radiusScale - 1 ) * 0.65 + breathEnergy * 0.25 );
		uHaloScale.value = collider.radiusScale;

		// Update volumetric canopy shafts
		mainShaft.update( eased );
		sideShaft.update( eased );

		// Gently animate Drift Blooms dew-buds when enabled
		if ( gameEnabled ) {

			for ( const b of buds ) {

				const age = Math.min( 1, ( time - b.spawnTime ) * 3.5 );
				const pulse = ( 0.88 + 0.16 * Math.sin( time * 4.2 + b.phase ) ) * age;
				b.mesh.scale.setScalar( pulse );
				b.mesh.position.y = b.anchor.y + Math.sin( time * 2.5 + b.phase ) * 0.025;
				b.trigger.position.copy( b.mesh.position );

			}

		}

		// Smooth rack focus tracking when pointer focus mode is active
		const focusGoal = controls.focusMode === 'pointer'
			? collider.position
			: tmpWanderPos.set( - 0.12, 0.02, 0.64 );
		smoothedFocusPos.lerp( focusGoal, 1 - Math.exp( - dt * 5.0 ) );

		// Feed scene-consistent audio telemetry (independent of input modality)
		if ( audio ) {

			const activeUserSpeed = collider.autopilot < 0.75 ? Math.min( 2.0, collider.pointer.speed * 0.26 ) : 0;
			if ( activeUserSpeed > 0.06 && activeUserSpeed < 0.42 ) {

				slowGlideAccum = Math.min( 1, slowGlideAccum + dt * 0.35 );

			} else {

				slowGlideAccum = Math.max( 0, slowGlideAccum - dt * 0.65 );

			}

			audio.updateTelemetry( {
				speed: activeUserSpeed,
				pan: THREE.MathUtils.clamp( collider.pointer.ndc.x * 0.85, - 0.85, 0.85 ),
				pressure: collider.radiusScale,
				breath: breathEnergy,
				slowGlide: slowGlideAccum
			}, dt );

		}

	} );

	engine.setPostStateProvider( () => {

		// Compute camera-space distance to macro focus target + optional manual offset
		const focusDist = camera.position.distanceTo( smoothedFocusPos ) + controls.manualFocusOffset;

		return {
			focusDistance: Math.max( 0.8, focusDist ),
			hazeWorldPos: cursorLight.position,
			hazeLightColor: cursorLight.color,
			hazeIntensity: cursorLight.intensity * 0.65
		};

	} );

	// ----------------------------------------------- 8. Runtime Control Methods
	function setFocusMode( mode ) {

		controls.focusMode = mode === 'pointer' ? 'pointer' : 'moss';

	}

	function setFocusOffset( delta ) {

		controls.manualFocusOffset = delta;

	}

	function setWindScale( scale ) {

		controls.windScale = scale;
		syncWindUniforms();

	}

	function setActivationPersistence( persistence ) {

		// persistence in [0.2, 2.5]: higher = glow/unfurl lingers longer
		const decay = config.moss.activationDecay / Math.max( 0.2, persistence );
		controls.activationDecay = decay;
		moss.uniforms.activationDecay.value = decay;

	}

	function setGameMode( enabled ) {

		gameEnabled = Boolean( enabled );
		gameGroup.visible = gameEnabled;

		for ( const b of buds ) {

			b.trigger.enabled = gameEnabled;
			if ( gameEnabled ) placeBud( b );

		}

	}

	function triggerPulse() {

		moss.triggerPulse( collider.position, 1.35 );
		if ( audio ) audio.triggerPulse( THREE.MathUtils.clamp( collider.pointer.ndc.x * 0.85, - 0.85, 0.85 ) );

	}

	function applyBreath( breath ) {

		if ( ! breath || ! breath.active ) {

			breathEnergy = 0;
			syncWindUniforms();
			if ( breathSteerActive && ! handDriverActive ) {

				breathSteerActive = false;
				collider.setExternalDriver( null );

			}
			return;

		}

		breathEnergy = breath.energy;
		syncWindUniforms();

		if ( breath.puff ) triggerPulse();

		if ( breath.mode === 'steer' && breath.energy > 0.08 && ! handDriverActive ) {

			breathSteerActive = true;
			collider.setExternalDriver( {
				active: true,
				ndcX: breath.steerX,
				ndcY: breath.steerY,
				radiusMul: 0.9 + breath.energy * 0.65,
				pressed: breath.energy > 0.45,
				suppressMouseHover: false
			} );

		} else if ( breathSteerActive && ! handDriverActive ) {

			breathSteerActive = false;
			collider.setExternalDriver( null );

		}

	}

	function applyHands( hand ) {

		if ( ! hand || ! hand.enabled || ! hand.detected ) {

			handOpenBoost = 0;
			syncWindUniforms();
			if ( handDriverActive ) {

				handDriverActive = false;
				collider.setExternalDriver( null );

			}
			return;

		}

		handDriverActive = true;
		breathSteerActive = false;
		handOpenBoost = hand.posture === 'open' ? ( 0.45 + hand.proximity * 0.75 ) : 0;
		syncWindUniforms();

		if ( hand.pinchJustStarted || hand.sweepTriggered ) {

			triggerPulse();

		}

		collider.setExternalDriver( {
			active: true,
			ndcX: hand.ndcX,
			ndcY: hand.ndcY,
			radiusMul: hand.radiusScale,
			pressed: hand.isPinched || hand.posture === 'fist',
			suppressMouseHover: true
		} );

	}

	engine.start();

	return {
		engine,
		collider,
		tree,
		moss,
		dandelions,
		controls,
		setFocusMode,
		setFocusOffset,
		setWindScale,
		setActivationPersistence,
		setGameMode,
		triggerPulse,
		applyBreath,
		applyHands,
		dispose: () => engine.dispose()
	};

}
