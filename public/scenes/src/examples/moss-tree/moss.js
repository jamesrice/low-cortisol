import * as THREE from 'three/webgpu';
import {
	Fn, If, uniform, instanceIndex, varying, lights,
	float, vec3, vec4, mix, exp, max, min, dot, cross, normalize, length, abs, sin, cos, pow, fract,
	smoothstep, saturate, step, uv, positionLocal, normalLocal, positionWorld, normalView, positionViewDirection,
	cameraPosition, cameraViewMatrix, cameraWorldMatrix
} from 'three/tsl';
import { createStorageBuffers, createGPUBodySystem, TSL } from '../../engine/index.js';
import { evalMainTrunkSurface, evalBranchSurface, evalMossCushionDensity } from './trunk.js';

// GPU-simulated macro moss ecosystem (3 coupled layers):
//   1. Velvet Moss Cushion Fronds (32k–145k 3D star-rosette shoots anchored in bark)
//      - Bend & ripple elastically under mouse movement (swept-segment CCD + dipole brush)
//      - Unfurl, stand taller, shift into luminous chartreuse-emerald & shimmer when activated
//   2. Moss Sporophytes (900–3.8k hair-thin copper setae + nodding spore capsules)
//      - Sway elastically like delicate tuning forks when brushed
//   3. Rising Moss Spores (9k–45k optical scatter-bokeh particles in overlayScene)
//      - Rest near the moss pillows; lift & swirl into dappled sunbeams on activation

/**
 * 3D star-rosette moss gametophyte shoot: 3 arched botanical leaflets at 120°
 * around the local +Y growth axis (15 triangles per shoot).
 * uv.y = 0 (bark root) -> 1 (frond tip), uv.x = 0 (stem) -> 1 (leaflet edge).
 */
