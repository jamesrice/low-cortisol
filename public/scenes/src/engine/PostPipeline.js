import * as THREE from 'three/webgpu';
import {
	Fn, pass, uniform, float, vec2, vec3, vec4, uv, dot, sqrt, atan, max, length, mix, smoothstep, fract, sin,
	getViewPosition, convertToTexture, renderOutput, screenCoordinate
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createDepthOfField } from './DepthOfField.js';

// Unified HDR WebGPU post-processing pipeline:
//
//   solid scene (HDR) → optional closed-form point haze → 3-pass Vogel DoF ┐
//   overlay scene (depth-tested additive / analytical bokeh particles)  ───┴→ bloom
//               → chromatic aberration → ACES filmic tone map → vignette + grain
//
// Exposes the shared `lens` uniform struct so GPU particle shaders can compute
// analytical per-particle scatter bokeh synchronized with the solid-scene DoF.

export function createPostPipeline( {
	renderer,
	scene,
	overlayScene = null,
	camera,
	config = {},
	dofTaps = 48
} ) {

	const cfg = {
		exposure: 1.0,
		focusDistance: 10.0,
		focusSlab: 0.55,
		focalRange: 3.0,
		bokeh: 11,
		bloomStrength: 0.36,
		bloomRadius: 0.72,
		bloomThreshold: 1.0,
		haze: 0.004,
		chromaticAberration: 0.012,
		vignette: 0.5,
		grain: 0.035,
		enableDoF: true,
		...config
	};

	const pipeline = new THREE.RenderPipeline( renderer );

	const lens = {
		focus: uniform( cfg.focusDistance ),
		focusSlab: uniform( cfg.focusSlab ),
		focalRange: uniform( cfg.focalRange ),
		bokehPx: uniform( cfg.bokeh )
	};

	const scenePass = pass( scene, camera );
	const sceneColor = scenePass.getTextureNode( 'output' );
	const sceneDepth = scenePass.getTextureNode( 'depth' );
	const sceneViewZ = scenePass.getViewZNode();

	let overlayColor = null;

	if ( overlayScene ) {

		const overlayPass = pass( overlayScene, camera, {
			depthTexture: scenePass.renderTarget.depthTexture,
			autoClearDepth: false
		} );
		overlayColor = overlayPass.getTextureNode( 'output' );

	}

	const U = {
		projectionInverse: uniform( camera.projectionMatrixInverse ),
		hazeViewPos: uniform( new THREE.Vector3( 0, 0, - 5 ) ),
		hazeColor: uniform( new THREE.Color( 0, 0, 0 ) ),
		aberration: uniform( cfg.chromaticAberration ),
		vignette: uniform( cfg.vignette ),
		grain: uniform( cfg.grain ),
		frame: uniform( 0 )
	};

	// Closed-form point-light volumetric scattering integral along each view ray up to depth
	const haze = Fn( ( [ st ] ) => {

		const depth = sceneDepth.sample( st ).r;
		const viewPosition = getViewPosition( st, depth, U.projectionInverse );

		const rayLength = length( viewPosition );
		const ray = viewPosition.div( max( rayLength, 1e-4 ) );

		// ∫ 1 / |o + t*d - L|^2 dt from 0 to rayLength
		const b = dot( U.hazeViewPos, ray ).negate();
		const c = dot( U.hazeViewPos, U.hazeViewPos );
		const h = sqrt( max( c.sub( b.mul( b ) ), 2e-3 ) );

		const scatter = atan( rayLength.add( b ).div( h ) ).sub( atan( b.div( h ) ) ).div( h );

		return U.hazeColor.mul( scatter );

	} );

	const sampleLit = ( st ) => sceneColor.sample( st ).rgb.add( haze( st ) );

	let depthOfField = null;
	let solidNode;

	if ( cfg.enableDoF ) {

		depthOfField = createDepthOfField( {
			sampleColor: sampleLit,
			viewZ: sceneViewZ,
			lens,
			taps: dofTaps
		} );
		solidNode = depthOfField.node.rgb;

	} else {

		solidNode = sampleLit( uv() );

	}

	const mergedRgb = overlayColor ? solidNode.add( overlayColor.rgb ) : solidNode;
	const combined = convertToTexture( vec4( mergedRgb, 1 ) );

	const bloomPass = bloom( combined, cfg.bloomStrength, cfg.bloomRadius, cfg.bloomThreshold );
	const bloomColor = bloomPass.getTextureNode();

	const lensColor = Fn( () => {

		const st = uv();
		const centered = st.sub( 0.5 );
		const offset = centered.mul( dot( centered, centered ) ).mul( U.aberration );

		const r = combined.sample( st.add( offset ) ).r.add( bloomColor.sample( st.add( offset ) ).r );
		const g = combined.sample( st ).g.add( bloomColor.sample( st ).g );
		const b = combined.sample( st.sub( offset ) ).b.add( bloomColor.sample( st.sub( offset ) ).b );

		return vec4( r, g, b, 1 );

	} );

	const display = renderOutput( lensColor(), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace );

	const graded = Fn( () => {

		const color = display.rgb.toVar();

		// Optical lens vignette
		const centered = uv().sub( 0.5 );
		const falloff = smoothstep( 0.25, 1.0, length( centered.mul( vec2( 1.0, 1.08 ) ) ).mul( 1.4 ) );
		color.mulAssign( mix( float( 1 ), float( 1 ).sub( U.vignette ), falloff ) );

		// Shadow-weighted film grain (also eliminates 8-bit dark banding)
		const seed = screenCoordinate.xy.add( vec2( U.frame.mul( 37.0 ), U.frame.mul( 17.0 ) ) );
		const noise = fract( sin( dot( seed, vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) ).sub( 0.5 );
		const luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
		color.addAssign( noise.mul( U.grain ).mul( mix( float( 1 ), float( 0.35 ), luma ) ) );

		return vec4( color, 1 );

	} );

	pipeline.outputColorTransform = false;
	pipeline.outputNode = graded();

	const tmpView = new THREE.Vector3();
	const tmpHazeColor = new THREE.Color();
	let frame = 0;

	/**
	 * Update lens focus distance, volumetric haze light source, and per-frame dither seed.
	 */
	function update( {
		focusWorldPoint = null,
		focusDistance = null,
		hazeWorldPos = null,
		hazeLightColor = null,
		hazeIntensity = 0
	} = {} ) {

		if ( focusWorldPoint ) {

			tmpView.copy( focusWorldPoint ).applyMatrix4( camera.matrixWorldInverse );
			lens.focus.value = Math.max( 0.35, - tmpView.z );

		} else if ( focusDistance !== null ) {

			lens.focus.value = Math.max( 0.35, focusDistance );

		}

		if ( hazeWorldPos && hazeLightColor && hazeIntensity > 0 ) {

			tmpView.copy( hazeWorldPos ).applyMatrix4( camera.matrixWorldInverse );
			U.hazeViewPos.value.copy( tmpView );
			tmpHazeColor.copy( hazeLightColor ).multiplyScalar( hazeIntensity * cfg.haze );
			U.hazeColor.value.copy( tmpHazeColor );

		} else {

			U.hazeColor.value.setRGB( 0, 0, 0 );

		}

		frame = ( frame + 1 ) % 1024;
		U.frame.value = frame;

	}

	function setSize( width, height, scale = 1 ) {

		lens.bokehPx.value = cfg.bokeh * ( ( height * scale ) / 1080 );
		if ( depthOfField ) depthOfField.setSize( width, height );

	}

	function render() {

		pipeline.render();

	}

	function dispose() {

		if ( depthOfField ) depthOfField.dispose();
		pipeline.dispose();

	}

	return {
		pipeline,
		lens,
		uniforms: U,
		bloomPass,
		config: cfg,
		update,
		setSize,
		render,
		dispose
	};

}
