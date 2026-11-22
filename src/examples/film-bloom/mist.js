import * as THREE from 'three/webgpu';
import {
	Fn, If, uniform, instanceIndex, varying,
	float, vec2, vec3, vec4, mix, exp, max, min, dot, normalize, length, abs, sin, cos,
	smoothstep, saturate, uv, positionLocal, cameraPosition, cameraWorldMatrix
} from 'three/tsl';
import { createStorageBuffers, createGPUBodySystem, TSL } from '../../engine/index.js';
import { evalThinFilmSpectrumTSL } from './optics.js';

// GPU-simulated nocturnal lake meniscus mist & iridescent dew micro-motes on `overlayScene`.
// Whisper-subtle floating twilight dust & spray that catches thin-film hues from the lake
// below, softly blooming upward on droplet impacts and drifting with breath & fingertip wakes.

export function createLakeMistSystem( {
	overlayScene,
	config,
	quality,
	lens
} ) {

	const count = quality.motes || 12000;
	const tiltX = config.surface.tiltX;
	const cosT = Math.cos( tiltX );
	const sinT = Math.sin( tiltX );

	// Transform lake-local (lx, ly, lz) -> world space (matching lakeGroup.rotation.x = tiltX)
	function localToWorld( lx, ly, lz, out ) {

		out.set(
			lx,
			ly * cosT - lz * sinT,
			ly * sinT + lz * cosT
		);
		return out;

	}

	const rand = TSL.mulberry32( 0x6f1b83a5 );
	const posArr = new Float32Array( count * 4 ); // xyz = world pos, w = bloom heat
	const velArr = new Float32Array( count * 4 ); // xyz = world vel, w = unused
	const homeArr = new Float32Array( count * 4 ); // xyz = rest home pos, w = opd seed (nm)
	const dataArr = new Float32Array( count * 4 ); // x = base size, y = height layer, z = seed, w = phase

	const tmp = new THREE.Vector3();

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		const lx = ( rand() - 0.5 ) * 7.6;
		const lz = ( rand() - 0.5 ) * 5.8;
		// Most motes hover just above the lake skin (0.04..0.55), a sparse few drift closer to camera for bokeh
		const layer = rand() < 0.82 ? ( 0.04 + Math.pow( rand(), 1.8 ) * 0.55 ) : ( 0.65 + rand() * 1.45 );
		localToWorld( lx, layer, lz, tmp );

		posArr[ o ] = tmp.x;
		posArr[ o + 1 ] = tmp.y;
		posArr[ o + 2 ] = tmp.z;
		posArr[ o + 3 ] = 0;

		homeArr[ o ] = tmp.x;
		homeArr[ o + 1 ] = tmp.y;
		homeArr[ o + 2 ] = tmp.z;
		// Optical path difference hue seed spanning bronze, gold, magenta, cobalt, turquoise, teal
		homeArr[ o + 3 ] = 340.0 + rand() * 880.0;

		dataArr[ o ] = 0.0022 + Math.pow( rand(), 2.2 ) * 0.0052;
		dataArr[ o + 1 ] = layer;
		dataArr[ o + 2 ] = rand();
		dataArr[ o + 3 ] = rand() * Math.PI * 2;

	}

	const buffers = createStorageBuffers( count, {
		pos: { array: posArr },
		vel: { array: velArr },
		home: { array: homeArr },
		data: { array: dataArr }
	} );

	const U = {
		dt: uniform( 1 / 60 ),
		time: uniform( 0 ),
		reveal: uniform( 0 ),
		breathEnergy: uniform( 0 ),
		breathSteerX: uniform( 0 ),
		thicknessScale: uniform( 1.0 ),
		// Latest drop impact impulse (world pos + age + strength)
		impactPos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		impactAge: uniform( 10.0 ),
		impactSize: uniform( 1.0 ),
		// Primary pointer/finger wake position + velocity + active weight
		wakePos: uniform( new THREE.Vector3( 0, - 99, 0 ) ),
		wakeVel: uniform( new THREE.Vector3() ),
		wakeActive: uniform( 0 )
	};

	const lakeNormalWorld = vec3( 0, cosT, sinT );

	function buildComputeFn( b ) {

		return Fn( () => {

			const P = b.pos.element( instanceIndex ).toVar();
			const V = b.vel.element( instanceIndex ).toVar();
			const H = b.home.element( instanceIndex ).toVar();
			const D = b.data.element( instanceIndex ).toVar();

			const pos = P.xyz.toVar();
			const heat = P.w.toVar();
			const vel = V.xyz.toVar();
			const home = H.xyz;
			const seed = D.z;

			// Gentle nocturnal curl breeze drifting lazily above the still lake
			const curl = TSL.curlNoise( pos.mul( 0.65 ).add( vec3( U.time.mul( 0.08 ), U.time.mul( 0.05 ), seed.mul( 3.1 ) ) ) );
			vel.addAssign( curl.mul( 0.065 ).mul( U.dt ) );

			// Soft restoring pull toward home mist layer so motes never drift off-screen
			vel.addAssign( home.sub( pos ).mul( 0.28 ).mul( U.dt ) );

			// Breath airflow glides mist gently across the lake surface
			If( U.breathEnergy.greaterThan( 0.02 ), () => {

				const bVec = vec3( U.breathSteerX.mul( 1.1 ).add( 0.35 ), float( 0.22 ), float( - 0.35 ) );
				vel.addAssign( bVec.mul( U.breathEnergy ).mul( 0.95 ).mul( U.dt ) );
				heat.assign( max( heat, U.breathEnergy.mul( 0.42 ) ) );

			} );

			// Fresh drop impact gently lifts nearby mist motes upward like micro-dew crown updraft
			If( U.impactAge.lessThan( 1.2 ), () => {

				const diff = pos.sub( U.impactPos );
				const dist = length( diff );
				const rad = float( 0.65 ).add( U.impactSize.mul( 0.55 ) );
				const near = smoothstep( rad, float( 0.05 ), dist );
				const env = smoothstep( 1.2, 0.0, U.impactAge ).mul( smoothstep( 0.0, 0.14, U.impactAge ) );
				const dir = normalize( diff.add( lakeNormalWorld.mul( 0.85 ) ) );
				vel.addAssign( dir.mul( near ).mul( env ).mul( 1.45 ).mul( U.impactSize ).mul( U.dt ) );
				heat.assign( max( heat, near.mul( env ).mul( 1.15 ) ) );

			} );

			// Fingertip / hand glide softly parts and illuminates nearby mist
			If( U.wakeActive.greaterThan( 0.04 ), () => {

				const diff = pos.sub( U.wakePos );
				const dist = length( diff );
				const near = smoothstep( float( 1.15 ), float( 0.08 ), dist ).mul( U.wakeActive );
				vel.addAssign( U.wakeVel.mul( near ).mul( 0.48 ).mul( U.dt ) );
				vel.addAssign( lakeNormalWorld.mul( near ).mul( 0.28 ).mul( U.dt ) );
				heat.assign( max( heat, near.mul( 0.65 ) ) );

			} );

			vel.mulAssign( exp( float( - 1.35 ).mul( U.dt ) ) );
			pos.addAssign( vel.mul( U.dt ) );
			heat.assign( TSL.decayHeat( heat, float( 0 ), 0.48, 0.0, U.dt ) );

			b.pos.element( instanceIndex ).assign( vec4( pos, heat ) );
			b.vel.element( instanceIndex ).assign( vec4( vel, 0 ) );

		} );

	}

	const mat = new THREE.MeshBasicNodeMaterial( {
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: THREE.AdditiveBlending
	} );

	{

		const aPos = buffers.pos.toAttribute();
		const aHome = buffers.home.toAttribute();
		const aData = buffers.data.toAttribute();

		const center = aPos.xyz;
		const depth = length( cameraPosition.sub( center ) );
		const coc = abs( depth.sub( lens.focus ) ).div( lens.focalRange ).mul( lens.bokehPx );
		const baseSize = aData.x;
		const radius = min( float( 0.017 ), max( baseSize, coc.mul( 0.0011 ) ) );
		const dilution = baseSize.div( max( radius, 1e-4 ) ).pow( 1.6 ).clamp( 0.10, 1.0 );
		const appear = smoothstep( aData.z.mul( 0.55 ), aData.z.mul( 0.55 ).add( 0.40 ), U.reveal );

		mat.positionNode = Fn( () => {

			const right = cameraWorldMatrix.mul( vec4( 1, 0, 0, 0 ) ).xyz;
			const up = cameraWorldMatrix.mul( vec4( 0, 1, 0, 0 ) ).xyz;
			const sz = radius.mul( 1.75 ).mul( appear );
			return center.add( right.mul( positionLocal.x.mul( sz ) ) ).add( up.mul( positionLocal.y.mul( sz ) ) );

		} )();

		const vHeat = varying( aPos.w );
		const vOpd = varying( aHome.w );
		const vSeed = varying( aData.z );
		const vPhase = varying( aData.w );
		const vDilution = varying( dilution );

		mat.colorNode = Fn( () => {

			const q = uv().sub( 0.5 ).mul( 2.0 );
			const r2 = dot( q, q );
			const softDisc = smoothstep( 1.0, 0.14, r2 );

			const shimmer = sin( U.time.mul( 1.8 ).add( vPhase ).add( vSeed.mul( 29.0 ) ) ).mul( 0.28 ).add( 0.72 );
			const opdLive = vOpd.add( U.time.mul( 22.0 ) ).add( vHeat.mul( 180.0 ) ).mul( U.thicknessScale );
			const filmTint = evalThinFilmSpectrumTSL( opdLive );
			const col = mix( vec3( 0.62, 0.78, 0.92 ), filmTint.mul( 1.35 ).add( 0.18 ), float( 0.55 ).add( vHeat.mul( 0.35 ) ) );

			// Whisper-quiet ambient mist so the lake remains clean and spacious; softly lifts on impacts
			const vis = float( 0.065 ).add( vHeat.mul( 0.32 ) );
			return vec4( col.mul( softDisc ).mul( vDilution ).mul( shimmer ).mul( vis ), 1.0 );

		} )();

	}

	const system = createGPUBodySystem( {
		name: 'Lake Meniscus Mist',
		count,
		buffers,
		buildComputeFn,
		geometry: new THREE.PlaneGeometry( 1, 1 ),
		material: mat,
		targetScene: overlayScene,
		castShadow: false,
		receiveShadow: false
	} );

	let reveal = 0;

	return {
		bodyCount: count,
		triggerImpact( lx, lz, size = 1.0 ) {

			localToWorld( lx, 0.02, lz, U.impactPos.value );
			U.impactAge.value = 0.0;
			U.impactSize.value = size;

		},
		setWake( worldPos, worldVel, active ) {

			if ( worldPos ) U.wakePos.value.copy( worldPos );
			if ( worldVel ) U.wakeVel.value.copy( worldVel );
			U.wakeActive.value = active;

		},
		setBreathWind( energy, steerX ) {

			U.breathEnergy.value = energy;
			U.breathSteerX.value = steerX;

		},
		setThicknessScale( v ) {

			U.thicknessScale.value = v;

		},
		update( dt, elapsed, ctx ) {

			reveal = Math.min( 1, reveal + dt * 0.85 );
			U.dt.value = dt;
			U.time.value = elapsed;
			U.reveal.value = reveal * reveal * ( 3 - 2 * reveal );
			if ( U.impactAge.value < 5.0 ) U.impactAge.value += dt;
			system.dispatch( ctx.renderer );

		},
		dispose() {

			system.dispose();

		}
	};

}
