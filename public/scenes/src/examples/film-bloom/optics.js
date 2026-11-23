import {
	Fn, float, vec2, vec3, vec4, sin, cos, exp, max, min, abs, floor, fract,
	dot, length, smoothstep, saturate, mix, sqrt, mx_noise_float
} from 'three/tsl';

// Physically grounded optical shaders for Film Bloom:
//   1. Exact 9-band CIE 1931 D65 -> linear sRGB two-beam Airy thin-film interference
//   2. Procedural labyrinthine Micro-Veined (Turing / capillary buckling) relief
//   3. Procedural dual-scale microscopic Fracture Lines (cleavage plates & craze lines)

const TWO_PI = Math.PI * 2;
const PI = Math.PI;

// Pre-normalized CIE 1931 D65 -> linear sRGB quadrature weights across 9 visible bands (nm)
const SPECTRAL_BANDS = [
	{ wl: 420.0, w: [ 0.0296, - 0.0239, 0.1738 ] },
	{ wl: 450.0, w: [ 0.0570, - 0.0640, 0.6382 ] },
	{ wl: 480.0, w: [ - 0.0959, 0.0649, 0.2828 ] },
	{ wl: 510.0, w: [ - 0.2437, 0.2845, 0.0201 ] },
	{ wl: 540.0, w: [ - 0.1658, 0.4471, - 0.0480 ] },
	{ wl: 570.0, w: [ 0.2906, 0.2870, - 0.0429 ] },
	{ wl: 600.0, w: [ 0.6398, 0.0434, - 0.0190 ] },
	{ wl: 630.0, w: [ 0.4207, - 0.0344, - 0.0043 ] },
	{ wl: 665.0, w: [ 0.0677, - 0.0045, - 0.0008 ] }
];

/**
 * Evaluate physically accurate thin-film reflected spectral color (linear sRGB)
 * for an Optical Path Difference `opdNm = 2 * n_film * thicknessNm * cos(theta_t)`.
 *
 * Includes the pi half-wave phase flip at the air (1.0) -> oil (~1.46) top interface
 * (with zero phase flip at oil 1.46 -> water 1.333), plus finite-bandwidth partial
 * coherence attenuation so thick films naturally desaturate into smoky bronze/mauve.
 */
export const evalThinFilmSpectrumTSL = /*@__PURE__*/ Fn( ( [ opdNm ] ) => {

	// Finite-bandwidth partial coherence envelope: rich saturated 1st-3rd orders,
	// softly mellowing into warm muted bronze-mauve at very thick films (> 1500 nm)
	const cohArg = opdNm.mul( 0.00038 );
	const coherence = exp( cohArg.mul( cohArg ).negate() ).toVar();

	let acc = vec3( 0.0, 0.0, 0.0 );

	for ( let i = 0; i < SPECTRAL_BANDS.length; i ++ ) {

		const b = SPECTRAL_BANDS[ i ];
		// Phase = 2*pi*OPD / lambda + pi (destructive at OPD=0 -> deep obsidian-bronze)
		const phase = opdNm.mul( TWO_PI / b.wl ).add( PI );
		const c = cos( phase );
		// Deep two-beam interference visibility (higher contrast dark valleys -> jewel-like hues)
		const rawRefl = saturate( float( 0.44 ).add( coherence.mul( 0.56 ).mul( c ) ) );
		// Gentle Airy contrast shaping deepens purples, sapphires, teals & bronzes without neon clipping
		const refl = rawRefl.mul( rawRefl ).mul( 0.65 ).add( rawRefl.mul( 0.35 ) );
		acc = acc.add( vec3( b.w[ 0 ], b.w[ 1 ], b.w[ 2 ] ).mul( refl ) );

	}

	return max( acc, vec3( 0.0 ) );

} );

/**
 * Snell's law cosine inside thin film of refractive index `nFilm` from air (n=1.0),
 * given cos(theta_i) = max(0, dot(N, V)).
 */
export const evalFilmCosThetaTSL = /*@__PURE__*/ Fn( ( [ cosThetaI, nFilm ] ) => {

	const sin2I = max( float( 0.0 ), float( 1.0 ).sub( cosThetaI.mul( cosThetaI ) ) );
	const sin2T = sin2I.div( nFilm.mul( nFilm ) );
	return sqrt( max( float( 0.05 ), float( 1.0 ).sub( sin2T ) ) );

} );

