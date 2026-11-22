// Dedicated real-time 48 kHz procedural physical-modeling & ASMR AudioWorkletProcessor.
// Zero external samples, zero allocations inside process(), soft-limited low-cortisol output.
//
// Scenes:
//   0 = Moss & Pappus  (warm woodland air, silky panned wind swoosh, pentatonic wood/kalimba modals)
//   1 = Snow & Light   (glacial glass shimmer, refracted micro-ice grains, celesta/glass-bowl modals)
//   2 = Petting Fur    (room warmth + dog breath cadence, breed-morphed velvet fur whisper, contented sigh)
//   3 = Film Bloom     (nocturnal still-lake calm, Minnaert bubble water drops, silky liquid glide)

const TWO_PI = Math.PI * 2;

// Consonant low-cortisol tunings (Hz)
// D major pentatonic across warm mellow registers (Moss & Pappus)
const MOSS_SCALE = [ 293.66, 329.63, 369.99, 440.00, 493.88, 587.33, 659.25, 739.99, 880.00 ];
// F# Lydian airy crystal intervals (Snow & Light)
const SNOW_SCALE = [ 369.99, 415.30, 466.16, 523.25, 554.37, 622.25, 739.99, 830.61, 932.33, 1108.73 ];
// Warm cozy open-fifth / suspended hues (Petting Fur)
const DOG_SCALE = [ 146.83, 220.00, 293.66, 329.63, 440.00 ];
// Serene Cmaj9 / A minor pentatonic nocturnal water-drop scale (Film Bloom)
const FILM_SCALE = [ 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99 ];

function clamp( x, lo, hi ) {

	return x < lo ? lo : ( x > hi ? hi : x );

}

function createSVF() {

	return { ic1eq: 0, ic2eq: 0 };

}

function stepSVF( f, x, g, k ) {

	// Cytomic TPT State-Variable Filter — unconditionally stable at audio rate
	const a1 = 1 / ( 1 + g * ( g + k ) );
	const a2 = g * a1;
	const a3 = g * a2;
	const v3 = x - f.ic2eq;
	const v1 = a1 * f.ic1eq + a2 * v3;
	const v2 = f.ic2eq + a2 * f.ic1eq + a3 * v3;
	f.ic1eq = 2 * v1 - f.ic1eq;
	f.ic2eq = 2 * v2 - f.ic2eq;
	return { lp: v2, bp: v1, hp: x - k * v1 - v2 };

}

function createPinkState() {

	return { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };

}

function nextPink( s, white ) {

	s.b0 = 0.99886 * s.b0 + white * 0.0555179;
	s.b1 = 0.99332 * s.b1 + white * 0.0750759;
	s.b2 = 0.96900 * s.b2 + white * 0.1538520;
	s.b3 = 0.86650 * s.b3 + white * 0.3104856;
	s.b4 = 0.55000 * s.b4 + white * 0.5329522;
	s.b5 = - 0.7616 * s.b5 - white * 0.0168980;
	const out = ( s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + white * 0.5362 ) * 0.11;
	s.b6 = white * 0.115926;
	return out;

}

class CollisionAudioProcessor extends AudioWorkletProcessor {

