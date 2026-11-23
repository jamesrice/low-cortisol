// Lazy-loaded MediaPipe HandLandmarker webcam input with One Euro smoothing,
// independent 5-digit 3D-aware finger tracking, Z-axis camera-distance proximity,
// distinct postures (single finger vs. open hand vs. pinch/fist), and a whisper-soft
// full-screen ambient ghost-glass camera & luminous fingertip overlay.
//
// Zero network cost until toggled On; tearing down stops all camera MediaStreamTracks.

const MP_VERSION = '1.2.3';
const MP_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ MP_VERSION }/vision_bundle.mjs`;
const MP_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ MP_VERSION }/wasm`;
const MP_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const FINGER_SPECS = [
	{ name: 'thumb', tip: 4, pip: 3, mcp: 2 },
	{ name: 'index', tip: 8, pip: 6, mcp: 5 },
	{ name: 'middle', tip: 12, pip: 10, mcp: 9 },
	{ name: 'ring', tip: 16, pip: 14, mcp: 13 },
	{ name: 'pinky', tip: 20, pip: 18, mcp: 17 }
];

const HAND_EDGES = [
	[ 0, 1 ], [ 1, 2 ], [ 2, 3 ], [ 3, 4 ],
	[ 0, 5 ], [ 5, 6 ], [ 6, 7 ], [ 7, 8 ],
	[ 5, 9 ], [ 9, 10 ], [ 10, 11 ], [ 11, 12 ],
	[ 9, 13 ], [ 13, 14 ], [ 14, 15 ], [ 15, 16 ],
	[ 13, 17 ], [ 17, 18 ], [ 18, 19 ], [ 19, 20 ],
	[ 0, 17 ]
];

class OneEuroFilter {

	constructor( minCutoff = 1.2, beta = 0.04, dCutoff = 1.0 ) {

		this.minCutoff = minCutoff;
		this.beta = beta;
		this.dCutoff = dCutoff;
		this.xPrev = null;
		this.dxPrev = 0;
		this.tPrev = null;

	}

	alpha( cutoff, dt ) {

		const tau = 1 / ( 2 * Math.PI * cutoff );
		return 1 / ( 1 + tau / dt );

	}

	reset() {

		this.xPrev = null;
		this.dxPrev = 0;
		this.tPrev = null;

	}

	filter( x, tSec ) {

		if ( this.xPrev === null || this.tPrev === null ) {

			this.xPrev = x;
			this.dxPrev = 0;
			this.tPrev = tSec;
			return x;

		}

		const dt = Math.max( 1 / 240, Math.min( 0.2, tSec - this.tPrev ) );
		this.tPrev = tSec;

		const dx = ( x - this.xPrev ) / dt;
		const aD = this.alpha( this.dCutoff, dt );
		const edx = aD * dx + ( 1 - aD ) * this.dxPrev;
		this.dxPrev = edx;

		const cutoff = this.minCutoff + this.beta * Math.abs( edx );
		const aX = this.alpha( cutoff, dt );
		const out = aX * x + ( 1 - aX ) * this.xPrev;
		this.xPrev = out;
		return out;

	}

}

function dist2( a, b ) {

	return Math.hypot( a.x - b.x, a.y - b.y );

}

function dist3( a, b ) {

	const dz = ( a.z || 0 ) - ( b.z || 0 );
	return Math.hypot( a.x - b.x, a.y - b.y, dz );

}

function clamp( x, lo, hi ) {

	return x < lo ? lo : ( x > hi ? hi : x );

}

