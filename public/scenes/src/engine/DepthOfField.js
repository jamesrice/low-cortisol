import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, rtt, uniform, float, vec2, vec4, uv, abs, sign, max, min, mix, step, smoothstep, length,
	screenCoordinate, interleavedGradientNoise, vogelDiskSample
} from 'three/tsl';

// Three-pass optical depth of field for the solid scene:
//   1. prefilter (½ res)  Packs HDR color + signed Circle of Confusion (CoC)
//   2. gather    (½ res)  Scatter-as-gather over a per-pixel rotated Vogel disc
//   3. composite (full)   4-tap bilinear tent filter dissolves Vogel grain;
//                         keeps sharp pixels at full resolution, protects sharp
//                         foreground from background bleed, lets foreground bokeh spill.

export function createDepthOfField( { sampleColor, viewZ, lens, taps = 48 } ) {

	const halfTexel = uniform( new THREE.Vector2( 1, 1 ) );

	// Signed CoC in full-res device pixels: negative in front of focal plane, positive behind
	const circleOfConfusion = () => {

		const signed = viewZ.negate().sub( lens.focus );
		const amount = smoothstep( 0, lens.focalRange, max( abs( signed ).sub( lens.focusSlab ), 0 ) );

		return sign( signed ).mul( amount ).mul( lens.bokehPx );

	};

	// ------------------------------------------------------------ prefilter

	const prefilter = rtt(
		vec4( sampleColor( uv() ), circleOfConfusion().mul( 0.5 ) ),
		null, null, { resolutionScale: 0.5 }
	);

	// --------------------------------------------------------------- gather

	const gather = Fn( () => {

		const st = uv();

		const center = prefilter.sample( st ).toVar();
		const centerCoc = center.a.toVar();

		const acc = center.rgb.toVar();
		const total = float( 1 ).toVar();
		const foreground = float( 0 ).toVar();

		const maxRadius = lens.bokehPx.mul( 0.5 ); // half-res pixels
		const phi = interleavedGradientNoise( screenCoordinate.xy ).mul( 6.28318530718 );

		Loop( taps, ( { i } ) => {

			const disc = vogelDiskSample( i, taps, phi ).toVar();
			const radius = length( disc ).mul( maxRadius );

			const tap = prefilter.sample( st.add( disc.mul( maxRadius ).mul( halfTexel ) ) ).toVar();
			const tapCoc = abs( tap.a ).toVar();

			// Prevent blurred background from leaking across sharp foreground silhouettes
			If( tap.a.greaterThan( centerCoc ), () => {

				tapCoc.assign( min( tapCoc, abs( centerCoc ).mul( 2 ) ) );

			} );

			const covers = smoothstep( radius.sub( 0.5 ), radius.add( 0.5 ), tapCoc );

			acc.addAssign( mix( acc.div( total ), tap.rgb, covers ) );
			total.addAssign( 1 );

			foreground.addAssign( covers.mul( step( tap.a, - 0.5 ) ) );

		} );

		return vec4( acc.div( total ), foreground.div( taps ) );

	} );

	const blurred = rtt( gather(), null, null, { resolutionScale: 0.5 } );

	// ------------------------------------------------------------ composite

	const composite = Fn( () => {

		const st = uv();
		const sharp = sampleColor( st );

		// Four-tap bilinear tent filter smooths out per-pixel Vogel disc rotation noise
		const o = halfTexel.mul( 0.75 );
		const soft = blurred.sample( st.add( o ) )
			.add( blurred.sample( st.sub( o ) ) )
			.add( blurred.sample( st.add( vec2( o.x, o.y.negate() ) ) ) )
			.add( blurred.sample( st.add( vec2( o.x.negate(), o.y ) ) ) )
			.mul( 0.25 );

		const own = smoothstep( 0.6, 2.4, abs( circleOfConfusion() ) );
		const spill = smoothstep( 0.03, 0.4, soft.a );

		return vec4( mix( sharp, soft.rgb, max( own, spill ) ), 1 );

	} );

	function setSize( width, height ) {

		halfTexel.value.set(
			1 / Math.max( 1, Math.floor( width * 0.5 ) ),
			1 / Math.max( 1, Math.floor( height * 0.5 ) )
		);

	}

	function dispose() {

		prefilter.dispose();
		blurred.dispose();

	}

	return { node: composite(), setSize, dispose };

}
