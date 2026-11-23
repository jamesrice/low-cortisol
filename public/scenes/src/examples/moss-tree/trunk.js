import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, vec4, mix, smoothstep, saturate, pow, dot, normalize,
	positionWorld, normalWorldGeometry, cameraViewMatrix, lights,
	mx_noise_float, mx_fractal_noise_float
} from 'three/tsl';
import { TSL } from '../../engine/index.js';

// Procedural gnarled old-growth tree trunk + sweeping moss-draped limb,
// shared deterministic bark surface evaluators (used by mesh builder, moss
// seeding, pointer raycasting, and GPU collision capsules), plus out-of-focus
// woodland background depth silhouettes for creamy macro bokeh.

const _tmpP = new THREE.Vector3();
const _tmpP1 = new THREE.Vector3();
const _tmpP2 = new THREE.Vector3();
const _tmpT1 = new THREE.Vector3();
const _tmpT2 = new THREE.Vector3();

/**
 * Spine curve and base radius of the main vertical gnarled trunk.
 */
export function evalMainTrunkSpine( y ) {

	const cx = - 0.56 + 0.22 * Math.sin( y * 0.62 + 0.35 ) - 0.055 * y;
	const cz = - 0.38 + 0.14 * Math.cos( y * 0.52 - 0.28 );
	const flare = Math.max( 0, - 0.72 - y );
	const radius = 0.94 - 0.065 * y + 0.26 * Math.pow( flare, 1.7 );

	return { cx, cz, radius };

}

/**
 * Bark fissure & gnarl displacement along the main trunk.
 */
function trunkBarkRelief( y, theta ) {

	const warp = 1.35 * Math.sin( y * 0.95 + theta * 2.0 ) + 0.45 * Math.cos( y * 2.1 - theta * 3.0 );
	const primaryRidge = 0.048 * Math.sin( theta * 9.0 + warp );
	const secondaryFurrow = 0.024 * Math.sin( theta * 19.0 - y * 2.1 + 0.75 * Math.cos( theta * 5.0 ) );
	const microCrack = 0.011 * Math.cos( theta * 33.0 + y * 4.7 );

	// Subtle organic burls / knots
	const d1 = Math.pow( y - 0.35, 2 ) * 2.8 + Math.pow( Math.sin( ( theta - 1.2 ) * 0.5 ), 2 ) * 14.0;
	const d2 = Math.pow( y + 0.48, 2 ) * 2.5 + Math.pow( Math.sin( ( theta - 1.85 ) * 0.5 ), 2 ) * 12.0;
	const burl = 0.075 * Math.exp( - d1 ) + 0.06 * Math.exp( - d2 );

	return primaryRidge + secondaryFurrow + microCrack + burl;

}

/**
 * Exact 3D point on the main gnarled trunk surface for height `y` and angle `theta`.
 * Note: theta = Math.PI * 0.5 faces directly toward +Z (the camera).
 */
export function evalMainTrunkPoint( y, theta, out = new THREE.Vector3() ) {

	const { cx, cz, radius } = evalMainTrunkSpine( y );
	const r = radius + trunkBarkRelief( y, theta );

	return out.set( cx + Math.cos( theta ) * r, y, cz + Math.sin( theta ) * r );

}

/**
 * Exact 3D point and outward unit normal on the main trunk surface.
 */
export function evalMainTrunkSurface( y, theta, outPos = new THREE.Vector3(), outNorm = new THREE.Vector3() ) {

	const epsT = 0.008;
	const epsY = 0.008;

	evalMainTrunkPoint( y, theta, outPos );
	evalMainTrunkPoint( y, theta + epsT, _tmpP1 );
	evalMainTrunkPoint( y + epsY, theta, _tmpP2 );

	_tmpT1.subVectors( _tmpP1, outPos );
	_tmpT2.subVectors( _tmpP2, outPos );

	// Cross(dP/dy, dP/dtheta) points outward when x = cos(t), z = sin(t)
	outNorm.crossVectors( _tmpT2, _tmpT1 ).normalize();

	return { position: outPos, normal: outNorm };

}

/**
 * Spine curve and radius of the sweeping mossy side limb emerging seamlessly
 * from inside the main trunk and extending across the lower-right foreground.
 */
