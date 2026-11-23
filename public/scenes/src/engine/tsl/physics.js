import {
	If, float, vec3, mix, exp, max, min, dot, cross, normalize, length, abs, sin, pow, fract
} from 'three/tsl';
import { curlNoise, quatIntegrate } from './noise.js';

// Composable TSL GPU physics building blocks.
// Each helper operates directly on TSL node variables inside a compute Fn(),
// making it straightforward to assemble particle swarms, rigid bodies,
// soft foliage/moss beds, and game projectiles on top of shared collision math.

/**
 * Two-octave divergence-free ambient turbulence (wind / air flow).
 */
export function sampleCurlFlow( position, frequency, amplitude, offset, detailWeight = 0.42 ) {

	const fp = position.mul( frequency ).add( offset ).toVar();
	const flow = curlNoise( fp ).mul( amplitude ).toVar();
	flow.addAssign(
		curlNoise( fp.mul( 2.63 ).add( vec3( 13.1, 7.7, 3.3 ) ) ).mul( amplitude.mul( detailWeight ) )
	);

	return flow;

}

/**
 * Potential-flow dipole wake displaced by a moving sphere collider.
 * Air is pushed ahead of the collider, slips around its flanks, and closes behind.
 */
export function computeDipoleWake( rel, dist, radius, colliderVel, wakeStrength ) {

	const n = rel.div( dist );
	const rc = max( dist, radius.mul( 0.85 ) );
	const dipole = pow( radius.div( rc ), 3 ).mul( 0.5 );

	return n.mul( dot( colliderVel, n ).mul( 3 ) ).sub( colliderVel ).mul( dipole ).mul( wakeStrength );

}

/**
 * Tangential vortex swirl velocity around a collider axis.
 */
export function computeVortexSwirl( normal, dist, radius, swirlAxis, swirlStrength ) {

	const rn = dist.div( radius );
	const profile = min( rn, pow( max( rn, 1e-3 ), - 1.5 ) );

	return cross( swirlAxis, normal ).mul( swirlStrength ).mul( profile );

}

/**
 * Closest point on swept segment [prev -> curr] to point `p`.
 * Prevents fast pointer or projectile movement from tunneling through particles.
 */
export function closestPointOnSweep( p, prev, curr ) {

	const sweep = curr.sub( prev );
	const sweepLenSq = max( dot( sweep, sweep ), 1e-8 );
	const along = dot( p.sub( prev ), sweep ).div( sweepLenSq ).clamp( 0, 1 );

	return prev.add( sweep.mul( along ) );

}

/**
 * Swept-sphere continuous collision solver with soft elastic cushion,
 * asymmetric critical damping, optional organic wobble, and hard inner core clamp.
 *
 * Mutates `p` and `v` TSL variables in place and returns `{ impact, normal, closest, dist }`.
 */
export function applySweptSphereCollision( {
	p,
	v,
	prev,
	curr,
	colliderVel,
	radius,
	shellOffset = float( 0 ),
	bodyHalfSize = float( 0 ),
	stiffness,
	damping,
	coreFraction = float( 0.58 ),
	inertia = float( 1 ),
	wobbleAmount = float( 0 ),
	timeNode = float( 0 ),
	dt,
	enabled = null
} ) {

	const impact = float( 0 ).toVar();
	const closest = closestPointOnSweep( p, prev, curr ).toVar();

	const rel = p.sub( closest ).toVar();
	const dist = max( length( rel ), 1e-4 ).toVar();
	const normal = rel.div( dist ).toVar();

	const wobble = sin( normal.x.mul( 3.1 ).add( timeNode.mul( 1.3 ) ) )
		.mul( sin( normal.y.mul( 2.7 ).sub( timeNode.mul( 0.9 ) ) ) )
		.mul( sin( normal.z.mul( 3.7 ).add( timeNode.mul( 1.1 ) ) ) );

	const shell = radius.mul( float( 1 ).add( shellOffset ).add( wobble.mul( wobbleAmount ) ) ).add( bodyHalfSize );
	const penetration = shell.sub( dist );

	const cond = enabled ? penetration.greaterThan( 0 ).and( enabled ) : penetration.greaterThan( 0 );

	If( cond, () => {

		const approach = dot( v.sub( colliderVel ), normal ).toVar();

		// Elastic repulsion scaled by inverse sqrt(inertia) so heavy bodies resist more
		v.addAssign( normal.mul( penetration.mul( stiffness ).mul( dt ).div( inertia.sqrt() ) ) );

		// Asymmetric damping: cushions incoming hits without violently flinging bodies out
		const dampRate = approach.lessThan( 0 ).select( damping, damping.mul( 0.55 ) );
		v.subAssign( normal.mul( approach.mul( exp( dt.mul( dampRate ).negate() ).oneMinus() ) ) );

		impact.assign( max( approach.negate(), 0 ) );

		// Hard inner core projection so fast objects never reach the collider center
		const core = shell.mul( coreFraction );

		If( dist.lessThan( core ), () => {

			p.assign( closest.add( normal.mul( core ) ) );
			v.subAssign( normal.mul( min( dot( v.sub( colliderVel ), normal ), 0 ) ) );

		} );

	} );

	return { impact, normal, closest, dist };

}