/**
 * Schlick Fresnel reflectance for air -> thin film (F0 ~ 0.035 for oil n=1.46).
 */
export const evalFresnelTSL = /*@__PURE__*/ Fn( ( [ cosTheta, f0 ] ) => {

	const om = saturate( float( 1.0 ).sub( cosTheta ) );
	const om2 = om.mul( om );
	return f0.add( float( 1.0 ).sub( f0 ).mul( om2.mul( om2 ).mul( om ) ) );

} );

/**
 * Scalar helper for labyrinthine Turing / micro-veined capillary buckling relief.
 * Domain-warped oscillating ridge bands produce intricate interlocking organic channels
 * matching the velvet-textured surface seen in macro thin-film photographs.
 */
const evalLabyrinthScalar = /*@__PURE__*/ Fn( ( [ q ] ) => {

	// Curl-like 2-axis organic domain warp so stripes meander into interlocking worms & loops
	const w1 = mx_noise_float( vec3( q.x.mul( 0.36 ), q.y.mul( 0.36 ), float( 1.7 ) ) );
	const w2 = mx_noise_float( vec3( q.x.mul( 0.36 ).add( 13.4 ), q.y.mul( 0.36 ).sub( 7.9 ), float( 4.3 ) ) );
	const warped = q.add( vec2( w1, w2 ).mul( 1.85 ) );

	// Secondary finer warp breaks straight lines into authentic organic labyrinth veins
	const f1 = mx_noise_float( vec3( warped.x.mul( 0.82 ), warped.y.mul( 0.82 ), float( 9.1 ) ) );
	const f2 = mx_noise_float( vec3( warped.x.mul( 0.82 ).sub( 6.2 ), warped.y.mul( 0.82 ).add( 11.8 ), float( 14.5 ) ) );
	const band = sin( f1.mul( 7.6 ).add( f2.mul( 4.2 ) ) );

	// Crisp flat-topped embossed micro-veins separated by narrow etched channels
	return smoothstep( float( - 0.42 ), float( 0.42 ), band );

} );

/**
 * Evaluates procedural Micro-Veined labyrinthine relief + analytical tangent slopes.
 * Input `p` is local lake XZ coordinate (world units).
 * Returns vec4( height [0..1], dH/dx, dH/dz, channelMask [0..1] ).
 */
export const evalMicroVeinedReliefTSL = /*@__PURE__*/ Fn( ( [ p ] ) => {

	// Fine organic labyrinthine scale matching macro thin-film surface micro-buckling
	const scale = float( 29.0 );
	const q = p.mul( scale ).toVar();
	const eps = float( 0.12 );

	const h0 = evalLabyrinthScalar( q ).toVar();
	const hx = evalLabyrinthScalar( q.add( vec2( eps, 0.0 ) ) );
	const hz = evalLabyrinthScalar( q.add( vec2( 0.0, eps ) ) );

	const gx = hx.sub( h0 ).div( eps );
	const gz = hz.sub( h0 ).div( eps );

	// Crisp etched micro-channel crevices where dark espresso shadow pools
	const channel = float( 1.0 ).sub( smoothstep( float( 0.12 ), float( 0.52 ), h0 ) );

	return vec4( h0, gx, gz, channel );

} );

// Fast deterministic 2D -> 2D hash in [0, 1] for organic Voronoi cleavage sites
const hash22 = /*@__PURE__*/ Fn( ( [ p ] ) => {

	const q = vec2(
		dot( p, vec2( 127.1, 311.7 ) ),
		dot( p, vec2( 269.5, 183.3 ) )
	);
	return fract( sin( q ).mul( 43758.5453123 ) );

} );

/**
 * Unrolled 3x3 Voronoi cellular distance returning:
 *   x = edgeDist (F2 - F1, crisp 0 right along crystalline fracture boundaries)
 *   y = cellHash (stable per-facet ID in [0, 1] for discrete thin-film thickness steps)
 *   z = cellDirX (unit-ish offset toward cell center for subtle per-plate facet tilt)
 *   w = cellDirZ
 */
