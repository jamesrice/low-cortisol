import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec2, vec3, vec4, mix, sin, cos, exp, abs,
	smoothstep, saturate, uv, attribute, positionLocal, normalLocal,
	mx_noise_float, lights, time
} from 'three/tsl';

// Procedural curved macro canine back/shoulder/flank surface, shared breed coat-marking
// logic, gentle living breathing motion, and warm sunlit room bokeh backdrop.

const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();
const _tU = new THREE.Vector3();
const _tV = new THREE.Vector3();

/**
 * Fast deterministic 2D smooth value noise + 2-octave organic fBM on CPU.
 * Shared identically by the body undercoat mesh and every 3D fur strand root
 * so breed markings match 100% seamlessly with zero fragment-shader noise cost.
 */
function hash2( ix, iy ) {

	const s = Math.sin( ix * 127.1 + iy * 311.7 ) * 43758.5453123;
	return s - Math.floor( s );

}

function valueNoise2D( x, y ) {

	const ix = Math.floor( x );
	const iy = Math.floor( y );
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * ( 3 - 2 * fx );
	const uy = fy * fy * ( 3 - 2 * fy );

	const a = hash2( ix, iy );
	const b = hash2( ix + 1, iy );
	const c = hash2( ix, iy + 1 );
	const d = hash2( ix + 1, iy + 1 );

	return ( a + ( b - a ) * ux ) + ( ( c - a ) + ( a - b - c + d ) * ux ) * uy;

}

function smoothstepJS( e0, e1, x ) {

	const t = Math.max( 0, Math.min( 1, ( x - e0 ) / ( e1 - e0 ) ) );
	return t * t * ( 3 - 2 * t );

}

/**
 * Evaluate exact organic breed coat masks at canine surface coordinate (u, v) in [-1, 1]^2:
 *   x = huskySaddleMask (0 = snow-white flank, 1 = charcoal/silver agouti mantle)
 *   y = bernWhiteMask   (0..1 snow-white front chest blaze / collar ruff)
 *   z = bernRustMask    (0..1 rich warm mahogany/rust shoulder & upper-leg crescent)
 */
export function evalBreedMasks( u, v ) {

	const nMacro = valueNoise2D( u * 2.4 + 4.1, v * 2.6 - 1.7 ) * 2 - 1;
	const nFine = valueNoise2D( u * 8.6 - 2.3, v * 9.2 + 5.4 ) * 2 - 1;
	const organic = nMacro * 0.14 + nFine * 0.045;

	// Husky dorsal mantle line: bold wolf-charcoal saddle across the upper back curving into snowy flank
	const saddleCurve = - 0.24
		+ Math.sin( u * 2.0 + 0.45 ) * 0.14
		+ smoothstepJS( - 0.12, - 0.78, u ) * 0.34
		+ organic;
	const huskySaddle = smoothstepJS( saddleCurve - 0.20, saddleCurve + 0.18, v );

	// Bernese Mountain Dog tricolor:
	//   1. Silky snow-white chest ruff sweeping in from front-left shoulder/chest corner
	const whiteEdge = - 0.44 - v * 0.46 + organic * 0.80;
	const bernWhite = smoothstepJS( whiteEdge + 0.09, whiteEdge - 0.07, u );

	//   2. Bold deep mahogany/rust shoulder crescent sitting cleanly between white chest blaze & jet-black mantle
	const ru = ( u + 0.20 ) * 1.48;
	const rv = ( v + 0.36 ) * 1.72;
	const rustEllip = ru * ru + rv * rv;
	const rustBand = smoothstepJS( 0.46, 0.14, rustEllip + organic * 0.48 );
	const rustBorder = smoothstepJS( 0.22, 0.02, Math.abs( u - whiteEdge - 0.13 ) )
		* smoothstepJS( 0.32, - 0.20, v );
	const bernRust = Math.max( 0, Math.min( 1, Math.max( rustBand, rustBorder * 0.90 ) ) ) * ( 1 - bernWhite );

	return { huskySaddle, bernWhite, bernRust };

}

/**
 * Evaluate exact 3D rest position on the dog's curved upper back, shoulder, and flank.
 *   u in [-1, 1]: neck/withers (left) -> mid-back/hip (right)
 *   v in [-1.12, 1]: extended lower near flank -> sunlit upper spine crest -> far slope
 */
