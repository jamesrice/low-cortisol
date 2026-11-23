import * as THREE from 'three/webgpu';
import {
	Fn, uniform, instanceIndex, varying, lights,
	float, vec3, vec4, mix, exp, max, min, dot, cross, normalize, length, abs, sin, cos, pow, fract,
	smoothstep, saturate, uv, positionLocal, normalLocal, positionWorld, normalView, positionViewDirection, cameraPosition
} from 'three/tsl';
import { createStorageBuffers, createGPUBodySystem, TSL } from '../../engine/index.js';

// Sculpted 3D botanical dandelion pappus parachutes floating through the macro
// forest clearing and interacting physically with mouse movement:
//   - Real 3D achene (tapered seed) + slender beak stem + 34-filament arched silky crown
//   - GPU divergence-free woodland curl breeze + prevailing sunbeam drift
//   - Swept-segment collision + potential-flow dipole wake + vortex swirl around cursor
//   - Aerodynamic pendulum righting torque (seed hangs down, canopy tilts into gusts,
//     gentle pirouette spin, playful tumbling recovery when swiped!)
//   - Analytic trunk & limb capsule collision so pappus glide cleanly around the tree

/**
 * Procedurally construct a detailed 3D Taraxacum (dandelion) pappus mesh.
 * Local orientation: +Y is the parachute crown axis, -Y is the hanging seed.
 * Encodes part type in uv.x:
 *   0.00..0.25 = ribbed amber-brown achene (seed body)
 *   0.25..0.60 = pale slender beak / rostrum stem
 *   0.60..1.00 = silky translucent ivory-white pappus crown & filaments
 */