	constructor() {

		super();
		this.sr = sampleRate || 48000;
		this.rng = 0x51a9c3d7;

		// Master & scene crossfade state
		this.targetMaster = 0;
		this.master = 0;
		this.sceneId = 0;
		this.wMoss = 1;
		this.wSnow = 0;
		this.wDog = 0;
		this.wFilm = 0;

		// Real-time smoothed telemetry targets
		this.tSpeed = 0;
		this.tPan = 0;
		this.tPressure = 0.5;
		this.tBreath = 0;
		this.tVortex = 0;
		this.tDogBreath = 0.5;
		this.tBreedLab = 1;
		this.tBreedHusky = 0;
		this.tBreedBernese = 0;
		this.tAgainstGrain = 0;
		this.tStillGlow = 0;
		this.tSlowGlide = 0;

		this.sSpeed = 0;
		this.sPan = 0;
		this.sPressure = 0.5;
		this.sBreath = 0;
		this.sVortex = 0;
		this.sDogBreath = 0.5;
		this.sAgainstGrain = 0;
		this.sStillGlow = 0;
		this.sSlowGlide = 0;

		// One-shot sweep envelopes (Shake Off / Smooth Coat / Frost Gust)
		this.shakeEnv = 0;
		this.shakePhase = 0;
		this.smoothEnv = 0;
		this.smoothPhase = 0;
		this.gustEnv = 0;
		this.gustPan = 0;

		// Noise states (L/R decorrelated stereo)
		this.pinkL = createPinkState();
		this.pinkR = createPinkState();

		// Stereo SVF banks for beds & reactive friction/airflow
		this.bedL = createSVF();
		this.bedR = createSVF();
		this.windL = createSVF();
		this.windR = createSVF();
		this.furLoL = createSVF();
		this.furLoR = createSVF();
		this.furHiL = createSVF();
		this.furHiR = createSVF();
		this.iceL = createSVF();
		this.iceR = createSVF();

		// Continuous ambient harmonic drone phases
		this.ph0 = 0;
		this.ph1 = 0;
		this.ph2 = 0;
		this.ph3 = 0;
		this.lfoPh = 0;

		// 12-voice polyphonic modal resonator bank (zero allocations)
		this.voices = [];
		for ( let i = 0; i < 12; i ++ ) {

			this.voices.push( {
				active: false,
				age: 0,
				amp: 0,
				decay: 0.9998,
				f1: 440,
				f2: 880,
				f3: 1320,
				p1: 0,
				p2: 0,
				p3: 0,
				a2: 0.35,
				a3: 0.14,
				d2: 0.9994,
				d3: 0.9990,
				pan: 0,
				attack: 0.006,
				noiseAmt: 0,
				isSigh: false,
				isDrop: false,
				fStart: 440,
				chirpTau: 0.032
			} );

		}
		this.nextVoice = 0;

		// Subtle 4-line Hadamard FDN stereo reverb (prime delay lengths in samples)
		const baseDelays = [ 1187, 1693, 2239, 2909 ];
		const scale = this.sr / 48000;
		this.fdnBufs = baseDelays.map( ( d ) => new Float32Array( Math.max( 64, Math.round( d * scale ) ) ) );
		this.fdnIdx = new Int32Array( 4 );
		this.fdnLp = new Float32Array( 4 );

		// Warm master low-pass tilt (rolls off harsh highs > ~5.5 kHz)
		this.masterLpL = 0;
		this.masterLpR = 0;

		// Output RMS telemetry back to main thread for mic echo-ducking
		this.rmsAcc = 0;
		this.rmsCount = 0;

		// Stochastic timers for organic micro-events
		this.sparkleCooldown = 0;
		this.thawCooldown = 0;

		this.port.onmessage = ( ev ) => this.handleMessage( ev.data );

	}

	rand() {

		// Fast xorshift32
		let x = this.rng;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.rng = x >>> 0;
		return ( this.rng / 4294967296 ) * 2 - 1;

	}

	rand01() {

		return this.rand() * 0.5 + 0.5;

	}

	handleMessage( m ) {

		if ( ! m || ! m.type ) return;

		if ( m.type === 'master' ) {

			this.targetMaster = clamp( m.value || 0, 0, 1 );

		} else if ( m.type === 'scene' ) {

			this.sceneId = m.id === 'snow' ? 1 : ( m.id === 'dog' ? 2 : ( m.id === 'film' ? 3 : 0 ) );

		} else if ( m.type === 'telemetry' ) {

			this.tSpeed = clamp( m.speed || 0, 0, 2.5 );
			this.tPan = clamp( m.pan || 0, - 0.85, 0.85 );
			this.tPressure = clamp( m.pressure ?? 0.5, 0, 2.0 );
			this.tBreath = clamp( m.breath || 0, 0, 1.5 );
			this.tVortex = m.vortex ? 1 : 0;
			this.tDogBreath = clamp( m.dogBreath ?? 0.5, 0, 1 );
			this.tBreedLab = clamp( m.breedLab ?? 1, 0, 1 );
			this.tBreedHusky = clamp( m.breedHusky ?? 0, 0, 1 );
			this.tBreedBernese = clamp( m.breedBernese ?? 0, 0, 1 );
			this.tAgainstGrain = clamp( m.againstGrain || 0, 0, 1 );
			this.tStillGlow = clamp( m.stillGlow || 0, 0, 1 );
			this.tSlowGlide = clamp( m.slowGlide || 0, 0, 1 );

		} else if ( m.type === 'plink' ) {

			this.spawnModal( m.scene ?? this.sceneId, m.pan || 0, m.intensity ?? 0.7, m.pitchIndex );

		} else if ( m.type === 'pulse' ) {

			const p = clamp( m.pan || 0, - 0.7, 0.7 );
			this.spawnModal( 0, p - 0.15, 0.55, 0 );
			this.spawnModal( 0, p + 0.15, 0.45, 3 );
			this.spawnModal( 0, p, 0.35, 5 );
			this.gustEnv = Math.max( this.gustEnv, 0.65 );
			this.gustPan = p;

		} else if ( m.type === 'gust' ) {

			const p = clamp( m.pan || 0, - 0.7, 0.7 );
			this.gustEnv = 1.0;
			this.gustPan = p;
			if ( this.sceneId === 3 ) {

				this.spawnDrop( p - 0.24, 1.35, 0.56 );
				this.spawnDrop( p + 0.22, 0.92, 0.44 );

			} else {

				this.spawnModal( 1, p - 0.25, 0.42, 2 );
				this.spawnModal( 1, p + 0.22, 0.38, 6 );

			}

		} else if ( m.type === 'drop' ) {

			this.spawnDrop( m.pan || 0, m.size ?? 1.0, m.intensity ?? 0.62 );

		} else if ( m.type === 'chime' ) {

			const s = m.scene ?? this.sceneId;
			this.spawnModal( s, m.pan || 0, m.intensity ?? 0.65, m.pitchIndex );

		} else if ( m.type === 'shake' ) {

			this.shakeEnv = 1.0;
			this.shakePhase = 0;

		} else if ( m.type === 'smooth' ) {

			this.smoothEnv = 1.0;
			this.smoothPhase = 0;

		} else if ( m.type === 'sigh' ) {

			this.spawnSigh();

		}

	}

