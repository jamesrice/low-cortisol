import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec3, mix, smoothstep, length, time, mx_fractal_noise_float } from 'three/tsl';

// Reusable lighting helpers:
//   - Procedural animated gobo/cookie SpotLight (haze or forest leaf canopy mottling)
//   - Procedural PMREM reflection environment from emissive cards (zero external HDRIs)

/**
 * Create a SpotLight with a procedural animated fractal-noise gobo cookie.
 */
export function createGoboSpotLight( {
	scene,
	position = [ 7.6, 10.8, - 0.6 ],
	target = [ - 1.3, - 2.05, - 3.1 ],
	color = 0xfff1d2,
	intensity = 900,
	angle = 0.17,
	penumbra = 1.0,
	decay = 2,
	goboScale = 2.3,
	goboSpeed = 0.035,
	goboContrast = 0.38,
	rimTint = [ 1.0, 0.91, 0.76 ]
} = {} ) {

	const spot = new THREE.SpotLight( color, intensity, 0, angle, penumbra, decay );
	spot.position.fromArray( position );
	spot.target.position.fromArray( target );
	if ( scene ) scene.add( spot, spot.target );

	const cookie = Fn( ( [ coord ] ) => {

		const c = coord.xy.sub( 0.5 ).mul( 2 );
		const rho = length( c );

		const n = mx_fractal_noise_float( vec3( c.mul( goboScale ), time.mul( goboSpeed ) ), 3, 2, 0.5 );
		const mottled = float( 1 ).add( n.mul( goboContrast ) ).clamp( 0.12, 1.8 );

		const warmth = smoothstep( 0.2, 1.0, rho ).mul( 0.45 ).add( n.mul( 0.1 ) ).clamp( 0, 1 );

		return mix( vec3( 1 ), vec3( rimTint[ 0 ], rimTint[ 1 ], rimTint[ 2 ] ), warmth ).mul( mottled );

	} );

	spot.colorNode = cookie;

	const direction = new THREE.Vector3().subVectors( spot.target.position, spot.position ).normalize();

	return {
		spot,
		direction,
		uniforms: {
			position: uniform( spot.position.clone() ),
			direction: uniform( direction ),
			color: uniform( new THREE.Color( color ).multiplyScalar( intensity ) ),
			coneCos: uniform( Math.cos( angle ) )
		}
	};

}

/**
 * Build a prefiltered PMREM environment texture from an array of emissive light cards.
 *
 * @param {THREE.WebGPURenderer} renderer
 * @param {object} opts
 * @param {number} [opts.background=0x000000]
 * @param {number} [opts.sigma=0.03]
 * @param {Array<{ width: number, height: number, color: number, intensity: number, position: number[] }>} opts.cards
 */
export function createProceduralEnvironment( renderer, { background = 0x000000, sigma = 0.03, cards = [] } = {} ) {

	const envScene = new THREE.Scene();
	envScene.background = new THREE.Color( background );

	for ( const card of cards ) {

		const material = new THREE.MeshBasicMaterial( { side: THREE.DoubleSide } );
		material.color.set( card.color ).multiplyScalar( card.intensity );

		const mesh = new THREE.Mesh( new THREE.PlaneGeometry( card.width, card.height ), material );
		mesh.position.fromArray( card.position );
		mesh.lookAt( 0, 0, 0 );
		envScene.add( mesh );

	}

	const pmrem = new THREE.PMREMGenerator( renderer );
	const target = pmrem.fromScene( envScene, sigma );
	pmrem.dispose();

	envScene.traverse( ( object ) => {

		if ( object.isMesh ) {

			object.geometry.dispose();
			object.material.dispose();

		}

	} );

	return target;

}