const evalVoronoiFractureLayer = /*@__PURE__*/ Fn( ( [ q ] ) => {

	const cell = floor( q ).toVar();
	const f = fract( q ).toVar();

	const d1 = float( 8.0 ).toVar();
	const d2 = float( 8.0 ).toVar();
	const bestHash = float( 0.0 ).toVar();
	const bestVec = vec2( 0.0, 0.0 ).toVar();

	// Unrolled 3x3 neighborhood (zero dynamic loop overhead across WebGPU & WebGL2)
	const offsets = [
		[ - 1, - 1 ], [ 0, - 1 ], [ 1, - 1 ],
		[ - 1, 0 ], [ 0, 0 ], [ 1, 0 ],
		[ - 1, 1 ], [ 0, 1 ], [ 1, 1 ]
	];

	for ( let k = 0; k < 9; k ++ ) {

		const off = vec2( offsets[ k ][ 0 ], offsets[ k ][ 1 ] );
		const siteId = cell.add( off );
		const rnd = hash22( siteId );
		// Jittered site within [0.12 .. 0.88] for natural irregular crystalline mineral plates
		const pt = off.add( rnd.mul( 0.76 ).add( 0.12 ) );
		const diff = pt.sub( f );
		const dist = length( diff );

		// Track closest (d1) and second-closest (d2) for exact border distance
		const isCloser = dist.lessThan( d1 );
		const isSecond = dist.lessThan( d2 );

		d2.assign( isCloser.select( d1, isSecond.select( dist, d2 ) ) );
		d1.assign( isCloser.select( dist, d1 ) );
		bestHash.assign( isCloser.select( rnd.x, bestHash ) );
		bestVec.assign( isCloser.select( diff, bestVec ) );

	}

	const edgeDist = d2.sub( d1 );
	return vec4( edgeDist, bestHash, bestVec.x, bestVec.y );

} );

/**
 * Procedural dual-scale microscopic thin-film Fracture Lines & cleavage facets.
 * Input `p` is local lake XZ coordinate (world units).
 * Returns vec4(
 *   x: discrete facet thickness step [-1..1],
 *   y: luminous hairline fracture seam mask [0..1],
 *   z: facet normal tilt X,
 *   w: facet normal tilt Z
 * )
 */
export const evalFractureNetworkTSL = /*@__PURE__*/ Fn( ( [ p ] ) => {

	// Organic jagged stress warp so microscopic fractures branch naturally like stressed glass / mineral film
	const warpX = mx_noise_float( vec3( p.x.mul( 3.2 ), p.y.mul( 3.2 ), float( 3.1 ) ) );
	const warpZ = mx_noise_float( vec3( p.x.mul( 3.2 ).add( 9.7 ), p.y.mul( 3.2 ).sub( 4.2 ), float( 7.4 ) ) );
	const jitterX = mx_noise_float( vec3( p.x.mul( 14.5 ), p.y.mul( 14.5 ), float( 12.2 ) ) );
	const jitterZ = mx_noise_float( vec3( p.x.mul( 14.5 ).sub( 5.4 ), p.y.mul( 14.5 ).add( 8.1 ), float( 19.6 ) ) );
	const stressed = p.add( vec2( warpX, warpZ ).mul( 0.085 ) ).add( vec2( jitterX, jitterZ ).mul( 0.014 ) ).toVar();

	// Primary fine crystalline cleavage plates + hairline spiderweb micro-crazing
	const v1 = evalVoronoiFractureLayer( stressed.mul( 7.6 ) );
	const v2 = evalVoronoiFractureLayer( stressed.add( vec2( warpZ, warpX.negate() ).mul( 0.035 ) ).mul( 22.5 ) );

	// Razor-fine microscopic fracture seams (hairline dark/glinting fissures, never thick white walls)
	const primaryLine = float( 1.0 ).sub( smoothstep( float( 0.004 ), float( 0.032 ), v1.x ) );
	const fineLine = float( 1.0 ).sub( smoothstep( float( 0.003 ), float( 0.028 ), v2.x ) ).mul( 0.52 );
	const crackMask = saturate( primaryLine.add( fineLine ) );

	// Per-facet discrete nanometer thickness step & delicate planar facet tilt
	const stepVal = v1.y.sub( 0.5 ).mul( 1.35 ).add( v2.y.sub( 0.5 ).mul( 0.42 ) );
	const tiltX = v1.z.mul( 0.24 ).add( v2.z.mul( 0.12 ) ).add( primaryLine.mul( v1.z ).mul( 0.65 ) );
	const tiltZ = v1.w.mul( 0.24 ).add( v2.w.mul( 0.12 ) ).add( primaryLine.mul( v1.w ).mul( 0.65 ) );

	return vec4( stepVal, crackMask, tiltX, tiltZ );

} );
