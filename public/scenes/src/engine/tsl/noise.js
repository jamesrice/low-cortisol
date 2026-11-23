import { Fn, vec3, vec4, floor, fract, dot, sin, cross, normalize } from 'three/tsl';

// Analytic 3D noise gradients, divergence-free bitangent curl noise,
// quaternion TSL math, and deterministic CPU PRNG utilities.

/**
 * Fast 3D lattice hash returning a pseudo-random vec3 in [-1, 1].
 */
export const hash33 = /*@__PURE__*/ Fn( ( [ p ] ) => {

	const q = vec3(
		dot( p, vec3( 127.1, 311.7, 74.7 ) ),
		dot( p, vec3( 269.5, 183.3, 246.1 ) ),
		dot( p, vec3( 113.5, 271.9, 124.6 ) )
	);

	return fract( sin( q ).mul( 43758.5453123 ) ).mul( 2 ).sub( 1 );

} );

/**
 * Analytic gradient of 3D quintic-interpolated gradient noise.
 * Evaluates the exact spatial gradient in a single pass without finite differences.
 */
export const noiseGradient = /*@__PURE__*/ Fn( ( [ x ] ) => {

	const i = floor( x ).toVar();
	const f = fract( x ).toVar();

	const u = f.mul( f ).mul( f ).mul( f.mul( f.mul( 6 ).sub( 15 ) ).add( 10 ) ).toVar();
	const du = f.mul( f ).mul( 30 ).mul( f.mul( f.sub( 2 ) ).add( 1 ) ).toVar();

	const ga = hash33( i ).toVar();
	const gb = hash33( i.add( vec3( 1, 0, 0 ) ) ).toVar();
	const gc = hash33( i.add( vec3( 0, 1, 0 ) ) ).toVar();
	const gd = hash33( i.add( vec3( 1, 1, 0 ) ) ).toVar();
	const ge = hash33( i.add( vec3( 0, 0, 1 ) ) ).toVar();
	const gf = hash33( i.add( vec3( 1, 0, 1 ) ) ).toVar();
	const gg = hash33( i.add( vec3( 0, 1, 1 ) ) ).toVar();
	const gh = hash33( i.add( vec3( 1, 1, 1 ) ) ).toVar();

	const va = dot( ga, f ).toVar();
	const vb = dot( gb, f.sub( vec3( 1, 0, 0 ) ) ).toVar();
	const vc = dot( gc, f.sub( vec3( 0, 1, 0 ) ) ).toVar();
	const vd = dot( gd, f.sub( vec3( 1, 1, 0 ) ) ).toVar();
	const ve = dot( ge, f.sub( vec3( 0, 0, 1 ) ) ).toVar();
	const vf = dot( gf, f.sub( vec3( 1, 0, 1 ) ) ).toVar();
	const vg = dot( gg, f.sub( vec3( 0, 1, 1 ) ) ).toVar();
	const vh = dot( gh, f.sub( vec3( 1, 1, 1 ) ) ).toVar();

	const k1 = vb.sub( va ).toVar();
	const k2 = vc.sub( va ).toVar();
	const k3 = ve.sub( va ).toVar();
	const k4 = va.sub( vb ).sub( vc ).add( vd ).toVar();
	const k5 = va.sub( vc ).sub( ve ).add( vg ).toVar();
	const k6 = va.sub( vb ).sub( ve ).add( vf ).toVar();
	const k7 = va.negate().add( vb ).add( vc ).sub( vd ).add( ve ).sub( vf ).sub( vg ).add( vh ).toVar();

	const interpolated = ga
		.add( gb.sub( ga ).mul( u.x ) )
		.add( gc.sub( ga ).mul( u.y ) )
		.add( ge.sub( ga ).mul( u.z ) )
		.add( ga.sub( gb ).sub( gc ).add( gd ).mul( u.x.mul( u.y ) ) )
		.add( ga.sub( gc ).sub( ge ).add( gg ).mul( u.y.mul( u.z ) ) )
		.add( ga.sub( gb ).sub( ge ).add( gf ).mul( u.z.mul( u.x ) ) )
		.add( ga.negate().add( gb ).add( gc ).sub( gd ).add( ge ).sub( gf ).sub( gg ).add( gh ).mul( u.x.mul( u.y ).mul( u.z ) ) );

	const slope = vec3(
		k1.add( u.y.mul( k4 ) ).add( u.z.mul( k6 ) ).add( u.y.mul( u.z ).mul( k7 ) ),
		k2.add( u.z.mul( k5 ) ).add( u.x.mul( k4 ) ).add( u.z.mul( u.x ).mul( k7 ) ),
		k3.add( u.x.mul( k6 ) ).add( u.y.mul( k5 ) ).add( u.x.mul( u.y ).mul( k7 ) )
	);

	return interpolated.add( du.mul( slope ) );

} );

/**
 * Divergence-free 3D bitangent curl noise: cross(grad(a), grad(b)).
 * Ideal for swirling wind, dust, spores, and fluid advection without clumping.
 */
export const curlNoise = /*@__PURE__*/ Fn( ( [ p ] ) => {

	const a = noiseGradient( p );
	const b = noiseGradient( p.add( vec3( 31.416, - 47.853, 12.679 ) ) );

	return cross( a, b );

} );

/**
 * Rotate a 3D vector v by a unit quaternion q (x, y, z, w).
 */
export const quatRotate = ( v, q ) => {

	const t = cross( q.xyz, v ).mul( 2 );
	return v.add( t.mul( q.w ) ).add( cross( q.xyz, t ) );

};

/**
 * Integrate unit quaternion q by angular velocity w over timestep dt.
 */
export const quatIntegrate = ( q, w, dt ) => {

	const hw = w.mul( dt.mul( 0.5 ) );
	const dq = vec4( hw.mul( q.w ).add( cross( hw, q.xyz ) ), dot( hw, q.xyz ).negate() );
	return normalize( q.add( dq ) );

};

/**
 * Deterministic Mulberry32 PRNG for reproducible GPU buffer seeding.
 */
export function mulberry32( seed ) {

	let a = seed >>> 0;

	return () => {

		a |= 0;
		a = a + 0x6D2B79F5 | 0;
		let t = Math.imul( a ^ a >>> 15, 1 | a );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

/**
 * Generate a uniformly distributed random unit quaternion into `out` at offset `o`.
 */
export function writeRandomQuaternion( rand, out, o ) {

	const u1 = rand();
	const u2 = rand() * Math.PI * 2;
	const u3 = rand() * Math.PI * 2;
	const a = Math.sqrt( 1 - u1 );
	const b = Math.sqrt( u1 );

	out[ o ] = a * Math.sin( u2 );
	out[ o + 1 ] = a * Math.cos( u2 );
	out[ o + 2 ] = b * Math.sin( u3 );
	out[ o + 3 ] = b * Math.cos( u3 );

}
