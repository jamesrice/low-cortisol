import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec2, vec3, vec4, mix, smoothstep, saturate,
	abs, pow, dot, normalize, sin, max, time,
	positionWorld, normalWorldGeometry, cameraPosition, cameraViewMatrix,
	lights, mx_noise_float, mx_fractal_noise_float
} from 'three/tsl';
import { createGoboSpotLight, createProceduralEnvironment, TSL } from '../../engine/index.js';

// Ambiently reflective, subtly shimmering frozen-glass ice cyclorama with deep
// sapphire-blue rays shining through the frozen glass, gobo key spotlight,
// icy particle fills, and glacial PMREM reflections.

function buildCyclorama( { floorY, wallZ, coveRadius } ) {

	const halfWidth = 70;
	const front = 30;
	const top = 26;
	const arcSegments = 48;

	const rows = [ { y: floorY, z: front, ny: 1, nz: 0 } ];
	const cy = floorY + coveRadius;
	const cz = wallZ + coveRadius;

	for ( let i = 0; i <= arcSegments; i ++ ) {

		const a = ( i / arcSegments ) * Math.PI * 0.5;
		rows.push( {
			y: cy - Math.cos( a ) * coveRadius,
			z: cz - Math.sin( a ) * coveRadius,
			ny: Math.cos( a ),
			nz: Math.sin( a )
		} );

	}

	rows.push( { y: top, z: wallZ, ny: 0, nz: 1 } );

	const positions = [];
	const normals = [];
	const indices = [];

	for ( const row of rows ) {

		positions.push( - halfWidth, row.y, row.z, halfWidth, row.y, row.z );
		normals.push( 0, row.ny, row.nz, 0, row.ny, row.nz );

	}

	for ( let r = 0; r < rows.length - 1; r ++ ) {

		const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
		indices.push( a, b, d, a, d, c );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setIndex( indices );
	return geometry;

}

export function createSnowLightStudio( { scene, renderer, config, orbLight } ) {

	const { world, light: lightConfig } = config;

	const spotRig = createGoboSpotLight( {
		scene,
		...lightConfig.spot
	} );

	const fillMagenta = new THREE.DirectionalLight( lightConfig.fillMagenta.color, lightConfig.fillMagenta.intensity );
	fillMagenta.position.fromArray( lightConfig.fillMagenta.direction ).multiplyScalar( 20 );

	const fillTeal = new THREE.DirectionalLight( lightConfig.fillTeal.color, lightConfig.fillTeal.intensity );
	fillTeal.position.fromArray( lightConfig.fillTeal.direction ).multiplyScalar( 20 );

	scene.add( fillMagenta, fillTeal );

	const rig = {
		spot: spotRig.spot,
		fillMagenta,
		fillTeal,
		spotPosition: spotRig.uniforms.position,
		spotDirection: spotRig.uniforms.direction,
		spotColor: spotRig.uniforms.color,
		spotConeCos: spotRig.uniforms.coneCos,
		fillMagentaDirection: uniform( new THREE.Vector3().fromArray( lightConfig.fillMagenta.direction ).normalize() ),
		fillMagentaColor: uniform( new THREE.Color( lightConfig.fillMagenta.color ).multiplyScalar( lightConfig.fillMagenta.intensity ) ),
		fillTealDirection: uniform( new THREE.Vector3().fromArray( lightConfig.fillTeal.direction ).normalize() ),
		fillTealColor: uniform( new THREE.Color( lightConfig.fillTeal.color ).multiplyScalar( lightConfig.fillTeal.intensity ) )
	};

	const envTarget = createProceduralEnvironment( renderer, {
		background: 0x01040a,
		sigma: 0.04,
		cards: [
			{ width: 7, height: 7, color: 0xfff1de, intensity: 8.0, position: [ 8, 10, 3 ] },
			{ width: 10, height: 12, color: 0x1b6eff, intensity: 3.4, position: [ - 10, 9, - 5 ] },
			{ width: 12, height: 4, color: 0x4bc4ff, intensity: 2.4, position: [ - 2, 12, - 7 ] },
			{ width: 4, height: 12, color: 0x7b98ff, intensity: 1.8, position: [ - 12, 3, 5 ] },
			{ width: 10, height: 3, color: 0x38b8ff, intensity: 1.8, position: [ 8, - 9, 5 ] },
			{ width: 8, height: 2, color: 0x78b8ff, intensity: 0.85, position: [ 0, 8, 14 ] }
		]
	} );

	const uReveal = uniform( 0 );
	const uRayIntensity = uniform( 1.0 );
	const uGustFlash = uniform( 0.0 );
	const geometry = buildCyclorama( world );
	const material = new THREE.MeshStandardNodeMaterial( { metalness: 0 } );

	// ---------------------------------------- Frozen-Glass & Dark Glacial Ice
	const floorness = smoothstep( 0.25, 0.96, normalWorldGeometry.y ).toVar();
	const wallness = smoothstep( 0.2, 0.92, normalWorldGeometry.z ).toVar();

	const p = positionWorld;

	// Vertical fluted frozen-glass pane texture + organic misty frost clouds (no contour lines)
	const broadIce = mx_fractal_noise_float( p.mul( 0.24 ), 3, 2.1, 0.52 ).toVar();
	const frostCloud = mx_fractal_noise_float(
		vec3( p.x.mul( 0.72 ), p.y.mul( 0.52 ), p.z.mul( 0.72 ) ),
		3, 2.2, 0.54
	).toVar();
	const glassFlute = mx_fractal_noise_float(
		vec3( p.x.mul( 2.4 ), p.y.mul( 0.34 ), p.z.mul( 1.2 ) ),
		3, 2.1, 0.5
	).toVar();
	const microFrost = mx_noise_float( p.mul( 5.2 ) ).toVar();

	// Smooth analytical ice ripples + vertical frozen-glass refraction gradient
	const macroGrad = TSL.noiseGradient( p.mul( 0.36 ) );
	const fluteGrad = TSL.noiseGradient( vec3( p.x.mul( 2.2 ), p.y.mul( 0.38 ), p.z.mul( 1.4 ) ) );
	const fineGrad = TSL.noiseGradient( p.mul( 3.2 ) );
	const wallBump = macroGrad.mul( 0.45 ).add( fluteGrad.mul( 0.42 ) ).add( fineGrad.mul( 0.13 ) ).mul( 0.085 );
	const floorBump = macroGrad.mul( 0.55 ).add( fineGrad.mul( 0.45 ) ).mul( 0.032 );
	const perturbedWorldNormal = normalize( normalWorldGeometry.sub( mix( wallBump, floorBump, floorness ) ) ).toVar();

	material.normalNode = perturbedWorldNormal.transformDirection( cameraViewMatrix );

	material.colorNode = Fn( () => {

		// Deep nocturnal obsidian-glacial ice so snow & blue rays pop cleanly
		const wallIce = vec3( 0.012, 0.030, 0.068 );
		const floorIce = vec3( 0.010, 0.024, 0.052 );
		const frostHighlight = vec3( 0.048, 0.112, 0.215 );

		const base = mix( wallIce, floorIce, floorness );
		const frosted = smoothstep( 0.08, 0.68, frostCloud.mul( 0.65 ).add( glassFlute.mul( 0.35 ) ) );
		const tinted = mix( base, frostHighlight, frosted.mul( 0.45 ) );
		const grain = float( 1 ).add( broadIce.mul( 0.18 ) ).add( microFrost.mul( 0.06 ) );

		return vec4( tinted.mul( grain ), 1 );

	} )();

	// Mirror-like dark ice floor + softly frosted frozen glass backdrop
	material.roughnessNode = mix( float( 0.24 ), float( 0.09 ), floorness )
		.add( smoothstep( - 0.2, 0.6, frostCloud ).mul( 0.14 ) )
		.add( abs( glassFlute ).mul( 0.06 ) )
		.clamp( 0.06, 0.44 );

	material.metalnessNode = mix( float( 0.14 ), float( 0.28 ), floorness )
		.clamp( 0.08, 0.34 );

	material.emissiveNode = Fn( () => {

		const viewDir = normalize( cameraPosition.sub( p ) ).toVar();
		const ndv = saturate( dot( perturbedWorldNormal, viewDir ) ).toVar();
		const fresnel = pow( ndv.oneMinus(), 3.2 ).toVar();

		// Frozen-glass refractive distortion bends the blue rays shining from behind
		const refractXY = p.xy
			.add( vec2( fluteGrad.x.mul( 0.36 ), fluteGrad.y.mul( 0.14 ) ) )
			.add( macroGrad.xy.mul( 0.28 ) )
			.toVar();

		// Crisp, deep crepuscular blue rays piercing through the frozen glass
		const blueRayFan = ( slopeX, originX, freq, drift, offset, width ) => {

			const along = refractXY.x.sub( originX ).add( refractXY.y.mul( slopeX ) );
			const primary = mx_noise_float( vec2( along.mul( freq ).add( offset ), time.mul( drift ).add( offset ) ) );
			const detail = mx_noise_float( vec2( along.mul( freq * 2.4 ).sub( offset ), time.mul( drift * 1.3 ).add( 4.1 ) ) );
			const shafts = pow( saturate( primary.mul( 0.64 ).add( detail.mul( 0.36 ) ).mul( 0.92 ).add( 0.32 ) ), 3.4 );
			const vertical = smoothstep( - 2.4, 3.6, p.y.add( broadIce.mul( 0.4 ) ) );
			const envelope = smoothstep( width, 0.4, abs( along ) );
			return shafts.mul( vertical ).mul( envelope );

		};

		const rayLeft = blueRayFan( - 0.58, - 2.6, 0.72, 0.042, 1.4, 7.5 );
		const rayCenter = blueRayFan( - 0.44, 0.6, 0.85, 0.034, 6.8, 7.0 ).mul( 0.88 );
		const rayFar = blueRayFan( - 0.66, - 5.2, 0.54, 0.026, 12.1, 8.5 ).mul( 0.72 );
		const rays = rayLeft.add( rayCenter ).add( rayFar ).toVar();

		// Subtle frosted-glass light scatter where rays pass through thicker crystalline ribs
		const glassScatter = float( 0.65 ).add( smoothstep( - 0.1, 0.65, glassFlute ).mul( 0.55 ) )
			.add( smoothstep( 0.05, 0.7, frostCloud ).mul( 0.35 ) );

		const deepBackGlow = smoothstep( - 2.6, 5.5, p.y )
			.mul( smoothstep( 12.5, 0.0, abs( p.x.add( 1.6 ) ) ) )
			.mul( 0.16 );

		const transmittedRays = vec3( 0.025, 0.14, 0.52 ).mul( deepBackGlow.add( rays.mul( 0.55 ) ) )
			.add( vec3( 0.12, 0.48, 0.98 ).mul( rays.mul( glassScatter ).mul( 0.44 ) ) )
			.add( vec3( 0.48, 0.82, 1.0 ).mul( pow( saturate( rays ), 2.2 ).mul( glassScatter ).mul( 0.24 ) ) );

		// Reflected sapphire ray wash mirrored softly on the dark polished ice floor
		const mirrorAlong = p.x.add( 1.2 ).add( p.z.mul( 0.22 ) ).add( macroGrad.x.mul( 0.45 ) );
		const floorRayNoise = mx_noise_float( vec2( mirrorAlong.mul( 0.55 ), p.z.mul( 0.22 ).sub( time.mul( 0.04 ) ) ) );
		const floorRayBand = pow( saturate( floorRayNoise.mul( 0.75 ).add( 0.38 ) ), 2.6 )
			.mul( smoothstep( 9.5, 0.5, abs( p.x.add( 0.8 ) ) ) )
			.mul( smoothstep( 4.0, - 5.0, p.z ) );
		const floorReflection = vec3( 0.03, 0.18, 0.56 )
			.mul( floorRayBand.mul( 0.28 ).add( 0.02 ) )
			.mul( floorness );

		// Magically slight shimmering ice: subtle glacial iridescence + delicate diamond-dust glints
		const shimmerWave = sin( p.x.mul( 0.5 ).add( p.y.mul( 0.36 ) ).sub( time.mul( 0.32 ) ).add( broadIce.mul( 2.8 ) ) )
			.mul( 0.5 ).add( 0.5 );
		const glazeTint = mix( vec3( 0.07, 0.28, 0.65 ), vec3( 0.34, 0.72, 1.0 ), shimmerWave );
		// Keep Fresnel glaze delicate and avoid creating a bright horizontal stripe across the cove
		const iceGlaze = glazeTint.mul( fresnel ).mul( mix( float( 0.09 ), float( 0.12 ), floorness ) );

		// Quiet, crystalline view-dependent ice micro-sparkles (magically slight)
		const glintA = mx_noise_float( p.mul( 5.8 ).add( viewDir.mul( 3.2 ) ).add( vec3( 0, time.mul( 0.06 ), 0 ) ) );
		const glintB = mx_noise_float( p.mul( 11.4 ).sub( viewDir.mul( 2.8 ) ).add( vec3( time.mul( 0.05 ), 0, 0 ) ) );
		const sparkle = pow( saturate( glintA.mul( 0.55 ).add( glintB.mul( 0.45 ) ).mul( 0.78 ).add( 0.22 ) ), 16.0 );
		const sparkleMask = float( 0.22 ).add( rays.mul( 0.75 ) ).add( floorRayBand.mul( 0.45 ) );
		const magicShimmer = mix( vec3( 0.45, 0.80, 1.0 ), vec3( 0.90, 0.96, 1.0 ), shimmerWave )
			.mul( sparkle ).mul( sparkleMask ).mul( 0.58 );

		const total = transmittedRays.mul( wallness ).mul( uRayIntensity )
			.add( floorReflection.mul( uRayIntensity ) )
			.add( iceGlaze.mul( float( 0.65 ).add( uRayIntensity.mul( 0.35 ) ) ) )
			.add( magicShimmer.mul( float( 0.55 ).add( uRayIntensity.mul( 0.45 ) ).add( uGustFlash.mul( 1.4 ) ) ) )
			.add( vec3( 0.22, 0.58, 1.0 ).mul( uGustFlash.mul( 0.22 ).mul( wallness.add( floorness.mul( 0.45 ) ) ) ) );

		return max( total, vec3( 0 ) ).mul( uReveal );

	} )();

	material.envMap = envTarget.texture;
	material.envMapIntensity = 0.92;
	material.lightsNode = lights( [ orbLight, spotRig.spot, fillTeal ] );

	const backdrop = new THREE.Mesh( geometry, material );
	backdrop.receiveShadow = true;
	backdrop.frustumCulled = false;
	scene.add( backdrop );

	let gustFlash = 0;

	function setRayIntensity( scale ) {

		uRayIntensity.value = THREE.MathUtils.clamp( scale, 0.15, 2.5 );

	}

	function flashGust( strength = 1.0 ) {

		gustFlash = Math.max( gustFlash, strength );

	}

	function update( reveal = 1, dt = 1 / 60 ) {

		uReveal.value = reveal;
		if ( gustFlash > 0.001 ) {

			gustFlash = Math.max( 0, gustFlash - dt * 1.4 );

		}
		uGustFlash.value = gustFlash;

	}

	function dispose() {

		if ( backdrop.parent ) backdrop.parent.remove( backdrop );
		geometry.dispose();
		material.dispose();
		envTarget.dispose();

	}

	return { backdrop, rig, environment: envTarget.texture, setRayIntensity, flashGust, update, dispose };

}