function buildDandelionPappusGeometry() {

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];
	let vOffset = 0;

	// Helper: append a lathe/revolved segment (for achene seed, beak stem, hub collar)
	function addRevolved( rings, sides, uvX ) {

		const base = vOffset;
		for ( const ring of rings ) {

			for ( let s = 0; s < sides; s ++ ) {

				const a = ( s / sides ) * Math.PI * 2;
				const ca = Math.cos( a );
				const sa = Math.sin( a );
				positions.push( ca * ring.r, ring.y, sa * ring.r );
				normals.push( ca, ring.ny || 0, sa );
				uvs.push( uvX, ring.uvY );

			}

		}

		for ( let i = 0; i < rings.length - 1; i ++ ) {

			const r0 = base + i * sides;
			const r1 = base + ( i + 1 ) * sides;
			for ( let s = 0; s < sides; s ++ ) {

				const s1 = ( s + 1 ) % sides;
				indices.push( r0 + s, r0 + s1, r1 + s, r0 + s1, r1 + s1, r1 + s );

			}

		}

		vOffset += rings.length * sides;

	}

	// 1. Tapered achene (seed body) at bottom (-0.44 -> -0.21)
	addRevolved( [
		{ y: - 0.44, r: 0.003, ny: - 0.9, uvY: 0.0 },
		{ y: - 0.37, r: 0.025, ny: - 0.25, uvY: 0.1 },
		{ y: - 0.28, r: 0.028, ny: 0.15, uvY: 0.2 },
		{ y: - 0.21, r: 0.011, ny: 0.55, uvY: 0.26 }
	], 6, 0.08 );

	// 2. Slender rostrum / beak stem (-0.21 -> +0.10)
	addRevolved( [
		{ y: - 0.21, r: 0.0085, ny: 0, uvY: 0.28 },
		{ y: - 0.05, r: 0.0065, ny: 0, uvY: 0.42 },
		{ y: 0.10, r: 0.008, ny: 0, uvY: 0.54 }
	], 4, 0.42 );

	// 3. Fluffy collar hub at parachute apex (+0.095 -> +0.13)
	addRevolved( [
		{ y: 0.095, r: 0.010, ny: - 0.4, uvY: 0.55 },
		{ y: 0.112, r: 0.024, ny: 0.1, uvY: 0.58 },
		{ y: 0.130, r: 0.009, ny: 0.7, uvY: 0.60 }
	], 6, 0.76 );

	// 4. Radiating curved 3D silky pappus filaments (two botanical whorls: 22 outer + 12 inner)
	const hubY = 0.112;

	function addFilament( azimuth, maxR, riseY, sag, halfWBase, halfWTip, twistRad ) {

		const ca = Math.cos( azimuth );
		const sa = Math.sin( azimuth );
		const tanX = - sa;
		const tanZ = ca;

		const segs = 3;
		const base = vOffset;

		for ( let i = 0; i <= segs; i ++ ) {

			const t = i / segs;
			// Graceful umbrella arch: sweeps outward & gently curves up at tips
			const rad = 0.014 + maxR * t;
			const y = hubY + riseY * Math.pow( t, 0.82 ) + sag * t * ( 1 - t );

			const cx = ca * rad;
			const cz = sa * rad;

			const w = halfWBase * ( 1 - t ) + halfWTip * t;
			// Twist the micro-ribbon along its length so it catches rim light from every viewing angle
			const tw = twistRad + t * 0.95;
			const ctw = Math.cos( tw );
			const stw = Math.sin( tw );

			// Width vector blends tangential & upward directions
			const wx = tanX * ctw;
			const wy = stw;
			const wz = tanZ * ctw;

			// Outward-upward normal for luminous silk backlighting
			const nx = ca * 0.55 + tanX * 0.25;
			const ny = 0.78;
			const nz = sa * 0.55 + tanZ * 0.25;

			positions.push( cx - wx * w, y - wy * w, cz - wz * w );
			normals.push( nx, ny, nz );
			uvs.push( 0.92, 0.58 + 0.42 * t );

			positions.push( cx + wx * w, y + wy * w, cz + wz * w );
			normals.push( nx, ny, nz );
			uvs.push( 0.96, 0.58 + 0.42 * t );

		}

		for ( let i = 0; i < segs; i ++ ) {

			const r0 = base + i * 2;
			const r1 = r0 + 2;
			indices.push( r0, r0 + 1, r1, r0 + 1, r1 + 1, r1 );

		}

		vOffset += ( segs + 1 ) * 2;

	}

	// Outer umbrella whorl (22 graceful wide filaments)
	const outerCount = 22;
	for ( let i = 0; i < outerCount; i ++ ) {

		const a = ( i / outerCount ) * Math.PI * 2 + ( ( i % 2 ) * 0.04 );
		const rVar = 0.37 + 0.055 * Math.sin( i * 3.7 );
		const yVar = 0.22 + 0.045 * Math.cos( i * 2.9 );
		addFilament( a, rVar, yVar, - 0.05, 0.0085, 0.0032, i * 0.7 );

	}

	// Inner steeper fluffy crown whorl (12 filaments)
	const innerCount = 12;
	for ( let i = 0; i < innerCount; i ++ ) {

		const a = ( ( i + 0.5 ) / innerCount ) * Math.PI * 2;
		const rVar = 0.23 + 0.04 * Math.cos( i * 4.1 );
		const yVar = 0.33 + 0.04 * Math.sin( i * 2.3 );
		addFilament( a, rVar, yVar, 0.03, 0.008, 0.0028, i * 1.1 + 0.5 );

	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geom.setIndex( indices );
	return geom;

}

/**
 * Seed floating dandelion pappus parachutes across crisp macro focus,
 * dreamy foreground bokeh, and sunlit background clearing.
 */
