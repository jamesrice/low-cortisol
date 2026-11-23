import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// Interactive kinematic colliders with sub-stepped spring-damper dynamics,
// swept-segment history (previous -> position), press-to-swell charge,
// idle autopilot, and pluggable pointer projection (plane, 3D mesh surface, or custom).

/**
 * Create a general-purpose kinematic collider driven by pointer input,
 * 3D surface raycasting, idle autopilot, or custom game logic.
 */
export function createCollider( {
	camera = null,
	element = null,
	mode = 'plane', // 'plane' | 'surface' | 'custom'
	planeNormal = new THREE.Vector3( 0, 0, 1 ),
	planeConstant = 0,
	surfaceMeshes = [],
	surfaceOffset = 0.08,
	radius = 1.0,
	stiffness = 52,
	damping = 0.6,
	maxSpeed = 24,
	depthSway = 0.0,
	idleAfter = 2.6,
	enableAutopilot = true,
	chargeScale = 1.55,
	chargeStiffness = 90,
	chargeDamping = 9,
	floorY = - Infinity,
	floorMarginRatio = 0.6,
	clampToBounds = true,
	wanderFn = null,
	initialPosition = new THREE.Vector3( 0, 0, 0 ),
	onPress = null
} = {} ) {

	const position = initialPosition.clone();
	const previous = position.clone();
	const velocity = new THREE.Vector3();
	const target = position.clone();
	const surfaceNormal = new THREE.Vector3( 0, 0, 1 );

	const pointerTarget = position.clone();
	const wanderTarget = position.clone();

	const pointer = {
		ndc: new THREE.Vector2(),
		lastMove: - Infinity,
		hasMoved: false,
		pressed: false,
		onSurface: false,
		speed: 0
	};

	const bounds = { halfWidth: 4, halfHeight: 2.5, centerY: 0 };

	let autopilot = enableAutopilot ? 1 : 0;
	let radiusScale = 1;
	let radiusVelocity = 0;
	let active = true;
	let placed = false;

	const raycaster = new THREE.Raycaster();
	const plane = new THREE.Plane( planeNormal.clone().normalize(), planeConstant );
	const hit = new THREE.Vector3();
	const tempNormal = new THREE.Vector3();
	const normalMatrix = new THREE.Matrix3();
	const meshes = Array.isArray( surfaceMeshes ) ? [ ...surfaceMeshes ] : [];

	// Reactive TSL uniform bundle so any GPU compute or material shader can read this collider
	const uniforms = {
		position: uniform( position.clone() ),
		previous: uniform( previous.clone() ),
		velocity: uniform( velocity.clone() ),
		normal: uniform( surfaceNormal.clone() ),
		radius: uniform( radius ),
		charge: uniform( 0 ),
		active: uniform( 1 )
	};

	const setPointer = ( clientX, clientY ) => {

		if ( ! element ) return;
		const rect = element.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return;

		pointer.ndc.set(
			( ( clientX - rect.left ) / rect.width ) * 2 - 1,
			- ( ( clientY - rect.top ) / rect.height ) * 2 + 1
		);
		pointer.lastMove = performance.now() / 1000;
		pointer.hasMoved = true;

	};

	let wheelActive = false;
	let wheelAnchorX = 0;
	let wheelAnchorY = 0;
	let wheelX = 0;
	let wheelY = 0;
	let lastWheelMs = - Infinity;
	let restingMouseX = NaN;
	let restingMouseY = NaN;
	let preTouchMouseX = NaN;
	let preTouchMouseY = NaN;

	// Optional external driver (e.g., Webcam Hand Tracking or Phase-2 Breath-Steer)
	const externalDriver = {
		active: false,
		ndcX: 0,
		ndcY: 0,
		radiusMul: 1.0,
		pressed: false,
		suppressMouseHover: false
	};

	const onPointerMove = ( event ) => {

		if ( event.pointerType === 'mouse' ) {

			if ( externalDriver.active && externalDriver.suppressMouseHover ) return;

			const now = performance.now();
			// Ignore macOS touchscreen's automatic cursor snap-back right after a finger-swipe ends
			if (
				( now - lastWheelMs ) < 350 &&
				Number.isFinite( preTouchMouseX ) &&
				Math.hypot( event.clientX - preTouchMouseX, event.clientY - preTouchMouseY ) < 28
			) {

				wheelActive = false;
				return;

			}

			if ( Number.isFinite( restingMouseX ) && Math.hypot( event.clientX - restingMouseX, event.clientY - restingMouseY ) > 12 ) {

				preTouchMouseX = restingMouseX;
				preTouchMouseY = restingMouseY;

			}

			restingMouseX = event.clientX;
			restingMouseY = event.clientY;
			wheelActive = false;

		}

		setPointer( event.clientX, event.clientY );

	};

	const onPointerDown = ( event ) => {

		wheelActive = false;
		setPointer( event.clientX, event.clientY );
		if ( event.pointerType === 'mouse' || event.pointerType === 'touch' || event.pointerType === 'pen' ) {

			pointer.pressed = true;
			if ( onPress && element && ( event.target === element || element.contains( event.target ) ) ) {

				onPress( pointer.ndc.x, pointer.ndc.y );

			}

		}

	};

	const onPointerUp = () => {

		pointer.pressed = false;

	};

	// macOS touchscreen Chrome converts single-finger drags into continuous pixel wheel events
	// anchored at the touch-start point (deltaX/Y are negative CSS pixels of finger movement).
	// Leaves iOS touch (no wheel events) and desktop mouse hover/click 100% unchanged.
	const onWheel = ( event ) => {

		if ( event.ctrlKey || event.deltaMode !== 0 ) return;
		if ( event.target !== element && ! element.contains( event.target ) ) return;
		if ( event.cancelable ) event.preventDefault();

		const rect = element.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) return;

		const now = performance.now();
		const isFreshGesture = ! wheelActive ||
			( now - lastWheelMs ) > 220 ||
			Math.hypot( event.clientX - wheelAnchorX, event.clientY - wheelAnchorY ) > 18;

		if ( isFreshGesture ) {

			wheelAnchorX = event.clientX;
			wheelAnchorY = event.clientY;
			wheelX = event.clientX;
			wheelY = event.clientY;
			wheelActive = true;

		}

		wheelX = Math.max( rect.left, Math.min( rect.right, wheelX - event.deltaX ) );
		wheelY = Math.max( rect.top, Math.min( rect.bottom, wheelY - event.deltaY ) );
		lastWheelMs = now;

		setPointer( wheelX, wheelY );

	};

	if ( element && mode !== 'custom' ) {

		window.addEventListener( 'pointermove', onPointerMove, { passive: true } );
		window.addEventListener( 'pointerdown', onPointerDown, { passive: true } );
		window.addEventListener( 'pointerup', onPointerUp, { passive: true } );
		window.addEventListener( 'pointercancel', onPointerUp, { passive: true } );
		window.addEventListener( 'blur', onPointerUp );
		element.addEventListener( 'wheel', onWheel, { passive: false } );

	}

	function resolvePointerTarget() {

		if ( ! camera || ! pointer.hasMoved ) return;

		raycaster.setFromCamera( pointer.ndc, camera );
		pointer.onSurface = false;

		if ( mode === 'surface' && meshes.length > 0 ) {

			const hits = raycaster.intersectObjects( meshes, false );

			if ( hits.length > 0 ) {

				const first = hits[ 0 ];
				pointerTarget.copy( first.point );

				if ( first.face ) {

					normalMatrix.getNormalMatrix( first.object.matrixWorld );
					tempNormal.copy( first.face.normal ).applyMatrix3( normalMatrix ).normalize();
					surfaceNormal.lerp( tempNormal, 0.35 ).normalize();
					pointerTarget.addScaledVector( tempNormal, surfaceOffset );

				}

				pointer.onSurface = true;
				return;

			}

		}

		if ( raycaster.ray.intersectPlane( plane, hit ) ) {

			pointerTarget.copy( hit );
			surfaceNormal.lerp( plane.normal, 0.15 ).normalize();

		}

	}

	function computeDefaultWander( time, out ) {

		const w = bounds.halfWidth * 0.62;
		const h = bounds.halfHeight * 0.5;

		out.set(
			Math.sin( time * 0.31 ) * w + Math.sin( time * 0.83 + 1.3 ) * w * 0.3,
			bounds.centerY + 0.15 + Math.sin( time * 0.47 + 0.6 ) * h + Math.cos( time * 1.07 ) * h * 0.28,
			- plane.constant
		);

	}

	function update( dt, time ) {

		if ( mode !== 'custom' ) {

			const now = performance.now() / 1000;

			if ( externalDriver.active ) {

				pointer.ndc.set(
					THREE.MathUtils.clamp( externalDriver.ndcX, - 1, 1 ),
					THREE.MathUtils.clamp( externalDriver.ndcY, - 1, 1 )
				);
				pointer.lastMove = now;
				pointer.hasMoved = true;

			}

			const idle = enableAutopilot && ! externalDriver.active && ( now - pointer.lastMove > idleAfter );

			const autoTarget = idle ? 1 : 0;
			const autoRate = idle ? 0.9 : 7.0;
			autopilot += ( autoTarget - autopilot ) * ( 1 - Math.exp( - dt * autoRate ) );

			resolvePointerTarget();

			if ( wanderFn ) {

				wanderFn( time, bounds, wanderTarget, surfaceNormal );

			} else {

				computeDefaultWander( time, wanderTarget );

			}

			target.lerpVectors( pointerTarget, wanderTarget, autopilot );

			if ( depthSway !== 0 && ! pointer.onSurface ) {

				target.z += Math.sin( time * 0.43 ) * depthSway;

			}

			if ( clampToBounds ) {

				const minFloor = floorY + radius * floorMarginRatio;
				target.x = THREE.MathUtils.clamp( target.x, - bounds.halfWidth * 0.97, bounds.halfWidth * 0.97 );
				target.y = THREE.MathUtils.clamp(
					target.y,
					Math.max( minFloor, bounds.centerY - bounds.halfHeight * 0.97 ),
					bounds.centerY + bounds.halfHeight * 0.97
				);

			}

		}

		// Sub-stepped spring-damper integration for smooth weight and unconditional stability
		previous.copy( position );

		const steps = Math.max( 1, Math.ceil( dt / ( 1 / 120 ) ) );
		const h2 = dt / steps;
		const dampCoeff = 2 * Math.sqrt( stiffness ) * damping;

		for ( let i = 0; i < steps; i ++ ) {

			velocity.x += ( ( target.x - position.x ) * stiffness - velocity.x * dampCoeff ) * h2;
			velocity.y += ( ( target.y - position.y ) * stiffness - velocity.y * dampCoeff ) * h2;
			velocity.z += ( ( target.z - position.z ) * stiffness - velocity.z * dampCoeff ) * h2;

			const speed = velocity.length();
			if ( speed > maxSpeed ) velocity.multiplyScalar( maxSpeed / speed );

			position.addScaledVector( velocity, h2 );

		}

		pointer.speed = velocity.length();

		// Springy radius charge while pointer is pressed (or shaped by external Z-proximity / hand posture)
		const baseMul = externalDriver.active ? THREE.MathUtils.clamp( externalDriver.radiusMul, 0.45, 2.2 ) : 1.0;
		const isPressed = pointer.pressed || ( externalDriver.active && externalDriver.pressed );
		const scaleGoal = baseMul * ( isPressed ? chargeScale : 1.0 );
		radiusVelocity += ( ( scaleGoal - radiusScale ) * chargeStiffness - radiusVelocity * chargeDamping ) * dt;
		radiusScale += radiusVelocity * dt;

		// Sync GPU uniforms
		uniforms.previous.value.copy( previous );
		uniforms.position.value.copy( position );
		uniforms.velocity.value.copy( velocity );
		uniforms.normal.value.copy( surfaceNormal );
		uniforms.radius.value = radius * radiusScale;
		uniforms.charge.value = Math.max( 0, ( radiusScale - 1 ) / Math.max( 0.001, chargeScale - 1 ) );
		uniforms.active.value = active ? 1 : 0;

	}

	function setBounds( halfWidth, halfHeight, centerY, snapIfUnplaced = true ) {

		bounds.halfWidth = halfWidth;
		bounds.halfHeight = halfHeight;
		bounds.centerY = centerY;

		if ( placed === false && snapIfUnplaced ) {

			placed = true;
			if ( mode === 'plane' ) {

				position.set( 0, centerY + 0.15, - plane.constant );
				previous.copy( position );
				target.copy( position );
				pointerTarget.copy( position );

			}

		}

	}

	function setTarget( x, y, z ) {

		target.set( x, y, z );
		pointerTarget.set( x, y, z );

	}

	function teleport( x, y, z ) {

		position.set( x, y, z );
		previous.set( x, y, z );
		target.set( x, y, z );
		pointerTarget.set( x, y, z );
		velocity.set( 0, 0, 0 );

	}

	function setExternalDriver( next ) {

		if ( ! next || ! next.active ) {

			externalDriver.active = false;
			externalDriver.pressed = false;
			externalDriver.radiusMul = 1.0;
			externalDriver.suppressMouseHover = false;
			return;

		}

		externalDriver.active = true;
		if ( typeof next.ndcX === 'number' ) externalDriver.ndcX = next.ndcX;
		if ( typeof next.ndcY === 'number' ) externalDriver.ndcY = next.ndcY;
		externalDriver.radiusMul = typeof next.radiusMul === 'number' ? next.radiusMul : 1.0;
		externalDriver.pressed = Boolean( next.pressed );
		externalDriver.suppressMouseHover = Boolean( next.suppressMouseHover );

	}

	function setSurfaceMeshes( nextMeshes ) {

		meshes.length = 0;
		meshes.push( ...nextMeshes );

	}

	function dispose() {

		if ( element && mode !== 'custom' ) {

			window.removeEventListener( 'pointermove', onPointerMove );
			window.removeEventListener( 'pointerdown', onPointerDown );
			window.removeEventListener( 'pointerup', onPointerUp );
			window.removeEventListener( 'pointercancel', onPointerUp );
			window.removeEventListener( 'blur', onPointerUp );
			element.removeEventListener( 'wheel', onWheel );

		}

	}

	return {
		position,
		previous,
		velocity,
		target,
		surfaceNormal,
		pointer,
		plane,
		uniforms,
		get baseRadius() { return radius; },
		set baseRadius( v ) { radius = v; },
		get radiusScale() { return radiusScale; },
		get effectiveRadius() { return radius * radiusScale; },
		get autopilot() { return autopilot; },
		get active() { return active; },
		set active( v ) { active = Boolean( v ); },
		update,
		setBounds,
		setTarget,
		teleport,
		setPointer,
		setExternalDriver,
		setSurfaceMeshes,
		dispose
	};

}

/**
 * Multi-collider container so collision games can drive GPU simulations
 * and CPU trigger queries from multiple simultaneous dynamic agents
 * (e.g. pointer, player avatar, projectiles, hazards).
 */
export function createColliderBank( initialColliders = [] ) {

	const list = [ ...initialColliders ];

	function add( collider ) {

		if ( ! list.includes( collider ) ) list.push( collider );
		return collider;

	}

	function remove( collider ) {

		const idx = list.indexOf( collider );
		if ( idx >= 0 ) list.splice( idx, 1 );

	}

	function update( dt, time ) {

		for ( const c of list ) c.update( dt, time );

	}

	function setBounds( halfWidth, halfHeight, centerY ) {

		for ( const c of list ) c.setBounds( halfWidth, halfHeight, centerY );

	}

	function dispose() {

		for ( const c of list ) c.dispose();
		list.length = 0;

	}

	return {
		list,
		get primary() { return list[ 0 ] || null; },
		add,
		remove,
		update,
		setBounds,
		dispose
	};

}
