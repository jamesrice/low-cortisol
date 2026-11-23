// Engine-level procedural AudioWorklet soundscape controller.
// Scene-consistent low-cortisol ASMR synthesis driven purely by scene physics & state,
// independent of whether interaction came from mouse, touch, OLED swipe, breath, or webcam hands.

export function createAudioEngine() {

	let ctx = null;
	let node = null;
	let initializing = null;
	let enabled = false;
	let currentScene = 'moss';
	let outputRms = 0;
	let lastTelemetryMs = - Infinity;
	let gentlePetSeconds = 0;
	let lastSighMs = - Infinity;
	let chimeIndex = 0;

	async function ensureReady() {

		if ( node && ctx ) return true;
		if ( initializing ) return initializing;

		initializing = ( async () => {

			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			if ( ! AudioCtx ) throw new Error( 'Web Audio API is not available in this browser.' );

			ctx = new AudioCtx( { latencyHint: 'interactive' } );
			const workletUrl = new URL( './src/engine/audio-worklet.js', window.location.href );
			await ctx.audioWorklet.addModule( workletUrl );

			node = new AudioWorkletNode( ctx, 'collision-audio-processor', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [ 2 ]
			} );

			node.port.onmessage = ( ev ) => {

				if ( ev.data && ev.data.type === 'rms' ) {

					outputRms = ev.data.value || 0;

				}

			};

			node.connect( ctx.destination );
			node.port.postMessage( { type: 'scene', id: currentScene } );
			node.port.postMessage( { type: 'master', value: enabled ? 0.92 : 0 } );
			return true;

		} )();

		try {

			return await initializing;

		} catch ( err ) {

			initializing = null;
			throw err;

		}

	}

	function post( payload ) {

		if ( node ) node.port.postMessage( payload );

	}

	async function setEnabled( next ) {

		enabled = Boolean( next );

		if ( enabled ) {

			await ensureReady();
			if ( ctx && ctx.state === 'suspended' ) await ctx.resume();
			post( { type: 'scene', id: currentScene } );
			post( { type: 'master', value: 0.92 } );

		} else {

			post( { type: 'master', value: 0 } );

		}

		return enabled;

	}

	function setScene( sceneName ) {

		currentScene = sceneName;
		gentlePetSeconds = 0;
		chimeIndex = 0;
		post( { type: 'scene', id: sceneName } );

	}

	function updateTelemetry( data, dt = 1 / 60 ) {

		if ( ! enabled || ! node ) return;

		// Track slow, gentle continuous petting in Petting Fur for the contented warm sigh surprise
		if ( currentScene === 'dog' ) {

			const sp = data.speed || 0;
			if ( sp > 0.08 && sp < 1.35 ) {

				gentlePetSeconds += dt;
				const now = performance.now();
				if ( gentlePetSeconds > 6.2 && ( now - lastSighMs ) > 18000 ) {

					lastSighMs = now;
					gentlePetSeconds = 0;
					post( { type: 'sigh' } );

				}

			} else {

				gentlePetSeconds = Math.max( 0, gentlePetSeconds - dt * 0.45 );

			}

		}

		// Throttle postMessage to ~33 Hz (audio-thread per-sample smoothing interpolates seamlessly)
		const now = performance.now();
		if ( ( now - lastTelemetryMs ) < 28 ) return;
		lastTelemetryMs = now;

		post( {
			type: 'telemetry',
			speed: data.speed || 0,
			pan: data.pan || 0,
			pressure: data.pressure ?? 0.5,
			breath: data.breath || 0,
			vortex: Boolean( data.vortex ),
			dogBreath: data.dogBreath ?? 0.5,
			breedLab: data.breedLab ?? 1,
			breedHusky: data.breedHusky ?? 0,
			breedBernese: data.breedBernese ?? 0,
			againstGrain: data.againstGrain || 0,
			stillGlow: data.stillGlow || 0,
			slowGlide: data.slowGlide || 0
		} );

	}

	function triggerPlink( pan = 0, intensity = 0.72, pitchIndex = undefined ) {

		if ( ! enabled ) return;
		post( { type: 'plink', pan, intensity, pitchIndex } );

	}

	function triggerPulse( pan = 0 ) {

		if ( ! enabled ) return;
		post( { type: 'pulse', pan } );

	}

	function triggerGust( pan = 0 ) {

		if ( ! enabled ) return;
		post( { type: 'gust', pan } );

	}

	function triggerChime( pan = 0, intensity = 0.68 ) {

		if ( ! enabled ) return;
		post( { type: 'chime', pan, intensity, pitchIndex: chimeIndex } );
		chimeIndex = ( chimeIndex + 1 ) % 9;

	}

	function triggerDrop( pan = 0, size = 1.0, intensity = 0.65 ) {

		if ( ! enabled ) return;
		post( { type: 'drop', pan, size, intensity } );

	}

	function triggerShakeOff() {

		if ( ! enabled ) return;
		post( { type: 'shake' } );

	}

	function triggerSmoothCoat() {

		if ( ! enabled ) return;
		post( { type: 'smooth' } );

	}

	function dispose() {

		enabled = false;
		if ( node ) {

			try { node.disconnect(); } catch {}
			node = null;

		}
		if ( ctx ) {

			try { ctx.close(); } catch {}
			ctx = null;

		}
		initializing = null;

	}

	return {
		get enabled() { return enabled; },
		get scene() { return currentScene; },
		getOutputLevel: () => ( enabled ? outputRms : 0 ),
		setEnabled,
		toggle: () => setEnabled( ! enabled ),
		setScene,
		updateTelemetry,
		triggerPlink,
		triggerPulse,
		triggerGust,
		triggerChime,
		triggerDrop,
		triggerShakeOff,
		triggerSmoothCoat,
		dispose
	};

}