function seedDandelionFlock( { count, rand, capsules } ) {

	const pos = new Float32Array( count * 4 ); // xyz = world position, w = interaction shimmer heat
	const vel = new Float32Array( count * 4 ); // xyz = velocity
	const rot = new Float32Array( count * 4 ); // unit quaternion
	const ang = new Float32Array( count * 4 ); // angular velocity
	const data = new Float32Array( count * 4 ); // x = scale, y = inertia, z = seed, w = pirouette rate
	const home = new Float32Array( count * 4 ); // xyz = rest home drift center, w = shell offset

	const pt = new THREE.Vector3();
	const tmp = new THREE.Vector3();

	const isInsideCapsule = ( x, y, z, a, b, rad ) => {

		const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
		const lenSq = Math.max( abx * abx + aby * aby + abz * abz, 1e-6 );
		const t = THREE.MathUtils.clamp( ( ( x - a.x ) * abx + ( y - a.y ) * aby + ( z - a.z ) * abz ) / lenSq, 0, 1 );
		const dx = x - ( a.x + abx * t );
		const dy = y - ( a.y + aby * t );
		const dz = z - ( a.z + abz * t );
		return Math.hypot( dx, dy, dz ) < rad;

	};

	for ( let i = 0; i < count; i ++ ) {

		const o = i * 4;
		const layerRoll = rand();

		// Depth layers for rich macro photography layering
		let x = 0, y = 0, z = 0;

		for ( let attempt = 0; attempt < 40; attempt ++ ) {

			if ( layerRoll < 0.70 ) {

				// Focal-corridor hero pappus: crisp right in front of and beside the mossy tree!
				x = - 2.15 + rand() * 4.55;
				y = - 1.25 + rand() * 2.55;
				z = 0.48 + rand() * 0.92;

			} else if ( layerRoll < 0.85 ) {

				// Close foreground: drift near macro lens for dreamy creamy bokeh silhouettes
				x = - 2.0 + rand() * 4.2;
				y = - 1.1 + rand() * 2.2;
				z = 1.65 + rand() * 0.85;

			} else {

				// Mid-background sunlit clearing to the right/around trunk
				x = - 1.5 + rand() * 4.3;
				y = - 1.35 + rand() * 2.75;
				z = - 1.35 + rand() * 1.6;

			}

			// Avoid seeding inside the tree trunk or side limb
			const hitTrunk = isInsideCapsule( x, y, z, capsules.trunkA, capsules.trunkB, capsules.trunkRadius + 0.24 );
			const hitBranch = isInsideCapsule( x, y, z, capsules.branchA, capsules.branchB, capsules.branchRadius + 0.20 );
			if ( ! hitTrunk && ! hitBranch ) break;

		}

		pt.set( x, y, z );
		pos[ o ] = pt.x;
		pos[ o + 1 ] = pt.y;
		pos[ o + 2 ] = pt.z;
		pos[ o + 3 ] = 0;

		home[ o ] = pt.x;
		home[ o + 1 ] = pt.y;
		home[ o + 2 ] = pt.z;
		home[ o + 3 ] = - 0.05 + 0.22 * rand();

		// Initial upright-tilted orientation with random yaw
		const yaw = rand() * Math.PI * 2;
		const tilt = ( rand() - 0.5 ) * 0.45;
		const q = new THREE.Quaternion().setFromEuler( new THREE.Euler( tilt, yaw, ( rand() - 0.5 ) * 0.45 ) );
		rot[ o ] = q.x;
		rot[ o + 1 ] = q.y;
		rot[ o + 2 ] = q.z;
		rot[ o + 3 ] = q.w;

		// Scale hierarchy: delicate macro seeds ~0.22 - 0.40 world units
		const scale = 0.21 + 0.19 * Math.pow( rand(), 1.3 );
		const inertia = 0.72 + ( scale / 0.30 ) * 0.65;

		data[ o ] = scale;
		data[ o + 1 ] = inertia;
		data[ o + 2 ] = rand();
		data[ o + 3 ] = ( rand() < 0.5 ? - 1 : 1 ) * ( 0.45 + 0.95 * rand() ); // gentle pirouette spin

		// Slight initial breeze velocity
		vel[ o ] = 0.08 + ( rand() - 0.5 ) * 0.08;
		vel[ o + 1 ] = ( rand() - 0.5 ) * 0.05;
		vel[ o + 2 ] = ( rand() - 0.5 ) * 0.05;

		void tmp;

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

/**
 * Create the interactive GPU dandelion pappus flock built on the general engine.
 */
export function createDandelionSystem( {
	scene,
	config,
	quality,
	collider,
	capsules,
	rig,
	sceneLights,
	environment
} ) {

	const cfg = config.dandelion;
	const rand = TSL.mulberry32( 0xd4ad3110 );

	const U = {
		dt: uniform( 1 / 60 ),
		time: uniform( 0 ),
		reveal: uniform( 1 ),
		flowFrequency: uniform( cfg.flowFrequency ),
		flowAmplitude: uniform( cfg.flowAmplitude ),
		flowOffset: uniform( new THREE.Vector3() ),
		prevailingWind: uniform( new THREE.Vector3().fromArray( cfg.prevailingWind ) ),
		drag: uniform( cfg.drag ),
		homeStiffness: uniform( cfg.homeStiffness ),
		wake: uniform( cfg.wake ),
		swirl: uniform( cfg.swirl ),
		swirlAxis: uniform( new THREE.Vector3( 0.15, 0.25, 0.95 ).normalize() ),
		shieldStiffness: uniform( cfg.shieldStiffness ),
		shieldDamping: uniform( cfg.shieldDamping ),
		shieldCore: uniform( cfg.shieldCore ),
		rightingStrength: uniform( cfg.rightingStrength ),
		maxSpeed: uniform( cfg.maxSpeed ),

		// Tree trunk & branch capsule collision obstacles
		trunkA: uniform( capsules.trunkA.clone() ),
		trunkB: uniform( capsules.trunkB.clone() ),
		trunkR: uniform( capsules.trunkRadius ),
		branchA: uniform( capsules.branchA.clone() ),
		branchB: uniform( capsules.branchB.clone() ),
		branchR: uniform( capsules.branchRadius )
	};

	const C = collider.uniforms;
	const buffers = seedDandelionFlock( { count: quality.pappus, rand, capsules } );

	// -------------------------------------------------- GPU Aerodynamic Compute
	const buildCompute = ( B ) => Fn( () => {

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

		const scale = D.x;
		const inertia = D.y;
		const seed = D.z;
		const pirouette = D.w;

		// 1. Divergence-free forest air currents + gentle drifting breeze + bobbing thermals
		const flow = TSL.sampleCurlFlow( p, U.flowFrequency, U.flowAmplitude, U.flowOffset, 0.46 ).toVar();
		const bob = sin( U.time.mul( 0.85 ).add( seed.mul( 25.1 ) ) ).mul( 0.08 );
		flow.addAssign( U.prevailingWind.add( vec3( 0, bob, 0 ) ) );

		// 2. Potential-flow dipole wake & swirl displaced by moving mouse cursor
		const rel = p.sub( C.position ).toVar();
		const r = max( length( rel ), 1e-3 ).toVar();
		const n = rel.div( r ).toVar();

		const interactR = C.radius.mul( 1.25 );
		flow.addAssign( TSL.computeDipoleWake( rel, r, interactR, C.velocity, U.wake ).mul( C.active ) );
		flow.addAssign( TSL.computeVortexSwirl( n, r, interactR, U.swirlAxis, U.swirl.mul( float( 0.45 ).add( C.charge.mul( 1.15 ) ) ) ).mul( C.active ) );

		// 3. Soft restoring drift home so seeds wander far on gusts and lazily return
		const driftHome = H.xyz.add( vec3(
			sin( U.time.mul( 0.22 ).add( seed.mul( 19.3 ) ) ).mul( 0.48 ),
			cos( U.time.mul( 0.17 ).add( seed.mul( 11.7 ) ) ).mul( 0.32 ),
			sin( U.time.mul( 0.15 ).add( seed.mul( 7.9 ) ) ).mul( 0.22 )
		) );
		const acc = driftHome.sub( p ).mul( U.homeStiffness ).toVar();

		// Air drag coupling (silky parachutes track air currents very responsively!)
		TSL.applyFluidDrag( v, flow, U.drag.div( inertia ), dt );
		v.addAssign( acc.mul( dt ) );

		// 4. Swept-segment continuous collision with cursor breeze bubble
		const hit = TSL.applySweptSphereCollision( {
			p,
			v,
			prev: C.previous,
			curr: C.position,
			colliderVel: C.velocity,
			radius: interactR.mul( 0.78 ),
			shellOffset: H.w,
			bodyHalfSize: scale.mul( 0.38 ),
			stiffness: U.shieldStiffness,
			damping: U.shieldDamping,
			coreFraction: U.shieldCore,
			inertia,
			wobbleAmount: float( 0.05 ),
			timeNode: U.time,
			dt,
			enabled: C.active.greaterThan( 0.5 )
		} );

		// Integrate linear velocity
		TSL.clampSpeed( v, U.maxSpeed );
		p.addAssign( v.mul( dt ) );

		// 5. Analytic tree trunk & limb obstacle collision (keep pappus outside wood)
		TSL.collideCapsule( p, v, U.trunkA, U.trunkB, U.trunkR, scale.mul( 0.42 ), 0.35, 0.88 );
		TSL.collideCapsule( p, v, U.branchA, U.branchB, U.branchR, scale.mul( 0.42 ), 0.35, 0.88 );

		// 6. Aerodynamic parachute righting torque + pirouette spin + swipe tumble kick
		const q = Q.toVar();
		const w = W.xyz.toVar();

		const localUp = TSL.quatRotate( vec3( 0, 1, 0 ), q ).toVar();
		// Parachute crown tilts subtly into relative airflow (drag - velocity)
		const relAir = flow.sub( v );
		const desiredUp = normalize( vec3( 0, 1, 0 ).add( relAir.mul( 0.38 ) ) );
		const rightingTorque = cross( localUp, desiredUp ).mul( U.rightingStrength );

		// Gentle axial spin around the parachute stem
		const spinTarget = localUp.mul( pirouette.add( length( relAir ).mul( 0.4 ) ) );

		w.addAssign( rightingTorque.mul( dt ) );
		w.assign( mix( w, spinTarget, exp( dt.mul( - 2.2 ) ).oneMinus() ) );

		// Mouse swipe kicks pappus into a graceful tumble before righting itself
		const kickAxis = normalize( vec3( fract( seed.mul( 41.3 ) ), fract( seed.mul( 73.1 ) ), fract( seed.mul( 29.7 ) ) ).sub( 0.5 ).add( 1e-3 ) );
		w.addAssign( cross( hit.normal, kickAxis ).mul( hit.impact.mul( 4.2 ).div( inertia ) ) );
		w.mulAssign( min( float( 1 ), float( 14.0 ).div( max( length( w ), 1e-4 ) ) ) );

		const nextQ = TSL.quatIntegrate( q, w, dt );

		// Also shimmer softly when caught in cursor wake even without direct hard impact
		const wakeGlow = smoothstep( interactR.mul( 1.65 ), interactR.mul( 0.25 ), r )
			.mul( min( length( C.velocity ).mul( 0.4 ).add( C.charge ), 1.2 ) )
			.mul( C.active );
		const nextHeat = max(
			TSL.decayHeat( heat, hit.impact, 0.85, 0.22, dt ),
			min( wakeGlow.mul( 0.85 ), 1.0 )
		);

		P.assign( vec4( p, nextHeat ) );
		V.assign( vec4( v, 0 ) );
		W.assign( vec4( w, 0 ) );
		Q.assign( nextQ );

	} );

	// ----------------------------------------- Translucent Silky Pappus Material
	const pappusMaterial = new THREE.MeshStandardNodeMaterial( {
		metalness: 0.0,
		side: THREE.DoubleSide
	} );

	{

		const aPos = buffers.pos.toAttribute();
		const aRot = buffers.rot.toAttribute();
		const aData = buffers.data.toAttribute();

		const appear = smoothstep( aData.z.mul( 0.6 ), aData.z.mul( 0.6 ).add( 0.4 ), U.reveal );

		pappusMaterial.positionNode = Fn( () => {

			const q = aRot.toVar();
			const s = aData.x.mul( appear );

			normalLocal.assign( TSL.quatRotate( normalLocal, q ) );
			return TSL.quatRotate( positionLocal.mul( s ), q ).add( aPos.xyz );

		} )();

		const vHeat = varying( aPos.w );
		const vSeed = varying( aData.z );

		const part = uv().x;
		const isStem = smoothstep( 0.22, 0.34, part );
		const isSilk = smoothstep( 0.62, 0.82, part );
		const tipFade = smoothstep( 0.56, 1.0, uv().y );

		const viewDir = normalize( cameraPosition.sub( positionWorld ) );
		const sunDir = rig.sunDirection.negate();
		// Strong Mie forward-scattering + silk Fresnel rim makes filaments glow like gossamer!
		const rim = pow( saturate( abs( dot( normalView, positionViewDirection ) ).oneMinus() ), 1.45 );
		const sunBacklight = pow( saturate( dot( viewDir, sunDir ) ), 2.2 );

		pappusMaterial.colorNode = Fn( () => {

			const seedColor = mix( vec3( 0.24, 0.14, 0.06 ), vec3( 0.42, 0.27, 0.12 ), uv().y.mul( 3.5 ).clamp( 0, 1 ) );
			const stemColor = vec3( 0.68, 0.62, 0.46 );
			const silkColor = mix( vec3( 0.86, 0.85, 0.80 ), vec3( 1.0, 0.99, 0.95 ), tipFade );

			const col = mix( seedColor, stemColor, isStem );
			return vec4( mix( col, silkColor, isSilk ), 1 );

		} )();

		pappusMaterial.roughnessNode = mix( float( 0.82 ), float( 0.46 ), isSilk );

		// Silky backlit radiance so delicate filaments remain crisp & luminous against mossy shadows
		pappusMaterial.emissiveNode = Fn( () => {

			const silkHalo = vec3( 0.96, 0.93, 0.82 )
				.mul( float( 0.20 ).add( rim.mul( 0.36 ) ).add( sunBacklight.mul( 0.28 ) ) );
			const touchShimmer = vec3( 1.0, 0.92, 0.56 ).mul( vHeat.mul( 0.55 ) );
			const glint = pow( sin( U.time.mul( 2.4 ).add( vSeed.mul( 29.0 ) ) ).mul( 0.5 ).add( 0.5 ), 4.0 ).mul( 0.12 );

			return silkHalo.add( touchShimmer ).add( vec3( 1.0, 0.95, 0.80 ).mul( glint ) )
				.mul( isSilk )
				.mul( float( 0.45 ).add( tipFade.mul( 0.55 ) ) );

		} )();

		pappusMaterial.lightsNode = lights( sceneLights );
		pappusMaterial.envMap = environment;
		pappusMaterial.envMapIntensity = config.light.environmentIntensity * 1.4;

	}

	const system = createGPUBodySystem( {
		name: 'Dandelion Pappus Flock',
		count: quality.pappus,
		buffers,
		buildComputeFn: buildCompute,
		geometry: buildDandelionPappusGeometry(),
		material: pappusMaterial,
		targetScene: scene,
		castShadow: false,
		receiveShadow: false
	} );

	function update( dt, time, { renderer } ) {

		U.dt.value = dt;
		U.time.value = time;
		U.reveal.value = Math.min( 1, U.reveal.value + dt / 2.4 );

		const drift = time * cfg.flowDrift;
		U.flowOffset.value.set( drift * 0.6, drift * 0.35, drift * 0.5 );

		U.swirlAxis.value.set(
			0.24 * Math.sin( time * 0.16 ),
			0.32 * Math.cos( time * 0.11 ),
			0.91
		).normalize();

		system.dispatch( renderer );

	}

	function dispose() {

		system.dispose();

	}

	return {
		uniforms: U,
		system,
		bodyCount: quality.pappus,
		update,
		dispose
	};

}
