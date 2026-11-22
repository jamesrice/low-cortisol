import * as THREE from 'three/webgpu';

// Coupled 2D still-lake capillary wave + Marangoni nanometer thin-film PDE simulation.
// Packs exact surface elevation, analytical slopes, film thickness (um), surface flow,
// and bloom activity into two hardware-bilinear RGBA16F (HalfFloat) DataTextures so
// rendering is silky smooth on both WebGPU and WebGL2 with zero grid stepping.

// Fast IEEE-754 float32 -> float16 LUT encoder (adapted from Jeroen van der Zijp's method)
const _f32 = new Float32Array( 1 );
const _u32 = new Uint32Array( _f32.buffer );
const _baseTable = new Uint16Array( 512 );
const _shiftTable = new Uint8Array( 512 );

( function initHalfFloatTables() {

	for ( let i = 0; i < 256; i ++ ) {

		const e = i - 127;
		if ( e < - 24 ) {

			_baseTable[ i ] = 0x0000;
			_baseTable[ i | 0x100 ] = 0x8000;
			_shiftTable[ i ] = 24;
			_shiftTable[ i | 0x100 ] = 24;

		} else if ( e < - 14 ) {

			_baseTable[ i ] = 0x0400 >> ( - e - 14 );
			_baseTable[ i | 0x100 ] = ( 0x0400 >> ( - e - 14 ) ) | 0x8000;
			_shiftTable[ i ] = - e - 1;
			_shiftTable[ i | 0x100 ] = - e - 1;

		} else if ( e <= 15 ) {

			_baseTable[ i ] = ( e + 15 ) << 10;
			_baseTable[ i | 0x100 ] = ( ( e + 15 ) << 10 ) | 0x8000;
			_shiftTable[ i ] = 13;
			_shiftTable[ i | 0x100 ] = 13;

		} else if ( e < 128 ) {

			_baseTable[ i ] = 0x7c00;
			_baseTable[ i | 0x100 ] = 0xfc00;
			_shiftTable[ i ] = 24;
			_shiftTable[ i | 0x100 ] = 24;

		} else {

			_baseTable[ i ] = 0x7c00;
			_baseTable[ i | 0x100 ] = 0xfc00;
			_shiftTable[ i ] = 13;
			_shiftTable[ i | 0x100 ] = 13;

		}

	}

} )();

function toHalf( val ) {

	_f32[ 0 ] = val;
	const f = _u32[ 0 ];
	const idx = ( f >> 23 ) & 0x1ff;
	return _baseTable[ idx ] + ( ( f & 0x007fffff ) >> _shiftTable[ idx ] );

}

