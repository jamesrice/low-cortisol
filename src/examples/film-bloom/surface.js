import * as THREE from 'three/webgpu';
import {
	Fn, uniform, float, vec2, vec3, vec4, texture, mix, smoothstep, saturate,
	max, abs, pow, dot, length, normalize,
	positionLocal, positionWorld, cameraPosition, modelWorldMatrix,
	mx_noise_float, lights
} from 'three/tsl';
import {
	evalThinFilmSpectrumTSL,
	evalFilmCosThetaTSL,
	evalFresnelTSL,
	evalMicroVeinedReliefTSL,
	evalFractureNetworkTSL
} from './optics.js';

// 3D Still Lake Surface + Thin-Film Interference Shader + Falling Liquid Droplets +
// Impact Meniscus Crown Rings + Hold-to-Swell Suspended Droplet Preview.

const MODE_TARGETS = {
	lake: { lake: 1, veined: 0, fracture: 0 },
	veined: { lake: 0, veined: 1, fracture: 0 },
	fracture: { lake: 0, veined: 0, fracture: 1 }
};

export function createFilmSurface( {
	scene,
	config,
	quality,
	sim,
	environment,
	sceneLights,
	keyLightPos,
	rimLightPos
} ) {

	const surfCfg = config.surface;
	const lakeGroup = new THREE.Group();
	lakeGroup.rotation.x = surfCfg.tiltX;
	scene.add( lakeGroup );

	// ---- Uniforms ----
	const uTime = uniform( 0 );
	const uReveal = uniform( 0 );
	const uThicknessScale = uniform( config.interaction.defaultThickness );
	const uModeLake = uniform( 1.0 );
	const uModeVeined = uniform( 0.0 );
	const uModeFracture = uniform( 0.0 );
	const uKeyPos = uniform( keyLightPos.clone() );
	const uRimPos = uniform( rimLightPos.clone() );
	const uFilmIOR = uniform( surfCfg.filmIOR );
	const uSimSpan = uniform( surfCfg.simSpan );
	const uSimHalf = uniform( surfCfg.simSpan * 0.5 );

	let modeTarget = MODE_TARGETS[ surfCfg.defaultMode ] || MODE_TARGETS.lake;
	const modeWeights = { ...modeTarget };

	// ---- Displaced Still Lake Geometry (local XZ plane, +Y up) ----
	const segs = quality.meshSegs || 144;
	const lakeGeom = new THREE.PlaneGeometry( surfCfg.meshSize, surfCfg.meshSize, segs, segs );
	lakeGeom.rotateX( - Math.PI * 0.5 );

	const waveTexNode = texture( sim.waveTex );
	const filmTexNode = texture( sim.filmTex );

	// Helper: convert local XZ point -> clamped simulation UV + smooth outer boundary mask
	const evalSimUv = Fn( ( [ xz ] ) => {

		const raw = xz.add( uSimHalf ).div( uSimSpan );
		const clamped = saturate( raw );
		const edgeDist = max( abs( raw.x.sub( 0.5 ) ), abs( raw.y.sub( 0.5 ) ) );
		const fade = float( 1.0 ).sub( smoothstep( float( 0.42 ), float( 0.50 ), edgeDist ) );
		return vec3( clamped.x, clamped.y, fade );

	} );

	const lakeMaterial = new THREE.MeshBasicNodeMaterial();

	// Real-time 3D capillary wave displacement on the lake mesh vertices
	lakeMaterial.positionNode = Fn( () => {

		const pos = positionLocal.toVar();
		const suv = evalSimUv( pos.xz );
		const wSample = waveTexNode.sample( suv.xy );
		// Gentle physical vertical elevation for real 3D ripple crests & drop dimples
		const dispY = wSample.r.mul( 0.145 ).mul( suv.z );
		return vec3( pos.x, pos.y.add( dispY ), pos.z );

	} )();

	// Shared physical thin-film optical evaluation computed per fragment
	const evalFilmSurface = Fn( () => {

		const localXZ = positionLocal.xz.toVar();
		const suv = evalSimUv( localXZ ).toVar();
		const simMask = suv.z;

		const wData = waveTexNode.sample( suv.xy ).toVar();
		const fData = filmTexNode.sample( suv.xy ).toVar();

		const hVal = wData.r.mul( simMask );
		const dhdx = wData.g.mul( simMask );
		const dhdz = wData.b.mul( simMask );
		const crownGlow = wData.a.mul( simMask );

		const rawFilmUm = fData.r.mul( simMask ).toVar();
		const flowXZ = fData.gb.mul( simMask ).toVar();
		const bloomAmt = saturate( fData.a.mul( simMask ) ).toVar();

		// Sub-pixel infinite-resolution Marangoni feathering & silky micro-swirl
		// Advected slightly backward along live surface velocity so plumes stay razor-sharp at 4K
		const swirlCoord = localXZ.sub( flowXZ.mul( 0.52 ) ).toVar();
		const nLarge = mx_noise_float( vec3( swirlCoord.x.mul( 2.1 ), swirlCoord.y.mul( 2.1 ), uTime.mul( 0.13 ) ) );
		const nMid = mx_noise_float( vec3( swirlCoord.x.mul( 5.2 ).add( nLarge.mul( 1.25 ) ), swirlCoord.y.mul( 5.2 ).sub( nLarge.mul( 1.05 ) ), uTime.mul( 0.20 ).add( 5.3 ) ) );
		const nFine = mx_noise_float( vec3( swirlCoord.x.mul( 13.0 ).add( nMid.mul( 0.90 ) ), swirlCoord.y.mul( 13.0 ).add( nLarge.mul( 0.80 ) ), uTime.mul( 0.28 ).add( 11.7 ) ) );

		// Subtle living capillary micro-shimmer for Still Lake mode (never frozen)
		const cap1 = mx_noise_float( vec3( localXZ.x.mul( 3.2 ).add( uTime.mul( 0.12 ) ), localXZ.y.mul( 3.2 ).sub( uTime.mul( 0.09 ) ), uTime.mul( 0.22 ) ) );
		const cap2 = mx_noise_float( vec3( localXZ.x.mul( 8.6 ).sub( uTime.mul( 0.16 ) ), localXZ.y.mul( 8.6 ).add( uTime.mul( 0.14 ) ), uTime.mul( 0.34 ).add( 3.1 ) ) );
		const lakeMicroSlopeX = cap1.mul( 0.016 ).add( cap2.mul( 0.008 ) );
		const lakeMicroSlopeZ = cap2.mul( 0.016 ).sub( cap1.mul( 0.008 ) );

		// ---- Surface Preset 2: Micro-Veined labyrinthine capillary relief (Photos 1-3) ----
		const veined = evalMicroVeinedReliefTSL( localXZ.add( flowXZ.mul( 0.02 ) ) ).toVar();
		// veined = (height, gradX, gradZ, channelMask)

		// ---- Surface Preset 3: Microscopic Fracture Lines & cleavage facets ----
		const frac = evalFractureNetworkTSL( localXZ ).toVar();
		// frac = (facetThicknessStep, crackLineMask, facetTiltX, facetTiltZ)

		// Combine surface slopes in local lake space (Y is up)
		const waveSlopeGain = float( 3.35 );
		const waveSlopeX = dhdx.mul( waveSlopeGain );
		const waveSlopeZ = dhdz.mul( waveSlopeGain );

		const microSlopeX = lakeMicroSlopeX.mul( uModeLake )
			.add( veined.y.mul( 0.62 ).mul( uModeVeined ) )
			.add( frac.z.mul( 0.38 ).mul( uModeFracture ) );

		const microSlopeZ = lakeMicroSlopeZ.mul( uModeLake )
			.add( veined.z.mul( 0.62 ).mul( uModeVeined ) )
			.add( frac.w.mul( 0.38 ).mul( uModeFracture ) );

		const localN = normalize( vec3(
			waveSlopeX.add( microSlopeX ).negate(),
			float( 1.0 ),
			waveSlopeZ.add( microSlopeZ ).negate()
		) ).toVar();

		// Transform local normal into world space using lakeGroup's rotation matrix
		const worldN = normalize( modelWorldMatrix.mul( vec4( localN, 0.0 ) ).xyz ).toVar();
		const worldV = normalize( cameraPosition.sub( positionWorld ) ).toVar();
		const cosThetaI = saturate( dot( worldN, worldV ) ).toVar();
		const cosThetaT = evalFilmCosThetaTSL( cosThetaI, uFilmIOR ).toVar();
		const fresnel = evalFresnelTSL( cosThetaI, float( 0.036 ) ).toVar();

		// ---- Nanometer Thin-Film Thickness Profile (calibrated strictly to 1st–3rd Newton orders) ----
		// Resting surface sits in dark smoky bronze / obsidian (18-58 nm), so blooms ignite with
		// dramatic low-cortisol jewel richness (bronze, gold, copper, magenta, violet, sapphire, teal)
		const ambientDrift = nLarge.mul( 14.0 ).add( nMid.mul( 7.0 ) );
		const restThicknessLake = float( 26.0 ).add( ambientDrift );
		const restThicknessVeined = float( 44.0 ).add( ambientDrift ).add( veined.x.sub( 0.5 ).mul( 28.0 ) );
		const restThicknessFrac = float( 52.0 ).add( ambientDrift ).add( frac.x.mul( 42.0 ) );

		const restThicknessNm = restThicknessLake.mul( uModeLake )
			.add( restThicknessVeined.mul( uModeVeined ) )
			.add( restThicknessFrac.mul( uModeFracture ) );

		// Softly saturate rawFilmUm so overlapping drops stay inside vivid 140..440 nm (OPD 360..1180 nm)
		// instead of over-thickening into flat coherence-0 white!
		const compressedFilm = rawFilmUm.div( float( 1.0 ).add( rawFilmUm.mul( 0.72 ) ) );
		const featherDetail = nMid.mul( 42.0 ).add( nFine.mul( 26.0 ) ).mul( smoothstep( float( 0.04 ), float( 0.42 ), bloomAmt ) );
		const waveModNm = hVal.mul( 48.0 ).add( crownGlow.mul( 52.0 ) );
		const reliefModNm = veined.x.sub( 0.5 ).mul( 38.0 ).mul( uModeVeined )
			.add( frac.x.mul( 64.0 ).add( frac.y.mul( 78.0 ) ).mul( uModeFracture ) );

		const bloomThicknessNm = compressedFilm.mul( 465.0 ).add( featherDetail ).add( waveModNm );
		const totalThicknessNm = max(
			float( 6.0 ),
			restThicknessNm.add( bloomThicknessNm ).add( reliefModNm.mul( float( 0.32 ).add( bloomAmt.mul( 0.68 ) ) ) ).mul( uThicknessScale )
		).toVar();

		// Real Optical Path Difference: OPD = 2 * n_film * thicknessNm * cos(theta_t)
		const opdNm = totalThicknessNm.mul( uFilmIOR ).mul( 2.0 ).mul( cosThetaT ).toVar();
		const rawThinFilmRGB = evalThinFilmSpectrumTSL( opdNm ).toVar();
		// Softly tame the pale silver-white 1st-order peak (OPD ~170..320nm) into warm smoky bronze
		// so bloom fringes emerge seamlessly out of dark twilight water without a pale halo
		const silverBand = smoothstep( float( 110.0 ), float( 235.0 ), opdNm )
			.mul( float( 1.0 ).sub( smoothstep( float( 260.0 ), float( 390.0 ), opdNm ) ) );
		const thinFilmRGB = mix( rawThinFilmRGB, rawThinFilmRGB.mul( vec3( 0.44, 0.34, 0.28 ) ), silverBand.mul( 0.72 ) ).toVar();

		// ---- Oblique Twilight Grazing Lighting & Specular Sheen ----
		const toKey = normalize( uKeyPos.sub( positionWorld ) );
		const toRim = normalize( uRimPos.sub( positionWorld ) );
		const halfKey = normalize( toKey.add( worldV ) );
		const halfRim = normalize( toRim.add( worldV ) );

		const ndlKey = saturate( dot( worldN, toKey ) );
		const ndlRim = saturate( dot( worldN, toRim ) );

		const specExpKey = float( 180.0 ).mul( uModeLake )
			.add( float( 36.0 ).mul( uModeVeined ) )
			.add( float( 110.0 ).mul( uModeFracture ) );
		const specExpRim = float( 125.0 ).mul( uModeLake )
			.add( float( 28.0 ).mul( uModeVeined ) )
			.add( float( 82.0 ).mul( uModeFracture ) );

		const specKey = pow( saturate( dot( worldN, halfKey ) ), specExpKey );
		const specRim = pow( saturate( dot( worldN, halfRim ) ), specExpRim );

		// ---- Mode-Specific Deep Nocturnal Base Substrate ----
		// Still Lake: inky mirror-dark midnight pond water
		const baseLake = vec3( 0.005, 0.009, 0.016 );
		// Micro-Veined: velvety dark mahogany-espresso labyrinth (echoing Photos 1-3!)
		const veinCreviceShade = mix( vec3( 0.011, 0.006, 0.005 ), vec3( 0.056, 0.034, 0.029 ), veined.x );
		const baseVeined = veinCreviceShade.mul( float( 0.55 ).add( ndlKey.mul( 0.85 ) ) );
		// Fracture Lines: deep smoked obsidian cleavage plates with dark etched hairline fissures
		const fracPlateTone = mix( vec3( 0.010, 0.010, 0.015 ), vec3( 0.028, 0.023, 0.028 ), saturate( frac.x.mul( 0.5 ).add( 0.5 ) ) );
		const baseFracture = fracPlateTone.mul( float( 1.0 ).sub( frac.y.mul( 0.65 ) ) ).mul( float( 0.62 ).add( ndlKey.mul( 0.65 ) ) );

		const substrate = baseLake.mul( uModeLake )
			.add( baseVeined.mul( uModeVeined ) )
			.add( baseFracture.mul( uModeFracture ) );

		// ---- Couple Thin-Film Interference Richly & Restfully Over Dark Ground ----
		const slopeSpark = saturate( length( vec2( waveSlopeX, waveSlopeZ ) ).mul( 1.65 ) );
		const sheenGain = float( 0.06 ).mul( uModeLake )
			.add( float( 0.10 ).mul( uModeVeined ) )
			.add( float( 0.10 ).mul( uModeFracture ) );

		// Smoothly gate bloom presence so outer edges melt invisibly into midnight stillness
		const bloomSoft = smoothstep( float( 0.04 ), float( 0.38 ), bloomAmt ).mul( bloomAmt );
		const bloomPresence = saturate(
			sheenGain
				.add( bloomSoft.mul( 0.88 ) )
				.add( slopeSpark.mul( 0.28 ) )
				.add( crownGlow.mul( 0.22 ) )
		);

		// Embossed micro-vein shadow occlusion: crevices stay deeply dark while ridges catch luminous color!
		const veinOcclusion = mix( float( 1.0 ), float( 0.34 ).add( veined.x.mul( 0.76 ) ), uModeVeined );
		const fracOcclusion = mix( float( 1.0 ), float( 1.0 ).sub( frac.y.mul( 0.42 ) ), uModeFracture );

		const lightEnvelope = float( 0.30 ).add( ndlKey.mul( 0.44 ) ).add( ndlRim.mul( 0.22 ) ).add( fresnel.mul( 0.58 ) );
		const filmLumen = thinFilmRGB.mul( bloomPresence ).mul( lightEnvelope ).mul( veinOcclusion ).mul( fracOcclusion ).mul(
			float( 0.90 ).mul( uModeLake )
				.add( float( 0.88 ).mul( uModeVeined ) )
				.add( float( 0.82 ).mul( uModeFracture ) )
		);

		// Subtle grazing rim along embossed labyrinth walls
		const veinRimGlow = veined.w.mul( float( 0.05 ).add( bloomAmt.mul( 0.22 ) ) ).mul( ndlKey.mul( 0.65 ).add( 0.35 ) )
			.mul( mix( vec3( 0.08, 0.05, 0.04 ), thinFilmRGB, 0.65 ) )
			.mul( uModeVeined );

		// Razor-fine luminous capillary fracture lines catching copper-opal & teal glints on ripples
		const fractureSeamGlow = frac.y.mul( float( 0.12 ).add( bloomAmt.mul( 0.56 ) ).add( slopeSpark.mul( 0.55 ) ) )
			.mul( mix( vec3( 0.26, 0.22, 0.24 ), thinFilmRGB.mul( 1.25 ), 0.78 ) )
			.mul( float( 0.45 ).add( ndlKey.mul( 0.55 ) ).add( specRim.mul( 0.75 ) ) )
			.mul( uModeFracture );

		// Sleek liquid specular reflection along capillary wave crests & fracture facets
		const specTint = mix( vec3( 0.85, 0.93, 1.0 ), thinFilmRGB.mul( 1.25 ).add( 0.22 ), saturate( bloomAmt.mul( 0.72 ).add( 0.2 ) ) );
		const keySpecCol = vec3( 0.95, 0.86, 0.76 ).mul( specTint ).mul( specKey ).mul(
			float( 0.82 ).mul( uModeLake )
				.add( float( 0.22 ).mul( uModeVeined ) )
				.add( float( 0.56 ).mul( uModeFracture ) )
		);
		const rimSpecCol = vec3( 0.56, 0.84, 0.98 ).mul( specTint ).mul( specRim ).mul(
			float( 0.68 ).mul( uModeLake )
				.add( float( 0.18 ).mul( uModeVeined ) )
				.add( float( 0.48 ).mul( uModeFracture ) )
		);

		// Analytical mirror twilight sky reflection along R = 2*(N·V)*N - V (gives Still Lake true liquid depth!)
		const reflDir = worldN.mul( dot( worldN, worldV ).mul( 2.0 ) ).sub( worldV );
		const skyBand = smoothstep( float( - 0.15 ), float( 0.85 ), reflDir.y );
		const warmHorizon = pow( saturate( float( 1.0 ).sub( abs( reflDir.y.sub( 0.12 ) ) ) ), float( 4.5 ) )
			.mul( smoothstep( float( - 0.7 ), float( 0.75 ), reflDir.x.negate() ) );
		const mirrorSky = mix( vec3( 0.022, 0.036, 0.062 ), vec3( 0.10, 0.15, 0.22 ), skyBand )
			.add( vec3( 0.12, 0.08, 0.055 ).mul( warmHorizon ) );
		const mirrorRefl = mirrorSky.mul( fresnel.mul( 1.25 ).add( 0.04 ) ).mul(
			float( 0.58 ).mul( uModeLake )
				.add( float( 0.10 ).mul( uModeVeined ) )
				.add( float( 0.30 ).mul( uModeFracture ) )
		).mul( mix( vec3( 1.0 ), thinFilmRGB.mul( 1.15 ).add( 0.35 ), saturate( bloomAmt.mul( 0.7 ) ) ) );

		// Subtle glistening liquid glint right where a falling droplet kisses the water
		const crownSpark = crownGlow.mul( mix( vec3( 0.65, 0.86, 0.98 ), thinFilmRGB.mul( 1.2 ), 0.6 ) ).mul( 0.24 );

		// Restful radial twilight vignette toward the dark far margins of the lake
		const radialDist = length( localXZ.mul( vec2( 0.26, 0.30 ) ) );
		const duskFalloff = float( 1.0 ).sub( smoothstep( float( 0.55 ), float( 1.75 ), radialDist ).mul( 0.68 ) );

		const finalCol = substrate
			.add( mirrorRefl )
			.add( filmLumen )
			.add( veinRimGlow )
			.add( fractureSeamGlow )
			.add( keySpecCol )
			.add( rimSpecCol )
			.add( crownSpark )
			.mul( duskFalloff )
			.mul( uReveal );

		return vec4( finalCol, 1.0 );

	} );

	lakeMaterial.colorNode = evalFilmSurface().rgb;

	const lakeMesh = new THREE.Mesh( lakeGeom, lakeMaterial );
	lakeGroup.add( lakeMesh );

	// ---- 3D Falling Liquid Water Droplets (16 reusable glistening teardrop meshes) ----
	const dropGeom = new THREE.SphereGeometry( 0.038, 18, 14 );
	const dropMat = new THREE.MeshStandardNodeMaterial( {
		color: 0xd8f2ff,
		roughness: 0.04,
		metalness: 0.06,
		transparent: true,
		opacity: 0.88
	} );
	if ( environment ) dropMat.envMap = environment;
	if ( sceneLights && sceneLights.length ) dropMat.lightsNode = lights( sceneLights );

	// Delicate liquid Fresnel rim glow so falling water beads shimmer cleanly against the dark lake
	dropMat.emissiveNode = Fn( () => {

		const V = normalize( cameraPosition.sub( positionWorld ) );
		const N = normalize( modelWorldMatrix.mul( vec4( positionLocal, 0.0 ) ).xyz );
		const rim = pow( saturate( float( 1.0 ).sub( abs( dot( N, V ) ) ) ), float( 2.2 ) );
		const core = vec3( 0.18, 0.26, 0.34 );
		const glint = vec3( 0.78, 0.94, 1.0 ).mul( rim ).mul( 1.35 );
		return core.add( glint ).mul( uReveal );

	} )();

	const dropMeshes = [];
	for ( let i = 0; i < sim.drops.length; i ++ ) {

		const m = new THREE.Mesh( dropGeom, dropMat );
		m.visible = false;
		lakeGroup.add( m );
		dropMeshes.push( m );

	}

	// ---- Hold-to-Swell Suspended Hanging Drop Preview ----
	const holdDropMesh = new THREE.Mesh( dropGeom, dropMat );
	holdDropMesh.visible = false;
	lakeGroup.add( holdDropMesh );

	// Subtle luminous targeting ring on the lake surface directly beneath a hanging/swelling drop
	const holdHaloGeom = new THREE.RingGeometry( 0.055, 0.072, 40 );
	holdHaloGeom.rotateX( - Math.PI * 0.5 );
	const uHoldHaloOpacity = uniform( 0 );
	const holdHaloMat = new THREE.MeshBasicNodeMaterial( {
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	} );
	holdHaloMat.colorNode = vec3( 0.62, 0.88, 0.98 );
	holdHaloMat.opacityNode = uHoldHaloOpacity.mul( uReveal );
	const holdHaloMesh = new THREE.Mesh( holdHaloGeom, holdHaloMat );
	holdHaloMesh.visible = false;
	lakeGroup.add( holdHaloMesh );

	// ---- Delicate 3D Impact Meniscus Rim (tiny glistening liquid collar right at drop entry) ----
	const crownGeom = new THREE.TorusGeometry( 0.085, 0.0032, 8, 48 );
	crownGeom.rotateX( Math.PI * 0.5 );

	const crownEntries = [];
	for ( let i = 0; i < sim.crowns.length; i ++ ) {

		const uCrownOp = uniform( 0 );
		const uCrownTint = uniform( new THREE.Color( 0x9ce8f8 ) );
		const cMat = new THREE.MeshBasicNodeMaterial( {
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		} );
		cMat.colorNode = uCrownTint;
		cMat.opacityNode = uCrownOp.mul( uReveal );
		const mesh = new THREE.Mesh( crownGeom, cMat );
		mesh.visible = false;
		lakeGroup.add( mesh );
		crownEntries.push( { mesh, mat: cMat, uOp: uCrownOp, uTint: uCrownTint } );

	}

	let reveal = 0;
	let holdState = { active: false, x: 0, z: 0, swell: 0 };

	function setSurfaceMode( mode ) {

		modeTarget = MODE_TARGETS[ mode ] || MODE_TARGETS.lake;

	}

	function setThicknessScale( v ) {

		uThicknessScale.value = THREE.MathUtils.clamp( v, 0.45, 1.9 );

	}

	function setHoldPreview( active, lx = 0, lz = 0, swell = 0 ) {

		holdState.active = active;
		holdState.x = lx;
		holdState.z = lz;
		holdState.swell = THREE.MathUtils.clamp( swell, 0, 1 );

	}

	function update( dt, elapsed ) {

		uTime.value = elapsed;
		reveal = Math.min( 1, reveal + dt * 0.85 );
		uReveal.value = reveal * reveal * ( 3 - 2 * reveal );

		// Smooth live crossfade between Still Lake, Micro-Veined, and Fracture Lines
		const morphK = 1 - Math.exp( - dt * 5.2 );
		modeWeights.lake += ( modeTarget.lake - modeWeights.lake ) * morphK;
		modeWeights.veined += ( modeTarget.veined - modeWeights.veined ) * morphK;
		modeWeights.fracture += ( modeTarget.fracture - modeWeights.fracture ) * morphK;
		uModeLake.value = modeWeights.lake;
		uModeVeined.value = modeWeights.veined;
		uModeFracture.value = modeWeights.fracture;

		// Sync 3D falling droplet meshes (stretched vertically along fall velocity)
		for ( let i = 0; i < sim.drops.length; i ++ ) {

			const d = sim.drops[ i ];
			const m = dropMeshes[ i ];
			if ( ! d.active ) {

				m.visible = false;
				continue;

			}

			m.visible = true;
			m.position.set( d.x, d.y + 0.02, d.z );
			const speedStretch = 1.0 + Math.min( 1.35, Math.abs( d.vy ) * 0.24 );
			const rScale = ( 0.62 + d.size * 0.34 ) / Math.sqrt( speedStretch );
			m.scale.set( rScale, ( 0.68 + d.size * 0.36 ) * speedStretch, rScale );

		}

		// Sync hold-to-swell hanging droplet preview
		if ( holdState.active ) {

			holdDropMesh.visible = true;
			const pulse = 1.0 + Math.sin( elapsed * 7.5 ) * 0.04;
			const s = ( 0.65 + holdState.swell * 0.95 ) * pulse;
			const hangY = 0.56 - holdState.swell * 0.14;
			holdDropMesh.position.set( holdState.x, hangY, holdState.z );
			// Slight teardrop sag as the suspended droplet grows heavier
			holdDropMesh.scale.set( s * 0.92, s * ( 1.08 + holdState.swell * 0.38 ), s * 0.92 );

			holdHaloMesh.visible = true;
			holdHaloMesh.position.set( holdState.x, 0.015, holdState.z );
			const hs = 0.85 + holdState.swell * 1.65;
			holdHaloMesh.scale.set( hs, 1, hs );
			uHoldHaloOpacity.value = 0.18 + holdState.swell * 0.28;

		} else {

			holdDropMesh.visible = false;
			holdHaloMesh.visible = false;
			uHoldHaloOpacity.value = 0;

		}

		// Keep impact crowns purely driven by physical 3D capillary wave crests & liquid crownSpark
		for ( let i = 0; i < crownEntries.length; i ++ ) crownEntries[ i ].mesh.visible = false;

	}

	function dispose() {

		scene.remove( lakeGroup );
		lakeGeom.dispose();
		lakeMaterial.dispose();
		dropGeom.dispose();
		dropMat.dispose();
		holdHaloGeom.dispose();
		holdHaloMat.dispose();
		crownGeom.dispose();
		for ( const e of crownEntries ) e.mat.dispose();

	}

	return {
		lakeGroup,
		lakeMesh,
		get reveal() { return reveal; },
		setSurfaceMode,
		setThicknessScale,
		setHoldPreview,
		update,
		dispose
	};

}