	spawnModal( scene, pan, intensity, pitchIdx ) {

		const v = this.voices[ this.nextVoice ];
		this.nextVoice = ( this.nextVoice + 1 ) % this.voices.length;

		const scale = scene === 1 ? SNOW_SCALE : ( scene === 2 ? DOG_SCALE : MOSS_SCALE );
		const idx = typeof pitchIdx === 'number'
			? Math.abs( Math.floor( pitchIdx ) ) % scale.length
			: Math.floor( this.rand01() * scale.length );

		const detune = 1 + this.rand() * 0.004;
		const f1 = scale[ idx ] * detune;

		v.active = true;
		v.isSigh = false;
		v.isDrop = false;
		v.age = 0;
		v.p1 = 0;
		v.p2 = 0;
		v.p3 = 0;
		v.pan = clamp( pan, - 0.85, 0.85 );

		if ( scene === 1 ) {

			// Snow & Light: crystalline glass celesta / refracted frost
			v.f1 = f1;
			v.f2 = f1 * 2.756; // glassy bell partial
			v.f3 = f1 * 4.02;
			v.amp = 0.095 * clamp( intensity, 0.12, 1.2 );
			v.decay = Math.exp( - 1 / ( this.sr * ( 1.45 + this.rand01() * 0.9 ) ) );
			v.d2 = Math.exp( - 1 / ( this.sr * 0.55 ) );
			v.d3 = Math.exp( - 1 / ( this.sr * 0.25 ) );
			v.a2 = 0.28;
			v.a3 = 0.11;
			v.attack = 0.004;
			v.noiseAmt = 0.03;

		} else if ( scene === 2 ) {

			// Petting Fur: ultra-warm hushed harmonic thrum
			v.f1 = f1;
			v.f2 = f1 * 1.5;
			v.f3 = f1 * 2.0;
			v.amp = 0.055 * clamp( intensity, 0.12, 1.0 );
			v.decay = Math.exp( - 1 / ( this.sr * 1.15 ) );
			v.d2 = Math.exp( - 1 / ( this.sr * 0.65 ) );
			v.d3 = Math.exp( - 1 / ( this.sr * 0.35 ) );
			v.a2 = 0.22;
			v.a3 = 0.08;
			v.attack = 0.025;
			v.noiseAmt = 0;

		} else {

			// Moss & Pappus: warm wooden marimba / kalimba dewdrop
			v.f1 = f1;
			v.f2 = f1 * 2.0;
			v.f3 = f1 * 3.98; // rosewood bar overtone
			v.amp = 0.105 * clamp( intensity, 0.12, 1.2 );
			v.decay = Math.exp( - 1 / ( this.sr * ( 0.85 + this.rand01() * 0.55 ) ) );
			v.d2 = Math.exp( - 1 / ( this.sr * 0.35 ) );
			v.d3 = Math.exp( - 1 / ( this.sr * 0.12 ) );
			v.a2 = 0.24;
			v.a3 = 0.12;
			v.attack = 0.005;
			v.noiseAmt = 0.04;

		}

	}

	spawnSigh() {

		// Barely-there warm contented harmonic sigh for Petting Fur
		const v = this.voices[ this.nextVoice ];
		this.nextVoice = ( this.nextVoice + 1 ) % this.voices.length;
		v.active = true;
		v.isSigh = true;
		v.isDrop = false;
		v.age = 0;
		v.f1 = 196.0;
		v.f2 = 293.66;
		v.f3 = 392.0;
		v.p1 = 0;
		v.p2 = 0;
		v.p3 = 0;
		v.amp = 0.068;
		v.decay = Math.exp( - 1 / ( this.sr * 1.55 ) );
		v.d2 = Math.exp( - 1 / ( this.sr * 1.25 ) );
		v.d3 = Math.exp( - 1 / ( this.sr * 0.85 ) );
		v.a2 = 0.42;
		v.a3 = 0.15;
		v.pan = 0;
		v.attack = 0.38;
		v.noiseAmt = 0.24;

	}

