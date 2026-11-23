import * as THREE from 'three/webgpu';
import {
	Fn, If, uniform, instanceIndex, varying, lights,
	float, vec2, vec3, vec4, mix, exp, max, min, dot, cross, normalize, length, abs, sin, cos, pow, sqrt, floor, fract,
	smoothstep, saturate, uv, positionLocal, normalLocal, positionWorld, cameraPosition, cameraWorldMatrix
} from 'three/tsl';
import { createStorageBuffers, createGPUBodySystem, TSL } from '../../engine/index.js';
import { evalDogSurface, evalBreathAmount, evalBreedMasks, evalBreedCoatFromMasksTSL } from './body.js';

// GPU-simulated macro canine fur & floating sunlit coat motes:
//   1. Multi-layered double-coat 3D fur strands (48k–192k tapered ribbon strands):
//      - Real-time smooth GPU morph between Black Labrador, Husky, and Bernese Mountain Dog
//      - Multi-touch petting physics (up to 3 simultaneous fingers + mouse): directional combing,
//        against-the-grain ruffling, fingertip radial parting, persistent velvet grain memory
//      - Living ribcage breathing locked to `body.js`, canine Shake Off wave & Smooth Coat pass
//      - View-aligned cylindrical ribbon geometry + dual-lobe Kajiya-Kay anisotropic sheen & backlit rim
//   2. Warm golden-hour floating dust/coat motes on `overlayScene` with optical scatter bokeh

/**
 * 4-segment tapered 3D fur strand ribbon (9 vertices, 7 triangles).
 *   position.x in [-1, 1] = normalized lateral ribbon offset (scaled by strand width in shader)
 *   position.y in [0, 1]  = normalized height from root (0) to needle tip (1)
 *   uv.x in [0, 1]        = across-strand coordinate (0 = left edge, 1 = right edge, 0.5 = tip)
 *   uv.y in [0, 1]        = root-to-tip parameter `t`
 */
function buildFurStrandGeometry() {

	const rings = [
		{ t: 0.00, halfW: 1.00 },
		{ t: 0.28, halfW: 0.90 },
		{ t: 0.58, halfW: 0.66 },
		{ t: 0.82, halfW: 0.34 }
	];

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	for ( const r of rings ) {

		positions.push( - r.halfW, r.t, 0 );
		normals.push( - 0.45, 0, 0.89 );
		uvs.push( 0, r.t );

		positions.push( r.halfW, r.t, 0 );
		normals.push( 0.45, 0, 0.89 );
		uvs.push( 1, r.t );

	}

	// Needle-fine tip vertex (index 8)
	positions.push( 0, 1.0, 0 );
	normals.push( 0, 0, 1 );
	uvs.push( 0.5, 1.0 );

	for ( let i = 0; i < 3; i ++ ) {

		const a = i * 2;
		const b = a + 1;
		const c = a + 2;
		const d = a + 3;
		indices.push( a, b, c, b, d, c );

	}

	indices.push( 6, 7, 8 );

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geom.setIndex( indices );
	return geom;

}

/**
 * Seed dense double-coat hair roots across the curved canine back, shoulder, and flank.
 * Uses stratified jittered sampling weighted toward the camera-facing petting zone & backlit crest.
 */
function seedFurBuffers( { count, rand } ) {

	// Packed into 4 vertex-accessible storage buffers (+ 1 compute-only vel buffer) so
	// furMaterial uses exactly 7 vertex buffers (3 geometry + 4 instanced < WebGPU max 8).
	const home = new Float32Array( count * 4 ); // xyz = rest root pos, w = 24-bit packed breed masks (s, w, r)
	const frameN = new Float32Array( count * 4 ); // xyz = unit outward normal, w = base strand length
	const frameF = new Float32Array( count * 4 ); // xyz = unit natural coat-flow tangent, w = 20-bit packed (isGuard, seed)
	const comb = new Float32Array( count * 4 ); // xy = persistent comb deflection (along/across flow), z = ruffle/lift, w = touch warmth
	const vel = new Float32Array( count * 4 ); // xy = comb angular velocity, z = lift velocity, w = reserved

	const cols = Math.round( Math.sqrt( count * 1.62 ) );
	const rows = Math.ceil( count / cols );

	const p = new THREE.Vector3();
	const n = new THREE.Vector3();
	const f = new THREE.Vector3();

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		const gx = i % cols;
		const gy = Math.floor( i / cols );

		// Stratified jittered coverage across visible back & backlit crest
		const su = ( gx + rand() ) / cols;
		const sv = ( gy + rand() ) / rows;

		const u = ( su * 2 - 1 ) * 0.96;
		const v = - 1.12 + sv * 2.10;

		evalDogSurface( u, v, p, n, f );

		// Double coat: ~42% dense downy undercoat + ~58% longer glossy guard hairs
		const isGuard = rand() < 0.58 ? ( 0.55 + rand() * 0.45 ) : ( rand() * 0.35 );
		const seed = rand();

		// Anatomical length gradation: subtly fuller along spine crest & shoulder ruff
		const ruffBoost = 1.0 + 0.16 * Math.exp( - Math.pow( ( v - 0.55 ) / 0.42, 2 ) )
			+ 0.10 * Math.exp( - Math.pow( ( u + 0.38 ) / 0.45, 2 ) );

		const baseLen = ( 0.18 + isGuard * 0.13 + ( rand() - 0.5 ) * 0.045 ) * ruffBoost;

		// Exact IEEE-754 f32 24-bit packing (0..16,777,215) for (huskySaddle, bernWhite, bernRust)
		const m = evalBreedMasks( u, v );
		const qS = Math.round( Math.max( 0, Math.min( 1, m.huskySaddle ) ) * 255 );
		const qW = Math.round( Math.max( 0, Math.min( 1, m.bernWhite ) ) * 255 );
		const qR = Math.round( Math.max( 0, Math.min( 1, m.bernRust ) ) * 255 );
		const packedMasks = qS + qW * 256 + qR * 65536;

		// Exact 20-bit packing for (isGuard, seed) at 10-bit resolution each
		const qGuard = Math.round( Math.max( 0, Math.min( 1, isGuard ) ) * 1023 );
		const qSeed = Math.round( Math.max( 0, Math.min( 1, seed ) ) * 1023 );
		const packedGuardSeed = qGuard * 1024 + qSeed;

		home[ o ] = p.x;
		home[ o + 1 ] = p.y;
		home[ o + 2 ] = p.z;
		home[ o + 3 ] = packedMasks;

		frameN[ o ] = n.x;
		frameN[ o + 1 ] = n.y;
		frameN[ o + 2 ] = n.z;
		frameN[ o + 3 ] = baseLen;

		frameF[ o ] = f.x;
		frameF[ o + 1 ] = f.y;
		frameF[ o + 2 ] = f.z;
		frameF[ o + 3 ] = packedGuardSeed;

		// Natural microscopic lay variation so the untouched coat looks genuinely alive
		comb[ o ] = ( rand() - 0.5 ) * 0.16;
		comb[ o + 1 ] = ( rand() - 0.5 ) * 0.22;
		comb[ o + 2 ] = 0;
		comb[ o + 3 ] = 0;

	}

	return createStorageBuffers( count, {
		home: { array: home },
		frameN: { array: frameN },
		frameF: { array: frameF },
		comb: { array: comb },
		vel: { array: vel }
	} );

}