export function evalDogPosition( u, v, out = new THREE.Vector3() ) {

	const x = u * 2.38;

	const shoulderLift = 0.17 * Math.exp( - Math.pow( ( u + 0.34 ) / 0.48, 2 ) );
	const hipRise = 0.08 * Math.exp( - Math.pow( ( u - 0.78 ) / 0.56, 2 ) );
	const neckTaper = - 0.11 * Math.max( 0, - ( u + 0.74 ) );
	const spineArc = shoulderLift + hipRise + neckTaper - 0.035 * u * u;

	const barrelY = 1.24 + 0.13 * Math.exp( - Math.pow( ( u + 0.20 ) / 0.68, 2 ) );
	const barrelZ = 1.16 + 0.11 * Math.exp( - Math.pow( ( u + 0.18 ) / 0.72, 2 ) );

	const scapula = 0.028 * Math.exp( - Math.pow( ( u + 0.38 ) / 0.30, 2 ) - Math.pow( ( v - 0.12 ) / 0.44, 2 ) );
	const ribRoll = 0.016 * Math.sin( u * 3.4 + 0.5 ) * Math.cos( v * 1.9 );
	const radialOffset = scapula + ribRoll;

	const cy = - 0.66 + spineArc;
	const cz = - 0.26 - 0.16 * u * u;

	const theta = 0.52 + v * 1.20;
	const y = cy + ( barrelY + radialOffset ) * Math.sin( theta );
	const z = cz + ( barrelZ + radialOffset ) * Math.cos( theta );

	return out.set( x, y, z );

}

/**
 * Evaluate rest position, outward unit normal, and natural coat-flow tangent on the dog's body.
 */
export function evalDogSurface( u, v, outPos, outNorm, outFlow ) {

	evalDogPosition( u, v, outPos );

	const eps = 0.004;
	evalDogPosition( u + eps, v, _pA );
	evalDogPosition( u - eps, v, _pB );
	_tU.subVectors( _pA, _pB ).normalize();

	evalDogPosition( u, v + eps, _pA );
	evalDogPosition( u, v - eps, _pB );
	_tV.subVectors( _pA, _pB ).normalize();

	outNorm.crossVectors( _tU, _tV ).normalize();
	if ( outNorm.y < - 0.25 && outNorm.z < 0 ) outNorm.negate();

	if ( outFlow ) {

		const flankCascade = - 0.28 * Math.max( 0, 0.55 - v ) - 0.08;
		const whorlDist = Math.hypot( u + 0.46, v - 0.08 );
		const whorlBias = 0.24 * Math.exp( - whorlDist * whorlDist * 8.5 );

		outFlow.copy( _tU )
			.multiplyScalar( 1.0 - whorlBias * 0.35 )
			.addScaledVector( _tV, flankCascade - whorlBias * 0.42 );

		outFlow.addScaledVector( outNorm, - outFlow.dot( outNorm ) ).normalize();

	}

	return outPos;

}

/**
 * Shared analytical breathing factor (evaluated identically on CPU, body vertex shader,
 * and fur compute/vertex shaders so hair roots remain locked to the skin).
 */
export function evalBreathAmount( elapsed ) {

	const phase = elapsed * 1.38;
	return 0.5 + 0.5 * Math.sin( phase - 0.35 * Math.sin( phase ) );

}

/**
 * Fast, noise-free TSL breed coat color blender driven by precomputed organic masks
 * (`masks = vec3(huskySaddle, bernWhite, bernRust)`).
 */