	spawnDrop( pan, size, intensity ) {

		// Physically modeled Minnaert bubble cavity water-drop plink:
		// smaller drops pinch off higher & faster; larger held drops resonate deeper & rounder
		const v = this.voices[ this.nextVoice ];
		this.nextVoice = ( this.nextVoice + 1 ) % this.voices.length;

		const sz = clamp( size || 1.0, 0.5, 2.2 );
		const szNorm = clamp( ( sz - 0.55 ) / 1.45, 0, 1 );
		// Map smaller drops toward higher register, heavier drops toward warm mellow mid-lows
		const maxIdx = FILM_SCALE.length - 1;
		const centerIdx = Math.round( ( 1 - szNorm ) * ( maxIdx - 2 ) ) + 1;
		const jitter = Math.floor( this.rand() * 1.9 );
		const idx = clamp( centerIdx + jitter, 0, maxIdx );

		const fEnd = FILM_SCALE[ idx ] * ( 1 + this.rand() * 0.006 );
		const chirpRatio = 1.48 + ( 1 - szNorm ) * 0.28; // characteristic upward liquid bloop
		const fStart = fEnd / chirpRatio;

		v.active = true;
		v.isSigh = false;
		v.isDrop = true;
		v.age = 0;
		v.fStart = fStart;
		v.f1 = fEnd;
		v.f2 = fEnd * 2.0;
		v.f3 = fEnd * 3.01;
		v.chirpTau = 0.024 + szNorm * 0.024;
		v.p1 = 0;
		v.p2 = 0;
		v.p3 = 0;
		v.pan = clamp( pan || 0, - 0.85, 0.85 );
		v.amp = 0.105 * clamp( intensity || 0.62, 0.16, 1.15 );
		v.decay = Math.exp( - 1 / ( this.sr * ( 0.28 + szNorm * 0.24 + this.rand01() * 0.12 ) ) );
		v.d2 = Math.exp( - 1 / ( this.sr * 0.085 ) );
		v.d3 = Math.exp( - 1 / ( this.sr * 0.045 ) );
		v.a2 = 0.16;
		v.a3 = 0.05;
		v.attack = 0.0028;
		v.noiseAmt = 0.022;

	}

