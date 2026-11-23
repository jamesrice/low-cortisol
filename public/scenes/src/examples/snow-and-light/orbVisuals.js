import * as THREE from 'three/webgpu';
import {
	uniform, float, vec3, vec4, uv, length, exp, cos, pow, dot, mix,
	normalView, positionViewDirection
} from 'three/tsl';
import { TSL } from '../../engine/index.js';

// Visuals & soft-shadow point light attached to an engine `Collider` for "Snow & Light".

export function createOrbVisuals( { scene, config, quality, collider } ) {

	const cfg = config.orb;
	const group = new THREE.Group();
	scene.add( group );

	const light = new THREE.PointLight( cfg.color, 0, 0, 2 );
	light.castShadow = quality.shadows;
	light.shadow.mapSize.setScalar( quality.shadowSize );
	light.shadow.camera.near = 0.18;
	light.shadow.camera.far = 24;
	light.shadow.bias = - 0.002;
	light.shadow.filterNode = TSL.createSoftPointShadow( {
		samples: quality.shadowSamples,
		spread: 0.03,
		near: light.shadow.camera.near,
		far: light.shadow.camera.far,
		bias: light.shadow.bias
	} );
	group.add( light );

	const uGlow = uniform( 0 );
	const uVortex = uniform( 0 );
	const coreMaterial = new THREE.MeshBasicNodeMaterial();
	const facing = dot( normalView, positionViewDirection ).clamp( 0, 1 );
	const warmCore = mix( vec3( 1.0, 0.66, 0.36 ), vec3( 1.0, 0.95, 0.88 ), pow( facing, 0.55 ) );
	const icyCore = mix( vec3( 0.42, 0.78, 1.0 ), vec3( 0.96, 0.98, 1.0 ), pow( facing, 0.55 ) );
	const coreColor = mix( warmCore, icyCore, uVortex.mul( 0.55 ) );
	coreMaterial.colorNode = vec4( coreColor.mul( cfg.emissive ).mul( uGlow ), 1 );

	const core = new THREE.Mesh( new THREE.SphereGeometry( cfg.radius, 48, 24 ), coreMaterial );
	group.add( core );

	const haloMaterial = new THREE.SpriteNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	} );

	const uShieldScale = uniform( 1 );
	const haloExtent = 1.7;

	const d = length( uv().sub( 0.5 ) ).mul( 2 * haloExtent );
	const corona = exp( d.mul( d ).mul( - 85 ) ).mul( 1.1 ).add( exp( d.mul( - 9 ) ).mul( 0.1 ) );
	const ringDistance = d.sub( uShieldScale ).div( 0.07 );
	const ring = exp( ringDistance.mul( ringDistance ).negate() );
	const spectrum = cos( d.mul( 2.2 ).add( vec3( 0.0, 0.33, 0.67 ) ).mul( 6.28318 ) ).mul( 0.5 ).add( 0.5 );
	const edgeFade = float( 1 ).sub( d.div( haloExtent ) ).clamp( 0, 1 );

	const haloTint = mix( vec3( 1.0, 0.86, 0.68 ), vec3( 0.62, 0.86, 1.0 ), uVortex.mul( 0.6 ) );
	haloMaterial.colorNode = vec4(
		haloTint.mul( corona ).add( spectrum.mul( ring ).mul( float( 0.028 ).add( uVortex.mul( 0.022 ) ) ) ).mul( edgeFade ).mul( uGlow ),
		1
	);

	const halo = new THREE.Sprite( haloMaterial );
	halo.scale.setScalar( cfg.shieldRadius * haloExtent * 2 );
	group.add( halo );

	let reveal = 0;
	let vortexTarget = 0;
	let radiusMul = 1;

	function setVortexMode( isVortex ) {

		vortexTarget = isVortex ? 1 : 0;

	}

	function setFieldRadiusScale( scale ) {

		radiusMul = THREE.MathUtils.clamp( scale, 0.55, 2.2 );

	}

	function update( dt, time ) {

		group.position.copy( collider.position );
		uVortex.value += ( vortexTarget - uVortex.value ) * Math.min( 1, dt * 6.0 );
		uShieldScale.value = collider.radiusScale;
		halo.scale.setScalar( cfg.shieldRadius * radiusMul * haloExtent * 2 );

		reveal = Math.min( 1, reveal + dt / 2.4 );
		const eased = reveal * reveal * ( 3 - 2 * reveal );
		const flicker = 1 + 0.03 * Math.sin( time * 7.3 ) * Math.sin( time * 3.1 + 1.0 ) + 0.015 * Math.sin( time * 23.0 );
		const charge = 1 + ( collider.radiusScale - 1 ) * 0.5;
		const sizeBoost = 0.72 + radiusMul * 0.28;

		light.intensity = cfg.intensity * eased * flicker * charge * sizeBoost;
		uGlow.value = eased * flicker * charge * sizeBoost;

	}

	function dispose() {

		if ( group.parent ) group.parent.remove( group );
		core.geometry.dispose();
		coreMaterial.dispose();
		haloMaterial.dispose();

	}

	return {
		group,
		light,
		get reveal() { return reveal; },
		setVortexMode,
		setFieldRadiusScale,
		update,
		dispose
	};

}