export function evalBreedCoatFromMasksTSL( masks, tipT, isGuard, seed, uLab, uHusky, uBernese ) {

	const saddleMask = masks.x;
	const bernWhiteMask = masks.y;
	const bernRustMask = masks.z;

	const tMid = smoothstep( 0.0, 0.48, tipT ).toVar();
	const tTip = smoothstep( 0.48, 1.0, tipT ).toVar();

	// 1. Black Labrador: true deep velvety obsidian-black with subtle warm seal-espresso depth
	const labUnder = vec3( 0.003, 0.003, 0.0035 );
	const labMid = mix( vec3( 0.005, 0.005, 0.0055 ), vec3( 0.009, 0.0085, 0.0085 ), seed );
	const labTip = mix( vec3( 0.009, 0.0085, 0.009 ), vec3( 0.015, 0.014, 0.014 ), seed.mul( 0.65 ).add( isGuard.mul( 0.35 ) ) );
	const labCol = mix( mix( labUnder, labMid, tMid ), labTip, tTip );

	// 2. Siberian Husky: rich dark wolf-charcoal & silver agouti dorsal mantle + textured snow-white plush flank
	const huskyWhiteRoot = vec3( 0.48, 0.47, 0.45 );
	const huskyWhiteTip = mix( vec3( 0.74, 0.73, 0.71 ), vec3( 0.86, 0.85, 0.83 ), seed );
	const huskyWhite = mix( huskyWhiteRoot, huskyWhiteTip, smoothstep( 0.0, 0.85, tipT ) );

	const darkGuard = smoothstep( 0.24, 0.78, isGuard.mul( 0.72 ).add( seed.mul( 0.28 ) ) );
	const mantleUnder = vec3( 0.36, 0.35, 0.33 );
	const mantleMid = mix( vec3( 0.16, 0.17, 0.19 ), vec3( 0.022, 0.025, 0.032 ), darkGuard );
	const mantleTip = mix( vec3( 0.38, 0.40, 0.43 ), vec3( 0.014, 0.016, 0.021 ), darkGuard.mul( 0.84 ) );
	const agouti = mix( mix( mantleUnder, mantleMid, smoothstep( 0.20, 0.58, tipT ) ), mantleTip, smoothstep( 0.60, 0.94, tipT ) );
	const huskyMantle = mix( mix( mantleUnder, vec3( 0.22, 0.23, 0.25 ), tipT.mul( 0.60 ) ), agouti, smoothstep( 0.18, 0.72, isGuard ) );
	const huskyCol = mix( huskyWhite, huskyMantle, saddleMask );
	const huskyUnder = mix( huskyWhiteRoot, mantleUnder, saddleMask );

	// 3. Bernese Mountain Dog: true jet-black silky mantle + deep mahogany-rust shoulder + textured snow-white chest blaze
	const bernBlackRoot = vec3( 0.005, 0.005, 0.006 );
	const bernBlackMid = mix( vec3( 0.009, 0.009, 0.011 ), vec3( 0.015, 0.014, 0.018 ), seed );
	const bernBlackTip = mix( vec3( 0.016, 0.015, 0.019 ), vec3( 0.026, 0.024, 0.030 ), seed );
	const bernBlack = mix( mix( bernBlackRoot, bernBlackMid, tMid ), bernBlackTip, tTip );

	const bernRustRoot = vec3( 0.12, 0.030, 0.005 );
	const bernRustMid = mix( vec3( 0.28, 0.075, 0.012 ), vec3( 0.38, 0.115, 0.018 ), seed );
	const bernRustTip = mix( vec3( 0.38, 0.115, 0.020 ), vec3( 0.52, 0.175, 0.032 ), seed );
	const bernRust = mix( mix( bernRustRoot, bernRustMid, tMid ), bernRustTip, tTip );

	const bernWhiteRoot = vec3( 0.42, 0.40, 0.37 );
	const bernWhiteTip = mix( vec3( 0.62, 0.60, 0.57 ), vec3( 0.76, 0.74, 0.71 ), seed );
	const bernWhite = mix( bernWhiteRoot, bernWhiteTip, smoothstep( 0.0, 0.78, tipT ) );

	const bernCol = mix( mix( bernBlack, bernRust, bernRustMask ), bernWhite, bernWhiteMask );
	const bernUnder = mix( mix( bernBlackRoot, bernRustRoot, bernRustMask ), bernWhiteRoot, bernWhiteMask );

	const color = labCol.mul( uLab ).add( huskyCol.mul( uHusky ) ).add( bernCol.mul( uBernese ) );
	const undercoat = labUnder.mul( uLab ).add( huskyUnder.mul( uHusky ) ).add( bernUnder.mul( uBernese ) );

	return { color, undercoat };

}

/**
 * Build the smooth curved canine undercoat body mesh plus a softly lit out-of-focus
 * sunlit room depth backdrop behind the silhouette.
 */