export function createHandInput() {

	let active = false;
	let loading = false;
	let landmarker = null;
	let video = null;
	let stream = null;
	let lastVideoTime = - 1;
	let lastDetectMs = 0;

	// Full-screen ambient ghost-glass camera veil + 1:1 luminous fingertip/skeleton overlay
	let stageCanvas = null;
	let stageCtx = null;
	let statusChip = null;
	let resizeListener = null;

	// Per-hand smoothers (up to 2 hands x 5 fingertips + palm center + Z proximity)
	const handFilters = [ 0, 1 ].map( () => ( {
		palmX: new OneEuroFilter( 1.35, 0.065 ),
		palmY: new OneEuroFilter( 1.35, 0.065 ),
		prox: new OneEuroFilter( 1.0, 0.025 ),
		pinch: new OneEuroFilter( 1.8, 0.05 ),
		isPinched: false,
		tips: FINGER_SPECS.map( () => ( {
			x: new OneEuroFilter( 1.6, 0.08 ),
			y: new OneEuroFilter( 1.6, 0.08 )
		} ) )
	} ) );

	let prevPrimaryX = null;
	let prevPrimaryY = null;
	let prevSampleSec = null;
	let lastSweepMs = - Infinity;
	let lastPinchEdge = false;
	let lastHandSeenMs = - Infinity;
	let lastParsedHands = [];

	// Reusable live state snapshot returned to scenes every frame
	const state = {
		enabled: false,
		loading: false,
		detected: false,
		handCount: 0,
		x: 0.5,
		y: 0.5,
		ndcX: 0,
		ndcY: 0,
		proximity: 0.45,
		pressureScale: 1.0,
		radiusScale: 1.0,
		posture: 'none',
		openCount: 0,
		isPinched: false,
		pinchJustStarted: false,
		pinchJustReleased: false,
		sweepTriggered: false,
		digits: []
	};

	function sizeStageCanvas() {

		if ( ! stageCanvas ) return;
		const dpr = Math.min( window.devicePixelRatio || 1, 1.5 );
		const w = Math.max( 1, Math.round( window.innerWidth * dpr ) );
		const h = Math.max( 1, Math.round( window.innerHeight * dpr ) );
		if ( stageCanvas.width !== w || stageCanvas.height !== h ) {

			stageCanvas.width = w;
			stageCanvas.height = h;

		}

	}

	function ensureOverlay() {

		if ( stageCanvas ) return;

		// Full-screen ambient translucent camera reflection + 1:1 fingertip aura canvas
		stageCanvas = document.createElement( 'canvas' );
		stageCanvas.id = 'hand-stage-overlay';
		stageCanvas.style.cssText = [
			'position:fixed',
			'inset:0',
			'width:100%',
			'height:100%',
			'z-index:4',
			'pointer-events:none',
			'mix-blend-mode:screen'
		].join( ';' );
		document.body.appendChild( stageCanvas );
		stageCtx = stageCanvas.getContext( '2d' );
		sizeStageCanvas();

		resizeListener = () => sizeStageCanvas();
		window.addEventListener( 'resize', resizeListener, { passive: true } );

		// Subtle bottom-left status chip indicating live posture & Z proximity
		statusChip = document.createElement( 'div' );
		statusChip.id = 'hand-status-chip';
		statusChip.style.cssText = [
			'position:fixed',
			'left:max(16px, env(safe-area-inset-left))',
			'bottom:max(16px, env(safe-area-inset-bottom))',
			'z-index:11',
			'padding:7px 12px',
			'border-radius:12px',
			'background:var(--glass)',
			'border:1px solid var(--glass-border)',
			'backdrop-filter:blur(14px)',
			'-webkit-backdrop-filter:blur(14px)',
			'box-shadow:0 10px 28px rgba(0,0,0,0.34)',
			'color:var(--text)',
			'font-size:12px',
			'line-height:1.25',
			'pointer-events:none',
			'white-space:nowrap',
			'font-variant-numeric:tabular-nums'
		].join( ';' );
		statusChip.textContent = 'Hands · loading…';
		document.body.appendChild( statusChip );

	}

	function removeOverlay() {

		if ( resizeListener ) {

			window.removeEventListener( 'resize', resizeListener );
			resizeListener = null;

		}
		if ( stageCanvas && stageCanvas.parentNode ) stageCanvas.parentNode.removeChild( stageCanvas );
		if ( statusChip && statusChip.parentNode ) statusChip.parentNode.removeChild( statusChip );
		stageCanvas = null;
		stageCtx = null;
		statusChip = null;

	}

	// Cover-fit mapping so mirrored webcam video & normalized [0..1] landmarks align 1:1 on screen
	function computeCoverRect( W, H ) {

		const vw = ( video && video.videoWidth ) || 640;
		const vh = ( video && video.videoHeight ) || 360;
		const scale = Math.max( W / vw, H / vh );
		const drawW = vw * scale;
		const drawH = vh * scale;
		return {
			x: ( W - drawW ) * 0.5,
			y: ( H - drawH ) * 0.5,
			w: drawW,
			h: drawH
		};

	}

	function drawAmbientStageOverlay( handsData ) {

		if ( ! stageCtx || ! stageCanvas ) return;

		const W = stageCanvas.width;
		const H = stageCanvas.height;
		const dpr = W / Math.max( 1, window.innerWidth );
		stageCtx.clearRect( 0, 0, W, H );

		const styles = getComputedStyle( document.body );
		const accent = styles.getPropertyValue( '--accent' ).trim() || '#a6ea57';
		const warm = styles.getPropertyValue( '--accent-warm' ).trim() || '#f6dc7a';

		// Pure light-line overlay (no camera video reflection): 1:1 skeletal filaments,
		// gentle Z-depth palm aura, and per-digit fingertip nodes at whisper-soft opacity.
		if ( handsData && handsData.length > 0 ) {

			const cover = computeCoverRect( W, H );
			const mapX = ( mirX ) => cover.x + mirX * cover.w;
			const mapY = ( rawY ) => cover.y + rawY * cover.h;

			for ( let hi = 0; hi < handsData.length; hi ++ ) {

				const hd = handsData[ hi ];
				const lms = hd.raw;

				// Delicate gossamer hand filaments
				stageCtx.save();
				stageCtx.strokeStyle = accent;
				stageCtx.globalAlpha = 0.16;
				stageCtx.lineWidth = 1.25 * dpr;
				stageCtx.lineCap = 'round';
				stageCtx.beginPath();
				for ( const [ a, b ] of HAND_EDGES ) {

					const pa = lms[ a ];
					const pb = lms[ b ];
					stageCtx.moveTo( mapX( 1 - pa.x ), mapY( pa.y ) );
					stageCtx.lineTo( mapX( 1 - pb.x ), mapY( pb.y ) );

				}
				stageCtx.stroke();

				// Palm Z-axis distance pressure aura
				const px = mapX( hd.palmX );
				const py = mapY( hd.palmY );
				const palmR = ( 20 + hd.proximity * 50 ) * dpr;
				const palmGrad = stageCtx.createRadialGradient( px, py, 0, px, py, palmR );
				palmGrad.addColorStop( 0, hd.posture === 'fist' || hd.isPinched ? warm : accent );
				palmGrad.addColorStop( 1, 'rgba(0,0,0,0)' );
				stageCtx.globalAlpha = hd.posture === 'fist' || hd.isPinched ? 0.21 : 0.10;
				stageCtx.fillStyle = palmGrad;
				stageCtx.beginPath();
				stageCtx.arc( px, py, palmR, 0, Math.PI * 2 );
				stageCtx.fill();

				// Soft outer Z-pressure ring around palm
				stageCtx.globalAlpha = 0.16 + hd.proximity * 0.24;
				stageCtx.strokeStyle = hd.posture === 'fist' || hd.isPinched ? warm : accent;
				stageCtx.lineWidth = 1.1 * dpr;
				stageCtx.beginPath();
				stageCtx.arc( px, py, palmR * 0.72, 0, Math.PI * 2 );
				stageCtx.stroke();

				// Individual luminous fingertip nodes & subtle halos
				for ( let fi = 0; fi < FINGER_SPECS.length; fi ++ ) {

					const f = hd.fingers[ fi ];
					const fx = mapX( f.x );
					const fy = mapY( f.y );
					const isActiveTip = f.extended || ( hd.isPinched && fi <= 1 );

					if ( isActiveTip ) {

						const haloR = ( ( hd.posture === 'point' ? 13 : 16 ) + hd.proximity * 14 ) * dpr;
						const tipGrad = stageCtx.createRadialGradient( fx, fy, 0, fx, fy, haloR );
						tipGrad.addColorStop( 0, hd.isPinched && fi <= 1 ? warm : accent );
						tipGrad.addColorStop( 1, 'rgba(0,0,0,0)' );
						stageCtx.globalAlpha = 0.28;
						stageCtx.fillStyle = tipGrad;
						stageCtx.beginPath();
						stageCtx.arc( fx, fy, haloR, 0, Math.PI * 2 );
						stageCtx.fill();

						stageCtx.globalAlpha = 0.66;
						stageCtx.fillStyle = warm;
						stageCtx.beginPath();
						stageCtx.arc( fx, fy, ( 2.9 + hd.proximity * 1.9 ) * dpr, 0, Math.PI * 2 );
						stageCtx.fill();

					} else {

						stageCtx.globalAlpha = 0.16;
						stageCtx.fillStyle = accent;
						stageCtx.beginPath();
						stageCtx.arc( fx, fy, 1.9 * dpr, 0, Math.PI * 2 );
						stageCtx.fill();

					}

				}

				stageCtx.restore();

			}

		}

		// Update minimal bottom-left posture & depth chip
		if ( statusChip ) {

			if ( loading ) {

				statusChip.textContent = 'Hands · loading model…';

			} else if ( ! handsData || handsData.length === 0 ) {

				statusChip.textContent = 'Hands · show open palm or finger';

			} else {

				const depthPct = Math.round( state.proximity * 100 );
				if ( state.handCount > 1 ) {

					statusChip.textContent = `2 hands · ${ state.digits.length } digits · depth ${ depthPct }%`;

				} else if ( state.posture === 'pinch' ) {

					statusChip.textContent = `Pinch · charge · depth ${ depthPct }%`;

				} else if ( state.posture === 'fist' ) {

					statusChip.textContent = `Fist · hold · depth ${ depthPct }%`;

				} else if ( state.posture === 'point' ) {

					statusChip.textContent = `1 finger · pinpoint · depth ${ depthPct }%`;

				} else if ( state.posture === 'open' ) {

					statusChip.textContent = `Open palm · ${ state.openCount } digits · depth ${ depthPct }%`;

				} else {

					statusChip.textContent = `${ state.openCount } fingers · depth ${ depthPct }%`;

				}

			}

		}

	}

	async function ensureLandmarker() {

		if ( landmarker ) return landmarker;

		const mod = await import( MP_BUNDLE_URL );
		const { FilesetResolver, HandLandmarker } = mod;
		const vision = await FilesetResolver.forVisionTasks( MP_WASM_URL );

		// Lower confidence thresholds (0.35) ensure spread open hands track reliably in dim evening lighting
		const opts = {
			baseOptions: {
				modelAssetPath: MP_MODEL_URL,
				delegate: 'GPU'
			},
			runningMode: 'VIDEO',
			numHands: 2,
			minHandDetectionConfidence: 0.35,
			minHandPresenceConfidence: 0.35,
			minTrackingConfidence: 0.35
		};

		try {

			landmarker = await HandLandmarker.createFromOptions( vision, opts );

		} catch {

			opts.baseOptions.delegate = 'CPU';
			landmarker = await HandLandmarker.createFromOptions( vision, opts );

		}

		return landmarker;

	}

	async function start() {

		if ( active ) return true;
		if ( ! navigator.mediaDevices || ! navigator.mediaDevices.getUserMedia ) {

			throw new Error( 'Webcam access is not supported in this browser.' );

		}

		loading = true;
		state.loading = true;
		ensureOverlay();
		drawAmbientStageOverlay( null );

		try {

			const [ mediaStream ] = await Promise.all( [
				navigator.mediaDevices.getUserMedia( {
					video: {
						facingMode: 'user',
						width: { ideal: 640 },
						height: { ideal: 360 },
						frameRate: { ideal: 30 }
					},
					audio: false
				} ),
				ensureLandmarker()
			] );

			stream = mediaStream;
			video = document.createElement( 'video' );
			video.autoplay = true;
			video.playsInline = true;
			video.muted = true;
			video.srcObject = stream;
			await video.play();

			for ( const hf of handFilters ) {

				hf.palmX.reset();
				hf.palmY.reset();
				hf.prox.reset();
				hf.pinch.reset();
				hf.isPinched = false;
				for ( const tf of hf.tips ) { tf.x.reset(); tf.y.reset(); }

			}

			lastVideoTime = - 1;
			prevPrimaryX = null;
			prevPrimaryY = null;
			prevSampleSec = null;
			lastPinchEdge = false;
			lastParsedHands = [];
			active = true;
			state.enabled = true;
			loading = false;
			state.loading = false;
			drawAmbientStageOverlay( null );
			return true;

		} catch ( err ) {

			loading = false;
			state.loading = false;
			stop();
			throw err;

		}

	}

	function stop() {

		active = false;
		loading = false;
		state.enabled = false;
		state.loading = false;
		state.detected = false;
		state.handCount = 0;
		state.posture = 'none';
		state.openCount = 0;
		state.isPinched = false;
		state.pinchJustStarted = false;
		state.pinchJustReleased = false;
		state.sweepTriggered = false;
		state.digits = [];
		lastParsedHands = [];

		if ( video ) {

			try { video.pause(); } catch {}
			video.srcObject = null;
			video = null;

		}
		if ( stream ) {

			for ( const t of stream.getTracks() ) {

				try { t.stop(); } catch {}

			}
			stream = null;

		}

		removeOverlay();

	}

	function analyzeHand( lms, hf, tSec ) {

		const wrist = lms[ 0 ];
		const indexMCP = lms[ 5 ];
		const middleMCP = lms[ 9 ];
		const ringMCP = lms[ 13 ];
		const pinkyMCP = lms[ 17 ];

		// Apparent 2D palm scale calibrated for natural ~1 foot (~30 cm) laptop webcam distance
		// (~1 ft -> proximity ~0.50; closer ~6-8 in -> ~0.90; farther ~20-24 in -> ~0.15)
		const palmLen = dist2( wrist, middleMCP );
		const palmWid = dist2( indexMCP, pinkyMCP );
		const palmSize = Math.max( 0.04, 0.55 * palmLen + 0.45 * palmWid );
		const rawProx = clamp( ( palmSize - 0.08 ) / 0.24, 0, 1 );
		const proximity = hf.prox.filter( rawProx, tSec );

		// Mirrored palm center (wrist + knuckle centroid)
		const rawPalmX = 1 - ( wrist.x + indexMCP.x + middleMCP.x + ringMCP.x + pinkyMCP.x ) / 5;
		const rawPalmY = ( wrist.y + indexMCP.y + middleMCP.y + ringMCP.y + pinkyMCP.y ) / 5;
		const palmX = clamp( hf.palmX.filter( rawPalmX, tSec ), 0, 1 );
		const palmY = clamp( hf.palmY.filter( rawPalmY, tSec ), 0, 1 );

		// 3D-aware independent 5-digit extension detection (works even when fingers tilt toward camera)
		const fingers = [];
		let openCount = 0;

		for ( let fi = 0; fi < FINGER_SPECS.length; fi ++ ) {

			const spec = FINGER_SPECS[ fi ];
			const tip = lms[ spec.tip ];
			const pip = lms[ spec.pip ];
			const mcp = lms[ spec.mcp ];

			let extended;
			if ( fi === 0 ) {

				const dTipPinky = dist3( tip, pinkyMCP );
				const dIpPinky = dist3( pip, pinkyMCP );
				const dTipIdx = dist3( tip, indexMCP );
				extended = dTipPinky > dIpPinky * 1.03 && dTipIdx > palmSize * 0.36;

			} else {

				const dTipWrist = dist3( tip, wrist );
				const dPipWrist = dist3( pip, wrist );
				const dMcpWrist = dist3( mcp, wrist );

				// 3D straightness dot product so fingers reaching forward toward the screen still count as extended
				const v1x = pip.x - mcp.x, v1y = pip.y - mcp.y, v1z = ( pip.z || 0 ) - ( mcp.z || 0 );
				const v2x = tip.x - pip.x, v2y = tip.y - pip.y, v2z = ( tip.z || 0 ) - ( pip.z || 0 );
				const l1 = Math.hypot( v1x, v1y, v1z ) || 1e-4;
				const l2 = Math.hypot( v2x, v2y, v2z ) || 1e-4;
				const straightDot = ( v1x * v2x + v1y * v2y + v1z * v2z ) / ( l1 * l2 );

				extended = ( dTipWrist > dPipWrist * 1.04 && dTipWrist > dMcpWrist * 1.14 )
					|| ( straightDot > 0.38 && dTipWrist > dMcpWrist * 1.05 );

			}

			if ( extended ) openCount ++;

			const fx = clamp( hf.tips[ fi ].x.filter( 1 - tip.x, tSec ), 0, 1 );
			const fy = clamp( hf.tips[ fi ].y.filter( tip.y, tSec ), 0, 1 );

			fingers.push( {
				name: spec.name,
				index: fi,
				extended,
				x: fx,
				y: fy,
				ndcX: fx * 2 - 1,
				ndcY: 1 - fy * 2
			} );

		}

		// Thumb-index pinch normalized to palm size (only when other fingers aren't fully spread open)
		const rawPinchRatio = dist2( lms[ 4 ], lms[ 8 ] ) / palmSize;
		const smoothPinch = hf.pinch.filter( rawPinchRatio, tSec );
		if ( ! hf.isPinched && smoothPinch < 0.33 && openCount <= 3 ) hf.isPinched = true;
		else if ( hf.isPinched && ( smoothPinch > 0.48 || openCount >= 4 ) ) hf.isPinched = false;

		let posture;
		if ( hf.isPinched ) posture = 'pinch';
		else if ( openCount === 0 ) posture = 'fist';
		else if ( openCount === 1 ) posture = 'point';
		else if ( openCount >= 4 ) posture = 'open';
		else posture = 'multi';

		return {
			raw: lms,
			palmX,
			palmY,
			proximity,
			openCount,
			isPinched: hf.isPinched,
			posture,
			fingers
		};

	}

	function update() {

		// Reset single-frame edge pulses
		state.pinchJustStarted = false;
		state.pinchJustReleased = false;
		state.sweepTriggered = false;

		if ( ! active || ! landmarker || ! video || video.readyState < 2 ) {

			return state;

		}

		const nowMs = performance.now();
		if ( video.currentTime !== lastVideoTime && ( nowMs - lastDetectMs ) >= 26 ) {

			lastVideoTime = video.currentTime;
			lastDetectMs = nowMs;

			let results = null;
			try {

				results = landmarker.detectForVideo( video, nowMs );

			} catch {

				return state;

			}

			const rawHands = ( results && results.landmarks ) ? results.landmarks : [];

			if ( rawHands.length > 0 ) {

				lastHandSeenMs = nowMs;
				const tSec = nowMs / 1000;
				const parsed = [];

				for ( let hi = 0; hi < Math.min( 2, rawHands.length ); hi ++ ) {

					parsed.push( analyzeHand( rawHands[ hi ], handFilters[ hi ], tSec ) );

				}
				lastParsedHands = parsed;

				const primary = parsed[ 0 ];
				state.detected = true;
				state.handCount = parsed.length;
				state.proximity = primary.proximity;
				state.openCount = primary.openCount;
				state.posture = primary.posture;
				state.isPinched = primary.isPinched;

				if ( primary.isPinched && ! lastPinchEdge ) state.pinchJustStarted = true;
				if ( ! primary.isPinched && lastPinchEdge ) state.pinchJustReleased = true;
				lastPinchEdge = primary.isPinched;

				// Cursor X/Y maps cleanly to viewport cover space
				const W = window.innerWidth || 1280;
				const H = window.innerHeight || 800;
				const cover = computeCoverRect( W, H );
				const toScreenNormX = ( mx ) => clamp( ( cover.x + mx * cover.w ) / W, 0, 1 );
				const toScreenNormY = ( ry ) => clamp( ( cover.y + ry * cover.h ) / H, 0, 1 );

				let rawCx = primary.palmX;
				let rawCy = primary.palmY;

				if ( primary.posture === 'point' ) {

					const lone = primary.fingers.find( ( f ) => f.extended ) || primary.fingers[ 1 ];
					rawCx = lone.x;
					rawCy = lone.y;

				} else if ( primary.posture === 'pinch' ) {

					rawCx = 0.5 * ( primary.fingers[ 0 ].x + primary.fingers[ 1 ].x );
					rawCy = 0.5 * ( primary.fingers[ 0 ].y + primary.fingers[ 1 ].y );

				} else if ( primary.openCount >= 2 ) {

					let sx = 0, sy = 0, n = 0;
					for ( const f of primary.fingers ) {

						if ( f.extended ) { sx += f.x; sy += f.y; n ++; }

					}
					if ( n > 0 ) {

						rawCx = primary.palmX * 0.45 + ( sx / n ) * 0.55;
						rawCy = primary.palmY * 0.45 + ( sy / n ) * 0.55;

					}

				}

				const cx = toScreenNormX( rawCx );
				const cy = toScreenNormY( rawCy );
				state.x = cx;
				state.y = cy;
				state.ndcX = cx * 2 - 1;
				state.ndcY = 1 - cy * 2;

				// Z-axis distance + posture drive pressure & touch area size
				const zPressure = 0.72 + primary.proximity * 1.15;
				const zRadius = 0.78 + primary.proximity * 0.92;
				const postureRadiusMul = primary.posture === 'point'
					? 0.54
					: ( primary.posture === 'open' ? 1.52 : ( primary.posture === 'pinch' ? 0.85 : 1.05 ) );

				state.pressureScale = zPressure;
				state.radiusScale = clamp( zRadius * postureRadiusMul, 0.45, 2.1 );

				// Detect brisk open-hand wave/sweep for Frost Gust / Shake Off
				if ( prevPrimaryX !== null && prevSampleSec !== null ) {

					const dtS = Math.max( 1 / 120, tSec - prevSampleSec );
					const speed = Math.hypot( cx - prevPrimaryX, cy - prevPrimaryY ) / dtS;
					if ( ( primary.posture === 'open' || primary.posture === 'multi' ) && speed > 1.85 && ( nowMs - lastSweepMs ) > 1350 ) {

						lastSweepMs = nowMs;
						state.sweepTriggered = true;

					}

				}
				prevPrimaryX = cx;
				prevPrimaryY = cy;
				prevSampleSec = tSec;

				// Collect up to 5 independently tracked active digits across 1–2 hands (cover-mapped!)
				const digits = [];
				for ( let hi = 0; hi < parsed.length; hi ++ ) {

					const hd = parsed[ hi ];
					if ( hd.posture === 'pinch' ) {

						const mx = toScreenNormX( 0.5 * ( hd.fingers[ 0 ].x + hd.fingers[ 1 ].x ) );
						const my = toScreenNormY( 0.5 * ( hd.fingers[ 0 ].y + hd.fingers[ 1 ].y ) );
						digits.push( {
							id: `h${ hi }_pinch`,
							x: mx,
							y: my,
							ndcX: mx * 2 - 1,
							ndcY: 1 - my * 2,
							proximity: hd.proximity,
							pressure: ( 0.9 + hd.proximity * 1.05 ) * 1.25,
							radiusMul: 0.75 + hd.proximity * 0.45
						} );

					} else if ( hd.posture === 'fist' ) {

						const px = toScreenNormX( hd.palmX );
						const py = toScreenNormY( hd.palmY );
						digits.push( {
							id: `h${ hi }_fist`,
							x: px,
							y: py,
							ndcX: px * 2 - 1,
							ndcY: 1 - py * 2,
							proximity: hd.proximity,
							pressure: ( 0.95 + hd.proximity * 1.1 ) * 1.2,
							radiusMul: 1.15 + hd.proximity * 0.55
						} );

					} else {

						for ( const f of hd.fingers ) {

							if ( ! f.extended ) continue;
							if ( digits.length >= 5 ) break;
							const sx = toScreenNormX( f.x );
							const sy = toScreenNormY( f.y );
							digits.push( {
								id: `h${ hi }_${ f.name }`,
								x: sx,
								y: sy,
								ndcX: sx * 2 - 1,
								ndcY: 1 - sy * 2,
								proximity: hd.proximity,
								pressure: 0.95 + hd.proximity * 1.15,
								radiusMul: hd.posture === 'point' ? ( 0.50 + hd.proximity * 0.45 ) : ( 0.85 + hd.proximity * 0.65 )
							} );

						}

					}

				}

				// Safety guarantee: a detected hand always drives at least its palm centroid
				if ( digits.length === 0 ) {

					digits.push( {
						id: 'h0_palm',
						x: cx,
						y: cy,
						ndcX: state.ndcX,
						ndcY: state.ndcY,
						proximity: primary.proximity,
						pressure: 0.95 + primary.proximity * 1.1,
						radiusMul: 1.0 + primary.proximity * 0.5
					} );

				}

				state.digits = digits;
				drawAmbientStageOverlay( parsed );

			} else if ( ( nowMs - lastHandSeenMs ) > 260 ) {

				state.detected = false;
				state.handCount = 0;
				state.posture = 'none';
				state.openCount = 0;
				state.isPinched = false;
				state.digits = [];
				lastPinchEdge = false;
				prevPrimaryX = null;
				prevPrimaryY = null;
				lastParsedHands = [];
				drawAmbientStageOverlay( null );

			}

		}

		return state;

	}

	function dispose() {

		stop();
		if ( landmarker ) {

			try { landmarker.close(); } catch {}
			landmarker = null;

		}

	}

	return {
		get active() { return active; },
		get loading() { return loading; },
		get state() { return state; },
		start,
		stop,
		toggle: () => ( active ? ( stop(), Promise.resolve( false ) ) : start() ),
		update,
		dispose
	};

}
