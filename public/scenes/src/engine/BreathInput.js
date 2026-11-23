// 3-Phase Breath Microphone Input Controller:
//   Phase 0 ('off'):    Microphone closed (MediaStreamTracks stopped, OS mic indicator off).
//   Phase 1 ('breeze'): Soft blowing creates living wind around pointer/hand; strong puff triggers
//                       Pulse (Moss), Frost Gust (Snow), or Shake Off (Petting Fur).
//   Phase 2 ('steer'):  Everything in Breeze + breath spectral brightness ("whooo" vs. "shhhh", or
//                       true L/R balance on stereo mics) steers the interaction horizontally hands-free.

const MODES = [ 'off', 'breeze', 'steer' ];

export function createBreathInput( { getAudioOutputLevel = () => 0 } = {} ) {

	let modeIndex = 0; // 0=off, 1=breeze, 2=steer
	let ctx = null;
	let stream = null;
	let source = null;
	let workletNode = null;
	let silentSink = null;
	let starting = null;

	// Adaptive calibration & smoothed DSP state
	let noiseFloor = 0.015;
	let calibFrames = 0;
	let rawEnergy = 0;
	let smoothEnergy = 0;
	let prevEnergy = 0;
	let smoothCentroid = 0.5;
	let smoothStereoPan = 0;
	let hasStereo = false;
	let lastPuffMs = - Infinity;
	let pendingPuff = false;
	let lastError = null;

	// Subtle ambient flowing breath-waveform overlay (matching HandInput's gossamer light-line style)
	let waveCanvas = null;
	let waveCtx = null;
	let waveResize = null;
	let wavePhase = 0;
	let displaySteerX = 0;
	let puffRippleAge = 10;
	let puffRippleX = 0.5;

	function sizeWaveCanvas() {

		if ( ! waveCanvas ) return;
		const dpr = Math.min( window.devicePixelRatio || 1, 1.5 );
		const w = Math.max( 1, Math.round( window.innerWidth * dpr ) );
		const h = Math.max( 1, Math.round( window.innerHeight * dpr ) );
		if ( waveCanvas.width !== w || waveCanvas.height !== h ) {

			waveCanvas.width = w;
			waveCanvas.height = h;

		}

	}

	function ensureWaveOverlay() {

		if ( waveCanvas ) return;
		waveCanvas = document.createElement( 'canvas' );
		waveCanvas.id = 'breath-stage-overlay';
		waveCanvas.style.cssText = [
			'position:fixed',
			'inset:0',
			'width:100%',
			'height:100%',
			'z-index:4',
			'pointer-events:none',
			'mix-blend-mode:screen'
		].join( ';' );
		document.body.appendChild( waveCanvas );
		waveCtx = waveCanvas.getContext( '2d' );
		sizeWaveCanvas();
		waveResize = () => sizeWaveCanvas();
		window.addEventListener( 'resize', waveResize, { passive: true } );

	}

	function removeWaveOverlay() {

		if ( waveResize ) {

			window.removeEventListener( 'resize', waveResize );
			waveResize = null;

		}
		if ( waveCanvas && waveCanvas.parentNode ) waveCanvas.parentNode.removeChild( waveCanvas );
		waveCanvas = null;
		waveCtx = null;

	}

	function drawBreathWaveform( dt, energy, steerX, centroid, puff, mode ) {

		if ( ! waveCtx || ! waveCanvas ) return;

		const W = waveCanvas.width;
		const H = waveCanvas.height;
		const dpr = W / Math.max( 1, window.innerWidth );
		waveCtx.clearRect( 0, 0, W, H );

		// Smoothly glide the focal crest horizontally to visualize breath directionality
		const steerTarget = mode === 'steer' || hasStereo ? steerX : ( steerX * 0.45 );
		displaySteerX += ( steerTarget - displaySteerX ) * ( 1 - Math.exp( - dt * 8.0 ) );

		// Advance flowing ribbon phase (direction tracks breath steering; speed scales with intensity)
		const dirSign = displaySteerX >= - 0.04 ? 1 : - 1;
		wavePhase += dt * ( 1.45 + energy * 7.2 ) * dirSign;

		if ( puff ) {

			puffRippleAge = 0;
			puffRippleX = 0.5 + displaySteerX * 0.34;

		} else if ( puffRippleAge < 2.0 ) {

			puffRippleAge += dt;

		}

		const styles = getComputedStyle( document.body );
		const accent = styles.getPropertyValue( '--accent' ).trim() || '#a6ea57';
		const warm = styles.getPropertyValue( '--accent-warm' ).trim() || '#f6dc7a';

		// Ribbon sits gently along the lower horizon above the hint & GitHub pill
		const spanW = Math.min( W * 0.66, 620 * dpr );
		const x0 = ( W - spanW ) * 0.5;
		const baseY = H - Math.max( 86 * dpr, H * 0.13 );
		const focusU = 0.5 + displaySteerX * 0.38; // normalized crest center [0.12 .. 0.88]
		const focusX = x0 + focusU * spanW;

		// Soft luminous directional focal glow riding along the breath crest
		if ( energy > 0.03 ) {

			const glowR = ( 34 + energy * 76 ) * dpr;
			const g = waveCtx.createRadialGradient( focusX, baseY, 0, focusX, baseY, glowR );
			g.addColorStop( 0, mode === 'steer' ? warm : accent );
			g.addColorStop( 1, 'rgba(0,0,0,0)' );
			waveCtx.save();
			waveCtx.globalAlpha = Math.min( 0.24, 0.05 + energy * 0.20 );
			waveCtx.fillStyle = g;
			waveCtx.beginPath();
			waveCtx.arc( focusX, baseY, glowR, 0, Math.PI * 2 );
			waveCtx.fill();
			waveCtx.restore();

		}

		// Three gossamer layered airflow ribbons (intensity controls amplitude, centroid controls wave fineness)
		const layers = [
			{ freq: 2.2 + centroid * 2.6, amp: 1.00, alpha: 0.10 + energy * 0.28, width: 1.35 * dpr, color: warm, phaseOff: 0 },
			{ freq: 3.1 + centroid * 3.2, amp: 0.68, alpha: 0.07 + energy * 0.21, width: 1.05 * dpr, color: accent, phaseOff: 1.9 },
			{ freq: 1.5 + centroid * 1.8, amp: 0.48, alpha: 0.05 + energy * 0.16, width: 0.90 * dpr, color: accent, phaseOff: 3.7 }
		];

		const maxAmp = ( 2.5 + Math.pow( energy, 0.85 ) * 34 ) * dpr;
		const samples = 64;

		for ( const L of layers ) {

			waveCtx.save();
			// Horizontal feathered fade at both ends so the waveform floats organically in air
			const grad = waveCtx.createLinearGradient( x0, baseY, x0 + spanW, baseY );
			grad.addColorStop( 0.00, 'rgba(0,0,0,0)' );
			grad.addColorStop( 0.16, L.color );
			grad.addColorStop( 0.84, L.color );
			grad.addColorStop( 1.00, 'rgba(0,0,0,0)' );

			waveCtx.strokeStyle = grad;
			waveCtx.globalAlpha = L.alpha;
			waveCtx.lineWidth = L.width;
			waveCtx.lineCap = 'round';
			waveCtx.beginPath();

			for ( let i = 0; i <= samples; i ++ ) {

				const u = i / samples;
				const px = x0 + u * spanW;

				// Smooth bell envelope centered around the directional breath focus
				const edgeFade = Math.sin( u * Math.PI );
				const dFocus = u - focusU;
				const dirFocus = 0.36 + 0.64 * Math.exp( - dFocus * dFocus * 9.5 );
				const env = edgeFade * dirFocus;

				const theta = u * Math.PI * 2 * L.freq - wavePhase + L.phaseOff;
				const harmonic = Math.sin( theta ) * 0.72 + Math.sin( theta * 1.73 + 0.8 ) * 0.28;
				const py = baseY + harmonic * maxAmp * L.amp * env;

				if ( i === 0 ) waveCtx.moveTo( px, py );
				else waveCtx.lineTo( px, py );

			}

			waveCtx.stroke();
			waveCtx.restore();

		}

		// Subtle directional indicator dot in Phase 2 ('steer') or stereo mode showing live horizontal aim
		if ( mode === 'steer' || hasStereo ) {

			waveCtx.save();
			waveCtx.globalAlpha = 0.22 + energy * 0.44;
			waveCtx.fillStyle = warm;
			waveCtx.beginPath();
			waveCtx.arc( focusX, baseY, ( 2.2 + energy * 2.0 ) * dpr, 0, Math.PI * 2 );
			waveCtx.fill();
			waveCtx.restore();

		}

		// Delicate expanding mist-ring ripple on strong breath puffs
		if ( puffRippleAge < 0.95 ) {

			const t = puffRippleAge / 0.95;
			const ease = 1 - Math.pow( 1 - t, 3 );
			const rx = x0 + ( 0.5 + ( puffRippleX - 0.5 ) * 1.1 ) * spanW;
			const r = ( 14 + ease * 92 ) * dpr;

			waveCtx.save();
			waveCtx.strokeStyle = warm;
			waveCtx.globalAlpha = ( 1 - t ) * 0.30;
			waveCtx.lineWidth = 1.2 * dpr;
			waveCtx.beginPath();
			waveCtx.ellipse( rx, baseY, r * 1.45, r * 0.48, 0, 0, Math.PI * 2 );
			waveCtx.stroke();
			waveCtx.restore();

		}

	}

	function onMetrics( m ) {

		if ( modeIndex === 0 || ! m ) return;

		// Estimate speaker bleed when AudioEngine is also active without headphones
		const speakerDuck = ( getAudioOutputLevel ? getAudioOutputLevel() : 0 ) * 0.24;

		// Separate turbulent airflow (breath) from narrow voiced speech/hum:
		// Breath has balanced low+mid+high airflow turbulence; speech concentrates strongly in mid formants.
		const totalBand = m.eLow + m.eMid + m.eHigh + 1e-5;
		const lowRatio = m.eLow / totalBand;
		const highRatio = m.eHigh / totalBand;
		const airflowScore = Math.min( 1, ( lowRatio * 1.1 + highRatio * 1.45 ) * 1.35 );

		// Initial ~0.5s quiet room calibration, then gentle slow drift adaptation when calm
		if ( calibFrames < 24 ) {

			noiseFloor = calibFrames === 0 ? Math.max( 0.005, m.rms ) : ( noiseFloor * 0.82 + m.rms * 0.18 );
			calibFrames ++;
			rawEnergy = 0;
			return;

		}

		const floorThreshold = Math.max( 0.008, noiseFloor * 1.65 + speakerDuck );
		const aboveFloor = Math.max( 0, m.rms - floorThreshold );

		if ( aboveFloor < 0.004 ) {

			// Calm room — slowly adapt floor down or up
			noiseFloor = noiseFloor * 0.992 + m.rms * 0.008;

		}

		// Scale normalized breath energy smoothly into [0, 1]
		const scaled = Math.min( 1, ( aboveFloor / 0.13 ) * ( 0.45 + 0.55 * airflowScore ) );
		rawEnergy = scaled;

		// Track spectral brightness ("whooo" ~ 0.12 .. "shhhh" ~ 0.85) & stereo balance when actively blowing
		hasStereo = Boolean( m.hasStereo );
		if ( scaled > 0.08 ) {

			smoothCentroid += ( m.centroid - smoothCentroid ) * 0.22;
			if ( hasStereo ) {

				smoothStereoPan += ( Math.max( - 1, Math.min( 1, m.stereoPan * 2.4 ) ) - smoothStereoPan ) * 0.26;

			}

		}

		// Strong breath puff peak detection with 1.45s low-cortisol cooldown
		const now = performance.now();
		const rise = scaled - prevEnergy;
		if ( scaled > 0.58 && rise > 0.10 && ( now - lastPuffMs ) > 1450 ) {

			lastPuffMs = now;
			pendingPuff = true;

		}
		prevEnergy = scaled;

	}

	async function startMic() {

		if ( stream && workletNode ) return true;
		if ( starting ) return starting;

		starting = ( async () => {

			if ( ! navigator.mediaDevices || ! navigator.mediaDevices.getUserMedia ) {

				throw new Error( 'Microphone access is not supported in this browser.' );

			}

			// Disable browser noiseSuppression so blowing into the mic isn't stripped as fan noise
			stream = await navigator.mediaDevices.getUserMedia( {
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
					channelCount: { ideal: 2 }
				},
				video: false
			} );

			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			ctx = new AudioCtx( { latencyHint: 'interactive' } );
			const workletUrl = new URL( './src/engine/breath-worklet.js', window.location.href );
			await ctx.audioWorklet.addModule( workletUrl );

			source = ctx.createMediaStreamSource( stream );
			workletNode = new AudioWorkletNode( ctx, 'breath-analyzer-processor', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [ 1 ],
				channelCountMode: 'max'
			} );

			// Connect through a zero-gain sink so WebKit/Safari & Chromium always pull the worklet graph
			silentSink = ctx.createGain();
			silentSink.gain.value = 0;

			workletNode.port.onmessage = ( ev ) => onMetrics( ev.data );
			source.connect( workletNode );
			workletNode.connect( silentSink );
			silentSink.connect( ctx.destination );

			if ( ctx.state === 'suspended' ) await ctx.resume();

			calibFrames = 0;
			rawEnergy = 0;
			smoothEnergy = 0;
			prevEnergy = 0;
			pendingPuff = false;
			lastError = null;
			ensureWaveOverlay();
			return true;

		} )();

		try {

			return await starting;

		} catch ( err ) {

			lastError = err;
			stopMic();
			throw err;

		} finally {

			starting = null;

		}

	}

	function stopMic() {

		if ( silentSink ) {

			try { silentSink.disconnect(); } catch {}
			silentSink = null;

		}
		if ( workletNode ) {

			try { workletNode.disconnect(); } catch {}
			workletNode = null;

		}
		if ( source ) {

			try { source.disconnect(); } catch {}
			source = null;

		}
		if ( stream ) {

			for ( const t of stream.getTracks() ) {

				try { t.stop(); } catch {}

			}
			stream = null;

		}
		if ( ctx ) {

			try { ctx.close(); } catch {}
			ctx = null;

		}

		rawEnergy = 0;
		smoothEnergy = 0;
		prevEnergy = 0;
		pendingPuff = false;
		calibFrames = 0;
		removeWaveOverlay();

	}

	async function setMode( mode ) {

		const nextIdx = typeof mode === 'number' ? ( mode % 3 ) : Math.max( 0, MODES.indexOf( mode ) );
		if ( nextIdx === 0 ) {

			modeIndex = 0;
			stopMic();
			return 'off';

		}

		await startMic();
		modeIndex = nextIdx;
		return MODES[ modeIndex ];

	}

	async function cycle() {

		const nextIdx = ( modeIndex + 1 ) % MODES.length;
		return setMode( nextIdx );

	}

	function update( dt = 1 / 60 ) {

		if ( modeIndex === 0 ) {

			smoothEnergy = 0;
			pendingPuff = false;
			return {
				mode: 'off',
				active: false,
				energy: 0,
				puff: false,
				steerX: 0,
				steerY: 0,
				centroid: 0.5,
				hasStereo: false
			};

		}

		const rate = rawEnergy > smoothEnergy ? 14.0 : 5.2;
		smoothEnergy += ( rawEnergy - smoothEnergy ) * ( 1 - Math.exp( - dt * rate ) );

		const puff = pendingPuff;
		pendingPuff = false;

		// Horizontal steering in Phase 2 ('steer'):
		//   - Uses true L/R balance if stereo mic hardware is present
		//   - Uses smooth spectral brightness ("whooo" left <-> "shhhh" right) on built-in mono mics
		const centroidX = Math.max( - 0.88, Math.min( 0.88, ( smoothCentroid - 0.44 ) * 2.4 ) );
		const steerX = hasStereo ? smoothStereoPan : centroidX;
		const steerY = Math.max( - 0.45, Math.min( 0.55, ( smoothEnergy - 0.35 ) * 0.75 ) );

		drawBreathWaveform( dt, smoothEnergy, steerX, smoothCentroid, puff, MODES[ modeIndex ] );

		return {
			mode: MODES[ modeIndex ],
			active: true,
			energy: smoothEnergy,
			puff,
			steerX,
			steerY,
			centroid: smoothCentroid,
			hasStereo
		};

	}

	function dispose() {

		modeIndex = 0;
		stopMic();

	}

	return {
		get mode() { return MODES[ modeIndex ]; },
		get modeIndex() { return modeIndex; },
		get active() { return modeIndex > 0; },
		get lastError() { return lastError; },
		setMode,
		cycle,
		update,
		dispose
	};

}