/**
 * Exponential frame-rate-independent velocity drag toward a target flow velocity.
 */
export function applyFluidDrag( v, flow, dragRate, dt ) {

	v.assign( mix( v, flow, exp( dt.mul( dragRate ).negate() ).oneMinus() ) );

}

/**
 * Clamp linear velocity magnitude to `maxSpeed`.
 */
export function clampSpeed( v, maxSpeed ) {

	const speed = length( v );
	v.mulAssign( min( float( 1 ), maxSpeed.div( max( speed, 1e-4 ) ) ) );

}

/**
 * Analytic floor plane collision (y >= floorY + margin) with restitution and friction.
 */
export function collideFloorPlane( p, v, floorY, margin, restitution = 0.28, frictionRate = 3.0, dt ) {

	const minY = floorY.add( margin );

	If( p.y.lessThan( minY ), () => {

		const friction = exp( dt.mul( - frictionRate ) );
		p.y.assign( minY );
		v.y.assign( abs( v.y ).mul( restitution ) );
		v.x.assign( v.x.mul( friction ) );
		v.z.assign( v.z.mul( friction ) );

	} );

}

/**
 * Analytic back wall plane collision (z >= wallZ + margin).
 */
export function collideBackWall( p, v, wallZ, margin, restitution = 0.28 ) {

	const minZ = wallZ.add( margin );

	If( p.z.lessThan( minZ ), () => {

		p.z.assign( minZ );
		v.z.assign( abs( v.z ).mul( restitution ) );

	} );

}

/**
 * Analytic finite capsule / cylinder obstacle collision (great for tree trunks,
 * branches, pillars, and game obstacles). Pushes `p` outside the capsule radius
 * and reflects/dampens inward normal velocity.
 */
export function collideCapsule( p, v, segA, segB, radius, margin, restitution = 0.25, friction = 0.85 ) {

	const ab = segB.sub( segA );
	const abLenSq = max( dot( ab, ab ), 1e-6 );
	const t = dot( p.sub( segA ), ab ).div( abLenSq ).clamp( 0, 1 );
	const axisPt = segA.add( ab.mul( t ) );

	const delta = p.sub( axisPt ).toVar();
	const d = max( length( delta ), 1e-4 ).toVar();
	const minR = radius.add( margin );

	If( d.lessThan( minR ), () => {

		const n = delta.div( d );
		p.assign( axisPt.add( n.mul( minR ) ) );

		const vn = dot( v, n );
		If( vn.lessThan( 0 ), () => {

			const vt = v.sub( n.mul( vn ) );
			v.assign( vt.mul( friction ).sub( n.mul( vn.mul( restitution ) ) ) );

		} );

	} );

}

/**
 * Update angular velocity & quaternion for tumbling rigid bodies.
 */
export function integrateTumble( { w, q, v, impact, impactNormal, seed, inertia, dt, maxSpin = 22 } ) {

	const spinAxis = normalize(
		vec3( fract( seed.mul( 53.3 ) ), fract( seed.mul( 71.9 ) ), fract( seed.mul( 29.7 ) ) ).sub( 0.5 ).add( 1e-3 )
	);
	const tumble = mix( 0.35, 1.9, fract( seed.mul( 11.3 ) ) );
	const cruise = spinAxis.mul( tumble.mul( length( v ).mul( 0.85 ).add( 0.3 ) ).div( inertia.sqrt() ) );

	w.assign( mix( w, cruise, exp( dt.mul( - 1.4 ) ).oneMinus() ) );
	w.addAssign( cross( impactNormal, spinAxis ).mul( impact.mul( 3.2 ).div( inertia ) ) );
	w.mulAssign( min( float( 1 ), float( maxSpin ).div( max( length( w ), 1e-4 ) ) ) );

	return quatIntegrate( q, w, dt );

}

/**
 * Exponentially decaying impact / activation heat accumulator in [0, 1].
 */
export function decayHeat( heat, impact, decayRate, impactGain, dt ) {

	return max( heat.mul( exp( dt.mul( decayRate ).negate() ) ), min( impact.mul( impactGain ), 1 ) );

}
