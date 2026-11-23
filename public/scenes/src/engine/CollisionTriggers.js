import * as THREE from 'three/webgpu';

// CPU-side swept-segment collision and trigger system.
// Mirrors the exact continuous collision math used on the GPU so interactive
// collision games can score pickups, activate switches, damage obstacles, or
// emit impulse events in lockstep with GPU particles and soft bodies.

const _sweep = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _normal = new THREE.Vector3();

/**
 * Evaluate exact distance between point `point` and swept segment `[prev -> curr]`.
 * Writes closest segment point into `outClosest` and unit normal into `outNormal`.
 */
export function sweptPointDistance( point, prev, curr, outClosest = _closest, outNormal = _normal ) {

	_sweep.subVectors( curr, prev );
	const lenSq = _sweep.lengthSq();
	let t = 0;

	if ( lenSq > 1e-10 ) {

		_rel.subVectors( point, prev );
		t = THREE.MathUtils.clamp( _rel.dot( _sweep ) / lenSq, 0, 1 );

	}

	outClosest.copy( prev ).addScaledVector( _sweep, t );
	outNormal.subVectors( point, outClosest );
	const dist = outNormal.length();

	if ( dist > 1e-6 ) {

		outNormal.divideScalar( dist );

	} else {

		outNormal.set( 0, 1, 0 );

	}

	return { dist, t, closest: outClosest, normal: outNormal };

}

/**
 * Create a lightweight game-layer trigger & collision manager.
 */
export function createCollisionTriggers() {

	const triggers = new Map();
	let nextId = 1;

	/**
	 * Register a spherical trigger/target volume.
	 *
	 * @param {object} spec
	 * @param {THREE.Vector3} spec.position World position (can be mutated each frame)
	 * @param {number} [spec.radius=0.25] Trigger radius
	 * @param {number} [spec.cooldown=0] Minimum seconds between repeated impact triggers
	 * @param {any} [spec.userData] Arbitrary game state
	 * @param {function} [spec.onEnter] Called when a collider enters: (event) => void
	 * @param {function} [spec.onStay] Called each frame while overlapping: (event) => void
	 * @param {function} [spec.onExit] Called when a collider leaves: (event) => void
	 * @param {function} [spec.onImpact] Called on entry or fast swipe impact: (event) => void
	 */
	function addTrigger( spec ) {

		const id = spec.id ?? `trigger_${ nextId ++ }`;
		const entry = {
			id,
			position: spec.position instanceof THREE.Vector3 ? spec.position : new THREE.Vector3( ...( spec.position || [ 0, 0, 0 ] ) ),
			radius: spec.radius ?? 0.25,
			enabled: spec.enabled ?? true,
			cooldown: spec.cooldown ?? 0,
			lastImpactAt: - Infinity,
			overlapping: new Set(),
			userData: spec.userData ?? null,
			onEnter: spec.onEnter || null,
			onStay: spec.onStay || null,
			onExit: spec.onExit || null,
			onImpact: spec.onImpact || null
		};

		triggers.set( id, entry );
		return entry;

	}

	function removeTrigger( id ) {

		triggers.delete( id );

	}

	function clear() {

		triggers.clear();

	}

	/**
	 * Evaluate all active triggers against an iterable of dynamic colliders.
	 */
	function update( colliders, time ) {

		const list = Array.isArray( colliders ) ? colliders : colliders?.list || [];

		for ( const trigger of triggers.values() ) {

			if ( ! trigger.enabled ) continue;

			for ( const collider of list ) {

				if ( ! collider.active ) continue;

				const hit = sweptPointDistance( trigger.position, collider.previous, collider.position );
				const combinedRadius = trigger.radius + collider.effectiveRadius;
				const inside = hit.dist <= combinedRadius;
				const wasInside = trigger.overlapping.has( collider );

				if ( inside ) {

					const speed = collider.velocity.length();
					const penetration = combinedRadius - hit.dist;
					const event = {
						trigger,
						collider,
						time,
						distance: hit.dist,
						penetration,
						speed,
						normal: hit.normal.clone(),
						closest: hit.closest.clone()
					};

					if ( ! wasInside ) {

						trigger.overlapping.add( collider );
						if ( trigger.onEnter ) trigger.onEnter( event );

						if ( trigger.onImpact && ( time - trigger.lastImpactAt ) >= trigger.cooldown ) {

							trigger.lastImpactAt = time;
							trigger.onImpact( event );

						}

					} else {

						if ( trigger.onStay ) trigger.onStay( event );

					}

				} else if ( wasInside ) {

					trigger.overlapping.delete( collider );
					if ( trigger.onExit ) trigger.onExit( { trigger, collider, time } );

				}

			}

		}

	}

	return {
		triggers,
		addTrigger,
		removeTrigger,
		clear,
		update
	};

}
