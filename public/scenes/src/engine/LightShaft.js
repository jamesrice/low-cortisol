import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec2, vec3, vec4, uv, dot, exp, abs, pow, mix, smoothstep, saturate, max, time,
	positionWorld, mx_noise_float
} from 'three/tsl';

// Camera-pivoting analytical volumetric light shaft ribbon.
// Uses progressive analytical blur across angular noise octaves so god-rays
// leave the light source / canopy crisp and soften naturally along the beam.

export function createLightShaft( {
	scene,
	camera,
	apex,
	target,
	angle = 0.17,
	color = 0xfff1d2,
	rimTint = [ 1.0, 0.91, 0.76 ],
	strength = 0.3,
	blurGrowth = 0.34,
	fadeInEnd = 0.2,
	fadeOutStart = 0.72,
	renderOrder = 2
} ) {

	const apexVec = apex instanceof THREE.Vector3 ? apex.clone() : new THREE.Vector3().fromArray( apex );
	const targetVec = target instanceof THREE.Vector3 ? target.clone() : new THREE.Vector3().fromArray( target );
	const axis = new THREE.Vector3().subVectors( targetVec, apexVec );
	const reach = axis.length();
	axis.normalize();

	const tanHalf = Math.tan( angle );

	const uApex = uniform( apexVec );
	const uAxis = uniform( axis );
	const uSide = uniform( new THREE.Vector3( 1, 0, 0 ) );
	const uReach = uniform( reach );
	const uStrength = uniform( 0 );
	const uTint = uniform( new THREE.Color( color ) );

	const material = new THREE.MeshBasicNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	} );

	material.positionNode = Fn( () => {

		const distance = uv().y.mul( uReach );
		const across = uv().x.sub( 0.5 ).mul( 2 );
		const halfWidth = distance.mul( tanHalf ).mul( 1.04 ).add( 0.02 );

		return uApex.add( uAxis.mul( distance ) ).add( uSide.mul( across.mul( halfWidth ) ) );

	} )();

	material.colorNode = Fn( () => {

		const rel = positionWorld.sub( uApex );
		const distance = max( dot( rel, uAxis ), 1e-3 );
		const across = dot( rel, uSide ).div( distance.mul( tanHalf ) );
		const t = distance.div( uReach );

		const profile = pow( saturate( across.mul( across ).oneMinus() ), 1.7 );
		const dilution = float( 1 ).div( t.mul( 1.3 ).add( 0.7 ) );
		const fade = smoothstep( 0.02, fadeInEnd, t ).mul( smoothstep( fadeOutStart, 1.0, t ).oneMinus() );

		const blur = t.mul( t ).mul( blurGrowth ).add( 0.012 );

		const octave = ( frequency, amplitude, speed, phase ) => {

			const attenuation = exp( blur.mul( frequency ).pow( 2 ).mul( - 2 ) );
			const n = mx_noise_float( vec2( across.mul( frequency ).add( phase ), time.mul( speed ).add( phase ) ) );

			return n.mul( attenuation ).mul( amplitude );

		};

		const rays = octave( 2.1, 0.55, 0.035, 1.7 )
			.add( octave( 4.9, 0.5, 0.05, 5.3 ) )
			.add( octave( 10.7, 0.42, 0.07, 9.1 ) )
			.add( octave( 23.0, 0.3, 0.09, 13.9 ) );

		const intensity = profile.mul( dilution ).mul( fade ).mul( max( float( 1 ).add( rays.mul( 1.5 ) ), 0.04 ) );

		const warmth = saturate( pow( abs( across ), 1.5 ).mul( 0.45 ).add( rays.mul( 0.2 ) ).add( 0.1 ) );
		const tint = mix( vec3( 1 ), vec3( rimTint[ 0 ], rimTint[ 1 ], rimTint[ 2 ] ), warmth );

		return vec4( uTint.mul( tint ).mul( intensity ).mul( uStrength ), 1 );

	} )();

	const mesh = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1, 1, 24 ), material );
	mesh.frustumCulled = false;
	mesh.renderOrder = renderOrder;
	if ( scene ) scene.add( mesh );

	const mid = new THREE.Vector3().copy( apexVec ).addScaledVector( axis, reach * 0.6 );
	const toCamera = new THREE.Vector3();

	function update( reveal = 1 ) {

		toCamera.subVectors( camera.position, mid );
		uSide.value.crossVectors( axis, toCamera ).normalize();
		uStrength.value = strength * reveal;

	}

	function dispose() {

		if ( mesh.parent ) mesh.parent.remove( mesh );
		mesh.geometry.dispose();
		material.dispose();

	}

	return { mesh, update, dispose };

}
