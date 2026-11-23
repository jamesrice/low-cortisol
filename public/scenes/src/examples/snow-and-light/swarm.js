import * as THREE from 'three/webgpu';
import {
	Fn, If, uniform, instanceIndex, varying, lights, select,
	float, vec3, vec4, mix, max, min, dot, cross, normalize, length, abs, cos, pow, fract,
	smoothstep, saturate, step, uv, positionLocal, normalLocal, positionGeometry,
	normalView, positionViewDirection, cameraPosition, cameraViewMatrix, cameraWorldMatrix, mx_noise_float
} from 'three/tsl';
import { createStorageBuffers, createGPUBodySystem, TSL } from '../../engine/index.js';

// 3D crystalline snowflakes + optical-bokeh frost dust swarm built
// on `createGPUBodySystem` and `TSL` physics primitives from `src/engine`.

/**
 * Procedurally construct a faceted 3D 6-fold dendritic ice crystal (snowflake),
 * normalized to diameter ~1.0 (radius 0.5) with crisp beveled facets that catch
 * specular glints and cast real star-shaped shadows (156 triangles, non-indexed
 * for sharp flat crystal facet normals).
 */
function buildSnowflakeGeometry() {

	const positions = [];

	const pushTri = ( a, b, c ) => {

		positions.push(
			a[ 0 ], a[ 1 ], a[ 2 ],
			b[ 0 ], b[ 1 ], b[ 2 ],
			c[ 0 ], c[ 1 ], c[ 2 ]
		);

	};

	// Faceted 3D crystal spear rooted at `base` (with 4-point diamond girdle) tapering to `tip`
	const addCrystalBranch = ( bx, by, tx, ty, halfW, halfZ, doubleEnded = false ) => {

		const dx = tx - bx;
		const dy = ty - by;
		const len = Math.hypot( dx, dy ) || 1;
		const px = - dy / len;
		const py = dx / len;

		// Girdle sits near base for rooted side dendrites, or at 38% length for primary arms
		const g = doubleEnded ? 0.36 : 0.14;
		const gx = bx + dx * g;
		const gy = by + dy * g;

		const left = [ gx + px * halfW, gy + py * halfW, 0 ];
		const right = [ gx - px * halfW, gy - py * halfW, 0 ];
		const front = [ gx, gy, halfZ ];
		const back = [ gx, gy, - halfZ ];
		const tip = [ tx, ty, 0 ];

		// 4 sharp crystal tip facets
		pushTri( front, right, tip );
		pushTri( right, back, tip );
		pushTri( back, left, tip );
		pushTri( left, front, tip );

		if ( doubleEnded ) {

			const root = [ bx, by, 0 ];
			pushTri( root, right, front );
			pushTri( root, back, right );
			pushTri( root, left, back );
			pushTri( root, front, left );

		}

	};

	// 1. Central hexagonal faceted crystal hub (front & back bipyramid, 12 triangles)
	const hubR = 0.145;
	const hubZ = 0.044;
	const centerFront = [ 0, 0, hubZ ];
	const centerBack = [ 0, 0, - hubZ ];
	const hexPts = [];

	for ( let i = 0; i < 6; i ++ ) {

		const a = ( i / 6 ) * Math.PI * 2;
		hexPts.push( [ Math.cos( a ) * hubR, Math.sin( a ) * hubR, 0 ] );

	}

	for ( let i = 0; i < 6; i ++ ) {

		const p0 = hexPts[ i ];
		const p1 = hexPts[ ( i + 1 ) % 6 ];
		pushTri( centerFront, p0, p1 );
		pushTri( centerBack, p1, p0 );

	}

	// 2. Six primary radiating dendritic arms + two symmetric pairs of 60° ice barbs each
	const branchAngle = Math.PI / 3; // true 60° hexagonal ice crystal lattice angle

	for ( let i = 0; i < 6; i ++ ) {

		const a = ( i / 6 ) * Math.PI * 2;
		const ca = Math.cos( a );
		const sa = Math.sin( a );

		// Primary hexagonal spine from center out to radius 0.50
		addCrystalBranch( ca * 0.05, sa * 0.05, ca * 0.50, sa * 0.50, 0.036, 0.026, true );

		// Inner pair of long 60° crystalline side-branches at r = 0.23
		const r1 = 0.22;
		const b1x = ca * r1;
		const b1y = sa * r1;
		for ( const side of [ - 1, 1 ] ) {

			const ba = a + side * branchAngle;
			addCrystalBranch( b1x, b1y, b1x + Math.cos( ba ) * 0.195, b1y + Math.sin( ba ) * 0.195, 0.024, 0.017, false );

		}

		// Outer pair of delicate 60° tip dendrites at r = 0.35
		const r2 = 0.35;
		const b2x = ca * r2;
		const b2y = sa * r2;
		for ( const side of [ - 1, 1 ] ) {

			const ba = a + side * branchAngle;
			addCrystalBranch( b2x, b2y, b2x + Math.cos( ba ) * 0.125, b2y + Math.sin( ba ) * 0.125, 0.019, 0.014, false );

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.computeVertexNormals();
	return geometry;

}

function sampleHome( rand, bounds, deepFraction, out ) {

	let x = 0, y = 0, z = 0;
	const deep = rand() < deepFraction;

	for ( let attempt = 0; attempt < 48; attempt ++ ) {

		let r2 = 2;
		while ( r2 > 1 ) {

			x = rand() * 2 - 1;
			y = rand() * 2 - 1;
			r2 = x * x + y * y;

		}

		if ( deep ) {

			z = ( 1.1 + 2.5 * rand() ) * ( rand() < 0.5 ? - 1 : 1 );

		} else {

			z = ( ( rand() + rand() + rand() - 1.5 ) / 1.5 ) * 0.92;

		}

		const wx = x * bounds.x, wy = y * bounds.y;
		const f = 1.5;
		const ax = wx * f + 0.95 * Math.sin( wy * 0.83 + 1.7 );
		const ay = wy * f + 0.95 * Math.sin( z * 0.71 + 4.1 );
		const az = z * f + 0.95 * Math.sin( wx * 0.67 + 2.3 );
		const g = Math.sin( ax ) * Math.cos( ay ) + Math.sin( ay ) * Math.cos( az ) + Math.sin( az ) * Math.cos( ax );

		const sheet = Math.exp( - g * g * 8 );
		const edge = Math.pow( 1 - r2, 0.5 );
		const density = deep ? edge : edge * ( 0.04 + 0.96 * sheet );

		if ( rand() < density ) break;

	}

	out[ 0 ] = x;
	out[ 1 ] = y;
	out[ 2 ] = z;

}

function seedSwarmBuffers( { count, family, bounds, center, orbStart, shieldRadius, rand } ) {

	const pos = new Float32Array( count * 4 );
	const vel = new Float32Array( count * 4 );
	const rot = new Float32Array( count * 4 );
	const ang = new Float32Array( count * 4 );
	const data = new Float32Array( count * 4 );
	const home = new Float32Array( count * 4 );

	const h = [ 0, 0, 0 ];

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		sampleHome( rand, bounds, family === 'dust' ? 0.13 : 0, h );

		let size;
		let captured = 0;

		if ( family === 'dust' ) {

			size = 0.006 + 0.024 * Math.pow( rand(), 3.4 );
			if ( Math.abs( h[ 2 ] ) > 1 ) size *= 1.7;
			if ( rand() < 0.004 ) captured = 1;

		} else {

			const roll = rand();
			if ( roll < 0.012 ) {

				// Hero large snowflakes: crisp crystal silhouettes & dreamy bokeh stars
				size = 0.21 + 0.28 * Math.pow( rand(), 1.5 );
				if ( roll < 0.006 ) h[ 2 ] = ( 1.3 + 2.1 * rand() ) * ( rand() < 0.5 ? - 1 : 1 );

			} else if ( roll < 0.07 ) {

				size = 0.095 + 0.095 * rand();

			} else {

				size = 0.028 + 0.064 * Math.pow( rand(), 2.2 );

			}

			if ( size < 0.14 && rand() < 0.014 ) captured = 1;

		}

		const inertia = Math.min( 0.55 + Math.pow( size / 0.028, 1.12 ), 9 );

		home[ o ] = h[ 0 ];
		home[ o + 1 ] = h[ 1 ];
		home[ o + 2 ] = h[ 2 ];
		home[ o + 3 ] = - 0.02 + 0.17 * Math.pow( rand(), 2.2 );

		if ( captured === 1 ) {

			const u = rand() * 2 - 1, phi = rand() * Math.PI * 2, s = Math.sqrt( 1 - u * u );
			const rr = shieldRadius * ( 0.25 + 0.35 * rand() );
			pos[ o ] = orbStart.x + s * Math.cos( phi ) * rr;
			pos[ o + 1 ] = orbStart.y + s * Math.sin( phi ) * rr;
			pos[ o + 2 ] = orbStart.z + u * rr;

		} else {

			pos[ o ] = center.x + h[ 0 ] * bounds.x;
			pos[ o + 1 ] = center.y + h[ 1 ] * bounds.y;
			pos[ o + 2 ] = center.z + h[ 2 ] * bounds.z;

		}

		TSL.writeRandomQuaternion( rand, rot, o );

		data[ o ] = size;
		data[ o + 1 ] = inertia;
		data[ o + 2 ] = rand();
		data[ o + 3 ] = captured;

	}

	return createStorageBuffers( count, {
		pos: { array: pos },
		vel: { array: vel },
		rot: { array: rot },
		ang: { array: ang },
		data: { array: data },
		home: { array: home }
	} );

}

export function createSnowSwarm( { scene, overlayScene, config, quality, collider, orbLight, rig, environment, lens, frame } ) {

	const cfg = config.swarm;
	const rand = TSL.mulberry32( 0x5eed1e55 );

	const bounds = new THREE.Vector3( 5, 2.6, 1 );
	const center = new THREE.Vector3( 0, 0.2, 0 );

	const U = {
		dt: uniform( 1 / 60 ),
		time: uniform( 0 ),
		reveal: uniform( 0 ),
		pixelSize: uniform( 0.001 ),
		dustGain: uniform( cfg.dustGain ),
		orbColor: uniform( new THREE.Color( 0, 0, 0 ) ),
		swirlAxis: uniform( new THREE.Vector3( 0.2, 0.3, 0.93 ).normalize() ),

		bounds: uniform( bounds ),
		center: uniform( center ),
		floorY: uniform( config.world.floorY ),
		wallZ: uniform( config.world.wallZ ),

		flowFrequency: uniform( cfg.flowFrequency ),
		flowAmplitude: uniform( cfg.flowAmplitude ),
		flowOffset: uniform( new THREE.Vector3() ),
		drag: uniform( cfg.drag ),
		homeStiffness: uniform( cfg.homeStiffness ),
		gravity: uniform( cfg.gravity ),
		gravityRange: uniform( cfg.gravityRange ),
		shieldStiffness: uniform( cfg.shieldStiffness ),
		shieldDamping: uniform( cfg.shieldDamping ),
		shieldCore: uniform( cfg.shieldCore ),
		swirl: uniform( cfg.swirl ),
		wake: uniform( cfg.wake ),
		maxSpeed: uniform( cfg.maxSpeed ),

		// Bespoke Snow & Light live controls
		vortexMode: uniform( 0 ), // 0 = Repel Shield, 1 = Crystal Vortex
		driftScale: uniform( 1 ),
		gustOrigin: uniform( new THREE.Vector3( 0, 0, 0 ) ),
		gustAge: uniform( 10 ),
		gustStrength: uniform( 0 )
	};

	const C = collider.uniforms;

	const buildUpdate = ( B, pull ) => Fn( () => {

		const P = B.pos.element( instanceIndex );
		const V = B.vel.element( instanceIndex );
		const Q = B.rot.element( instanceIndex );
		const W = B.ang.element( instanceIndex );
		const D = B.data.element( instanceIndex );
		const H = B.home.element( instanceIndex );

		const dt = U.dt;
		const p = P.xyz.toVar();
		const v = V.xyz.toVar();
		const heat = P.w.toVar();

		const size = D.x.toVar();
		const inertia = D.y.toVar();
		const seed = D.z.toVar();
		const captured = D.w.greaterThan( 0.5 );

		const R = C.radius;

		const flow = TSL.sampleCurlFlow( p, U.flowFrequency, U.flowAmplitude.mul( U.driftScale ), U.flowOffset ).toVar();

		const rel = p.sub( C.position ).toVar();
		const r = max( length( rel ), 1e-3 ).toVar();
		const n = rel.div( r ).toVar();

		const swirlBoost = U.swirl.mul( float( 0.65 ).add( U.driftScale.mul( 0.35 ) ) )
			.mul( float( 1 ).add( U.vortexMode.mul( 3.2 ) ) );

		flow.addAssign( TSL.computeDipoleWake( rel, r, R, C.velocity, U.wake ) );
		flow.addAssign( TSL.computeVortexSwirl( n, r, R, U.swirlAxis, swirlBoost ) );

		const acc = vec3( 0 ).toVar();
		const homeWorld = H.xyz.mul( U.bounds ).add( U.center );
		acc.addAssign( homeWorld.sub( p ).mul( U.homeStiffness.mul( mix( float( 1 ), float( 0.55 ), U.vortexMode ) ) ) );

		const reach = smoothstep( R, U.gravityRange.mul( float( 1 ).add( U.vortexMode.mul( 0.65 ) ) ), r ).oneMinus();
		const pullStrength = U.gravity.mul( pull ).mul( float( 1 ).add( U.vortexMode.mul( 3.1 ) ) );
		acc.subAssign( n.mul( pullStrength.mul( inertia.inverseSqrt() ).div( r.mul( r ).add( 0.35 ) ).mul( reach ) ) );

		// Expanding winter Frost Gust shockwave ring across the entire snowfield
		const gustHeat = float( 0 ).toVar();
		If( U.gustAge.lessThan( 2.4 ), () => {

			const waveR = U.gustAge.mul( 5.6 );
			const gRel = p.sub( U.gustOrigin );
			const gDist = max( length( gRel ), 1e-3 );
			const gDir = gRel.div( gDist );
			const ring = smoothstep( 1.25, 0.0, abs( gDist.sub( waveR ) ) );
			const fade = smoothstep( 2.4, 0.0, U.gustAge );
			const swirlDir = normalize( cross( U.swirlAxis, gDir ).add( vec3( 0, 0.25, 0 ) ) );
			const gustForce = gDir.mul( 0.85 ).add( swirlDir.mul( 0.65 ) ).add( vec3( 0, 0.35, 0 ) );
			acc.addAssign( gustForce.mul( ring.mul( fade ).mul( U.gustStrength ).mul( 42.0 ).div( inertia.sqrt() ) ) );
			gustHeat.assign( ring.mul( fade ).mul( U.gustStrength ).mul( 0.85 ) );

		} );

		const coupling = U.drag.div( inertia ).toVar();

		If( captured, () => {

			const orbitRadius = R.mul( mix( 0.24, 0.6, fract( seed.mul( 7.31 ) ) ) );
			const orbitAxis = normalize( vec3( fract( seed.mul( 91.7 ) ), fract( seed.mul( 37.3 ) ), fract( seed.mul( 59.1 ) ) ).sub( 0.5 ).add( 1e-3 ) );
			const orbitSpeed = mix( 1.3, 2.9, fract( seed.mul( 3.7 ) ) ).mul( float( 1 ).add( U.vortexMode.mul( 0.75 ) ) );

			acc.assign( n.mul( orbitRadius.sub( r ).mul( 70 ) ) );
			flow.assign( C.velocity.add( cross( orbitAxis, n ).mul( orbitSpeed ) ) );
			coupling.assign( 7 );

		} );

		TSL.applyFluidDrag( v, flow, coupling, dt );
		v.addAssign( acc.mul( dt ) );

		const hit = TSL.applySweptSphereCollision( {
			p,
			v,
			prev: C.previous,
			curr: C.position,
			colliderVel: C.velocity,
			radius: R.mul( mix( float( 1 ), float( 0.52 ), U.vortexMode ) ),
			shellOffset: H.w,
			bodyHalfSize: size.mul( 0.5 ),
			stiffness: U.shieldStiffness.mul( mix( float( 1 ), float( 0.38 ), U.vortexMode ) ),
			damping: U.shieldDamping,
			coreFraction: U.shieldCore,
			inertia,
			wobbleAmount: float( 0.04 ),
			timeNode: U.time,
			dt,
			enabled: captured.not()
		} );

		TSL.clampSpeed( v, U.maxSpeed );
		p.addAssign( v.mul( dt ) );

		TSL.collideFloorPlane( p, v, U.floorY, size.mul( 0.5 ), 0.28, 3.0, dt );
		TSL.collideBackWall( p, v, U.wallZ, size.mul( 0.5 ), 0.28 );

		const w = W.xyz.toVar();
		const nextQ = TSL.integrateTumble( {
			w,
			q: Q.toVar(),
			v,
			impact: hit.impact.add( gustHeat.mul( 2.8 ) ),
			impactNormal: hit.normal,
			seed,
			inertia,
			dt
		} );

		const nextHeat = TSL.decayHeat( heat, hit.impact.add( gustHeat.mul( 1.8 ) ), 1.7, 0.085, dt );

		P.assign( vec4( p, nextHeat ) );
		V.assign( vec4( v, 0 ) );
		W.assign( vec4( w, 0 ) );
		Q.assign( nextQ );

	} );

	// Compute initial bounds from frame before seeding
	const updateBoundsFromFrame = ( f ) => {

		bounds.set(
			Math.max( 1.6, f.halfWidth * 0.94 ),
			Math.max( 1.8, Math.min( f.halfHeight * 0.9, 3.4 ) ),
			1
		);
		center.set( 0, f.centerY + 0.1, 0 );
		U.pixelSize.value = f.pixelSize;

	};

	if ( frame ) updateBoundsFromFrame( frame );

	const seedOpts = { bounds, center, orbStart: collider.position, shieldRadius: config.orb.shieldRadius, rand };
	const cubeBuffers = seedSwarmBuffers( { count: quality.cubes, family: 'cubes', ...seedOpts } );
	const dustBuffers = seedSwarmBuffers( { count: quality.dust, family: 'dust', ...seedOpts } );

	const appear = ( seed ) => smoothstep( seed.mul( 0.7 ), seed.mul( 0.7 ).add( 0.3 ), U.reveal );
	const emberColor = vec3( 1.0, 0.52, 0.2 );

	// ------------------------------------------------------------ Snowflakes
	const snowflakeMaterial = new THREE.MeshStandardNodeMaterial();

	{

		const aPos = cubeBuffers.pos.toAttribute();
		const aRot = cubeBuffers.rot.toAttribute();
		const aData = cubeBuffers.data.toAttribute();

		snowflakeMaterial.positionNode = Fn( () => {

			const q = aRot.toVar();
			const scale = aData.x.mul( appear( aData.z ) );

			normalLocal.assign( TSL.quatRotate( normalLocal, q ) );
			return TSL.quatRotate( positionLocal.mul( scale ), q ).add( aPos.xyz );

		} )();

		const vData = varying( aData );
		const vHeat = varying( aPos.w );

		const pick = fract( vData.z.mul( 17.13 ) );
		const tint = fract( vData.z.mul( 5.71 ) );

		// View-angle Fresnel & iridescent ice film across sharp faceted crystal edges
		const facing = saturate( abs( dot( normalView, positionViewDirection ) ) );
		const fresnel = pow( facing.oneMinus(), 2.4 );
		const film = cos( facing.mul( 1.65 ).add( tint ).add( vec3( 0, 0.33, 0.67 ) ).mul( 6.28318 ) ).mul( 0.5 ).add( 0.5 );

		const glacialIce = mix( vec3( 0.72, 0.84, 0.96 ), vec3( 0.92, 0.96, 1.0 ), tint );
		const frostWhite = mix( vec3( 0.90, 0.93, 0.97 ), vec3( 0.78, 0.85, 0.94 ), tint );
		const prismaticIce = mix( vec3( 0.94, 0.97, 1.0 ), film, 0.48 );
		const warmCrystal = vec3( 1.0, 0.90, 0.76 );

		const isGlacial = pick.lessThan( 0.52 );
		const isFrost = pick.lessThan( 0.74 );
		const isPrismatic = pick.lessThan( 0.93 );

		const surface = mx_noise_float( positionGeometry.mul( 11.0 ).add( vData.z.mul( 37 ) ) );

		const albedo = select( isGlacial, glacialIce, select( isFrost, frostWhite, select( isPrismatic, prismaticIce, warmCrystal ) ) );
		const gloss = select( isGlacial, mix( float( 0.10 ), float( 0.24 ), tint ), select( isFrost, float( 0.48 ), select( isPrismatic, float( 0.12 ), float( 0.22 ) ) ) );

		snowflakeMaterial.colorNode = vec4( albedo.mul( surface.mul( 0.08 ).add( 1 ) ), 1 );
		snowflakeMaterial.metalnessNode = select( isFrost, float( 0.08 ), float( 0.65 ) );
		snowflakeMaterial.roughnessNode = gloss.add( surface.mul( 0.06 ) ).clamp( 0.06, 0.78 );

		// Delicate crystalline rim sheen + warm amber-gold glow when struck by the light shield
		const iceRim = mix( vec3( 0.65, 0.82, 1.0 ), vec3( 1.0, 0.95, 0.88 ), tint ).mul( fresnel ).mul( 0.22 );
		snowflakeMaterial.emissiveNode = iceRim.add( emberColor.mul( vHeat.mul( vHeat ) ).mul( 1.35 ) );

		snowflakeMaterial.lightsNode = lights( [ orbLight, rig.spot, rig.fillMagenta, rig.fillTeal ] );
		snowflakeMaterial.envMap = environment;
		snowflakeMaterial.envMapIntensity = config.light.environmentIntensity * 2.2;

	}

	const cubeSystem = createGPUBodySystem( {
		name: 'Snow & Light Snowflakes',
		count: quality.cubes,
		buffers: cubeBuffers,
		buildComputeFn: ( B ) => buildUpdate( B, cfg.cubePull ),
		geometry: buildSnowflakeGeometry(),
		material: snowflakeMaterial,
		targetScene: scene,
		castShadow: quality.shadows,
		receiveShadow: quality.shadows
	} );

	// -------------------------------------------------- Optical Bokeh Dust
	const dustMaterial = new THREE.MeshBasicNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	} );

	{

		const aPos = dustBuffers.pos.toAttribute();
		const aRot = dustBuffers.rot.toAttribute();
		const aData = dustBuffers.data.toAttribute();

		const ctr = aPos.xyz;
		const distance = cameraViewMatrix.mul( vec4( ctr, 1 ) ).z.negate();
		const defocus = max( abs( distance.sub( lens.focus ) ).sub( lens.focusSlab ), 0 );
		const cocPx = smoothstep( 0, lens.focalRange, defocus ).mul( lens.bokehPx );

		const pixelWorld = distance.mul( U.pixelSize );
		const sizePx = aData.x.div( pixelWorld );
		const drawPx = max( sizePx, 1.1 );
		const radiusPx = cocPx.add( drawPx.mul( 0.5 ) );
		const blend = saturate( cocPx.mul( 0.6 ) );

		const lit = Fn( () => {

			const N = TSL.quatRotate( vec3( 0, 0, 1 ), aRot ).toVar();
			const Vd = normalize( cameraPosition.sub( ctr ) ).toVar();
			const seed = aData.z;

			const tone = fract( seed.mul( 23.7 ) );
			const gloss = fract( seed.mul( 41.3 ) );

			const albedo = mix( vec3( 0.05, 0.05, 0.058 ), vec3( 0.62, 0.6, 0.56 ), tone.mul( tone ) ).toVar();
			const shininess = mix( float( 50 ), float( 700 ), gloss ).toVar();
			const specular = mix( float( 0.0 ), float( 7.0 ), pow( gloss, 2.6 ) ).toVar();
			const nv = dot( N, Vd ).toVar();

			const shade = ( L, radiance, glint ) => {

				const nl = dot( N, L );
				const sameSide = step( 0, nl.mul( nv ) );
				const diffuse = abs( nl ).mul( 0.3183 ).mul( mix( float( 0.09 ), float( 1 ), sameSide ) );
				const highlight = pow( abs( dot( N, normalize( L.add( Vd ) ) ) ), shininess ).mul( specular ).mul( sameSide ).mul( glint );
				return albedo.mul( diffuse ).add( highlight ).mul( radiance );

			};

			const toOrb = C.position.sub( ctr ).toVar();
			const d2 = dot( toOrb, toOrb ).toVar();
			const color = shade( toOrb.mul( d2.inverseSqrt() ), U.orbColor.div( d2.add( 0.3 ) ), 1 ).toVar();

			const toSpot = rig.spotPosition.sub( ctr ).toVar();
			const s2 = dot( toSpot, toSpot ).toVar();
			const spotL = toSpot.mul( s2.inverseSqrt() ).toVar();
			const cone = smoothstep( rig.spotConeCos, float( 1 ), dot( spotL.negate(), rig.spotDirection ) );
			color.addAssign( shade( spotL, rig.spotColor.mul( cone ).div( s2 ), 1 ).mul( config.light.spotOnDust ) );

			color.addAssign( shade( rig.fillMagentaDirection, rig.fillMagentaColor, 0 ) );
			color.addAssign( shade( rig.fillTealDirection, rig.fillTealColor, 0 ) );
			color.addAssign( emberColor.mul( aPos.w.mul( aPos.w ) ) );

			const facing = max( abs( dot( N, Vd ) ), 0.12 );
			const flakeEnergy = pow( sizePx.div( drawPx ), 2 );
			const discEnergy = sizePx.mul( sizePx ).mul( facing ).div( radiusPx.mul( radiusPx ).mul( 3.14159 ) );

			return color.mul( mix( flakeEnergy, discEnergy, blend ) ).mul( U.dustGain );

		} )().toVar();

		dustMaterial.positionNode = Fn( () => {

			const right = cameraWorldMatrix.mul( vec4( 1, 0, 0, 0 ) ).xyz;
			const up = cameraWorldMatrix.mul( vec4( 0, 1, 0, 0 ) ).xyz;

			const flake = TSL.quatRotate( positionLocal.mul( drawPx.mul( pixelWorld ) ), aRot );
			const disc = right.mul( positionLocal.x ).add( up.mul( positionLocal.y ) ).mul( radiusPx.mul( 2 ).mul( pixelWorld ) );
			const visible = step( 0.0012, max( lit.r, max( lit.g, lit.b ) ) );

			return ctr.add( mix( flake, disc, blend ).mul( appear( aData.z ) ).mul( visible ) );

		} )();

		const vColor = varying( lit );
		const vBlend = varying( blend );
		const vRadius = varying( radiusPx );

		const r = length( uv().sub( 0.5 ) ).mul( 2 );
		const edge = min( float( 1.5 ).div( vRadius ), 0.5 );
		const disc = smoothstep( float( 1 ).sub( edge ), float( 1 ), r ).oneMinus();
		const rim = smoothstep( 0.45, 1.0, r ).mul( 0.22 ).add( 1 ).div( 1.09 );

		dustMaterial.colorNode = vec4( vColor.mul( mix( float( 1 ), disc.mul( rim ), vBlend ) ), 1 );

	}

	const dustSystem = createGPUBodySystem( {
		name: 'Snow & Light Dust',
		count: quality.dust,
		buffers: dustBuffers,
		buildComputeFn: ( B ) => buildUpdate( B, cfg.dustPull ),
		geometry: new THREE.PlaneGeometry( 1, 1 ),
		material: dustMaterial,
		targetScene: overlayScene
	} );

	const orbColorTmp = new THREE.Color();
	let vortexTarget = 0;
	let driftAccumulator = 0;

	function setFieldMode( mode ) {

		vortexTarget = mode === 'vortex' ? 1 : 0;

	}

	function setBlizzardDrift( scale ) {

		U.driftScale.value = THREE.MathUtils.clamp( scale, 0.2, 2.5 );

	}

	function triggerFrostGust( origin = collider.position, strength = 1.0 ) {

		U.gustOrigin.value.copy( origin );
		U.gustAge.value = 0;
		U.gustStrength.value = strength;

	}

	function setFrame( f ) {

		updateBoundsFromFrame( f );
		const drawFraction = THREE.MathUtils.clamp( ( bounds.x * bounds.y ) / 12.2, 0.4, 1 );
		cubeSystem.setDrawFraction( drawFraction );
		dustSystem.setDrawFraction( drawFraction );

	}

	function update( dt, time, { renderer } ) {

		U.dt.value = dt;
		U.time.value = time;
		U.reveal.value = Math.min( 1, U.reveal.value + dt / 3.2 );
		U.vortexMode.value += ( vortexTarget - U.vortexMode.value ) * Math.min( 1, dt * 6.0 );
		if ( U.gustAge.value < 10 ) U.gustAge.value += dt;

		orbColorTmp.copy( orbLight.color ).multiplyScalar( orbLight.intensity );
		U.orbColor.value.copy( orbColorTmp );

		driftAccumulator += dt * cfg.flowDrift * ( 0.45 + U.driftScale.value * 0.55 );
		U.flowOffset.value.set( driftAccumulator * 0.35, driftAccumulator, driftAccumulator * 0.7 );
		U.swirlAxis.value.set( 0.22 * Math.sin( time * 0.11 ), 0.3 * Math.cos( time * 0.07 ), 0.93 ).normalize();

		cubeSystem.dispatch( renderer );
		dustSystem.dispatch( renderer );

	}

	function dispose() {

		cubeSystem.dispose();
		dustSystem.dispose();

	}

	return {
		uniforms: U,
		cubeSystem,
		dustSystem,
		bodyCount: quality.cubes + quality.dust,
		setFieldMode,
		setBlizzardDrift,
		triggerFrostGust,
		setFrame,
		update,
		dispose
	};

}
