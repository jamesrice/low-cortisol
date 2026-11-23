import {
	Fn, Loop, float, vec3, abs, max, cross, normalize,
	cubeTexture, screenCoordinate, interleavedGradientNoise, vogelDiskSample
} from 'three/tsl';

/**
 * Soft point-light PCF shadow filter using a per-pixel rotated Vogel disk.
 * Produces smooth physical penumbrae without regular grid banding.
 */
export const createSoftPointShadow = ( { samples = 8, spread = 0.03, near = 0.18, far = 24, bias = - 0.002 } = {} ) =>
	Fn( ( { depthTexture, bd3D, distance }, builder ) => {

		const reversed = builder.renderer.reversedDepthBuffer === true;
		const range = far - near;

		const absDir = abs( bd3D );
		const tangent = normalize(
			cross( bd3D, absDir.x.greaterThan( absDir.z ).select( vec3( 0, 1, 0 ), vec3( 1, 0, 0 ) ) )
		).toConst();
		const bitangent = cross( bd3D, tangent ).toConst();

		const phi = interleavedGradientNoise( screenCoordinate.xy ).mul( 6.28318530718 ).toConst();

		const depthA = reversed ? - ( near / range + bias ) : far / range + bias;
		const depthB = ( near * far ) / range;

		const lit = float( 0 ).toVar();

		Loop( samples, ( { i } ) => {

			const offset = vogelDiskSample( i, samples, phi );
			const direction = bd3D.add( tangent.mul( offset.x ).add( bitangent.mul( offset.y ) ).mul( spread ) ).toConst();
			const a = abs( direction ).toConst();
			const reach = float( depthB ).div( distance.mul( max( a.x, max( a.y, a.z ) ) ) );
			const depth = reversed ? float( depthA ).add( reach ) : float( depthA ).sub( reach );

			lit.addAssign( cubeTexture( depthTexture, direction ).compare( depth ) );

		} );

		return lit.div( samples );

	} );