function buildMossTuftGeometry() {

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	const blades = 3;
	let vOffset = 0;

	for ( let b = 0; b < blades; b ++ ) {

		const angle = ( b / blades ) * Math.PI * 2 + 0.35;
		const ca = Math.cos( angle );
		const sa = Math.sin( angle );
		// Perpendicular width axis
		const px = - sa;
		const pz = ca;

		// 4 height rings from root (0) to arched tip (1)
		const rings = [
			{ y: 0.0, reach: 0.02, halfW: 0.145, uvY: 0.0 },
			{ y: 0.36, reach: 0.10, halfW: 0.175, uvY: 0.36 },
			{ y: 0.72, reach: 0.22, halfW: 0.115, uvY: 0.72 }
		];

		for ( const r of rings ) {

			const cx = ca * r.reach;
			const cz = sa * r.reach;

			// Left vertex
			positions.push( cx - px * r.halfW, r.y, cz - pz * r.halfW );
			normals.push( ca * 0.55 - px * 0.35, 0.72, sa * 0.55 - pz * 0.35 );
			uvs.push( 0.85, r.uvY );

			// Right vertex
			positions.push( cx + px * r.halfW, r.y, cz + pz * r.halfW );
			normals.push( ca * 0.55 + px * 0.35, 0.72, sa * 0.55 + pz * 0.35 );
			uvs.push( 0.85, r.uvY );

		}

		// Tapered arched tip vertex
		positions.push( ca * 0.32, 1.0, sa * 0.32 );
		normals.push( ca * 0.45, 0.88, sa * 0.45 );
		uvs.push( 0.2, 1.0 );

		// 2 quads + 1 tip triangle = 5 triangles per leaflet
		indices.push(
			vOffset + 0, vOffset + 1, vOffset + 2,
			vOffset + 1, vOffset + 3, vOffset + 2,
			vOffset + 2, vOffset + 3, vOffset + 4,
			vOffset + 3, vOffset + 5, vOffset + 4,
			vOffset + 4, vOffset + 5, vOffset + 6
		);

		vOffset += 7;

	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geom.setIndex( indices );
	geom.computeVertexNormals();
	return geom;

}

/**
 * Slender moss sporophyte: delicate copper-amber seta stalk topped with a
 * tiny nodding teardrop spore capsule (uv.x < 0.5 = stalk, uv.x > 0.5 = capsule).
 */
function buildSporophyteGeometry() {

	const positions = [];
	const uvs = [];
	const indices = [];
	let vOffset = 0;

	// Tapered 3-sided curved stalk (y: 0 -> 0.82)
	const stalkRings = [
		{ y: 0.0, ox: 0.0, r: 0.022, uvY: 0.0 },
		{ y: 0.34, ox: 0.015, r: 0.017, uvY: 0.34 },
		{ y: 0.66, ox: 0.045, r: 0.014, uvY: 0.66 },
		{ y: 0.84, ox: 0.095, r: 0.015, uvY: 0.84 }
	];

	for ( const ring of stalkRings ) {

		for ( let s = 0; s < 3; s ++ ) {

			const a = ( s / 3 ) * Math.PI * 2;
			positions.push( ring.ox + Math.cos( a ) * ring.r, ring.y, Math.sin( a ) * ring.r );
			uvs.push( 0.15, ring.uvY );

		}

	}

	for ( let i = 0; i < stalkRings.length - 1; i ++ ) {

		const r0 = i * 3;
		const r1 = ( i + 1 ) * 3;
		for ( let s = 0; s < 3; s ++ ) {

			const s1 = ( s + 1 ) % 3;
			indices.push( r0 + s, r0 + s1, r1 + s, r0 + s1, r1 + s1, r1 + s );

		}

	}
	vOffset = stalkRings.length * 3;

	// Nodding teardrop spore capsule (5-sided diamond/teardrop at top of stalk)
	const capBase = vOffset;
	const capSegs = 5;
	// Base point
	positions.push( 0.095, 0.83, 0.0 );
	uvs.push( 0.85, 0.84 );
	// Swollen equator
	for ( let s = 0; s < capSegs; s ++ ) {

		const a = ( s / capSegs ) * Math.PI * 2;
		positions.push( 0.145 + Math.cos( a ) * 0.068, 0.92 + Math.cos( a ) * 0.012, Math.sin( a ) * 0.068 );
		uvs.push( 0.92, 0.93 );

	}
	// Nodding beak tip
	positions.push( 0.215, 0.985, 0.0 );
	uvs.push( 1.0, 1.0 );

	const capTip = capBase + 1 + capSegs;
	for ( let s = 0; s < capSegs; s ++ ) {

		const s1 = ( s + 1 ) % capSegs;
		indices.push( capBase, capBase + 1 + s1, capBase + 1 + s );
		indices.push( capBase + 1 + s, capBase + 1 + s1, capTip );

	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geom.setIndex( indices );
	geom.computeVertexNormals();
	return geom;

}

/**
 * Sample an anchor point & normal on either the main trunk or mossy side branch,
 * rejection-sampled by the organic pillowy cushion density field.
 */
function sampleMossAnchor( rand, minDensity, outPos, outNorm ) {

	let density = 0;

	for ( let attempt = 0; attempt < 36; attempt ++ ) {

		if ( rand() < 0.74 ) {

			// Main trunk: front hemisphere + curved left/right macro silhouette rims
			const y = - 1.95 + rand() * 3.95;
			const theta = ( - 0.10 + rand() * 1.20 ) * Math.PI;
			evalMainTrunkSurface( y, theta, outPos, outNorm );

		} else {

			// Sweeping mossy side limb: start past trunk union, cover upper crest & front face
			const u = 0.16 + rand() * 0.82;
			const theta = ( 0.18 + rand() * 1.18 ) * Math.PI;
			evalBranchSurface( u, theta, outPos, outNorm );

		}

		density = evalMossCushionDensity( outPos.x, outPos.y, outPos.z, outNorm.x, outNorm.y, outNorm.z );
		if ( density >= minDensity && rand() < ( 0.14 + 0.86 * density ) ) break;

	}

	return density;

}

/**
 * Seed GPU storage buffers for moss fronds or sporophytes.
 */
function seedAnchoredFlora( { count, rand, minDensity, heightRange, widthRange, stiffnessRange } ) {

	const pos = new Float32Array( count * 4 ); // xyz = elastic tip offset, w = activation [0..1]
	const vel = new Float32Array( count * 4 ); // xyz = tip velocity, w = bloom phase
	const home = new Float32Array( count * 4 ); // xyz = bark root anchor, w = rest height
	const restNorm = new Float32Array( count * 4 ); // xyz = unit growth normal, w = species tint
	const data = new Float32Array( count * 4 ); // x = base width, y = stiffness, z = seed, w = twist

	const p = new THREE.Vector3();
	const n = new THREE.Vector3();

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		const density = sampleMossAnchor( rand, minDensity, p, n );

		// Slight organic splay away from rigid normal for lush velvety pillow texture
		n.x += ( rand() - 0.5 ) * 0.34;
		n.y += ( rand() - 0.5 ) * 0.34 + 0.12;
		n.z += ( rand() - 0.5 ) * 0.28;
		n.normalize();

		// Embed root slightly into bark so tufts never float
		const h = heightRange[ 0 ] + ( heightRange[ 1 ] - heightRange[ 0 ] ) * ( 0.35 * rand() + 0.65 * Math.pow( density, 0.75 ) );
		const w = widthRange[ 0 ] + ( widthRange[ 1 ] - widthRange[ 0 ] ) * ( 0.5 + 0.5 * rand() );
		const k = stiffnessRange[ 0 ] + ( stiffnessRange[ 1 ] - stiffnessRange[ 0 ] ) * rand();

		home[ o ] = p.x - n.x * 0.008;
		home[ o + 1 ] = p.y - n.y * 0.008;
		home[ o + 2 ] = p.z - n.z * 0.008;
		home[ o + 3 ] = h;

		restNorm[ o ] = n.x;
		restNorm[ o + 1 ] = n.y;
		restNorm[ o + 2 ] = n.z;
		restNorm[ o + 3 ] = rand(); // natural moss hue variety

		data[ o ] = w;
		data[ o + 1 ] = k;
		data[ o + 2 ] = rand();
		data[ o + 3 ] = rand() * Math.PI * 2;

	}

	return createStorageBuffers( count, {
		pos: { array: pos },
		vel: { array: vel },
		home: { array: home },
		restNorm: { array: restNorm },
		data: { array: data }
	} );

}

/**
 * Seed rising golden-emerald spores nestled above the moss cushions.
 */
function seedMossSpores( { count, rand } ) {

	const pos = new Float32Array( count * 4 ); // xyz = world pos, w = activation/glow heat
	const vel = new Float32Array( count * 4 ); // xyz = velocity
	const home = new Float32Array( count * 4 ); // xyz = rest pos above moss, w = buoyancy seed
	const data = new Float32Array( count * 4 ); // x = size, y = inertia, z = seed, w = ambient flag

	const p = new THREE.Vector3();
	const n = new THREE.Vector3();

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		const ambient = rand() < 0.22 ? 1 : 0;

		if ( ambient ) {

			// Free-drifting golden forest pollen/spores across varied macro depths
			const hx = ( rand() * 2 - 1 ) * 2.85;
			const hy = ( rand() * 2 - 1 ) * 1.65;
			const hz = - 1.4 + rand() * 3.8;
			home[ o ] = hx;
			home[ o + 1 ] = hy;
			home[ o + 2 ] = hz;

		} else {

			// Anchored just above mossy pillows — launch into eddies when moss is activated
			sampleMossAnchor( rand, 0.25, p, n );
			const lift = 0.04 + 0.34 * Math.pow( rand(), 1.8 );
			home[ o ] = p.x + n.x * lift;
			home[ o + 1 ] = p.y + n.y * lift;
			home[ o + 2 ] = p.z + n.z * lift;

		}

		home[ o + 3 ] = 0.5 + rand();

		pos[ o ] = home[ o ];
		pos[ o + 1 ] = home[ o + 1 ];
		pos[ o + 2 ] = home[ o + 2 ];
		pos[ o + 3 ] = 0;

		const size = ambient
			? 0.0026 + 0.0055 * Math.pow( rand(), 2.2 )
			: 0.0020 + 0.0042 * Math.pow( rand(), 2.6 );
		const inertia = 0.45 + ( size / 0.008 ) * 0.9;

		data[ o ] = size;
		data[ o + 1 ] = inertia;
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
 * Create the complete GPU interactive moss + sporophyte + rising spore ecosystem.
 */
export function createMossSystem( {
	scene,
	overlayScene,
	config,
	quality,
	collider,
	rig,
	sceneLights,
	environment,
	lens
} ) {

	const cfg = config.moss;
	const rand = TSL.mulberry32( 0x6055f02e );

	const U = {
		dt: uniform( 1 / 60 ),
		time: uniform( 0 ),
		reveal: uniform( 1 ),
		pixelSize: uniform( 0.001 ),
		flowOffset: uniform( new THREE.Vector3() ),
		swirlAxis: uniform( new THREE.Vector3( 0.15, 0.25, 0.95 ).normalize() ),

		stiffness: uniform( cfg.stiffness ),
		damping: uniform( cfg.damping ),
		brushStrength: uniform( cfg.brushStrength ),
		wakeStrength: uniform( cfg.wakeStrength ),
		swirlStrength: uniform( cfg.swirlStrength ),
		breezeFreq: uniform( cfg.breezeFreq ),
		breezeAmp: uniform( cfg.breezeAmp ),
		activationDecay: uniform( cfg.activationDecay ),
		activationGain: uniform( cfg.activationGain ),
		unfurlLift: uniform( cfg.unfurlLift ),
		sporeLift: uniform( cfg.sporeLift ),
		sporeGain: uniform( cfg.sporeGain ),

		// Secondary shockwave pulse (triggered by clicks or game Bloom Hunt pickups!)
		pulsePos: uniform( new THREE.Vector3( 0, 0, 10 ) ),
		pulseRadius: uniform( 0.01 ),
		pulseStrength: uniform( 0 ),

		cursorLightPos: uniform( new THREE.Vector3() ),
		cursorLightColor: uniform( new THREE.Color( config.collider.lightColor ) )
	};

	const C = collider.uniforms;

	// ----------------------------------------- Shared Anchored Flora Compute
	const buildFloraCompute = ( B, stiffnessScale = 1.0, maxBendRatio = 0.84 ) => Fn( () => {

		const P = B.pos.element( instanceIndex );
		const V = B.vel.element( instanceIndex );
		const H = B.home.element( instanceIndex );
		const RN = B.restNorm.element( instanceIndex );
		const D = B.data.element( instanceIndex );

		const dt = U.dt;
		const offset = P.xyz.toVar();
		const activation = P.w.toVar();
		const vel = V.xyz.toVar();

		const anchor = H.xyz;
		const height = H.w;
		const restN = RN.xyz;
		const k = D.y.mul( U.stiffness ).mul( stiffnessScale );
		const seed = D.z;

		// Live world tip position of this moss shoot
		const tipPos = anchor.add( restN.mul( height ) ).add( offset ).toVar();

		// Ambient gentle woodland micro-breeze
		const breeze = TSL.curlNoise( tipPos.mul( U.breezeFreq ).add( U.flowOffset ) ).mul( U.breezeAmp );
		const acc = breeze.mul( 6.0 ).toVar();

		// Hooke elastic spring restoring bent shoot back to upright rest pose
		acc.subAssign( offset.mul( k ) );

		// Swept-segment mouse interaction against [C.previous -> C.position]
		const closest = TSL.closestPointOnSweep( tipPos, C.previous, C.position ).toVar();
		const rel = tipPos.sub( closest ).toVar();
		const dist = max( length( rel ), 1e-4 ).toVar();
		const n2 = rel.div( dist ).toVar();

		const reachR = C.radius.mul( 1.38 );
		const proximity = smoothstep( reachR, C.radius.mul( 0.08 ), dist ).mul( C.active ).toVar();

		const cursorSpeed = length( C.velocity ).toVar();

		If( proximity.greaterThan( 0.001 ), () => {

			// Tactile radial parting + sweeping velocity wake + subtle curl swirl
			const radialPush = n2.mul( U.brushStrength ).mul( float( 0.45 ).add( C.charge.mul( 0.9 ) ) );
			const sweepDrag = C.velocity.mul( U.wakeStrength ).mul( 4.6 );
			const swirl = cross( restN, n2 ).mul( U.swirlStrength ).mul( float( 0.4 ).add( cursorSpeed.mul( 0.25 ) ) );

			const force = radialPush.add( sweepDrag ).add( swirl ).mul( proximity );
			// Project force mostly tangential to bark so shoots bend cleanly over the surface
			const tangential = force.sub( restN.mul( dot( force, restN ).mul( 0.72 ) ) );
			acc.addAssign( tangential );

		} );

		// Secondary expanding pulse ring (from click charge or game trigger blooms)
		const pDist = length( tipPos.sub( U.pulsePos ) );
		const ringBand = exp( pow( pDist.sub( U.pulseRadius ).div( 0.26 ), 2 ).negate() ).mul( U.pulseStrength );
		const ringDir = normalize( tipPos.sub( U.pulsePos ).add( vec3( 1e-4 ) ) );
		acc.addAssign( ringDir.sub( restN.mul( dot( ringDir, restN ).mul( 0.7 ) ) ).mul( ringBand ).mul( 24.0 ) );

		// Symplectic elastic integration with exponential velvety damping
		vel.addAssign( acc.mul( dt ) );
		vel.mulAssign( exp( dt.mul( U.damping ).negate() ) );
		offset.addAssign( vel.mul( dt ) );

		// Clamp tip excursion so roots never shear awkwardly
		const maxExcursion = height.mul( maxBendRatio );
		const offLen = length( offset );
		If( offLen.greaterThan( maxExcursion ), () => {

			offset.mulAssign( maxExcursion.div( max( offLen, 1e-4 ) ) );
			vel.mulAssign( 0.7 );

		} );

		// Botanical activation energy: wakes up vividly on mouse movement & pulse ripples
		const motionBoost = min( cursorSpeed.mul( 0.42 ).add( C.charge.mul( 1.2 ) ).add( 0.22 ), 2.2 );
		const hitEnergy = proximity.mul( motionBoost ).mul( U.activationGain ).add( ringBand.mul( 1.6 ) );
		const nextActivation = max(
			activation.mul( exp( dt.mul( U.activationDecay ).negate() ) ),
			min( hitEnergy, 1.0 )
		);

		// Subtle breathing shimmer phase for activated moss tips
		const phase = V.w.add( dt.mul( float( 2.2 ).add( nextActivation.mul( 3.5 ) ).add( seed ) ) );

		P.assign( vec4( offset, nextActivation ) );
		V.assign( vec4( vel, phase ) );

	} );

	// -------------------------------------------------- 1. Velvet Moss Cushions
	const mossBuffers = seedAnchoredFlora( {
		count: quality.moss,
		rand,
		minDensity: 0.08,
		heightRange: [ 0.022, 0.068 ],
		widthRange: [ 0.030, 0.066 ],
		stiffnessRange: [ 0.85, 1.4 ]
	} );

	const mossMaterial = new THREE.MeshStandardNodeMaterial( {
		metalness: 0.0,
		side: THREE.DoubleSide
	} );

	{

		const aPos = mossBuffers.pos.toAttribute(); // xyz = tip offset, w = activation
		const aHome = mossBuffers.home.toAttribute(); // xyz = anchor, w = height
		const aNorm = mossBuffers.restNorm.toAttribute(); // xyz = unit rest normal, w = tint
		const aData = mossBuffers.data.toAttribute(); // x = width, y = stiffness, z = seed, w = twist

		const appear = smoothstep( aData.z.mul( 0.65 ), aData.z.mul( 0.65 ).add( 0.35 ), U.reveal );

		mossMaterial.positionNode = Fn( () => {

			const N = aNorm.xyz.toVar();
			const upRef = abs( N.y ).greaterThan( 0.92 ).select( vec3( 1, 0, 0 ), vec3( 0, 1, 0 ) );
			const T0 = normalize( cross( upRef, N ) );
			const B0 = cross( N, T0 );

			const ca = cos( aData.w );
			const sa = sin( aData.w );
			const T = T0.mul( ca ).add( B0.mul( sa ) );
			const B = B0.mul( ca ).sub( T0.mul( sa ) );

			const act = aPos.w;
			const tY = uv().y;
			const bendW = tY.mul( tY ); // cantilever curve: root locked, tip fluid

			// Activated moss gently unfurls wider and stands slightly taller!
			const heightScale = aHome.w.mul( float( 1 ).add( act.mul( U.unfurlLift ) ) ).mul( appear );
			const widthScale = aData.x.mul( float( 1 ).add( act.mul( 0.28 ).mul( tY ) ) ).mul( appear );

			const localWorld = T.mul( positionLocal.x.mul( widthScale ) )
				.add( N.mul( positionLocal.y.mul( heightScale ) ) )
				.add( B.mul( positionLocal.z.mul( widthScale ) ) );

			const bentOffset = aPos.xyz.mul( bendW );
			const worldPos = aHome.xyz.add( localWorld ).add( bentOffset );

			// Tilt vertex normal dynamically along elastic bend for rich velvet sheen
			const baseNormal = T.mul( normalLocal.x ).add( N.mul( normalLocal.y ) ).add( B.mul( normalLocal.z ) );
			const bentNormal = normalize( baseNormal.add( aPos.xyz.mul( tY.mul( 4.5 ) ) ) );
			normalLocal.assign( bentNormal );

			return worldPos;

		} )();

		const vActivation = varying( aPos.w );
		const vTint = varying( aNorm.w );
		const vSeed = varying( aData.z );

		mossMaterial.colorNode = Fn( () => {

			const tip = uv().y;
			const edge = uv().x;

			// Dormant deep woodland bryophyte gradient: shady forest root -> plush velvet emerald tip
			const rootColor = vec3( 0.006, 0.018, 0.005 );
			const midDormant = mix( vec3( 0.024, 0.088, 0.016 ), vec3( 0.048, 0.118, 0.020 ), vTint );
			const tipDormant = mix( vec3( 0.075, 0.175, 0.028 ), vec3( 0.135, 0.235, 0.038 ), vTint );

			// Activated lush jewel-emerald & warm sunlit chartreuse-lime (rich saturation, never white!)
			const midActive = mix( vec3( 0.10, 0.31, 0.032 ), vec3( 0.18, 0.42, 0.045 ), vTint );
			const tipActive = mix( vec3( 0.32, 0.62, 0.075 ), vec3( 0.56, 0.78, 0.125 ), vTint );

			const mid = mix( midDormant, midActive, vActivation );
			const top = mix( tipDormant, tipActive, vActivation );

			const col = mix( rootColor, mid, smoothstep( 0.0, 0.50, tip ) );
			const graded = mix( col, top, smoothstep( 0.42, 1.0, tip ) );

			// Restrained backlit chlorophyll translucency along thin leaflet edges
			const viewDir = normalize( cameraPosition.sub( positionWorld ) );
			const sunDir = rig.sunDirection.negate();
			const backScatter = pow( saturate( dot( viewDir, sunDir ) ), 3.0 ).mul( tip );
			const rim = pow( saturate( abs( dot( normalView, positionViewDirection ) ).oneMinus() ), 2.6 ).mul( tip );

			const sssColor = mix( vec3( 0.14, 0.32, 0.04 ), vec3( 0.44, 0.72, 0.11 ), vActivation );
			const translucent = sssColor.mul( backScatter.mul( 0.24 ).add( rim.mul( 0.22 ) ) ).mul( edge );

			return vec4( graded.add( translucent ), 1 );

		} )();

		mossMaterial.roughnessNode = mix( float( 0.88 ), float( 0.46 ), uv().y.mul( float( 0.4 ).add( vActivation.mul( 0.5 ) ) ) )
			.clamp( 0.36, 0.94 );

		// Refined organic bioluminescent dew-tip shimmer when awakened by mouse movement
		mossMaterial.emissiveNode = Fn( () => {

			const tipMask = smoothstep( 0.52, 1.0, uv().y );
			const sparkle = pow( sin( U.time.mul( 3.2 ).add( vSeed.mul( 31.4 ) ) ).mul( 0.5 ).add( 0.5 ), 3.5 );
			const dewColor = mix( vec3( 0.16, 0.56, 0.06 ), vec3( 0.62, 0.88, 0.14 ), sparkle.mul( 0.55 ).add( vTint.mul( 0.45 ) ) );

			return dewColor.mul( pow( vActivation, 1.55 ) ).mul( tipMask ).mul( float( 0.28 ).add( sparkle.mul( 0.36 ) ) );

		} )();

		mossMaterial.lightsNode = lights( sceneLights );
		mossMaterial.envMap = environment;
		mossMaterial.envMapIntensity = config.light.environmentIntensity;

	}

	const mossSystem = createGPUBodySystem( {
		name: 'Macro Moss Cushion',
		count: quality.moss,
		buffers: mossBuffers,
		buildComputeFn: ( B ) => buildFloraCompute( B, 1.0, 0.85 ),
		geometry: buildMossTuftGeometry(),
		material: mossMaterial,
		targetScene: scene,
		castShadow: quality.shadows,
		receiveShadow: quality.shadows
	} );

	// -------------------------------------------------- 2. Moss Sporophytes
	const sporoBuffers = seedAnchoredFlora( {
		count: quality.sporophytes,
		rand,
		minDensity: 0.42, // grow from the lushest moss pillow crowns
		heightRange: [ 0.075, 0.165 ],
		widthRange: [ 0.085, 0.145 ],
		stiffnessRange: [ 0.42, 0.72 ] // whippy hair-thin stalks
	} );

	const sporoMaterial = new THREE.MeshStandardNodeMaterial( { metalness: 0.05 } );

	{

		const aPos = sporoBuffers.pos.toAttribute();
		const aHome = sporoBuffers.home.toAttribute();
		const aNorm = sporoBuffers.restNorm.toAttribute();
		const aData = sporoBuffers.data.toAttribute();

		const appear = smoothstep( aData.z.mul( 0.7 ), aData.z.mul( 0.7 ).add( 0.3 ), U.reveal );

		sporoMaterial.positionNode = Fn( () => {

			const N = aNorm.xyz.toVar();
			const upRef = abs( N.y ).greaterThan( 0.92 ).select( vec3( 1, 0, 0 ), vec3( 0, 1, 0 ) );
			const T0 = normalize( cross( upRef, N ) );
			const B0 = cross( N, T0 );

			const ca = cos( aData.w );
			const sa = sin( aData.w );
			const T = T0.mul( ca ).add( B0.mul( sa ) );
			const B = B0.mul( ca ).sub( T0.mul( sa ) );

			const act = aPos.w;
			const tY = uv().y;
			const bendW = tY.mul( tY );

			const heightScale = aHome.w.mul( float( 1 ).add( act.mul( 0.18 ) ) ).mul( appear );
			const widthScale = aData.x.mul( appear );

			const localWorld = T.mul( positionLocal.x.mul( widthScale ) )
				.add( N.mul( positionLocal.y.mul( heightScale ) ) )
				.add( B.mul( positionLocal.z.mul( widthScale ) ) );

			const baseNormal = T.mul( normalLocal.x ).add( N.mul( normalLocal.y ) ).add( B.mul( normalLocal.z ) );
			normalLocal.assign( normalize( baseNormal.add( aPos.xyz.mul( tY.mul( 3.0 ) ) ) ) );

			return aHome.xyz.add( localWorld ).add( aPos.xyz.mul( bendW ) );

		} )();

		const vActivation = varying( aPos.w );
		const vSeed = varying( aData.z );

		const isCapsule = smoothstep( 0.45, 0.75, uv().x );
		const stalkColor = vec3( 0.38, 0.17, 0.07 ); // copper-red seta
		const capsuleDormant = vec3( 0.56, 0.44, 0.14 );
		const capsuleActive = vec3( 0.96, 0.88, 0.32 );

		sporoMaterial.colorNode = vec4(
			mix( stalkColor, mix( capsuleDormant, capsuleActive, vActivation ), isCapsule ),
			1
		);
		sporoMaterial.roughnessNode = mix( float( 0.65 ), float( 0.32 ), isCapsule );
		sporoMaterial.emissiveNode = vec3( 0.85, 0.68, 0.18 )
			.mul( isCapsule )
			.mul( float( 0.05 ).add( pow( vActivation, 1.5 ).mul( 0.68 ) ) )
			.mul( sin( U.time.mul( 4.0 ).add( vSeed.mul( 20.0 ) ) ).mul( 0.18 ).add( 0.9 ) );
		sporoMaterial.lightsNode = lights( sceneLights );
		sporoMaterial.envMap = environment;
		sporoMaterial.envMapIntensity = config.light.environmentIntensity;

	}

	const sporoSystem = createGPUBodySystem( {
		name: 'Moss Sporophytes',
		count: quality.sporophytes,
		buffers: sporoBuffers,
		buildComputeFn: ( B ) => buildFloraCompute( B, 0.45, 0.92 ),
		geometry: buildSporophyteGeometry(),
		material: sporoMaterial,
		targetScene: scene,
		castShadow: false,
		receiveShadow: quality.shadows
	} );

	// ---------------------------------- 3. Rising Golden-Emerald Moss Spores
	const sporeBuffers = seedMossSpores( { count: quality.spores, rand } );

	const buildSporeCompute = ( B ) => Fn( () => {

		const P = B.pos.element( instanceIndex );
		const V = B.vel.element( instanceIndex );
		const H = B.home.element( instanceIndex );
		const D = B.data.element( instanceIndex );

		const dt = U.dt;
		const p = P.xyz.toVar();
		const v = V.xyz.toVar();
		const heat = P.w.toVar();

		const inertia = D.y;
		const seed = D.z;
		const ambient = D.w.greaterThan( 0.5 );

		// Ambient woodland curl breeze
		const flow = TSL.sampleCurlFlow( p, float( 0.55 ), float( 0.26 ), U.flowOffset, 0.45 ).toVar();
		flow.addAssign( vec3( 0.06, 0.03, 0.0 ) );

		// Dipole air wake + vortex swirl around moving pointer
		const rel = p.sub( C.position ).toVar();
		const r = max( length( rel ), 1e-3 ).toVar();
		const n = rel.div( r ).toVar();

		flow.addAssign( TSL.computeDipoleWake( rel, r, C.radius, C.velocity, float( 1.45 ) ).mul( C.active ) );
		flow.addAssign( TSL.computeVortexSwirl( n, r, C.radius, U.swirlAxis, float( 1.15 ) ).mul( C.active ) );

		// Restoring home tether + thermal buoyancy when awakened!
		const acc = H.xyz.sub( p ).mul( ambient.select( float( 0.14 ), float( 0.42 ) ) ).toVar();
		acc.y.addAssign( heat.mul( U.sporeLift ).mul( H.w ) );

		// Swept interaction impulse & activation
		const closest = TSL.closestPointOnSweep( p, C.previous, C.position ).toVar();
		const rel2 = p.sub( closest ).toVar();
		const r2 = max( length( rel2 ), 1e-4 ).toVar();
		const n2 = rel2.div( r2 ).toVar();

		const prox = smoothstep( C.radius.mul( 1.45 ), C.radius.mul( 0.15 ), r2 ).mul( C.active ).toVar();
		const speed = length( C.velocity );
		const wakeImpulse = prox.mul( float( 0.3 ).add( speed.mul( 0.48 ) ).add( C.charge.mul( 1.3 ) ) );

		// Gentle lift and swirl burst on nearby moss spores
		acc.addAssign( n2.mul( prox.mul( 5.5 ) ).add( vec3( 0, wakeImpulse.mul( 4.2 ), 0 ) ) );

		// Expanding click/game pulse burst
		const pDist = length( p.sub( U.pulsePos ) );
		const ring = exp( pow( pDist.sub( U.pulseRadius ).div( 0.3 ), 2 ).negate() ).mul( U.pulseStrength );
		acc.addAssign( normalize( p.sub( U.pulsePos ).add( vec3( 0, 0.25, 0 ) ) ).mul( ring ).mul( 14.0 ) );

		TSL.applyFluidDrag( v, flow, float( 2.8 ).div( inertia ), dt );
		v.addAssign( acc.mul( dt ) );
		TSL.clampSpeed( v, float( 10.0 ) );
		p.addAssign( v.mul( dt ) );

		const nextHeat = max(
			heat.mul( exp( dt.mul( - 0.55 ) ) ),
			min( wakeImpulse.mul( 0.85 ).add( ring.mul( 1.4 ) ), 1.0 )
		);

		P.assign( vec4( p, nextHeat ) );
		V.assign( vec4( v, fract( seed.add( U.time.mul( 0.2 ) ) ) ) );

	} );

	const sporeMaterial = new THREE.MeshBasicNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	} );

	{

		const aPos = sporeBuffers.pos.toAttribute();
		const aData = sporeBuffers.data.toAttribute();

		const center = aPos.xyz;
		const heat = aPos.w;
		const seed = aData.z;
		const isAmbient = aData.w;

		// Analytical per-spore scatter bokeh synchronized with the shared macro lens
		const distance = cameraViewMatrix.mul( vec4( center, 1 ) ).z.negate();
		const defocus = max( abs( distance.sub( lens.focus ) ).sub( lens.focusSlab ), 0 );
		const cocPx = min( smoothstep( 0, lens.focalRange, defocus ).mul( lens.bokehPx ), float( 8.5 ) );

		const pixelWorld = distance.mul( U.pixelSize );
		const sizePx = aData.x.mul( float( 1 ).add( heat.mul( 0.45 ) ) ).div( max( pixelWorld, 1e-5 ) );
		const drawPx = max( sizePx, 1.15 );
		const radiusPx = cocPx.add( drawPx.mul( 0.5 ) );
		const blend = saturate( cocPx.mul( 0.55 ) );

		// Sunbeam + cursor illumination + activation glow
		const lit = Fn( () => {

			const toSun = rig.sunPosition.sub( center ).toVar();
			const s2 = max( dot( toSun, toSun ), 0.5 );
			const sunL = toSun.mul( s2.inverseSqrt() );
			const cone = smoothstep( rig.sunConeCos, float( 1 ), dot( sunL.negate(), rig.sunDirection ) );

			const toCursor = U.cursorLightPos.sub( center );
			const c2 = dot( toCursor, toCursor );
			const cursorGlow = U.cursorLightColor.div( c2.add( 0.95 ) ).mul( 0.22 );

			const sunGold = vec3( 0.96, 0.82, 0.36 ).mul( cone.mul( 0.85 ).add( 0.08 ) );
			const sporeEmerald = mix( vec3( 0.32, 0.78, 0.16 ), vec3( 0.92, 0.92, 0.30 ), fract( seed.mul( 13.7 ) ) );

			// Dormant moss spores stay delicate; activated ones drift out as golden-emerald motes
			const baseVis = mix( float( 0.03 ), float( 0.22 ), isAmbient );
			const twinkle = sin( U.time.mul( 2.8 ).add( seed.mul( 47.1 ) ) ).mul( 0.25 ).add( 0.82 );

			const radiance = sunGold.mul( baseVis ).add( sporeEmerald.mul( heat.mul( 1.15 ) ) ).add( cursorGlow.mul( heat.add( 0.08 ) ) );

			// Energy conservation as sharp motes bloom into delicate macro bokeh circles
			const flakeEnergy = pow( sizePx.div( drawPx ), 2 );
			const discEnergy = sizePx.mul( sizePx ).div( max( radiusPx.mul( radiusPx ).mul( 3.14159 ), 1.0 ) );

			return radiance.mul( twinkle ).mul( mix( flakeEnergy, discEnergy.mul( 1.25 ), blend ) ).mul( U.sporeGain );

		} )().toVar();

		const appear = smoothstep( seed.mul( 0.7 ), seed.mul( 0.7 ).add( 0.3 ), U.reveal );

		sporeMaterial.positionNode = Fn( () => {

			const right = cameraWorldMatrix.mul( vec4( 1, 0, 0, 0 ) ).xyz;
			const up = cameraWorldMatrix.mul( vec4( 0, 1, 0, 0 ) ).xyz;

			const visible = step( 0.001, max( lit.r, max( lit.g, lit.b ) ) );
			const billboard = right.mul( positionLocal.x ).add( up.mul( positionLocal.y ) ).mul( radiusPx.mul( 2 ).mul( pixelWorld ) );

			return center.add( billboard.mul( appear ).mul( visible ) );

		} )();

		const vColor = varying( lit );
		const vRadius = varying( radiusPx );

		const r = length( uv().sub( 0.5 ) ).mul( 2 );
		const edge = min( float( 1.5 ).div( max( vRadius, 1.0 ) ), 0.5 );
		const disc = smoothstep( float( 1 ).sub( edge ), float( 1 ), r ).oneMinus();
		const rim = smoothstep( 0.45, 1.0, r ).mul( 0.24 ).add( 1 ).div( 1.08 );

		sporeMaterial.colorNode = vec4( vColor.mul( disc.mul( rim ) ), 1 );

	}

	const sporeSystem = createGPUBodySystem( {
		name: 'Rising Moss Spores',
		count: quality.spores,
		buffers: sporeBuffers,
		buildComputeFn: buildSporeCompute,
		geometry: new THREE.PlaneGeometry( 1, 1 ),
		material: sporeMaterial,
		targetScene: overlayScene
	} );

	// -------------------------------------------------- Pulse & Frame Updates
	let pulseAge = 99;
	let pulseOrigin = new THREE.Vector3();

	function triggerPulse( worldPoint, strength = 1.0 ) {

		pulseOrigin.copy( worldPoint );
		U.pulsePos.value.copy( worldPoint );
		U.pulseStrength.value = strength;
		U.pulseRadius.value = 0.06;
		pulseAge = 0;

	}

	let wasPressed = false;

	function update( dt, time, { renderer } ) {

		U.dt.value = dt;
		U.time.value = time;
		U.reveal.value = Math.min( 1, U.reveal.value + dt / 2.2 );

		const drift = time * 0.16;
		U.flowOffset.value.set( drift * 0.45, drift * 0.85, drift * 0.3 );

		U.swirlAxis.value.set(
			0.18 * Math.sin( time * 0.19 ),
			0.25 * Math.cos( time * 0.13 ),
			0.95
		).normalize();

		U.cursorLightPos.value.copy( collider.position );

		// Trigger expanding organic moss ripple on pointer press
		if ( collider.pointer.pressed && ! wasPressed ) {

			triggerPulse( collider.position, 1.15 );

		}
		wasPressed = collider.pointer.pressed;

		if ( pulseAge < 2.2 ) {

			pulseAge += dt;
			U.pulseRadius.value = 0.08 + pulseAge * 1.45;
			U.pulseStrength.value = Math.max( 0, Math.exp( - pulseAge * 2.1 ) * 1.15 );

		} else {

			U.pulseStrength.value = 0;

		}

		mossSystem.dispatch( renderer );
		sporoSystem.dispatch( renderer );
		sporeSystem.dispatch( renderer );

	}

	function setFrame( { pixelSize } ) {

		U.pixelSize.value = pixelSize;

	}

	function dispose() {

		mossSystem.dispose();
		sporoSystem.dispose();
		sporeSystem.dispose();

	}

	return {
		uniforms: U,
		mossSystem,
		sporoSystem,
		sporeSystem,
		bodyCount: quality.moss + quality.sporophytes + quality.spores,
		triggerPulse,
		update,
		setFrame,
		dispose
	};

}