/**
 * Seed warm golden-hour floating dust / fine sunlit fur motes drifting above the dog's back.
 */
function seedCoatMotes( { count, rand } ) {

	const pos = new Float32Array( count * 4 ); // xyz = world pos, w = glow excitation
	const vel = new Float32Array( count * 4 ); // xyz = velocity
	const home = new Float32Array( count * 4 ); // xyz = rest drift pos, w = buoyancy
	const data = new Float32Array( count * 4 ); // x = size, y = inertia, z = seed, w = ambient flag

	const p = new THREE.Vector3();
	const n = new THREE.Vector3();

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		const ambient = rand() < 0.45 ? 1 : 0;

		if ( ambient ) {

			home[ o ] = ( rand() * 2 - 1 ) * 2.3;
			home[ o + 1 ] = 0.48 + rand() * 1.38;
			home[ o + 2 ] = - 2.2 + rand() * 2.35;

		} else {

			const u = ( rand() * 2 - 1 ) * 0.86;
			const v = 0.25 + rand() * 0.68;
			evalDogSurface( u, v, p, n, null );
			const lift = 0.14 + 0.42 * Math.pow( rand(), 1.4 );
			home[ o ] = p.x + n.x * lift;
			home[ o + 1 ] = Math.max( 0.42, p.y + n.y * lift );
			home[ o + 2 ] = Math.min( 0.25, p.z + n.z * lift );

		}

		home[ o + 3 ] = 0.5 + rand();
		pos[ o ] = home[ o ];
		pos[ o + 1 ] = home[ o + 1 ];
		pos[ o + 2 ] = home[ o + 2 ];
		pos[ o + 3 ] = 0;

		const size = ambient
			? 0.0022 + 0.0044 * Math.pow( rand(), 2.3 )
			: 0.0018 + 0.0036 * Math.pow( rand(), 2.5 );

		data[ o ] = size;
		data[ o + 1 ] = 0.5 + ( size / 0.007 ) * 0.85;
		data[ o + 2 ] = rand();
		data[ o + 3 ] = ambient;

	}

	return createStorageBuffers( count, {
		pos: { array: pos },
		vel: { array: vel },
		home: { array: home },
		data: { array: data }
	} );

}

/**
 * Create the GPU-simulated canine fur coat + floating sunlit dust motes system.
 */