export function evalBranchSpine( u ) {

	const cx = - 0.66 + 3.18 * u;
	const cy = - 0.62 + 0.30 * Math.sin( u * 2.25 + 0.12 ) + 0.16 * u;
	const cz = - 0.34 + 0.68 * Math.sin( u * 1.95 ) - 0.26 * u * u;
	// Flared collar at trunk union (u near 0) tapering organically along limb
	const collar = 0.14 * Math.exp( - u * u * 18.0 );
	const radius = 0.42 * ( 1 - 0.62 * u ) + collar + 0.025 * Math.sin( u * 11.0 );

	return { cx, cy, cz, radius };

}

function branchFrame( u, outCenter, outTangent, outRight, outUp ) {

	const eps = 0.005;
	const c0 = evalBranchSpine( u );
	const c1 = evalBranchSpine( Math.min( 1, u + eps ) );
	const cPrev = evalBranchSpine( Math.max( 0, u - eps ) );

	outCenter.set( c0.cx, c0.cy, c0.cz );
	outTangent.set( c1.cx - cPrev.cx, c1.cy - cPrev.cy, c1.cz - cPrev.cz ).normalize();

	// Stable Frenet-like up/right frame along the horizontal-ish limb
	outRight.set( 0, 1, 0 ).cross( outTangent ).normalize();
	outUp.crossVectors( outTangent, outRight ).normalize();

	return c0.radius;

}

const _bC = new THREE.Vector3();
const _bT = new THREE.Vector3();
const _bR = new THREE.Vector3();
const _bU = new THREE.Vector3();

/**
 * Exact 3D point on the mossy side branch surface for `u` in [0, 1] and `theta` in [0, 2π).
 */
export function evalBranchPoint( u, theta, out = new THREE.Vector3() ) {

	const baseR = branchFrame( u, _bC, _bT, _bR, _bU );
	const relief = 0.022 * Math.sin( theta * 7.0 + u * 9.0 ) + 0.011 * Math.cos( theta * 14.0 - u * 17.0 );
	const r = baseR + relief;

	const cosT = Math.cos( theta );
	const sinT = Math.sin( theta );

	return out.set(
		_bC.x + ( _bR.x * cosT + _bU.x * sinT ) * r,
		_bC.y + ( _bR.y * cosT + _bU.y * sinT ) * r,
		_bC.z + ( _bR.z * cosT + _bU.z * sinT ) * r
	);

}

/**
 * Exact 3D point and outward unit normal on the mossy side branch.
 */
export function evalBranchSurface( u, theta, outPos = new THREE.Vector3(), outNorm = new THREE.Vector3() ) {

	const epsU = 0.004;
	const epsT = 0.01;

	evalBranchPoint( u, theta, outPos );
	evalBranchPoint( Math.min( 1, u + epsU ), theta, _tmpP1 );
	evalBranchPoint( u, theta + epsT, _tmpP2 );

	_tmpT1.subVectors( _tmpP1, outPos );
	_tmpT2.subVectors( _tmpP2, outPos );

	outNorm.crossVectors( _tmpT2, _tmpT1 ).normalize();

	return { position: outPos, normal: outNorm };

}

/**
 * Organic pillowy moss cushion density in [0, 1] at any point on the bark.
 * Produces thick velvety moss domes separated by narrow damp bark fissures.
 */
export function evalMossCushionDensity( x, y, z, nx, ny, nz ) {

	// Multi-frequency trigonometric pillow field (fast & deterministic on CPU)
	const n1 = Math.sin( x * 3.1 + Math.cos( y * 2.4 + z * 1.9 ) ) * Math.cos( y * 2.8 - z * 2.3 );
	const n2 = Math.sin( x * 6.7 - y * 5.2 + z * 4.1 ) * Math.cos( y * 6.3 + x * 4.8 );
	const n3 = Math.sin( x * 13.5 + y * 11.2 - z * 9.8 );

	const pillow = 0.56 + 0.34 * n1 + 0.18 * n2 + 0.08 * n3;

	// Favor upward-facing ledges and the camera-facing damp sunlit trunk side
	const upBias = Math.max( 0, ny * 0.55 + 0.45 );
	const frontBias = Math.max( 0, nz * 0.5 + 0.58 );

	const raw = pillow * ( 0.68 + 0.32 * upBias ) * ( 0.6 + 0.4 * frontBias );
	return THREE.MathUtils.clamp( ( raw - 0.24 ) / 0.62, 0, 1 );

}

/**
 * Build high-resolution displaced BufferGeometry for the main trunk.
 */