	process( _inputs, outputs ) {

		const out = outputs[ 0 ];
		if ( ! out || out.length === 0 ) return true;

		const outL = out[ 0 ];
		const outR = out[ 1 ] || out[ 0 ];
		const N = outL.length;
		const invSr = 1 / this.sr;

		const masterStep = 1 - Math.exp( - 1 / ( this.sr * 0.42 ) );
		const sceneStep = 1 - Math.exp( - 1 / ( this.sr * 0.55 ) );
		const paramStep = 1 - Math.exp( - 1 / ( this.sr * 0.055 ) );
		const lpAlpha = 1 - Math.exp( - TWO_PI * 5200 * invSr );
		const revDamp = 0.36;

		// Occasional organic micro-events per block (zero allocations)
		this.sparkleCooldown -= N * invSr;
		this.thawCooldown -= N * invSr;

		if ( this.master > 0.01 ) {

			// Moss: soft pappus harp flutters while swirling
			if ( this.wMoss > 0.35 && this.sSpeed > 0.18 && this.sparkleCooldown <= 0 ) {

				const prob = clamp( ( this.sSpeed - 0.15 ) * 0.32, 0, 0.55 );
				if ( this.rand01() < prob ) {

					this.spawnModal( 0, this.sPan + this.rand() * 0.25, 0.22 + this.sSpeed * 0.18 );
					this.sparkleCooldown = 0.16 + this.rand01() * 0.24;

				}

			}

			// Snow: delicate refracted ice-crystal sparkles while sweeping or breathing
			if ( this.wSnow > 0.35 && ( this.sSpeed + this.sBreath * 0.9 ) > 0.14 && this.sparkleCooldown <= 0 ) {

				const activity = this.sSpeed + this.sBreath * 0.9;
				if ( this.rand01() < clamp( activity * 0.42, 0, 0.72 ) ) {

					const hiIdx = 4 + Math.floor( this.rand01() * ( SNOW_SCALE.length - 4 ) );
					this.spawnModal( 1, this.sPan + this.rand() * 0.35, 0.18 + Math.min( 0.45, activity * 0.26 ), hiIdx );
					this.sparkleCooldown = 0.09 + this.rand01() * 0.19;

				}

			}

			// Snow thermal thaw surprise: tiny crystalline water-drop pings when warm/still or gentle breath
			if ( this.wSnow > 0.5 && ( this.sStillGlow > 0.45 || ( this.sBreath > 0.1 && this.sBreath < 0.55 ) ) && this.thawCooldown <= 0 ) {

				if ( this.rand01() < 0.08 ) {

					const dropIdx = Math.floor( this.rand01() * 5 );
					this.spawnModal( 1, this.sPan + this.rand() * 0.4, 0.24, dropIdx );
					this.thawCooldown = 0.9 + this.rand01() * 1.4;

				}

			}

		}

		// Precompute per-block SVF coefficients
		const speedNorm = clamp( this.sSpeed, 0, 1.6 );
		const breathNorm = clamp( this.sBreath, 0, 1.2 );
		const windCutoff = clamp( 240 + speedNorm * 680 + breathNorm * 620 + this.gustEnv * 920, 180, 2800 );
		const windG = Math.tan( Math.PI * windCutoff * invSr );

		const bedCutoff = 260 * this.wMoss + 520 * this.wSnow + 190 * this.wDog + 205 * this.wFilm;
		const bedG = Math.tan( Math.PI * clamp( bedCutoff, 140, 1400 ) * invSr );

		// Breed-morphed fur-whisper formants
		const furFreqLo = 1120 * this.tBreedLab + 560 * this.tBreedHusky + 810 * this.tBreedBernese;
		const furFreqHi = 2850 * this.tBreedLab + 2150 * this.tBreedHusky + 2500 * this.tBreedBernese;
		const furLoG = Math.tan( Math.PI * clamp( furFreqLo + speedNorm * 320 + this.sAgainstGrain * 260, 320, 2600 ) * invSr );
		const furHiG = Math.tan( Math.PI * clamp( furFreqHi + this.sAgainstGrain * 550, 1200, 4800 ) * invSr );

		const iceCutoff = clamp( 2100 + speedNorm * 1200 + breathNorm * 800, 1400, 4600 );
		const iceG = Math.tan( Math.PI * iceCutoff * invSr );

		for ( let i = 0; i < N; i ++ ) {

			// Smooth master & scene blend weights
			this.master += ( this.targetMaster - this.master ) * masterStep;
			this.wMoss += ( ( this.sceneId === 0 ? 1 : 0 ) - this.wMoss ) * sceneStep;
			this.wSnow += ( ( this.sceneId === 1 ? 1 : 0 ) - this.wSnow ) * sceneStep;
			this.wDog += ( ( this.sceneId === 2 ? 1 : 0 ) - this.wDog ) * sceneStep;
			this.wFilm += ( ( this.sceneId === 3 ? 1 : 0 ) - this.wFilm ) * sceneStep;

			if ( this.master < 1e-5 && this.targetMaster === 0 ) {

				outL[ i ] = 0;
				outR[ i ] = 0;
				continue;

			}

			// Smooth real-time telemetry parameters
			this.sSpeed += ( this.tSpeed - this.sSpeed ) * paramStep;
			this.sPan += ( this.tPan - this.sPan ) * paramStep;
			this.sPressure += ( this.tPressure - this.sPressure ) * paramStep;
			this.sBreath += ( this.tBreath - this.sBreath ) * paramStep;
			this.sVortex += ( this.tVortex - this.sVortex ) * paramStep;
			this.sDogBreath += ( this.tDogBreath - this.sDogBreath ) * paramStep;
			this.sAgainstGrain += ( this.tAgainstGrain - this.sAgainstGrain ) * paramStep;
			this.sStillGlow += ( this.tStillGlow - this.sStillGlow ) * paramStep;
			this.sSlowGlide += ( this.tSlowGlide - this.sSlowGlide ) * paramStep;

			// Decay one-shot sweep envelopes
			if ( this.gustEnv > 1e-4 ) this.gustEnv *= 0.99994;
			if ( this.shakeEnv > 1e-4 ) {

				this.shakeEnv *= 0.99995;
				this.shakePhase += invSr;

			}
			if ( this.smoothEnv > 1e-4 ) {

				this.smoothEnv *= 0.99996;
				this.smoothPhase += invSr;

			}

			// Decorrelated stereo white & pink noise
			const wL = this.rand();
			const wR = this.rand();
			const pL = nextPink( this.pinkL, wL );
			const pR = nextPink( this.pinkR, wR );

			// Subtle slow breathing LFO
			this.lfoPh += 0.14 * TWO_PI * invSr;
			if ( this.lfoPh > TWO_PI ) this.lfoPh -= TWO_PI;
			const slowLfo = 0.5 + 0.5 * Math.sin( this.lfoPh );

			// Stereo pan gains
			const panAng = ( this.sPan * 0.5 + 0.5 ) * ( Math.PI * 0.5 );
			const panGainL = Math.cos( panAng );
			const panGainR = Math.sin( panAng );

			let dryL = 0;
			let dryR = 0;
			let wetSendL = 0;
			let wetSendR = 0;

			// ----------------------------------------------------------
			// 1. AMBIENT ASMR BEDS (consistent to scene, always present when unmuted)
			// ----------------------------------------------------------
			const bedFiltL = stepSVF( this.bedL, pL, bedG, 1.35 ).bp;
			const bedFiltR = stepSVF( this.bedR, pR, bedG, 1.35 ).bp;

			// Moss ambient: woodland breeze + warm breathing D2/A2 harmonic pad
			if ( this.wMoss > 0.002 ) {

				this.ph0 += 146.83 * TWO_PI * invSr;
				this.ph1 += 220.00 * TWO_PI * invSr;
				if ( this.ph0 > TWO_PI ) this.ph0 -= TWO_PI;
				if ( this.ph1 > TWO_PI ) this.ph1 -= TWO_PI;

				const drone = ( Math.sin( this.ph0 ) * 0.62 + Math.sin( this.ph1 ) * 0.38 ) * ( 0.022 + 0.014 * slowLfo );
				// Surprise: meditative slow-glide warm wooden overtone
				const glideHarm = Math.sin( this.ph1 * 2.0 ) * this.sSlowGlide * 0.022;
				const mossAirL = bedFiltL * ( 0.068 + 0.03 * slowLfo ) + drone + glideHarm;
				const mossAirR = bedFiltR * ( 0.068 + 0.03 * ( 1 - slowLfo ) ) + drone + glideHarm;

				dryL += mossAirL * this.wMoss;
				dryR += mossAirR * this.wMoss;
				wetSendL += ( drone + glideHarm ) * this.wMoss * 0.5;
				wetSendR += ( drone + glideHarm ) * this.wMoss * 0.5;

			}

			// Snow ambient: glacial hushed air + delicate glass-harmonica + vortex glass-bowl hum
			if ( this.wSnow > 0.002 ) {

				this.ph2 += ( 369.99 + this.sVortex * this.sSpeed * 18 ) * TWO_PI * invSr;
				this.ph3 += ( 554.37 + this.sVortex * this.sSpeed * 27 ) * TWO_PI * invSr;
				if ( this.ph2 > TWO_PI ) this.ph2 -= TWO_PI;
				if ( this.ph3 > TWO_PI ) this.ph3 -= TWO_PI;

				const shimmer = ( Math.sin( this.ph2 ) * 0.55 + Math.sin( this.ph3 ) * 0.45 ) * ( 0.015 + 0.012 * slowLfo );
				const vortexHum = Math.sin( this.ph2 * 0.5 ) * this.sVortex * ( 0.022 + 0.025 * Math.min( 1, this.sSpeed ) );

				const iceFiltL = stepSVF( this.iceL, wL, iceG, 0.25 ).bp;
				const iceFiltR = stepSVF( this.iceR, wR, iceG, 0.25 ).bp;
				const frostHush = 0.012 + 0.035 * Math.min( 1, this.sSpeed + this.sBreath );

				const snowL = bedFiltL * 0.055 + iceFiltL * frostHush + shimmer + vortexHum;
				const snowR = bedFiltR * 0.055 + iceFiltR * frostHush + shimmer + vortexHum;

				dryL += snowL * this.wSnow;
				dryR += snowR * this.wSnow;
				wetSendL += ( shimmer + vortexHum + iceFiltL * frostHush ) * this.wSnow * 0.65;
				wetSendR += ( shimmer + vortexHum + iceFiltR * frostHush ) * this.wSnow * 0.65;

			}

			// Petting Fur ambient: cozy sunlit room warmth + subliminal dog ribcage breathing warmth
			if ( this.wDog > 0.002 ) {

				this.ph0 += 110.0 * TWO_PI * invSr;
				if ( this.ph0 > TWO_PI ) this.ph0 -= TWO_PI;

				// Sync directly to dog's live ribcage breath (0..1)
				const breathWarmth = 0.45 + 0.55 * this.sDogBreath;
				const roomWarm = Math.sin( this.ph0 ) * ( 0.012 + 0.012 * this.sDogBreath );
				const dogBedL = bedFiltL * 0.062 * breathWarmth + roomWarm;
				const dogBedR = bedFiltR * 0.062 * breathWarmth + roomWarm;

				dryL += dogBedL * this.wDog;
				dryR += dogBedR * this.wDog;

			}

			// Film Bloom ambient: nocturnal still-lake water stillness + translucent liquid-glass pad
			if ( this.wFilm > 0.002 ) {

				this.ph0 += 130.81 * TWO_PI * invSr; // warm C3
				this.ph1 += 196.00 * TWO_PI * invSr; // open G3
				this.ph2 += 293.66 * TWO_PI * invSr; // delicate D4 iridescent bloom shimmer
				if ( this.ph0 > TWO_PI ) this.ph0 -= TWO_PI;
				if ( this.ph1 > TWO_PI ) this.ph1 -= TWO_PI;
				if ( this.ph2 > TWO_PI ) this.ph2 -= TWO_PI;

				const lakePad = ( Math.sin( this.ph0 ) * 0.56 + Math.sin( this.ph1 ) * 0.44 ) * ( 0.017 + 0.011 * slowLfo );
				const bloomHarm = Math.sin( this.ph2 ) * clamp( this.sStillGlow, 0, 1 ) * ( 0.014 + 0.008 * ( 1 - slowLfo ) );
				const filmBedL = bedFiltL * ( 0.048 + 0.024 * slowLfo ) + lakePad + bloomHarm;
				const filmBedR = bedFiltR * ( 0.048 + 0.024 * ( 1 - slowLfo ) ) + lakePad + bloomHarm;

				dryL += filmBedL * this.wFilm;
				dryR += filmBedR * this.wFilm;
				wetSendL += ( lakePad + bloomHarm ) * this.wFilm * 0.62;
				wetSendR += ( lakePad + bloomHarm ) * this.wFilm * 0.62;

			}

			// ----------------------------------------------------------
			// 2. REACTIVE SILKY WIND / LIQUID SWOOSH (Moss, Snow, Film + global breath breeze)
			// ----------------------------------------------------------
			const swooshAmt = ( this.wMoss + this.wSnow ) * ( Math.min( 1.2, this.sSpeed * 0.72 ) + this.sBreath * 0.85 + this.gustEnv * 0.95 )
				+ this.wFilm * ( Math.min( 1.0, this.sSpeed * 0.52 ) + this.sBreath * 0.68 + this.gustEnv * 0.82 )
				+ this.wDog * ( this.sBreath * 0.48 );
			if ( swooshAmt > 0.004 ) {

				const wFiltL = stepSVF( this.windL, pL, windG, 0.72 ).bp;
				const wFiltR = stepSVF( this.windR, pR, windG, 0.72 ).bp;
				const gAmt = swooshAmt * 0.24;
				const sL = wFiltL * gAmt * ( 0.42 + 0.78 * panGainL );
				const sR = wFiltR * gAmt * ( 0.42 + 0.78 * panGainR );

				dryL += sL;
				dryR += sR;
				wetSendL += sL * 0.35;
				wetSendR += sR * 0.35;

			}

			// ----------------------------------------------------------
			// 3. TACTILE WHISPERING DOG FUR (Petting Fur — breed-morphed ASMR)
			// ----------------------------------------------------------
			if ( this.wDog > 0.002 ) {

				// Velvet impulse texture mixed with smooth pink brush noise
				const velvetL = Math.abs( wL ) > 0.92 ? ( wL > 0 ? 0.55 : - 0.55 ) : 0;
				const velvetR = Math.abs( wR ) > 0.92 ? ( wR > 0 ? 0.55 : - 0.55 ) : 0;
				const grainMix = 0.14 + 0.28 * this.sAgainstGrain + 0.12 * this.tBreedLab;
				const srcL = pL + velvetL * grainMix;
				const srcR = pR + velvetR * grainMix;

				const flL = stepSVF( this.furLoL, srcL, furLoG, 1.05 ).bp;
				const flR = stepSVF( this.furLoR, srcR, furLoG, 1.05 ).bp;
				const fhL = stepSVF( this.furHiL, srcL, furHiG, 1.45 ).bp;
				const fhR = stepSVF( this.furHiR, srcR, furHiG, 1.45 ).bp;

				const petEnergy = clamp( this.sSpeed * 0.85, 0, 1.2 ) * ( 0.55 + 0.45 * clamp( this.sPressure, 0.3, 1.8 ) );
				// Shake Off ripples left-to-right across the stereo field
				const shakeLfo = this.shakeEnv > 0.001
					? this.shakeEnv * ( 0.45 + 0.55 * Math.abs( Math.sin( this.shakePhase * 22.0 ) ) )
					: 0;
				const shakePan = clamp( - 0.85 + this.shakePhase * 1.1, - 0.85, 0.85 );
				const shakeAng = ( shakePan * 0.5 + 0.5 ) * ( Math.PI * 0.5 );
				const smoothSweep = this.smoothEnv > 0.001
					? this.smoothEnv * Math.sin( clamp( this.smoothPhase * 1.8, 0, Math.PI ) )
					: 0;

				const furAmt = ( petEnergy * 0.34 + smoothSweep * 0.24 ) * this.wDog;
				const hiMix = 0.32 + 0.36 * this.sAgainstGrain + 0.18 * this.tBreedBernese;
				const fL = ( flL + fhL * hiMix ) * furAmt * ( 0.45 + 0.75 * panGainL )
					+ ( flL * 1.15 + fhL * 0.65 ) * shakeLfo * 0.34 * Math.cos( shakeAng ) * this.wDog;
				const fR = ( flR + fhR * hiMix ) * furAmt * ( 0.45 + 0.75 * panGainR )
					+ ( flR * 1.15 + fhR * 0.65 ) * shakeLfo * 0.34 * Math.sin( shakeAng ) * this.wDog;

				dryL += fL;
				dryR += fR;
				wetSendL += fL * 0.16;
				wetSendR += fR * 0.16;

			}

			// ----------------------------------------------------------
			// 4. POLYPHONIC MODAL RESONATORS (Plinks, Chimes, Dewdrops, Ice, Sigh)
			// ----------------------------------------------------------
			for ( let vi = 0; vi < 12; vi ++ ) {

				const v = this.voices[ vi ];
				if ( ! v.active ) continue;

				v.age += invSr;
				const envAtk = v.age < v.attack ? ( v.age / v.attack ) : 1;
				v.amp *= v.decay;
				v.a2 *= v.d2;
				v.a3 *= v.d3;

				if ( v.amp < 1e-5 ) {

					v.active = false;
					continue;

				}

				// Pitch trajectory: Minnaert upward bubble chirp on water drops, gentle pitch drop on sigh
				let fInst1 = v.f1;
				let fInst2 = v.f2;
				let fInst3 = v.f3;
				if ( v.isDrop ) {

					const chirpE = Math.exp( - v.age / v.chirpTau );
					fInst1 = v.f1 - ( v.f1 - v.fStart ) * chirpE;
					fInst2 = fInst1 * 2.0;
					fInst3 = fInst1 * 3.01;

				} else if ( v.isSigh ) {

					const pitchMul = 1 - Math.min( 0.09, v.age * 0.045 );
					fInst1 *= pitchMul;
					fInst2 *= pitchMul;
					fInst3 *= pitchMul;

				}

				v.p1 += fInst1 * TWO_PI * invSr;
				v.p2 += fInst2 * TWO_PI * invSr;
				v.p3 += fInst3 * TWO_PI * invSr;
				if ( v.p1 > TWO_PI ) v.p1 -= TWO_PI;
				if ( v.p2 > TWO_PI ) v.p2 -= TWO_PI;
				if ( v.p3 > TWO_PI ) v.p3 -= TWO_PI;

				let sig = ( Math.sin( v.p1 ) + Math.sin( v.p2 ) * v.a2 + Math.sin( v.p3 ) * v.a3 ) * v.amp * envAtk;
				if ( v.noiseAmt > 0 && v.age < ( v.isSigh ? 1.8 : 0.03 ) ) {

					const nEnv = v.isSigh ? Math.sin( clamp( v.age / 1.8, 0, 1 ) * Math.PI ) : ( 1 - v.age / 0.03 );
					sig += pL * v.noiseAmt * nEnv * ( v.isSigh ? 0.35 : v.amp * 2.2 );

				}

				const vp = ( v.pan * 0.5 + 0.5 ) * ( Math.PI * 0.5 );
				const vL = sig * Math.cos( vp );
				const vR = sig * Math.sin( vp );

				dryL += vL;
				dryR += vR;
				wetSendL += vL * 0.58;
				wetSendR += vR * 0.58;

			}

			// ----------------------------------------------------------
			// 5. WARM 4-LINE HADAMARD FDN STEREO REVERB
			// ----------------------------------------------------------
			const d0 = this.fdnBufs[ 0 ][ this.fdnIdx[ 0 ] ];
			const d1 = this.fdnBufs[ 1 ][ this.fdnIdx[ 1 ] ];
			const d2 = this.fdnBufs[ 2 ][ this.fdnIdx[ 2 ] ];
			const d3 = this.fdnBufs[ 3 ][ this.fdnIdx[ 3 ] ];

			// Soft 1-pole damping inside feedback loop for warm wooden/silky decay
			this.fdnLp[ 0 ] += ( d0 - this.fdnLp[ 0 ] ) * revDamp;
			this.fdnLp[ 1 ] += ( d1 - this.fdnLp[ 1 ] ) * revDamp;
			this.fdnLp[ 2 ] += ( d2 - this.fdnLp[ 2 ] ) * revDamp;
			this.fdnLp[ 3 ] += ( d3 - this.fdnLp[ 3 ] ) * revDamp;

			const fb = 0.34; // ortho Hadamard factor 0.5 * 0.68 feedback
			const f0 = this.fdnLp[ 0 ];
			const f1 = this.fdnLp[ 1 ];
			const f2 = this.fdnLp[ 2 ];
			const f3 = this.fdnLp[ 3 ];

			this.fdnBufs[ 0 ][ this.fdnIdx[ 0 ] ] = wetSendL + ( f0 + f1 + f2 + f3 ) * fb;
			this.fdnBufs[ 1 ][ this.fdnIdx[ 1 ] ] = wetSendR + ( f0 - f1 + f2 - f3 ) * fb;
			this.fdnBufs[ 2 ][ this.fdnIdx[ 2 ] ] = wetSendL + ( f0 + f1 - f2 - f3 ) * fb;
			this.fdnBufs[ 3 ][ this.fdnIdx[ 3 ] ] = wetSendR + ( f0 - f1 - f2 + f3 ) * fb;

			for ( let c = 0; c < 4; c ++ ) {

				this.fdnIdx[ c ] = ( this.fdnIdx[ c ] + 1 ) % this.fdnBufs[ c ].length;

			}

			const revL = ( d0 + d2 ) * 0.36;
			const revR = ( d1 + d3 ) * 0.36;

			// Master warmth roll-off + soft tanh low-cortisol limiter
			const mixL = ( dryL + revL ) * this.master * 0.88;
			const mixR = ( dryR + revR ) * this.master * 0.88;

			this.masterLpL += ( mixL - this.masterLpL ) * lpAlpha;
			this.masterLpR += ( mixR - this.masterLpR ) * lpAlpha;

			const finalL = Math.tanh( this.masterLpL );
			const finalR = Math.tanh( this.masterLpR );

			outL[ i ] = finalL;
			outR[ i ] = finalR;

			this.rmsAcc += 0.5 * ( finalL * finalL + finalR * finalR );
			this.rmsCount ++;

		}

		// Report live output RMS (~24 Hz) so BreathInput can duck speaker feedback
		if ( this.rmsCount >= 2048 ) {

			const rms = Math.sqrt( this.rmsAcc / this.rmsCount );
			this.rmsAcc = 0;
			this.rmsCount = 0;
			this.port.postMessage( { type: 'rms', value: rms } );

		}

		return true;

	}

}

registerProcessor( 'collision-audio-processor', CollisionAudioProcessor );