export function createDogFurSystem( {
	scene,
	overlayScene,
	config,
	quality,
	environment,
	sceneLights,
	keyLightPos,
	rimLightPos,
	lens
} ) {

	const rand = TSL.mulberry32( 0xD06F004 );
	const strandCount = quality.strands ?? 96000;
	const moteCount = quality.motes ?? 8000;
	const densityComp = Math.min( 1.55, Math.max( 0.88, Math.sqrt( 118000 / Math.max( 1, strandCount ) ) ) );

	const furBuffers = seedFurBuffers( { count: strandCount, rand } );
	const moteBuffers = seedCoatMotes( { count: moteCount, rand } );

	const labCfg = config.breeds.labrador;
	const U = {
		dt: uniform( 1 / 60 ),
		time: uniform( 0 ),
		reveal: uniform( 0 ),
		breath: uniform( 0.5 ),

		// Live breed blend weights (smoothly morphed in JS on breed switch)
		breedLab: uniform( 1.0 ),
		breedHusky: uniform( 0.0 ),
		breedBernese: uniform( 0.0 ),

		// Live breed physical coat parameters
		lengthMul: uniform( labCfg.lengthMul ),
		widthMul: uniform( labCfg.widthMul ),
		laydown: uniform( labCfg.laydown ),
		loft: uniform( labCfg.loft ),
		waveAmp: uniform( labCfg.waveAmp ),
		waveFreq: uniform( labCfg.waveFreq ),
		stiffness: uniform( labCfg.stiffness ),
		specular: uniform( labCfg.specular ),
		roughness: uniform( labCfg.roughness ),
		rimGlow: uniform( labCfg.rimGlow ),

		// Interactive user controls
		touchRadius: uniform( config.interaction.touchRadius ),
		touchRadiusScale: uniform( 1.0 ),
		touchPressure: uniform( config.interaction.defaultPressure ),
		coatSoftness: uniform( config.interaction.defaultSoftness ),
		sunWarmth: uniform( config.interaction.defaultWarmth ),

		// Breath wind ripple across coat
		breathWind: uniform( 0.0 ),
		breathDir: uniform( 0.0 ),

		// Action waves: Shake Off & Smooth Coat
		shakeAge: uniform( 10.0 ),
		smoothAge: uniform( 10.0 ),

		// Multi-touch / independent 5-digit hand tracking slots (up to 5 simultaneous fingers)
		t0Pos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		t0Vel: uniform( new THREE.Vector3() ),
		t0Active: uniform( 0 ),
		t1Pos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		t1Vel: uniform( new THREE.Vector3() ),
		t1Active: uniform( 0 ),
		t2Pos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		t2Vel: uniform( new THREE.Vector3() ),
		t2Active: uniform( 0 ),
		t3Pos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		t3Vel: uniform( new THREE.Vector3() ),
		t3Active: uniform( 0 ),
		t4Pos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		t4Vel: uniform( new THREE.Vector3() ),
		t4Active: uniform( 0 ),

		// Lighting positions for Kajiya-Kay anisotropic hair highlights & rim scatter
		keyPos: uniform( keyLightPos.clone() ),
		rimPos: uniform( rimLightPos.clone() )
	};

	const touchSlots = [
		{ pos: U.t0Pos, vel: U.t0Vel, active: U.t0Active },
		{ pos: U.t1Pos, vel: U.t1Vel, active: U.t1Active },
		{ pos: U.t2Pos, vel: U.t2Vel, active: U.t2Active },
		{ pos: U.t3Pos, vel: U.t3Vel, active: U.t3Active },
		{ pos: U.t4Pos, vel: U.t4Vel, active: U.t4Active }
	];

	// =========================================================================
	// 1. FUR STRANDS COMPUTE + ANISOTROPIC RENDERING
	// =========================================================================
	function buildFurCompute( b ) {

		return Fn( () => {

			const h = b.home.element( instanceIndex ); // xyz = rest root, w = packedMasks
			const fn = b.frameN.element( instanceIndex ); // xyz = N, w = baseLen
			const ff = b.frameF.element( instanceIndex ); // xyz = F, w = packed(isGuard, seed)
			const cb = b.comb.element( instanceIndex ); // xy = comb, z = lift, w = warmth
			const vl = b.vel.element( instanceIndex ); // xy = combVel, z = liftVel

			const coatU = h.x.div( 2.38 );
			const N = fn.xyz;
			const F = ff.xyz;
			const S = normalize( cross( N, F ) );
			const qPacked = ff.w;
			const isGuard = floor( qPacked.div( 1024.0 ) ).div( 1023.0 );
			const seed = qPacked.sub( floor( qPacked.div( 1024.0 ) ).mul( 1024.0 ) ).div( 1023.0 );

			// Exact same living breathing root position as body.js
			const ribEnv = smoothstep( 1.05, 0.15, abs( coatU.add( 0.05 ) ) )
				.mul( smoothstep( - 0.95, 0.45, h.y ) );
			const worldRoot = h.xyz.add( N.mul( U.breath.mul( 0.032 ).mul( ribEnv ) ) );

			const cxy = cb.xy.toVar();
			const lift = cb.z.toVar();
			const heat = cb.w.toVar();
			const vxy = vl.xy.toVar();
			const vLift = vl.z.toVar();

			// Reusable multi-touch petting response helper (invoked for T0, T1, T2)
			const applyTouch = ( tPos, tVel, tActive ) => {

				If( tActive.greaterThan( 0.01 ), () => {

					const rel = worldRoot.sub( tPos );
					const dist = length( rel );
					const rad = U.touchRadius.mul( U.touchRadiusScale ).mul( float( 0.82 ).add( U.touchPressure.mul( 0.38 ) ) );
					const normD = dist.div( max( rad, 0.08 ) );
					const falloff = exp( normD.mul( normD ).mul( - 1.75 ) ).mul( tActive );

					If( falloff.greaterThan( 0.004 ), () => {

						const vF = dot( tVel, F );
						const vS = dot( tVel, S );
						const swipeSpeed = length( vec2( vF, vS ) );

						const pliability = float( 0.68 ).add( isGuard.mul( 0.52 ) ).mul( float( 0.65 ).add( U.coatSoftness.mul( 0.45 ) ) );
						const combGain = falloff.mul( U.touchPressure ).mul( pliability ).mul( 12.5 );
						vxy.x.addAssign( vF.mul( combGain ).mul( U.dt ) );
						vxy.y.addAssign( vS.mul( combGain ).mul( U.dt ) );

						// Soft organic fingertip parting beneath the finger pad to gently reveal cozy undercoat
						const relF = dot( rel, F );
						const relS = dot( rel, S );
						const relLen = max( length( vec2( relF, relS ) ), 0.06 );
						const partRing = falloff.mul( smoothstep( 0.03, 0.22, dist ) ).mul( U.touchPressure ).mul( pliability );
						vxy.x.addAssign( relF.div( relLen ).mul( partRing ).mul( 2.0 ).mul( U.dt ) );
						vxy.y.addAssign( relS.div( relLen ).mul( partRing ).mul( 2.0 ).mul( U.dt ) );

						// Petting against the grain (vF < 0) or pressing deeply ruffles fur up delightfully
						const againstGrain = max( float( 0 ), vF.negate() );
						const withGrain = max( float( 0 ), vF );
						const scritchLift = againstGrain.mul( 1.75 ).add( U.touchPressure.mul( 0.20 ) );
						vLift.addAssign( scritchLift.mul( falloff ).mul( pliability ).mul( 4.8 ).mul( U.dt ) );
						vLift.subAssign( withGrain.mul( falloff ).mul( 4.5 ).mul( U.dt ) );

						const glowSample = falloff.mul( saturate( float( 0.25 ).add( swipeSpeed.mul( 0.32 ) ) ) );
						heat.assign( max( heat, glowSample ) );

					} );

				} );

			};

			applyTouch( U.t0Pos, U.t0Vel, U.t0Active );
			applyTouch( U.t1Pos, U.t1Vel, U.t1Active );
			applyTouch( U.t2Pos, U.t2Vel, U.t2Active );
			applyTouch( U.t3Pos, U.t3Vel, U.t3Active );
			applyTouch( U.t4Pos, U.t4Vel, U.t4Active );

			// Living microphone breath breeze rippling warmly across the fur strands
			If( U.breathWind.greaterThan( 0.015 ), () => {

				const gustWave = sin( U.time.mul( 7.5 ).sub( coatU.mul( 5.4 ) ).add( h.y.mul( 3.2 ) ).add( seed.mul( 4.1 ) ) );
				const flutter = cos( U.time.mul( 13.0 ).add( coatU.mul( 9.2 ) ).add( seed.mul( 11.7 ) ) );
				const pliable = float( 0.55 ).add( isGuard.mul( 0.75 ) ).mul( float( 0.65 ).add( U.coatSoftness.mul( 0.45 ) ) );
				const bGain = U.breathWind.mul( pliable );
				const dirBias = U.breathDir.mul( 0.65 ).add( 0.35 );

				vxy.x.addAssign( dirBias.add( gustWave.mul( 0.55 ) ).mul( bGain ).mul( 10.5 ).mul( U.dt ) );
				vxy.y.addAssign( flutter.mul( bGain ).mul( 8.5 ).mul( U.dt ) );
				vLift.addAssign( float( 0.45 ).add( abs( gustWave ).mul( 0.55 ) ).mul( bGain ).mul( 4.2 ).mul( U.dt ) );
				heat.assign( max( heat, bGain.mul( 0.32 ) ) );

			} );

			// Canine Shake Off: energetic torsional wave rippling from neck (-1) to hip (+1)
			If( U.shakeAge.lessThan( 2.2 ), () => {

				const waveFront = float( - 1.35 ).add( U.shakeAge.mul( 2.35 ) );
				const distWave = coatU.sub( waveFront );
				const env = exp( distWave.mul( distWave ).mul( - 3.6 ) )
					.mul( smoothstep( 2.2, 1.35, U.shakeAge ) );
				const whip = sin( U.shakeAge.mul( 38.0 ).sub( coatU.mul( 8.5 ) ).add( seed.mul( 1.4 ) ) );

				vxy.y.addAssign( whip.mul( env ).mul( 32.0 ).mul( U.dt ) );
				vxy.x.subAssign( cxy.x.mul( env ).mul( 8.5 ).mul( U.dt ) );
				vLift.addAssign( abs( whip ).mul( env ).mul( 9.5 ).mul( U.dt ) );
				heat.assign( max( heat, env.mul( 0.55 ) ) );

			} );

			// Smooth Coat pass: gentle sweeping caress wave aligning every strand sleekly with the grain
			If( U.smoothAge.lessThan( 1.9 ), () => {

				const brushFront = float( - 1.45 ).add( U.smoothAge.mul( 2.15 ) );
				const dBrush = coatU.sub( brushFront );
				const bEnv = exp( dBrush.mul( dBrush ).mul( - 5.2 ) )
					.mul( smoothstep( 1.9, 1.35, U.smoothAge ) );

				const targetComb = vec2( 0.42, 0.0 );
				vxy.addAssign( targetComb.sub( cxy ).mul( bEnv ).mul( 24.0 ).mul( U.dt ) );
				vLift.subAssign( lift.mul( bEnv ).mul( 18.0 ).mul( U.dt ) );
				heat.assign( max( heat, bEnv.mul( 0.85 ) ) );

			} );

			// Persistent velvet grain memory: higher Coat Softness holds silky finger trails longer
			const restComb = vec2(
				seed.sub( 0.5 ).mul( 0.14 ),
				sin( seed.mul( 29.7 ) ).mul( 0.12 )
			);
			const springK = mix( float( 3.2 ), float( 0.44 ), saturate( U.coatSoftness.mul( 0.50 ) ) ).mul( U.stiffness );
			const dampRate = mix( float( 5.8 ), float( 4.2 ), saturate( U.coatSoftness.mul( 0.5 ) ) );

			vxy.addAssign( restComb.sub( cxy ).mul( springK ).mul( U.dt ) );
			vLift.addAssign( lift.negate().mul( springK.mul( 1.15 ) ).mul( U.dt ) );

			const damp = exp( dampRate.negate().mul( U.dt ) );
			vxy.mulAssign( damp );
			vLift.mulAssign( exp( float( - 5.4 ).mul( U.dt ) ) );

			cxy.addAssign( vxy.mul( U.dt ) );
			lift.addAssign( vLift.mul( U.dt ) );

			const combLen = length( cxy );
			If( combLen.greaterThan( 1.45 ), () => {

				cxy.mulAssign( float( 1.45 ).div( combLen ) );

			} );
			lift.assign( lift.clamp( - 0.18, 1.0 ) );

			heat.assign( TSL.decayHeat( heat, float( 0 ), 0.42, 0.0, U.dt ) );

			b.comb.element( instanceIndex ).assign( vec4( cxy, lift, heat ) );
			b.vel.element( instanceIndex ).assign( vec4( vxy, vLift, 0 ) );

		} );

	}

	const strandGeometry = buildFurStrandGeometry();
	const furMaterial = new THREE.MeshStandardNodeMaterial( {
		side: THREE.DoubleSide,
		metalness: 0.0,
		roughness: 0.42
	} );

	{

		// Exactly 4 instanced buffers + 3 geometry attributes = 7 vertex buffers (< WebGPU max 8)
		const aHome = furBuffers.home.toAttribute(); // xyz = root, w = packedMasks
		const aFrameN = furBuffers.frameN.toAttribute(); // xyz = N, w = baseLen
		const aFrameF = furBuffers.frameF.toAttribute(); // xyz = F, w = packed(isGuard, seed)
		const aComb = furBuffers.comb.toAttribute(); // xy = comb, z = lift, w = heat

		// Compact vertex-stage helpers (evaluated cleanly once per vertex)
		const unpackGuard = Fn( () => floor( aFrameF.w.div( 1024.0 ) ).div( 1023.0 ) );
		const unpackSeed = Fn( () => aFrameF.w.sub( floor( aFrameF.w.div( 1024.0 ) ).mul( 1024.0 ) ).div( 1023.0 ) );
		const unpackMasks = Fn( () => {

			const p = aHome.w.toVar();
			const qR = floor( p.div( 65536.0 ) );
			const rem = p.sub( qR.mul( 65536.0 ) );
			const qW = floor( rem.div( 256.0 ) );
			const qS = rem.sub( qW.mul( 256.0 ) );
			return vec3( qS, qW, qR ).div( 255.0 );

		} );

		const computeTipDir = Fn( () => {

			const N = aFrameN.xyz.toVar();
			const F = aFrameF.xyz.toVar();
			const S = normalize( cross( N, F ) ).toVar();
			const effLay = U.laydown.add( aComb.x.mul( 0.92 ) );
			const effSide = aComb.y.mul( 0.95 );
			const effLoft = max( float( 0.10 ), U.loft.add( aComb.z.mul( 0.78 ) ).sub( max( float( 0 ), aComb.x ).mul( 0.18 ) ) );
			return normalize( F.mul( effLay ).add( S.mul( effSide ) ).add( N.mul( effLoft ) ) );

		} );

		furMaterial.positionNode = Fn( () => {

			const coatU = aHome.x.div( 2.38 );
			const N = aFrameN.xyz.toVar();
			const F = aFrameF.xyz.toVar();
			const S = normalize( cross( N, F ) ).toVar();
			const isGuard = unpackGuard().toVar();
			const seed = unpackSeed().toVar();
			const phase = fract( seed.mul( 17.31 ) ).mul( 6.28318 );
			const baseHalfW = float( 0.0086 ).sub( isGuard.mul( 0.0020 ) )
				.mul( float( 0.85 ).add( fract( seed.mul( 31.7 ) ).mul( 0.30 ) ) )
				.mul( densityComp );

			const tVert = uv().y;
			const lat = positionLocal.x;

			const appear = smoothstep( seed.mul( 0.45 ), seed.mul( 0.45 ).add( 0.42 ), U.reveal ).toVar();
			const strandLen = aFrameN.w.mul( U.lengthMul ).mul( appear ).toVar();
			const strandHalfW = baseHalfW.mul( U.widthMul ).mul( appear ).toVar();

			const tipDir = computeTipDir().toVar();
			const rootDir = normalize( mix( N, tipDir, 0.48 ) ).toVar();

			const ribEnv = smoothstep( 1.05, 0.15, abs( coatU.add( 0.05 ) ) )
				.mul( smoothstep( - 0.95, 0.45, aHome.y ) );
			const rootWorld = aHome.xyz.add( N.mul( U.breath.mul( 0.032 ).mul( ribEnv ) ) ).toVar();

			const archDir = normalize( mix( rootDir, tipDir, tVert.pow( 0.85 ) ) ).toVar();
			const wavePhase = tVert.mul( U.waveFreq ).add( phase ).add( coatU.mul( 4.2 ) ).add( aHome.y.mul( 3.1 ) ).toVar();
			const waveEnv = tVert.mul( tVert ).mul( float( 0.45 ).add( isGuard.mul( 0.55 ) ) );
			const waveScale = U.waveAmp.mul( strandLen ).mul( 0.28 ).mul( waveEnv ).toVar();

			const microFlutter = sin( U.time.mul( 1.65 ).add( seed.mul( 23.1 ) ).add( coatU.mul( 3.0 ) ) )
				.mul( 0.0055 ).mul( tVert ).mul( tVert ).mul( U.lengthMul );

			const spineWorld = rootWorld
				.add( archDir.mul( tVert.mul( strandLen ) ) )
				.add( S.mul( sin( wavePhase ).mul( waveScale ).add( microFlutter ) ) )
				.add( N.mul( cos( wavePhase.mul( 0.85 ) ).mul( waveScale.mul( 0.42 ) ) ) )
				.toVar();

			// View-aligned ribbon width axis guarantees lush backlit silhouettes from any angle
			const toCam = normalize( cameraPosition.sub( spineWorld ) ).toVar();
			const rawCross = cross( archDir, toCam ).toVar();
			const crossLen = length( rawCross ).toVar();
			const widthAxis = crossLen.greaterThan( 1e-4 ).select( rawCross.div( crossLen ), S ).toVar();

			const worldPos = spineWorld.add( widthAxis.mul( lat.mul( strandHalfW ) ) );

			const ribbonFace = normalize( cross( widthAxis, archDir ) ).toVar();
			const cylNormal = normalize(
				mix( N, ribbonFace, float( 0.34 ).add( tVert.mul( 0.22 ) ) )
					.add( widthAxis.mul( lat.mul( 0.36 ) ) )
			);
			normalLocal.assign( cylNormal );

			return worldPos;

		} )();

		const vMasks = varying( unpackMasks() );
		const vGuard = varying( unpackGuard() );
		const vSeed = varying( unpackSeed() );
		const vHeat = varying( aComb.w );
		const vHairTangent = varying( computeTipDir() );
		const vSurfNormal = varying( aFrameN.xyz );

		furMaterial.colorNode = Fn( () => {

			const tip = uv().y;
			const { color } = evalBreedCoatFromMasksTSL(
				vMasks,
				tip,
				vGuard,
				vSeed,
				U.breedLab,
				U.breedHusky,
				U.breedBernese
			);

			// Deep cozy root ambient occlusion gives genuine 3D plush pile thickness
			const rootAO = mix( float( 0.22 ), float( 1.0 ), smoothstep( 0.0, 0.62, tip ) );
			const across = abs( uv().x.sub( 0.5 ) ).mul( 2.0 );
			const strandForm = mix( float( 1.05 ), float( 0.80 ), across.mul( across ) );

			return vec4( color.mul( rootAO ).mul( strandForm ), 1 );

		} )();

		// Keep base PBR roughness velvety matte so isotropic dielectric GGX never washes
		// dark coats silver; crisp glossy sheen is driven exclusively by Kajiya-Kay below.
		furMaterial.roughnessNode = mix(
			float( 0.96 ),
			U.roughness.mul( 0.25 ).add( 0.78 ),
			smoothstep( 0.15, 0.92, uv().y ).mul( float( 0.55 ).add( vGuard.mul( 0.45 ) ) )
		).clamp( 0.80, 0.97 );

		// Dual-lobe Kajiya-Kay anisotropic hair sheen + golden-hour backlit rim halo
		furMaterial.emissiveNode = Fn( () => {

			const tip = uv().y;
			const { color: coatCol } = evalBreedCoatFromMasksTSL(
				vMasks,
				tip,
				vGuard,
				vSeed,
				U.breedLab,
				U.breedHusky,
				U.breedBernese
			);

			const T = normalize( vHairTangent ).toVar();
			const Nsurf = normalize( vSurfNormal ).toVar();
			const V = normalize( cameraPosition.sub( positionWorld ) ).toVar();
			const Lkey = normalize( U.keyPos.sub( positionWorld ) ).toVar();
			const Lrim = normalize( U.rimPos.sub( positionWorld ) ).toVar();
			const Hkey = normalize( Lkey.add( V ) ).toVar();

			// Marschner-style shifted hair tangents: crisp primary cuticle sheen + warm secondary coat sheen
			const T1 = normalize( T.add( Nsurf.mul( float( - 0.10 ).add( vSeed.mul( 0.06 ) ) ) ) );
			const T2 = normalize( T.add( Nsurf.mul( float( 0.16 ).add( vSeed.mul( 0.06 ) ) ) ) );

			const dotTH1 = dot( T1, Hkey ).clamp( - 0.999, 0.999 );
			const dotTH2 = dot( T2, Hkey ).clamp( - 0.999, 0.999 );
			const sinTH1 = sqrt( max( float( 0 ), float( 1 ).sub( dotTH1.mul( dotTH1 ) ) ) );
			const sinTH2 = sqrt( max( float( 0 ), float( 1 ).sub( dotTH2.mul( dotTH2 ) ) ) );

			const specPrimary = pow( sinTH1, 110.0 );
			const specSecondary = pow( sinTH2, 36.0 );

			const keyGate = smoothstep( - 0.08, 0.65, dot( Nsurf, Lkey ) );
			const tipAO = smoothstep( 0.22, 0.82, tip ).toVar();
			const guardWeight = float( 0.28 ).add( vGuard.mul( 0.72 ) );

			const sunTint = mix( vec3( 0.78, 0.86, 1.0 ), vec3( 1.0, 0.80, 0.54 ), saturate( U.sunWarmth.mul( 0.65 ) ) ).toVar();
			const primaryCol = sunTint.mul( specPrimary ).mul( 0.085 ).mul( U.specular );
			const secondaryTint = mix( coatCol.mul( 1.65 ), sunTint, 0.08 );
			const secondaryCol = secondaryTint.mul( specSecondary ).mul( 0.065 ).mul( U.specular );

			// Refined backlit golden-hour rim scatter strictly along the grazing silhouette crest
			const fresnelRim = pow( saturate( float( 1 ).sub( abs( dot( Nsurf, V ) ) ) ), 3.6 );
			const backAlign = pow( saturate( dot( V, Lrim.negate() ).mul( 0.5 ).add( 0.5 ) ), 2.2 );
			const tipFade = smoothstep( 0.36, 1.0, tip );
			const rimStrength = fresnelRim.mul( float( 0.25 ).add( backAlign.mul( 0.75 ) ) )
				.mul( tipFade ).mul( U.rimGlow ).mul( U.sunWarmth );
			const rimTint = mix( coatCol.mul( 0.85 ).add( vec3( 0.12, 0.09, 0.06 ) ), vec3( 1.0, 0.74, 0.40 ), 0.48 );
			const rimHalo = rimTint.mul( rimStrength ).mul( 0.28 );

			const touchLuster = sunTint.mul( vHeat ).mul( tipAO ).mul( 0.018 ).mul( float( 0.4 ).add( U.sunWarmth.mul( 0.6 ) ) );

			return primaryCol.add( secondaryCol ).mul( keyGate ).mul( tipAO ).mul( guardWeight )
				.add( rimHalo ).add( touchLuster );

		} )();

		furMaterial.lightsNode = lights( sceneLights );
		furMaterial.envMap = environment;
		furMaterial.envMapIntensity = 0.10;

	}

	const furSystem = createGPUBodySystem( {
		name: 'Dog Fur Strands',
		count: strandCount,
		buffers: furBuffers,
		buildComputeFn: buildFurCompute,
		geometry: strandGeometry,
		material: furMaterial,
		targetScene: scene,
		castShadow: false,
		receiveShadow: true
	} );

	// =========================================================================
	// 2. FLOATING SUNLIT COAT DUST MOTES (OPTICAL SCATTER BOKEH ON OVERLAY)
	// =========================================================================
	function buildMoteCompute( b ) {

		return Fn( () => {

			const p = b.pos.element( instanceIndex );
			const v = b.vel.element( instanceIndex );
			const h = b.home.element( instanceIndex );
			const d = b.data.element( instanceIndex );

			const pos = p.xyz.toVar();
			const heat = p.w.toVar();
			const vel = v.xyz.toVar();

			const inertia = d.y;
			const seed = d.z;
			const ambient = d.w;

			const flow = TSL.sampleCurlFlow(
				pos,
				float( 0.58 ),
				float( 0.085 ),
				vec3( U.time.mul( 0.065 ), U.time.mul( 0.032 ), seed.mul( 5.0 ) )
			).add( vec3( 0, 0.016, 0 ) );

			const spring = mix( float( 0.22 ), float( 0.08 ), ambient );
			vel.addAssign( flow.sub( vel ).mul( float( 1.25 ).div( inertia ) ).mul( U.dt ) );
			vel.addAssign( h.xyz.sub( pos ).mul( spring ).mul( U.dt ) );

			const disturbMote = ( tPos, tVel, tActive ) => {

				If( tActive.greaterThan( 0.01 ), () => {

					const rel = pos.sub( tPos );
					const dist = length( rel );
					If( dist.lessThan( 1.35 ), () => {

						const w = exp( dist.mul( dist ).mul( - 2.4 ) ).mul( tActive );
						const spd = length( tVel );
						vel.addAssign( tVel.mul( 0.42 ).add( vec3( 0, 0.24, 0.14 ) ).mul( w ).mul( U.dt ).mul( 4.2 ) );
						heat.assign( max( heat, w.mul( saturate( spd.mul( 0.45 ).add( 0.25 ) ) ) ) );

					} );

				} );

			};

			disturbMote( U.t0Pos, U.t0Vel, U.t0Active );
			disturbMote( U.t1Pos, U.t1Vel, U.t1Active );
			disturbMote( U.t2Pos, U.t2Vel, U.t2Active );

			// Shake Off lofts a sparkling cloud of sunlit coat motes into the golden air
			If( U.shakeAge.lessThan( 1.4 ), () => {

				const env = smoothstep( 1.4, 0.0, U.shakeAge ).mul( smoothstep( 0.0, 0.18, U.shakeAge ) );
				const burstDir = normalize( vec3( sin( seed.mul( 41.3 ) ), float( 0.85 ).add( seed.mul( 0.45 ) ), cos( seed.mul( 27.9 ) ).mul( 0.65 ) ) );
				vel.addAssign( burstDir.mul( env ).mul( float( 1 ).sub( ambient.mul( 0.55 ) ) ).mul( 2.4 ).mul( U.dt ) );
				heat.assign( max( heat, env.mul( 0.8 ) ) );

			} );

			vel.mulAssign( exp( float( - 1.1 ).mul( U.dt ) ) );
			pos.addAssign( vel.mul( U.dt ) );
			heat.assign( TSL.decayHeat( heat, float( 0 ), 0.55, 0.0, U.dt ) );

			b.pos.element( instanceIndex ).assign( vec4( pos, heat ) );
			b.vel.element( instanceIndex ).assign( vec4( vel, 0 ) );

		} );

	}

	const moteMat = new THREE.MeshBasicNodeMaterial( {
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: THREE.AdditiveBlending
	} );

	{

		const aPos = moteBuffers.pos.toAttribute();
		const aData = moteBuffers.data.toAttribute();

		const center = aPos.xyz;
		const depth = length( cameraPosition.sub( center ) );
		const coc = abs( depth.sub( lens.focus ) ).div( lens.focalRange ).mul( lens.bokehPx );
		const baseSize = aData.x;
		const radius = min( float( 0.018 ), max( baseSize, coc.mul( 0.0012 ) ) );
		const dilution = baseSize.div( max( radius, 1e-4 ) ).pow( 1.55 ).clamp( 0.12, 1.0 );
		const appear = smoothstep( aData.z.mul( 0.55 ), aData.z.mul( 0.55 ).add( 0.40 ), U.reveal );

		moteMat.positionNode = Fn( () => {

			const right = cameraWorldMatrix.mul( vec4( 1, 0, 0, 0 ) ).xyz;
			const up = cameraWorldMatrix.mul( vec4( 0, 1, 0, 0 ) ).xyz;
			const sz = radius.mul( 1.8 ).mul( appear );

			return center.add( right.mul( positionLocal.x.mul( sz ) ) ).add( up.mul( positionLocal.y.mul( sz ) ) );

		} )();

		const vHeat = varying( aPos.w );
		const vSeed = varying( aData.z );
		const vAmbient = varying( aData.w );
		const vCircle = varying( dilution );

		moteMat.colorNode = Fn( () => {

			const q = uv().sub( 0.5 ).mul( 2.0 );
			const r2 = dot( q, q );
			const softDisc = smoothstep( 1.0, 0.15, r2 );

			const twinkle = sin( U.time.mul( 2.2 ).add( vSeed.mul( 37.0 ) ) ).mul( 0.25 ).add( 0.75 );
			const warmCol = mix( vec3( 0.72, 0.82, 0.96 ), vec3( 1.0, 0.80, 0.50 ), saturate( U.sunWarmth.mul( 0.65 ) ) );
			const visibility = mix( float( 0.10 ), float( 0.24 ), vAmbient ).add( vHeat.mul( 0.28 ) );

			return vec4( warmCol.mul( softDisc ).mul( vCircle ).mul( twinkle ).mul( visibility ).mul( U.sunWarmth ), 1 );

		} )();

	}

	const moteSystem = createGPUBodySystem( {
		name: 'Sunlit Coat Motes',
		count: moteCount,
		buffers: moteBuffers,
		buildComputeFn: buildMoteCompute,
		geometry: new THREE.PlaneGeometry( 1, 1 ),
		material: moteMat,
		targetScene: overlayScene,
		castShadow: false,
		receiveShadow: false
	} );

	// =========================================================================
	// LIVE BREED SMOOTH MORPHING & CONTROL API
	// =========================================================================
	let targetBreed = 'labrador';
	const curWeights = { labrador: 1, husky: 0, bernese: 0 };
	let reveal = 0;

	function setBreed( name ) {

		if ( config.breeds[ name ] ) targetBreed = name;

	}

	function setTouchSlot( index, pos, vel, active ) {

		const slot = touchSlots[ index ];
		if ( ! slot ) return;
		if ( pos ) slot.pos.value.copy( pos );
		if ( vel ) slot.vel.value.copy( vel );
		slot.active.value = active;

	}

	function setTouchPressure( v ) {

		U.touchPressure.value = Math.max( 0.25, Math.min( 2.2, v ) );

	}

	function setTouchRadiusScale( s ) {

		U.touchRadiusScale.value = Math.max( 0.45, Math.min( 2.1, s ) );

	}

	function setBreathWind( energy, dir = 0 ) {

		U.breathWind.value = Math.max( 0, Math.min( 1.4, energy ) );
		U.breathDir.value = Math.max( - 1, Math.min( 1, dir ) );

	}

	function setCoatSoftness( v ) {

		U.coatSoftness.value = Math.max( 0.15, Math.min( 2.0, v ) );

	}

	function setSunWarmth( v ) {

		U.sunWarmth.value = Math.max( 0.2, Math.min( 2.2, v ) );

	}

	function triggerShakeOff() {

		U.shakeAge.value = 0.0;

	}

	function triggerSmoothCoat() {

		U.smoothAge.value = 0.0;

	}

	function update( dt, elapsed, ctx ) {

		U.dt.value = dt;
		U.time.value = elapsed;
		reveal = Math.min( 1, reveal + dt * 1.45 );
		U.reveal.value = reveal;
		U.breath.value = evalBreathAmount( elapsed );

		if ( U.shakeAge.value < 5.0 ) U.shakeAge.value += dt;
		if ( U.smoothAge.value < 5.0 ) U.smoothAge.value += dt;

		// Smoothly morph breed weights & coat physical properties over ~0.55s
		const k = 1 - Math.exp( - dt * 6.5 );
		curWeights.labrador += ( ( targetBreed === 'labrador' ? 1 : 0 ) - curWeights.labrador ) * k;
		curWeights.husky += ( ( targetBreed === 'husky' ? 1 : 0 ) - curWeights.husky ) * k;
		curWeights.bernese += ( ( targetBreed === 'bernese' ? 1 : 0 ) - curWeights.bernese ) * k;

		const sum = curWeights.labrador + curWeights.husky + curWeights.bernese || 1;
		const wL = curWeights.labrador / sum;
		const wH = curWeights.husky / sum;
		const wB = curWeights.bernese / sum;

		U.breedLab.value = wL;
		U.breedHusky.value = wH;
		U.breedBernese.value = wB;

		const bL = config.breeds.labrador;
		const bH = config.breeds.husky;
		const bB = config.breeds.bernese;

		U.lengthMul.value = bL.lengthMul * wL + bH.lengthMul * wH + bB.lengthMul * wB;
		U.widthMul.value = bL.widthMul * wL + bH.widthMul * wH + bB.widthMul * wB;
		U.laydown.value = bL.laydown * wL + bH.laydown * wH + bB.laydown * wB;
		U.loft.value = bL.loft * wL + bH.loft * wH + bB.loft * wB;
		U.waveAmp.value = bL.waveAmp * wL + bH.waveAmp * wH + bB.waveAmp * wB;
		U.waveFreq.value = bL.waveFreq * wL + bH.waveFreq * wH + bB.waveFreq * wB;
		U.stiffness.value = bL.stiffness * wL + bH.stiffness * wH + bB.stiffness * wB;
		U.specular.value = bL.specular * wL + bH.specular * wH + bB.specular * wB;
		U.roughness.value = bL.roughness * wL + bH.roughness * wH + bB.roughness * wB;
		U.rimGlow.value = bL.rimGlow * wL + bH.rimGlow * wH + bB.rimGlow * wB;

		furSystem.dispatch( ctx.renderer );
		moteSystem.dispatch( ctx.renderer );

	}

	function dispose() {

		furSystem.dispose();
		moteSystem.dispose();

	}

	return {
		bodyCount: strandCount + moteCount,
		get reveal() { return reveal; },
		getBreedWeights: () => curWeights,
		setBreed,
		setTouchSlot,
		setTouchPressure,
		setTouchRadiusScale,
		setBreathWind,
		setCoatSoftness,
		setSunWarmth,
		triggerShakeOff,
		triggerSmoothCoat,
		update,
		dispose
	};

}