function buildMainTrunkGeometry() {

	const radialSegs = 128;
	const heightSegs = 120;
	const yMin = - 2.6;
	const yMax = 2.8;

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	const pos = new THREE.Vector3();
	const norm = new THREE.Vector3();

	for ( let iy = 0; iy <= heightSegs; iy ++ ) {

		const v = iy / heightSegs;
		const y = yMin + ( yMax - yMin ) * v;

		for ( let ix = 0; ix <= radialSegs; ix ++ ) {

			const u = ix / radialSegs;
			const theta = u * Math.PI * 2;

			evalMainTrunkSurface( y, theta, pos, norm );
			positions.push( pos.x, pos.y, pos.z );
			normals.push( norm.x, norm.y, norm.z );
			uvs.push( u, v );

		}

	}

	const stride = radialSegs + 1;

	for ( let iy = 0; iy < heightSegs; iy ++ ) {

		for ( let ix = 0; ix < radialSegs; ix ++ ) {

			const a = iy * stride + ix;
			const b = a + 1;
			const c = a + stride;
			const d = c + 1;
			indices.push( a, c, b, b, c, d );

		}

	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geom.setIndex( indices );
	return geom;

}

/**
 * Build high-resolution displaced BufferGeometry for the sweeping mossy side limb.
 */
function buildBranchGeometry() {

	const lengthSegs = 64;
	const radialSegs = 48;

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	const pos = new THREE.Vector3();
	const norm = new THREE.Vector3();

	for ( let iu = 0; iu <= lengthSegs; iu ++ ) {

		const u = iu / lengthSegs;

		for ( let it = 0; it <= radialSegs; it ++ ) {

			const v = it / radialSegs;
			const theta = v * Math.PI * 2;

			evalBranchSurface( u, theta, pos, norm );
			positions.push( pos.x, pos.y, pos.z );
			normals.push( norm.x, norm.y, norm.z );
			uvs.push( u, v );

		}

	}

	const stride = radialSegs + 1;

	for ( let iu = 0; iu < lengthSegs; iu ++ ) {

		for ( let it = 0; it < radialSegs; it ++ ) {

			const a = iu * stride + it;
			const b = a + 1;
			const c = a + stride;
			const d = c + 1;
			indices.push( a, b, c, b, d, c );

		}

	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geom.setIndex( indices );
	return geom;

}

/**
 * Analytic capsule descriptors matching the trunk & branch for GPU obstacle collision.
 */
export function getTrunkCollisionCapsules() {

	return {
		trunkA: new THREE.Vector3( - 0.48, - 2.2, - 0.35 ),
		trunkB: new THREE.Vector3( - 0.68, 2.5, - 0.38 ),
		trunkRadius: 0.96,
		branchA: new THREE.Vector3( - 0.1, - 0.58, 0.14 ),
		branchB: new THREE.Vector3( 2.35, - 0.25, - 0.22 ),
		branchRadius: 0.30
	};

}

/**
 * Build the tactile TSL bark material, hero trunk & branch meshes, and
 * soft out-of-focus woodland background silhouettes.
 */
export function createMossyTree( { scene, quality, sceneLights, environment, envIntensity, collider } ) {

	const group = new THREE.Group();
	scene.add( group );

	// ---------------------------------------------------- TSL Bark Material
	const barkMaterial = new THREE.MeshStandardNodeMaterial( { metalness: 0.0 } );

	const p = positionWorld;
	// Stretched crisp vertical bark striations for authentic macro wood texture
	const grainCoord = vec3( p.x.mul( 10.5 ), p.y.mul( 2.6 ), p.z.mul( 10.5 ) );
	const macroBark = mx_fractal_noise_float( grainCoord, 4, 2.3, 0.58 ).toVar();
	const microBark = mx_fractal_noise_float( vec3( p.x.mul( 32.0 ), p.y.mul( 11.0 ), p.z.mul( 32.0 ) ), 3, 2.2, 0.55 ).toVar();
	const mossPatch = mx_fractal_noise_float( p.mul( 2.1 ).add( vec3( 2.1, - 0.7, 1.4 ) ), 3, 2.0, 0.5 ).toVar();

	// Crisp procedural bump normal perturbation so macro bark grooves catch raking sunlight
	const eps = float( 0.009 );
	const h0 = mx_noise_float( grainCoord );
	const hx = mx_noise_float( grainCoord.add( vec3( eps.mul( 10.5 ), 0, 0 ) ) );
	const hy = mx_noise_float( grainCoord.add( vec3( 0, eps.mul( 2.6 ), 0 ) ) );
	const hz = mx_noise_float( grainCoord.add( vec3( 0, 0, eps.mul( 10.5 ) ) ) );
	const bumpGrad = vec3( hx.sub( h0 ), hy.sub( h0 ).mul( 0.35 ), hz.sub( h0 ) ).mul( 0.85 );
	const perturbedWorldNormal = normalize( normalWorldGeometry.sub( bumpGrad ) ).toVar();

	barkMaterial.normalNode = perturbedWorldNormal.transformDirection( cameraViewMatrix );

	// Subtle moisture glint near active cursor without washing out dark crevices
	const distToCursor = positionWorld.sub( collider.uniforms.position ).length();
	const cursorGlow = smoothstep( collider.uniforms.radius.mul( 1.35 ), float( 0.08 ), distToCursor )
		.mul( collider.uniforms.active );

	barkMaterial.colorNode = Fn( () => {

		const crevice = smoothstep( - 0.38, 0.42, macroBark );
		const darkBark = vec3( 0.018, 0.013, 0.009 );
		const ridgeBark = vec3( 0.095, 0.068, 0.044 );
		const lichen = vec3( 0.13, 0.155, 0.11 );

		const wood = mix( darkBark, ridgeBark, crevice ).mul( microBark.mul( 0.32 ).add( 0.88 ) );
		const lichenMask = smoothstep( 0.42, 0.72, macroBark.add( microBark.mul( 0.35 ) ) ).mul( 0.30 );
		const withLichen = mix( wood, lichen, lichenMask );

		// Deep velvety forest-green moss bed undercoat where moss cushions grow
		const upFront = saturate( normalWorldGeometry.y.mul( 0.45 ).add( normalWorldGeometry.z.mul( 0.4 ) ).add( 0.42 ) );
		const mossBaseMask = smoothstep( - 0.18, 0.32, mossPatch ).mul( upFront );
		const mossUndercoat = mix( vec3( 0.014, 0.042, 0.011 ), vec3( 0.042, 0.115, 0.022 ), cursorGlow.mul( 0.65 ) );

		return vec4( mix( withLichen, mossUndercoat, mossBaseMask.mul( 0.88 ) ), 1 );

	} )();

	barkMaterial.roughnessNode = mix( float( 0.94 ), float( 0.66 ), smoothstep( - 0.2, 0.5, mossPatch ) )
		.sub( cursorGlow.mul( 0.1 ) )
		.add( microBark.mul( 0.12 ) )
		.clamp( 0.42, 0.97 );

	barkMaterial.emissiveNode = vec3( 0.04, 0.11, 0.02 ).mul( pow( cursorGlow, 2.4 ) ).mul( 0.22 );
	barkMaterial.lightsNode = lights( sceneLights );
	barkMaterial.envMap = environment;
	barkMaterial.envMapIntensity = envIntensity;

	// -------------------------------------------------- Hero Trunk & Branch
	const trunkGeom = buildMainTrunkGeometry();
	const trunkMesh = new THREE.Mesh( trunkGeom, barkMaterial );
	trunkMesh.castShadow = quality.shadows;
	trunkMesh.receiveShadow = quality.shadows;
	group.add( trunkMesh );

	const branchGeom = buildBranchGeometry();
	const branchMesh = new THREE.Mesh( branchGeom, barkMaterial );
	branchMesh.castShadow = quality.shadows;
	branchMesh.receiveShadow = quality.shadows;
	group.add( branchMesh );

	// ------------------------------------ Out-of-Focus Woodland Background
	// Soft blurred distant trees & sunlit forest canopy wall so the macro DoF
	// resolves into dreamy circular woodland bokeh rather than a flat void.
	const bgGroup = new THREE.Group();
	scene.add( bgGroup );

	const backdropMat = new THREE.MeshBasicNodeMaterial( { depthWrite: true } );
	backdropMat.colorNode = Fn( () => {

		const wp = positionWorld;
		const canopy = mx_fractal_noise_float( vec3( wp.x.mul( 0.38 ), wp.y.mul( 0.36 ), float( 1.7 ) ), 3, 2.1, 0.52 );
		const sunBreak = smoothstep( 0.22, 0.68, canopy );
		const heightGrad = smoothstep( - 4.2, 4.0, wp.y );

		const deepForest = vec3( 0.006, 0.015, 0.009 );
		const midCanopy = vec3( 0.022, 0.052, 0.022 );
		const goldenBreak = vec3( 0.22, 0.26, 0.09 );

		const base = mix( deepForest, midCanopy, heightGrad );
		// Warm dappled sun bokeh pools in the upper-right forest clearing
		const clearing = smoothstep( - 1.2, 4.5, wp.x.add( wp.y.mul( 0.65 ) ) );
		const color = mix( base, goldenBreak, sunBreak.mul( clearing ).mul( 0.62 ) );

		// Sparkling out-of-focus sunlit canopy leaf gaps (melt into circular macro bokeh)
		const gapNoise = mx_noise_float( vec3( wp.x.mul( 1.55 ), wp.y.mul( 1.55 ), float( 4.3 ) ) );
		const bokehDot = smoothstep( 0.60, 0.82, gapNoise ).mul( clearing ).mul( heightGrad );

		return vec4( color.add( vec3( 0.72, 0.68, 0.32 ).mul( bokehDot ).mul( 0.95 ) ), 1 );

	} )();

	const backdrop = new THREE.Mesh( new THREE.PlaneGeometry( 28, 18 ), backdropMat );
	backdrop.position.set( 0, 0.5, - 9.5 );
	bgGroup.add( backdrop );

	// Distant blurred woodland tree silhouettes
	const silhouetteSpecs = [
		{ x: - 3.6, z: - 4.4, rTop: 0.42, rBot: 0.60, tilt: 0.05, tone: [ 0.010, 0.022, 0.012 ] },
		{ x: 2.55, z: - 4.8, rTop: 0.36, rBot: 0.52, tilt: - 0.04, tone: [ 0.012, 0.026, 0.014 ] },
		{ x: 4.3, z: - 6.6, rTop: 0.55, rBot: 0.76, tilt: 0.03, tone: [ 0.009, 0.020, 0.011 ] },
		{ x: - 1.9, z: - 6.8, rTop: 0.48, rBot: 0.68, tilt: - 0.06, tone: [ 0.008, 0.018, 0.010 ] },
		{ x: 0.75, z: - 7.5, rTop: 0.38, rBot: 0.54, tilt: 0.02, tone: [ 0.014, 0.028, 0.015 ] }
	];

	const bgDisposables = [ backdrop.geometry, backdropMat ];

	for ( const s of silhouetteSpecs ) {

		const g = new THREE.CylinderGeometry( s.rTop, s.rBot, 14, 14, 1 );
		const m = new THREE.MeshBasicNodeMaterial();
		const rim = pow( saturate( dot( normalWorldGeometry, vec3( 0.65, 0.55, 0.52 ) ) ), 2.2 );
		m.colorNode = vec4(
			vec3( s.tone[ 0 ], s.tone[ 1 ], s.tone[ 2 ] ).add( vec3( 0.12, 0.16, 0.07 ).mul( rim ) ),
			1
		);
		const mesh = new THREE.Mesh( g, m );
		mesh.position.set( s.x, 0, s.z );
		mesh.rotation.z = s.tilt;
		bgGroup.add( mesh );
		bgDisposables.push( g, m );

	}

	// Deterministic random surface sampler used for placing game buds or extras
	function sampleMossyBarkPoint( rand, outPos = new THREE.Vector3(), outNorm = new THREE.Vector3() ) {

		for ( let attempt = 0; attempt < 32; attempt ++ ) {

			if ( rand() < 0.72 ) {

				const y = - 1.25 + rand() * 2.55;
				const theta = ( 0.15 + rand() * 0.70 ) * Math.PI; // camera-facing front hemisphere
				evalMainTrunkSurface( y, theta, outPos, outNorm );

			} else {

				const u = 0.08 + rand() * 0.84;
				const theta = ( 0.25 + rand() * 1.05 ) * Math.PI; // upper/front face of limb
				evalBranchSurface( u, theta, outPos, outNorm );

			}

			const density = evalMossCushionDensity( outPos.x, outPos.y, outPos.z, outNorm.x, outNorm.y, outNorm.z );
			if ( density > 0.35 ) return { position: outPos, normal: outNorm, density };

		}

		return { position: outPos, normal: outNorm, density: 0.5 };

	}

	function dispose() {

		if ( group.parent ) group.parent.remove( group );
		if ( bgGroup.parent ) bgGroup.parent.remove( bgGroup );
		trunkGeom.dispose();
		branchGeom.dispose();
		barkMaterial.dispose();
		for ( const d of bgDisposables ) d.dispose();

	}

	return {
		group,
		trunkMesh,
		branchMesh,
		surfaceMeshes: [ trunkMesh, branchMesh ],
		capsules: getTrunkCollisionCapsules(),
		sampleMossyBarkPoint,
		dispose
	};

}