export function createFilmSimulation( {
	resolution = 200,
	simSpan = 10.4,
	onImpact = null
} = {} ) {

	const N = resolution;
	const count = N * N;
	const halfSpan = simSpan * 0.5;
	const invSpan = 1 / simSpan;

	// Heightfield (2-step Verlet wave equation)
	let hCurr = new Float32Array( count );
	let hPrev = new Float32Array( count );
	let hNext = new Float32Array( count );
	let crown = new Float32Array( count );

	// Coupled 2D velocity field (grid units / sec)
	let vx = new Float32Array( count );
	let vy = new Float32Array( count );
	let vxTmp = new Float32Array( count );
	let vyTmp = new Float32Array( count );

	// Thin-film optical thickness (um, 0..1.65) and bloom iridescence envelope (0..1.5)
	let film = new Float32Array( count );
	let filmNext = new Float32Array( count );
	let bloom = new Float32Array( count );
	let bloomNext = new Float32Array( count );

	// Packed RGBA16F DataTextures
	const waveData = new Uint16Array( count * 4 );
	const filmData = new Uint16Array( count * 4 );

	const waveTex = new THREE.DataTexture( waveData, N, N, THREE.RGBAFormat, THREE.HalfFloatType );
	waveTex.magFilter = THREE.LinearFilter;
	waveTex.minFilter = THREE.LinearFilter;
	waveTex.wrapS = THREE.ClampToEdgeWrapping;
	waveTex.wrapT = THREE.ClampToEdgeWrapping;
	waveTex.generateMipmaps = false;
	waveTex.needsUpdate = true;

	const filmTex = new THREE.DataTexture( filmData, N, N, THREE.RGBAFormat, THREE.HalfFloatType );
	filmTex.magFilter = THREE.LinearFilter;
	filmTex.minFilter = THREE.LinearFilter;
	filmTex.wrapS = THREE.ClampToEdgeWrapping;
	filmTex.wrapT = THREE.ClampToEdgeWrapping;
	filmTex.generateMipmaps = false;
	filmTex.needsUpdate = true;

	// Dynamic 3D falling droplet & impact crown pools (consumed by surface.js & mist.js)
	const MAX_DROPS = 16;
	const drops = Array.from( { length: MAX_DROPS }, () => ( {
		active: false,
		x: 0,
		z: 0,
		y: 0,
		vy: 0,
		size: 1.0,
		style: 0,
		age: 0,
		seed: 0
	} ) );

	const MAX_CROWNS = 16;
	const crowns = Array.from( { length: MAX_CROWNS }, () => ( {
		active: false,
		x: 0,
		z: 0,
		age: 0,
		duration: 0.55,
		size: 1.0
	} ) );

	// Recent impact pulses exposed to GPU mist motes
	const recentImpacts = [];

	let viscosity = 1.0; // 0.3 (swift watery) .. 2.2 (slow honeyed oil)
	let breathEnergy = 0;
	let breathSteerX = 0;
	let simTime = 0;
	let dropCounter = 0;
	let activeBloomEnergy = 0;
	let activeRippleEnergy = 0;

	function worldToGrid( lx, lz ) {

		const gx = ( ( lx + halfSpan ) * invSpan ) * ( N - 1 );
		const gz = ( ( lz + halfSpan ) * invSpan ) * ( N - 1 );
		return [ gx, gz ];

	}

	function spawnCrown( lx, lz, size ) {

		for ( const c of crowns ) {

			if ( ! c.active ) {

				c.active = true;
				c.x = lx;
				c.z = lz;
				c.age = 0;
				c.duration = 0.44 + size * 0.18;
				c.size = size;
				return;

			}

		}

		// Recycle oldest crown
		let oldest = crowns[ 0 ];
		for ( const c of crowns ) if ( c.age > oldest.age ) oldest = c;
		oldest.active = true;
		oldest.x = lx;
		oldest.z = lz;
		oldest.age = 0;
		oldest.duration = 0.44 + size * 0.18;
		oldest.size = size;

	}

	/**
	 * Inject a physical droplet impact: capillary wave depression + surrounding rim,
	 * outward Marangoni surface-tension burst with organic feathery azimuthal lobes,
	 * and a rich thin-film thickness profile sweeping across 1st–3rd interference orders.
	 *
	 * style:
	 *   0 = Contained marbled iridescent bloom (Photo 2)
	 *   1 = Jewel-eye concentric droplet with feathery outer plumes (Photo 3)
	 *   2 = Dramatic dark-eyed radial Marangoni starburst plume (Photo 1)
	 */
	function injectImpact( lx, lz, size = 1.0, style = - 1, seed = Math.random() * 100 ) {

		const [ cx, cz ] = worldToGrid( lx, lz );
		if ( cx < 3 || cx >= N - 3 || cz < 3 || cz >= N - 3 ) return;

		const chosenStyle = style >= 0 ? style : ( dropCounter % 3 );
		dropCounter ++;

		const s = Math.max( 0.5, Math.min( 2.2, size ) );
		const waveRad = Math.max( 4.5, N * 0.030 * ( 0.72 + s * 0.34 ) );
		const filmRad = Math.max( 9.0, N * 0.078 * ( 0.75 + s * 0.42 ) );
		const maxR = Math.ceil( filmRad * 1.85 );

		const i0 = Math.max( 2, Math.floor( cx - maxR ) );
		const i1 = Math.min( N - 3, Math.ceil( cx + maxR ) );
		const j0 = Math.max( 2, Math.floor( cz - maxR ) );
		const j1 = Math.min( N - 3, Math.ceil( cz + maxR ) );

		// Random organic phase angles for Marangoni Saffman-Taylor fingering lobes
		const p1 = seed * 1.73;
		const p2 = seed * 3.19 + 1.4;
		const p3 = seed * 5.41 + 2.7;
		// Vary target optical thickness palette gently across drops so overlapping blooms
		// mix bronze/gold, magenta/violet, and sapphire/turquoise/emerald naturally
		const paletteShift = 0.22 + ( ( seed * 0.6180339 ) % 1 ) * 0.42;

		for ( let j = j0; j <= j1; j ++ ) {

			const dy = j - cz;
			const row = j * N;

			for ( let i = i0; i <= i1; i ++ ) {

				const dx = i - cx;
				const r2 = dx * dx + dy * dy;
				if ( r2 > maxR * maxR ) continue;

				const idx = row + i;
				const r = Math.sqrt( r2 );
				const ang = Math.atan2( dy, dx );

				// Multi-harmonic azimuthal fingering modulation (creates realistic Marangoni plumes)
				const finger = 1.0
					+ 0.20 * Math.sin( ang * 5.0 + p1 )
					+ 0.15 * Math.sin( ang * 9.0 - p2 )
					+ 0.11 * Math.sin( ang * 15.0 + p3 )
					+ 0.07 * Math.cos( ang * 23.0 - p1 * 1.3 );

				// 1. Crisp capillary impact dimple + raised crown collar
				const rw = r / waveRad;
				if ( rw < 3.2 ) {

					const coreDip = - Math.exp( - rw * rw * 1.65 ) * 0.85 * s;
					const rimRise = Math.exp( - Math.pow( ( rw - 1.12 ) / 0.55, 2 ) ) * 0.34 * s;
					const dh = ( coreDip + rimRise ) * 0.92;
					hCurr[ idx ] = Math.max( - 1.4, Math.min( 1.4, hCurr[ idx ] + dh ) );
					// Slightly bias hPrev so wave starts cleanly expanding outward
					hPrev[ idx ] = Math.max( - 1.4, Math.min( 1.4, hPrev[ idx ] + dh * 0.62 ) );
					crown[ idx ] = Math.min( 1.5, crown[ idx ] + Math.exp( - Math.pow( ( rw - 0.95 ) / 0.65, 2 ) ) * 0.95 * s );

				}

				// 2. Outward Marangoni velocity jet + feathery radial shear
				const rf = r / ( filmRad * finger );
				if ( r > 0.35 && rf < 1.85 ) {

					const invR = 1 / r;
					const ux = dx * invR;
					const uy = dy * invR;
					const ringEnv = Math.exp( - Math.pow( ( rf - 0.52 ) / 0.52, 2 ) );
					const pushMag = ( chosenStyle === 2 ? 46.0 : 32.0 ) * ( 0.72 + s * 0.42 ) * ringEnv * ( 0.78 + 0.35 * finger );
					// Subtle curl swirl component makes plumes curl organically at their tips
					const swirl = Math.sin( ang * 7.0 + p2 ) * 0.26 * pushMag;
					vx[ idx ] += ux * pushMag - uy * swirl;
					vy[ idx ] += uy * pushMag + ux * swirl;

				}

				// 3. Thin-film thickness profile (in um) + bloom visibility envelope
				if ( rf < 1.55 ) {

					const env = Math.exp( - rf * rf * 1.55 );
					let targetThickness = 0;
					let bloomAdd = 0;

					if ( chosenStyle === 0 ) {

						// Contained marbled circular bloom (Photo 2): rich concentric swirls fading softly to dark bronze
						const dome = Math.exp( - rf * rf * 2.15 );
						const swirlMod = 0.22 * Math.sin( ang * 3.0 + rf * 5.8 + p1 ) + 0.14 * Math.cos( ang * 6.0 - rf * 4.5 + p2 );
						targetThickness = Math.max( 0.04, ( 0.34 + paletteShift * 0.56 + swirlMod ) ) * dome;
						bloomAdd = dome * 0.96;

					} else if ( chosenStyle === 1 ) {

						// Jewel-eye concentric droplet + outer plumes (Photo 3):
						// vivid compact central jewel core + dark calm ring + feathered outer fringe
						const coreJewel = Math.exp( - Math.pow( rf / 0.26, 2 ) );
						const outerPlume = Math.exp( - Math.pow( ( rf - 0.96 ) / 0.38, 2 ) ) * Math.max( 0.22, finger );
						targetThickness = coreJewel * ( 0.46 + paletteShift * 0.52 )
							+ outerPlume * ( 0.30 + paletteShift * 0.44 );
						bloomAdd = coreJewel * 1.15 + outerPlume * 0.85;
						// Keep the quiet ring between jewel core and outer plume dark & restful
						if ( rf > 0.34 && rf < 0.64 ) {

							film[ idx ] *= 0.65;
							bloom[ idx ] *= 0.72;

						}

					} else {

						// Dark-eyed Marangoni starburst plume (Photo 1):
						// deep espresso-bronze calm eye ringed by sweeping radial multicolored tendrils
						const eyeClear = 1.0 - Math.exp( - Math.pow( rf / 0.42, 2.4 ) );
						const plumeRing = Math.exp( - Math.pow( ( rf - 0.72 ) / 0.44, 2 ) ) * eyeClear;
						const radialGrad = 0.26 + ( 1.0 - Math.min( 1, rf * 0.85 ) ) * 0.52 + paletteShift * 0.32;
						targetThickness = plumeRing * radialGrad * ( 0.78 + 0.34 * finger );
						bloomAdd = plumeRing * 1.05;
						if ( rf < 0.40 ) {

							const keep = Math.pow( rf / 0.40, 1.8 );
							film[ idx ] *= ( 0.14 + 0.86 * keep );
							bloom[ idx ] *= ( 0.18 + 0.82 * keep );

						}

					}

					// Blend smoothly with existing film so overlapping blooms mix & shift colors without over-thickening
					const mixW = Math.min( 0.82, env * 0.78 );
					film[ idx ] = Math.min( 1.25, film[ idx ] * ( 1 - mixW * 0.42 ) + targetThickness * ( 0.68 + s * 0.18 ) );
					bloom[ idx ] = Math.min( 1.25, Math.max( bloom[ idx ] * 0.82, bloom[ idx ] * 0.38 + bloomAdd * ( 0.74 + s * 0.16 ) ) );

				}

			}

		}

		spawnCrown( lx, lz, s );
		recentImpacts.push( { x: lx, z: lz, size: s } );
		if ( recentImpacts.length > 6 ) recentImpacts.shift();

		if ( onImpact ) {

			const pan = THREE.MathUtils.clamp( lx * 0.28, - 0.85, 0.85 );
			onImpact( { x: lx, z: lz, size: s, pan, style: chosenStyle } );

		}

	}

	/**
	 * Release a tiny 3D water bead from above the lake surface; on contact it spawns
	 * capillary ripples, an iridescent Marangoni bloom, a liquid crown, and audio plink.
	 */
	function releaseDrop( lx, lz, size = 1.0, style = - 1, startHeight = 1.35 ) {

		const clampedX = THREE.MathUtils.clamp( lx, - halfSpan * 0.78, halfSpan * 0.78 );
		const clampedZ = THREE.MathUtils.clamp( lz, - halfSpan * 0.72, halfSpan * 0.72 );

		let slot = null;
		for ( const d of drops ) {

			if ( ! d.active ) {

				slot = d;
				break;

			}

		}
		if ( ! slot ) {

			slot = drops[ 0 ];
			for ( const d of drops ) if ( d.age > slot.age ) slot = d;

		}

		slot.active = true;
		slot.x = clampedX;
		slot.z = clampedZ;
		slot.y = Math.max( 0.15, startHeight );
		slot.vy = - 0.45;
		slot.size = Math.max( 0.55, Math.min( 2.1, size ) );
		slot.style = style;
		slot.age = 0;
		slot.seed = Math.random() * 1000;
		return slot;

	}

	/**
	 * Continuous fingertip / pointer / webcam-digit wake gliding softly through the film.
	 */
	function applyWake( lx, lz, velX, velZ, pressure = 1.0, radiusScale = 1.0 ) {

		const [ cx, cz ] = worldToGrid( lx, lz );
		if ( cx < 2 || cx >= N - 2 || cz < 2 || cz >= N - 2 ) return;

		const speed = Math.hypot( velX, velZ );
		const rad = Math.max( 3.5, N * 0.036 * Math.max( 0.55, Math.min( 1.9, radiusScale ) ) );
		const maxR = Math.ceil( rad * 2.1 );

		const i0 = Math.max( 2, Math.floor( cx - maxR ) );
		const i1 = Math.min( N - 3, Math.ceil( cx + maxR ) );
		const j0 = Math.max( 2, Math.floor( cz - maxR ) );
		const j1 = Math.min( N - 3, Math.ceil( cz + maxR ) );

		// Convert world velocity to grid velocity scale
		const gvx = THREE.MathUtils.clamp( velX * invSpan * N * 0.36, - 55, 55 );
		const gvy = THREE.MathUtils.clamp( velZ * invSpan * N * 0.36, - 55, 55 );
		const pAmt = Math.max( 0.25, Math.min( 2.0, pressure ) );
		const wakeFilmTarget = 0.34 + 0.32 * Math.sin( simTime * 0.55 + lx * 0.65 - lz * 0.45 ) + 0.12 * Math.min( 1, speed * 0.3 );

		for ( let j = j0; j <= j1; j ++ ) {

			const dy = j - cz;
			const row = j * N;

			for ( let i = i0; i <= i1; i ++ ) {

				const dx = i - cx;
				const r2 = dx * dx + dy * dy;
				if ( r2 > maxR * maxR ) continue;

				const idx = row + i;
				const rn = Math.sqrt( r2 ) / rad;
				const g = Math.exp( - rn * rn * 1.4 );

				// Gentle bow-wave depression ahead + soft capillary wake
				const wakeWave = - g * ( 0.042 + Math.min( 0.12, speed * 0.035 ) ) * pAmt;
				hCurr[ idx ] = Math.max( - 1.2, Math.min( 1.2, hCurr[ idx ] + wakeWave ) );

				// Drag the thin film organically along the finger path + gentle outward parting
				const invR = r2 > 0.25 ? ( 1 / Math.sqrt( r2 ) ) : 0;
				const partMag = g * ( 6.5 + speed * 4.5 ) * pAmt;
				vx[ idx ] += g * gvx * ( 0.72 + 0.28 * pAmt ) + dx * invR * partMag;
				vy[ idx ] += g * gvy * ( 0.72 + 0.28 * pAmt ) + dy * invR * partMag;

				// Awaken thin-film iridescence along the wake ribbon
				const trailGlow = g * Math.min( 1.0, ( 0.10 + speed * 0.14 ) * pAmt );
				film[ idx ] = Math.min( 1.48, film[ idx ] + ( wakeFilmTarget - film[ idx ] ) * trailGlow * 0.45 + trailGlow * 0.16 );
				bloom[ idx ] = Math.min( 1.38, bloom[ idx ] + trailGlow * 0.62 );

			}

		}

	}

	/**
	 * Open-palm webcam Z-proximity air cushion: softly dimples the water and spreads
	 * a serene broad iridescent halo outward without splashing.
	 */
	function applyPalmCushion( lx, lz, proximity = 0.5, radiusScale = 1.3 ) {

		const [ cx, cz ] = worldToGrid( lx, lz );
		if ( cx < 2 || cx >= N - 2 || cz < 2 || cz >= N - 2 ) return;

		const rad = Math.max( 7.0, N * 0.072 * radiusScale );
		const maxR = Math.ceil( rad * 1.75 );
		const i0 = Math.max( 2, Math.floor( cx - maxR ) );
		const i1 = Math.min( N - 3, Math.ceil( cx + maxR ) );
		const j0 = Math.max( 2, Math.floor( cz - maxR ) );
		const j1 = Math.min( N - 3, Math.ceil( cz + maxR ) );

		const p = THREE.MathUtils.clamp( proximity, 0.05, 1.0 );

		for ( let j = j0; j <= j1; j ++ ) {

			const dy = j - cz;
			const row = j * N;

			for ( let i = i0; i <= i1; i ++ ) {

				const dx = i - cx;
				const r2 = dx * dx + dy * dy;
				if ( r2 > maxR * maxR ) continue;

				const idx = row + i;
				const r = Math.sqrt( r2 );
				const rn = r / rad;
				const g = Math.exp( - rn * rn * 1.35 );
				const invR = r > 0.4 ? ( 1 / r ) : 0;

				hCurr[ idx ] = Math.max( - 1.0, hCurr[ idx ] - g * 0.022 * p );
				const push = g * 9.5 * p;
				vx[ idx ] += dx * invR * push;
				vy[ idx ] += dy * invR * push;

				const halo = Math.exp( - Math.pow( ( rn - 0.65 ) / 0.48, 2 ) );
				film[ idx ] = Math.min( 1.45, film[ idx ] + halo * 0.045 * p );
				bloom[ idx ] = Math.min( 1.32, bloom[ idx ] + ( halo * 0.09 + g * 0.03 ) * p );

			}

		}

	}

	/**
	 * Marangoni Gust (from Strong Breath puff, Hand Sweep, or HUD button):
	 * parts the center into sweeping multicolored starburst plumes and drops 3 soft satellite beads.
	 */
	function triggerMarangoniGust( centerX = 0, centerZ = 0 ) {

		injectImpact( centerX, centerZ, 1.65, 2, Math.random() * 100 );
		// Release 3 delicate satellite beads around the outer rim at staggered heights
		for ( let k = 0; k < 3; k ++ ) {

			const a = ( k / 3 ) * Math.PI * 2 + Math.random() * 0.9;
			const dist = 1.05 + Math.random() * 0.85;
			releaseDrop(
				centerX + Math.cos( a ) * dist,
				centerZ + Math.sin( a ) * dist * 0.72,
				0.72 + Math.random() * 0.38,
				k % 2,
				1.05 + k * 0.42
			);

		}

	}

	function setViscosity( v ) {

		viscosity = Math.max( 0.3, Math.min( 2.2, v ) );

	}

	function setBreathWind( energy, steerX ) {

		breathEnergy = Math.max( 0, Math.min( 1.5, energy || 0 ) );
		breathSteerX = Math.max( - 1, Math.min( 1, steerX || 0 ) );

	}

	function stepFluid( dt ) {

		simTime += dt;

		// 1. Update falling 3D droplets & trigger impacts right when y <= 0
		const gravity = 5.8;
		for ( const d of drops ) {

			if ( ! d.active ) continue;
			d.age += dt;
			d.vy -= gravity * dt;
			d.y += d.vy * dt;

			if ( d.y <= 0 ) {

				d.active = false;
				injectImpact( d.x, d.z, d.size, d.style, d.seed );

			}

		}

		// 2. Age expanding 3D crown rings
		for ( const c of crowns ) {

			if ( ! c.active ) continue;
			c.age += dt;
			if ( c.age >= c.duration ) c.active = false;

		}

		// 3. Coupled capillary wave equation + viscous damping (2 substeps for crisp high-speed stability)
		// Lower viscosity = swifter glassy ripples; higher viscosity = slow dreamy honeyed swells
		const viscNorm = ( viscosity - 0.3 ) / 1.9; // 0..1
		const waveC2 = 0.22 - viscNorm * 0.085; // wave speed squared (< 0.25 CFL safe)
		const waveDamp = 0.9915 - viscNorm * 0.0085;

		for ( let sub = 0; sub < 2; sub ++ ) {

			for ( let j = 1; j < N - 1; j ++ ) {

				const row = j * N;
				const rowUp = row - N;
				const rowDn = row + N;

				for ( let i = 1; i < N - 1; i ++ ) {

					const idx = row + i;
					const lap = hCurr[ idx - 1 ] + hCurr[ idx + 1 ] + hCurr[ rowUp + i ] + hCurr[ rowDn + i ] - 4.0 * hCurr[ idx ];
					let nh = ( 2.0 * hCurr[ idx ] - hPrev[ idx ] + waveC2 * lap ) * waveDamp;

					// Soft absorbing boundary sponge near outer edges so waves never bounce harshly
					if ( i < 8 || i > N - 9 || j < 8 || j > N - 9 ) nh *= 0.93;

					hNext[ idx ] = nh;

				}

			}

			// Rotate height buffers (zero allocation)
			const tmp = hPrev;
			hPrev = hCurr;
			hCurr = hNext;
			hNext = tmp;

		}

		// 4. Gentle breath capillary wind & slow ambient thermal convection (never motionless!)
		const bAmp = breathEnergy;
		const windDirX = 0.45 + breathSteerX * 0.85;
		const windDirY = - 0.25 - 0.35 * Math.abs( breathSteerX );

		if ( bAmp > 0.04 ) {

			// Soft capillary breeze ripples shimmering along breath direction
			const bForce = bAmp * 16.0 * dt;
			const phaseT = simTime * 9.5;
			for ( let j = 3; j < N - 3; j += 2 ) {

				const row = j * N;
				for ( let i = 3; i < N - 3; i += 2 ) {

					const idx = row + i;
					const wave = Math.sin( i * 0.22 * windDirX + j * 0.22 * windDirY - phaseT );
					hCurr[ idx ] += wave * bAmp * 0.014;
					vx[ idx ] += windDirX * bForce * ( 0.7 + 0.3 * wave );
					vy[ idx ] += windDirY * bForce * ( 0.7 + 0.3 * wave );
					bloom[ idx ] = Math.min( 1.25, bloom[ idx ] + bAmp * 0.008 );

				}

			}

		}

		// 5. Velocity damping + slight viscous diffusion + semi-Lagrangian advection of thin-film thickness
		const velDecay = Math.exp( - dt * ( 1.45 + viscNorm * 1.45 ) );
		// Gentle relaxation so blooms linger luxuriously (10-20s) before fading back to quiet dark bronze
		const filmDecay = Math.exp( - dt * ( 0.042 + ( 1.0 - viscNorm ) * 0.025 ) );
		const bloomDecay = Math.exp( - dt * ( 0.048 + ( 1.0 - viscNorm ) * 0.030 ) );
		const crownDecay = Math.exp( - dt * 5.2 );
		const advScale = dt * ( 0.78 - viscNorm * 0.32 );
		const tSlow = simTime * 0.32;

		let sumBloom = 0;
		let sumRipple = 0;

		for ( let j = 1; j < N - 1; j ++ ) {

			const row = j * N;
			const rowUp = row - N;
			const rowDn = row + N;
			const vNorm = j / N;

			for ( let i = 1; i < N - 1; i ++ ) {

				const idx = row + i;
				const uNorm = i / N;

				// Subtle divergence-free slow ambient convection swirl (keeps the film alive & breathing)
				const convX = Math.sin( vNorm * 6.283 + tSlow ) * Math.cos( uNorm * 4.5 - tSlow * 0.7 ) * 1.65;
				const convY = - Math.cos( uNorm * 6.283 - tSlow * 0.85 ) * Math.sin( vNorm * 4.5 + tSlow * 0.6 ) * 1.65;

				// Smooth viscous velocity diffusion
				const nvx = ( vx[ idx ] * 0.76 + ( vx[ idx - 1 ] + vx[ idx + 1 ] + vx[ rowUp + i ] + vx[ rowDn + i ] ) * 0.06 ) * velDecay;
				const nvy = ( vy[ idx ] * 0.76 + ( vy[ idx - 1 ] + vy[ idx + 1 ] + vy[ rowUp + i ] + vy[ rowDn + i ] ) * 0.06 ) * velDecay;
				vxTmp[ idx ] = nvx;
				vyTmp[ idx ] = nvy;

				// Trace backward along total surface velocity (Marangoni + wave gradient drift + convection)
				const sx = Math.max( 1, Math.min( N - 2.001, i - ( nvx + convX ) * advScale ) );
				const sy = Math.max( 1, Math.min( N - 2.001, j - ( nvy + convY ) * advScale ) );

				const ix = sx | 0;
				const iy = sy | 0;
				const fx = sx - ix;
				const fy = sy - iy;
				const a00 = iy * N + ix;
				const a10 = a00 + 1;
				const a01 = a00 + N;
				const a11 = a01 + 1;

				const w00 = ( 1 - fx ) * ( 1 - fy );
				const w10 = fx * ( 1 - fy );
				const w01 = ( 1 - fx ) * fy;
				const w11 = fx * fy;

				const advFilm = film[ a00 ] * w00 + film[ a10 ] * w10 + film[ a01 ] * w01 + film[ a11 ] * w11;
				const advBloom = bloom[ a00 ] * w00 + bloom[ a10 ] * w10 + bloom[ a01 ] * w01 + bloom[ a11 ] * w11;

				// Tiny surface-tension diffusion keeps thin-film plumes silky & oil-like
				const lapF = ( film[ idx - 1 ] + film[ idx + 1 ] + film[ rowUp + i ] + film[ rowDn + i ] ) * 0.25 - film[ idx ];
				const nextF = Math.max( 0, Math.min( 1.65, ( advFilm + lapF * 0.025 ) * filmDecay ) );
				const nextB = Math.max( 0, Math.min( 1.50, advBloom * bloomDecay ) );

				filmNext[ idx ] = nextF;
				bloomNext[ idx ] = nextB;
				crown[ idx ] *= crownDecay;

				if ( ( ( i + j ) & 7 ) === 0 ) {

					sumBloom += nextB;
					sumRipple += Math.abs( hCurr[ idx ] );

				}

			}

		}

		// Swap ping-pong buffers
		let t = vx; vx = vxTmp; vxTmp = t;
		t = vy; vy = vyTmp; vyTmp = t;
		t = film; film = filmNext; filmNext = t;
		t = bloom; bloom = bloomNext; bloomNext = t;

		const sampleCount = ( N * N ) / 8;
		activeBloomEnergy = Math.min( 1.5, ( sumBloom / sampleCount ) * 3.8 );
		activeRippleEnergy = Math.min( 1.5, ( sumRipple / sampleCount ) * 16.0 );

		// 6. Pack into RGBA16F DataTextures (smooth bilinear slopes + thickness + velocity + bloom)
		for ( let j = 0; j < N; j ++ ) {

			const row = j * N;
			const jUp = j > 0 ? ( j - 1 ) * N : row;
			const jDn = j < N - 1 ? ( j + 1 ) * N : row;

			for ( let i = 0; i < N; i ++ ) {

				const idx = row + i;
				const iL = i > 0 ? idx - 1 : idx;
				const iR = i < N - 1 ? idx + 1 : idx;

				const dhdx = ( hCurr[ iR ] - hCurr[ iL ] ) * 0.5;
				const dhdy = ( hCurr[ jDn + i ] - hCurr[ jUp + i ] ) * 0.5;

				const o = idx * 4;
				waveData[ o ] = toHalf( hCurr[ idx ] );
				waveData[ o + 1 ] = toHalf( dhdx );
				waveData[ o + 2 ] = toHalf( dhdy );
				waveData[ o + 3 ] = toHalf( crown[ idx ] );

				filmData[ o ] = toHalf( film[ idx ] );
				filmData[ o + 1 ] = toHalf( vx[ idx ] * 0.04 );
				filmData[ o + 2 ] = toHalf( vy[ idx ] * 0.04 );
				filmData[ o + 3 ] = toHalf( bloom[ idx ] );

			}

		}

		waveTex.needsUpdate = true;
		filmTex.needsUpdate = true;

	}

	/**
	 * Pre-seed a gorgeous living bloom so Frame 1 already exhibits rich thin-film iridescence
	 * and delicate expanding capillary rings over the still dark lake.
	 */
	function seedOpeningBloom() {

		// Soft wide twilight starburst bloom slightly off-center + crisp jewel droplet nearby
		injectImpact( - 0.35, - 0.12, 1.38, 2, 17.4 );
		for ( let k = 0; k < 18; k ++ ) stepFluid( 1 / 60 );
		injectImpact( 0.58, 0.24, 0.95, 1, 42.8 );
		for ( let k = 0; k < 12; k ++ ) stepFluid( 1 / 60 );
		// Clear initial silent impacts from audio/mist queue so boot stays tranquil
		recentImpacts.length = 0;

	}

	seedOpeningBloom();

	return {
		resolution: N,
		simSpan,
		waveTex,
		filmTex,
		drops,
		crowns,
		recentImpacts,
		get bloomEnergy() { return activeBloomEnergy; },
		get rippleEnergy() { return activeRippleEnergy; },
		releaseDrop,
		injectImpact,
		applyWake,
		applyPalmCushion,
		triggerMarangoniGust,
		setViscosity,
		setBreathWind,
		step: stepFluid,
		dispose() {

			waveTex.dispose();
			filmTex.dispose();

		}
	};

}