export function createDogBody( { scene, config, environment, sceneLights } ) {

	const segU = 56;
	const segV = 40;
	const positions = [];
	const normals = [];
	const uvs = [];
	const breedMasks = [];
	const indices = [];

	const p = new THREE.Vector3();
	const n = new THREE.Vector3();

	for ( let iv = 0; iv <= segV; iv ++ ) {

		const v = - 1.16 + ( iv / segV ) * 2.16;
		for ( let iu = 0; iu <= segU; iu ++ ) {

			const u = ( iu / segU ) * 2 - 1;
			evalDogSurface( u, v, p, n, null );
			positions.push( p.x, p.y, p.z );
			normals.push( n.x, n.y, n.z );
			uvs.push( u, v );
			const m = evalBreedMasks( u, v );
			breedMasks.push( m.huskySaddle, m.bernWhite, m.bernRust );

		}

	}

	const stride = segU + 1;
	for ( let iv = 0; iv < segV; iv ++ ) {

		for ( let iu = 0; iu < segU; iu ++ ) {

			const a = iv * stride + iu;
			const b = a + 1;
			const c = a + stride;
			const d = c + 1;
			indices.push( a, b, c, b, d, c );

		}

	}

	const bodyGeom = new THREE.BufferGeometry();
	bodyGeom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	bodyGeom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	bodyGeom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	bodyGeom.setAttribute( 'aBreedMasks', new THREE.Float32BufferAttribute( breedMasks, 3 ) );
	bodyGeom.setIndex( indices );

	const uBreath = uniform( 0.5 );
	const uBreedLab = uniform( 1.0 );
	const uBreedHusky = uniform( 0.0 );
	const uBreedBernese = uniform( 0.0 );
	const uSunWarmth = uniform( 1.0 );

	const bodyMat = new THREE.MeshStandardNodeMaterial( {
		roughness: 0.94,
		metalness: 0.0
	} );

	bodyMat.positionNode = Fn( () => {

		const coatU = positionLocal.x.div( 2.38 );
		const ribEnvelope = smoothstep( 1.05, 0.15, abs( coatU.add( 0.05 ) ) )
			.mul( smoothstep( - 0.95, 0.45, positionLocal.y ) );
		const lift = uBreath.mul( 0.032 ).mul( ribEnvelope );
		return positionLocal.add( normalLocal.mul( lift ) );

	} )();

	bodyMat.colorNode = Fn( () => {

		const masks = attribute( 'aBreedMasks', 'vec3' );
		const { undercoat } = evalBreedCoatFromMasksTSL(
			masks,
			float( 0.18 ),
			float( 0.2 ),
			float( 0.45 ),
			uBreedLab,
			uBreedHusky,
			uBreedBernese
		);

		return vec4( undercoat.mul( 0.72 ), 1 );

	} )();

	bodyMat.lightsNode = lights( sceneLights );
	bodyMat.envMap = environment;
	bodyMat.envMapIntensity = 0.22;

	const bodyMesh = new THREE.Mesh( bodyGeom, bodyMat );
	bodyMesh.receiveShadow = true;
	bodyMesh.castShadow = true;
	scene.add( bodyMesh );

	// ---- Dreamy golden-hour sunlit room backdrop behind the dog's backlit silhouette ----
	const bgGeom = new THREE.PlaneGeometry( 18, 10, 1, 1 );
	const bgMat = new THREE.MeshBasicNodeMaterial( { depthWrite: false } );
	bgMat.colorNode = Fn( () => {

		const st = uv();
		const baseRoom = mix( vec3( 0.018, 0.013, 0.010 ), vec3( 0.068, 0.044, 0.025 ), smoothstep( 0.15, 0.92, st.y ) );

		const diag = st.x.mul( 1.2 ).add( st.y.mul( 0.72 ) );
		const drift = time.mul( 0.03 );
		const barA = smoothstep( 0.0, 0.55, sin( diag.mul( 5.4 ).add( 0.8 ) ).mul( 0.5 ).add( 0.5 ) );
		const barB = mx_noise_float( vec2( diag.mul( 2.8 ).add( drift ), st.y.mul( 1.6 ) ) ).mul( 0.5 ).add( 0.5 );
		const windowGlow = exp( st.x.sub( 0.26 ).pow( 2 ).mul( - 3.6 ) )
			.mul( smoothstep( 0.25, 0.88, st.y ) )
			.mul( barA.mul( 0.65 ).add( barB.mul( 0.35 ) ) );

		const orbA = exp( st.sub( vec2( 0.22, 0.76 ) ).length().pow( 2 ).mul( - 18.0 ) ).mul( 0.22 );
		const orbB = exp( st.sub( vec2( 0.68, 0.80 ) ).length().pow( 2 ).mul( - 24.0 ) ).mul( 0.14 );
		const orbC = exp( st.sub( vec2( 0.44, 0.86 ) ).length().pow( 2 ).mul( - 28.0 ) ).mul( 0.16 );

		const warmTone = mix( vec3( 0.35, 0.46, 0.64 ), vec3( 0.96, 0.64, 0.30 ), saturate( uSunWarmth.mul( 0.62 ) ) );
		const goldBloom = warmTone.mul( windowGlow.mul( 0.28 ).add( orbA.add( orbB ).add( orbC ).mul( 0.48 ) ) ).mul( uSunWarmth );

		return vec4( baseRoom.add( goldBloom ), 1 );

	} )();

	const backdrop = new THREE.Mesh( bgGeom, bgMat );
	backdrop.position.set( 0, 0.35, - 4.4 );
	backdrop.renderOrder = - 10;
	scene.add( backdrop );

	function setBreedWeights( lab, husky, bernese ) {

		uBreedLab.value = lab;
		uBreedHusky.value = husky;
		uBreedBernese.value = bernese;

	}

	function setSunWarmth( warmth ) {

		uSunWarmth.value = warmth;

	}

	function update( elapsed ) {

		uBreath.value = evalBreathAmount( elapsed );

	}

	function dispose() {

		if ( bodyMesh.parent ) bodyMesh.parent.remove( bodyMesh );
		if ( backdrop.parent ) backdrop.parent.remove( backdrop );
		bodyGeom.dispose();
		bodyMat.dispose();
		bgGeom.dispose();
		bgMat.dispose();

	}

	return {
		mesh: bodyMesh,
		backdrop,
		uniforms: { uBreath, uBreedLab, uBreedHusky, uBreedBernese, uSunWarmth },
		setBreedWeights,
		setSunWarmth,
		update,
		dispose
	};

}
