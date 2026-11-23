// Zero-build native ES module scene for jamesrice/low-cortisol:
// Arc String — 2D Coupled Spring-Mass Electric Plasma Lines with Touch, Pointer, Hand & Breath interaction.

const PALETTES = {
	lime: { core: '#fcffe6', inner: '#d9ff52', glow: '#a6ea57', outer: '#4d9e19', sparkTail: '#e7ff7a', ring: '#f6dc7a' },
	violet: { core: '#fff5ff', inner: '#f5b4ff', glow: '#e879f9', outer: '#9333ea', sparkTail: '#f0abfc', ring: '#fbcfe8' },
	cyan: { core: '#f0fcff', inner: '#7dd3fc', glow: '#38bdf8', outer: '#0284c7', sparkTail: '#bae6fd', ring: '#a5f3fc' },
	amber: { core: '#fffbeb', inner: '#fde68a', glow: '#fbbf24', outer: '#d97706', sparkTail: '#fcd34d', ring: '#fed7aa' }
};

const NODE_COUNT = 36;
const MAX_SPARKS = 440;
const MAX_PULL_SNAP = 68;
const MAX_DISP = 135;
const PROXIMITY_RADIUS = 190;

function hexAlpha( hex, a ) {
	const c = hex.replace( '#', '' );
	const r = parseInt( c.slice( 0, 2 ), 16 );
	const g = parseInt( c.slice( 2, 4 ), 16 );
	const b = parseInt( c.slice( 4, 6 ), 16 );
	return `rgba(${ r },${ g },${ b },${ Math.max( 0, Math.min( 1, a ) ).toFixed( 3 ) })`;
}

function hash11( x ) {
	const s = Math.sin( x * 127.1 + 311.7 ) * 43758.5453123;
	return ( s - Math.floor( s ) ) * 2 - 1;
}

function segIntersectT( ax, ay, bx, by, cx, cy, dx, dy ) {
	const rX = bx - ax, rY = by - ay, sX = dx - cx, sY = dy - cy;
	const denom = rX * sY - rY * sX;
	if ( Math.abs( denom ) < 1e-6 ) return null;
	const qpx = cx - ax, qpy = cy - ay;
	const u = ( qpx * sY - qpy * sX ) / denom;
	const t = ( qpx * rY - qpy * rX ) / denom;
	return ( u >= 0 && u <= 1 && t >= 0.02 && t <= 0.98 ) ? t : null;
}

function pointToSeg( px, py, ax, ay, bx, by ) {
	const dx = bx - ax, dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if ( lenSq < 1e-6 ) return { dist: Math.hypot( px - ax, py - ay ), signedDist: 0, t: 0, cx: ax, cy: ay, nx: 0, ny: - 1 };
	const t = Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( py - ay ) * dy ) / lenSq ) );
	const cx = ax + t * dx, cy = ay + t * dy;
	const len = Math.sqrt( lenSq );
	const nx = - dy / len, ny = dx / len;
	const rx = px - cx, ry = py - cy;
	return { dist: Math.hypot( rx, ry ), signedDist: rx * nx + ry * ny, t, cx, cy, nx, ny };
}

function segToSegClosest( ax, ay, bx, by, cx, cy, dx, dy ) {
	const crossB = segIntersectT( ax, ay, bx, by, cx, cy, dx, dy );
	if ( crossB !== null ) {
		const px = cx + ( dx - cx ) * crossB, py = cy + ( dy - cy ) * crossB;
		const pA = pointToSeg( px, py, ax, ay, bx, by );
		return { dist: 0, tA: pA.t, tB: crossB };
	}
	let bestDist = Infinity, bestTA = 0.5, bestTB = 0.5;
	const ts = [ 0.5, 0.35, 0.65, 0.2, 0.8, 0.05, 0.95 ];
	for ( const tA of ts ) {
		const pAx = ax + ( bx - ax ) * tA, pAy = ay + ( by - ay ) * tA;
		const pB = pointToSeg( pAx, pAy, cx, cy, dx, dy );
		if ( pB.dist < bestDist - 1e-4 ) { bestDist = pB.dist; bestTA = tA; bestTB = pB.t; }
	}
	for ( const tB of ts ) {
		const pBx = cx + ( dx - cx ) * tB, pBy = cy + ( dy - cy ) * tB;
		const pA = pointToSeg( pBx, pBy, ax, ay, bx, by );
		if ( pA.dist < bestDist - 1e-4 ) { bestDist = pA.dist; bestTA = pA.t; bestTB = tB; }
	}
	return { dist: bestDist, tA: bestTA, tB: bestTB };
}

export async function createArcStringExperience( { container, audio } ) {
	const canvas = document.createElement( 'canvas' );
	canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
	container.innerHTML = '';
	container.appendChild( canvas );
	container.classList.add( 'is-ready' );

	const ctx = canvas.getContext( '2d' );
	let width = window.innerWidth;
	let height = window.innerHeight;
	let dpr = Math.min( window.devicePixelRatio || 1, 2 );

	let mode = 'strum';
	let paletteId = 'lime';
	let tension = 1.0;
	let reverb = 1.15;
	let sparkIntensity = 1.1;
	const voltage = 1.0;

	const strings = [];
	const sparks = [];
	let coronaArcs = [];
	let nextId = 1;
	let simTime = 0;
	let drawPreview = null;
	let anchorDrag = null;
	const pointers = new Map();
	const prevHandDigits = new Map();
	let handPinchPreview = null;
	let latestHandState = null;
	let latestBreath = null;
	let humIntensity = 0;
	let resonantPairs = [];

	// Lightweight local Web Audio dissonant proximity hum (activates only while global audio is enabled)
	let humCtx = null, humGain = null, humOscA = null, humOscB = null, humOscTri = null, humFilter = null, humPanner = null;
	function syncProximityHum( intensity, baseFreq, dissRatio, beatHz, pan ) {
		if ( ! audio?.enabled ) {
			if ( humCtx && humGain ) humGain.gain.setTargetAtTime( 0.0001, humCtx.currentTime, 0.15 );
			return;
		}
		if ( ! humCtx && intensity > 0.02 ) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if ( ! AC ) return;
			try {
				humCtx = new AC();
				humGain = humCtx.createGain(); humGain.gain.value = 0.0001;
				humPanner = humCtx.createStereoPanner();
				humFilter = humCtx.createBiquadFilter(); humFilter.type = 'lowpass'; humFilter.frequency.value = 340; humFilter.Q.value = 2.1;
				humOscA = humCtx.createOscillator(); humOscA.type = 'sawtooth'; humOscA.frequency.value = 110;
				humOscB = humCtx.createOscillator(); humOscB.type = 'triangle'; humOscB.frequency.value = 116.5;
				humOscTri = humCtx.createOscillator(); humOscTri.type = 'sine'; humOscTri.frequency.value = 155.5;
				const gA = humCtx.createGain(); gA.gain.value = 0.36;
				const gB = humCtx.createGain(); gB.gain.value = 0.42;
				const gT = humCtx.createGain(); gT.gain.value = 0.24;
				humOscA.connect( gA ); humOscB.connect( gB ); humOscTri.connect( gT );
				gA.connect( humFilter ); gB.connect( humFilter ); gT.connect( humFilter );
				humFilter.connect( humGain ); humGain.connect( humPanner ); humPanner.connect( humCtx.destination );
				humOscA.start(); humOscB.start(); humOscTri.start();
			} catch { humCtx = null; return; }
		}
		if ( ! humCtx || ! humGain ) return;
		if ( humCtx.state === 'suspended' ) humCtx.resume().catch( () => {} );
		const now = humCtx.currentTime;
		if ( intensity > 0.005 ) {
			humGain.gain.setTargetAtTime( 0.0001 + Math.pow( intensity, 0.85 ) * 0.036, now, 0.12 );
			humOscA.frequency.setTargetAtTime( baseFreq, now, 0.16 );
			humOscB.frequency.setTargetAtTime( baseFreq * dissRatio + beatHz * 0.18, now, 0.16 );
			humOscTri.frequency.setTargetAtTime( baseFreq * 1.4142, now, 0.18 );
			humFilter.frequency.setTargetAtTime( 240 + intensity * 340, now, 0.16 );
			humPanner.pan.setTargetAtTime( Math.max( - 0.85, Math.min( 0.85, pan ) ), now, 0.18 );
		} else {
			humGain.gain.setTargetAtTime( 0.0001, now, 0.24 );
		}
	}

	const stats = { backend: 'canvas2d', tier: 'spring-mass', fps: 60, bodies: 0, error: null };

	function createString( start, end, palKey = paletteId ) {
		if ( Math.hypot( end.x - start.x, end.y - start.y ) < 56 ) return null;
		const px = new Float32Array( NODE_COUNT );
		const py = new Float32Array( NODE_COUNT );
		const vx = new Float32Array( NODE_COUNT );
		const vy = new Float32Array( NODE_COUNT );
		const charge = new Float32Array( NODE_COUNT );
		const dx = end.x - start.x, dy = end.y - start.y;
		for ( let i = 0; i < NODE_COUNT; i ++ ) {
			const t = i / ( NODE_COUNT - 1 );
			px[ i ] = start.x + dx * t;
			py[ i ] = start.y + dy * t;
			if ( i > 0 && i < NODE_COUNT - 1 ) charge[ i ] = 0.65 * Math.sin( Math.PI * t );
		}
		const s = {
			id: nextId ++,
			start: { x: start.x, y: start.y },
			end: { x: end.x, y: end.y },
			palette: palKey,
			px, py, vx, vy, charge,
			energy: 0.7,
			anchorFlash: 1.0,
			seed: ( nextId * 1.618 ) % 100,
			lastPluck: - 10,
			grab: null
		};
		if ( strings.length >= 16 ) strings.shift();
		strings.push( s );
		return s;
	}

	function emitSparks( x, y, dirX, dirY, palKey, count, scale ) {
		const pal = PALETTES[ palKey ] || PALETTES.lime;
		const n = Math.min( count, Math.max( 0, MAX_SPARKS - sparks.length ) );
		for ( let i = 0; i < n; i ++ ) {
			const ang = Math.atan2( dirY, dirX ) + ( Math.random() - 0.5 ) * Math.PI * 1.85;
			const spd = ( 95 + Math.random() * 380 ) * scale;
			const maxLife = 0.22 + Math.random() * 0.42;
			sparks.push( {
				x, y,
				vx: Math.cos( ang ) * spd + dirX * 0.2,
				vy: Math.sin( ang ) * spd + dirY * 0.2 - ( 18 + Math.random() * 60 ),
				life: maxLife,
				maxLife,
				size: 1.2 + Math.random() * 2.1,
				core: '#ffffff',
				tail: pal.sparkTail
			} );
		}
	}

	function excite( s, t, normalVel, strength, suppressSparks = false ) {
		const ct = Math.max( 0.04, Math.min( 0.96, t ) );
		const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
		const len = Math.max( 1, Math.hypot( dx, dy ) );
		const nx = - dy / len, ny = dx / len;
		const center = ct * ( NODE_COUNT - 1 );
		const spread = Math.max( 2.2, NODE_COUNT * 0.11 );
		const imp = Math.max( - 1600, Math.min( 1600, normalVel ) );
		for ( let i = 1; i < NODE_COUNT - 1; i ++ ) {
			const g = Math.exp( - 0.5 * Math.pow( ( i - center ) / spread, 2 ) );
			s.vx[ i ] += nx * imp * g;
			s.vy[ i ] += ny * imp * g;
			s.charge[ i ] = Math.min( 2.0, s.charge[ i ] + ( 0.65 + strength * 0.95 ) * g );
		}
		s.energy = Math.min( 2.0, Math.max( s.energy, 0.4 + strength * 1.1 ) );
		s.anchorFlash = 1.0;
		s.lastPluck = simTime;
		const ci = Math.max( 1, Math.min( NODE_COUNT - 2, Math.round( center ) ) );
		if ( ! suppressSparks && sparkIntensity > 0.05 ) {
			emitSparks( s.px[ ci ], s.py[ ci ], nx * Math.sign( normalVel || 1 ) * 180, ny * Math.sign( normalVel || 1 ) * 180, s.palette, Math.round( ( 10 + strength * 24 ) * sparkIntensity ), 0.7 + strength * 0.7 );
		}
		const pan = Math.max( - 0.85, Math.min( 0.85, ( s.px[ ci ] / Math.max( 1, width ) ) * 2 - 1 ) );
		audio?.triggerChime?.( pan, Math.min( 1, 0.35 + strength * 0.65 ) );
	}

	function resize() {
		const prevW = width, prevH = height;
		width = window.innerWidth;
		height = window.innerHeight;
		dpr = Math.min( window.devicePixelRatio || 1, 2 );
		canvas.width = Math.round( width * dpr );
		canvas.height = Math.round( height * dpr );
		if ( prevW > 0 && prevH > 0 ) {
			const sx = width / prevW, sy = height / prevH;
			for ( const s of strings ) {
				s.start.x *= sx; s.start.y *= sy;
				s.end.x *= sx; s.end.y *= sy;
				for ( let i = 0; i < NODE_COUNT; i ++ ) { s.px[ i ] *= sx; s.py[ i ] *= sy; }
			}
		}
	}

	resize();
	const spanX = Math.min( width * 0.62, 760 );
	const initStr = createString( { x: width * 0.5 - spanX * 0.5, y: height * 0.5 + 14 }, { x: width * 0.5 + spanX * 0.5, y: height * 0.5 - 14 } );
	if ( initStr ) excite( initStr, 0.5, 420, 0.65, true );

	window.addEventListener( 'resize', resize );

	function findAnchor( x, y, maxD = 26 ) {
		let best = maxD, res = null;
		for ( const s of strings ) {
			const ds = Math.hypot( x - s.start.x, y - s.start.y );
			if ( ds < best ) { best = ds; res = { id: s.id, end: 'start' }; }
			const de = Math.hypot( x - s.end.x, y - s.end.y );
			if ( de < best ) { best = de; res = { id: s.id, end: 'end' }; }
		}
		return res;
	}

	function onPointerDown( e ) {
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left, y = e.clientY - rect.top;
		canvas.setPointerCapture( e.pointerId );
		pointers.set( e.pointerId, { prevX: x, prevY: y, x, y, down: true } );
		if ( mode === 'draw' || e.shiftKey ) {
			drawPreview = { pid: e.pointerId, start: { x, y }, end: { x, y }, palette: paletteId };
			return;
		}
		const hit = findAnchor( x, y, 28 );
		if ( hit ) anchorDrag = { pid: e.pointerId, id: hit.id, end: hit.end };
	}

	function onPointerMove( e ) {
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left, y = e.clientY - rect.top;
		const existing = pointers.get( e.pointerId );
		if ( existing ) {
			existing.x = x; existing.y = y;
		} else if ( e.pointerType === 'mouse' ) {
			pointers.set( e.pointerId, { prevX: x, prevY: y, x, y, down: false } );
		}
		if ( drawPreview && drawPreview.pid === e.pointerId ) {
			drawPreview.end = { x, y };
			return;
		}
		if ( anchorDrag && anchorDrag.pid === e.pointerId ) {
			const target = strings.find( ( s ) => s.id === anchorDrag.id );
			if ( target ) {
				target[ anchorDrag.end ].x = x;
				target[ anchorDrag.end ].y = y;
				target.anchorFlash = 0.65;
			}
		}
	}

	function onPointerUp( e ) {
		if ( drawPreview && drawPreview.pid === e.pointerId ) {
			const s = createString( drawPreview.start, drawPreview.end, drawPreview.palette );
			drawPreview = null;
			if ( s ) excite( s, 0.5, 360, 0.45 );
		}
		if ( anchorDrag && anchorDrag.pid === e.pointerId ) anchorDrag = null;
		if ( e.pointerType === 'mouse' ) {
			const p = pointers.get( e.pointerId );
			if ( p ) p.down = false;
		} else {
			pointers.delete( e.pointerId );
		}
	}

	canvas.addEventListener( 'pointerdown', onPointerDown );
	canvas.addEventListener( 'pointermove', onPointerMove );
	canvas.addEventListener( 'pointerup', onPointerUp );
	canvas.addEventListener( 'pointercancel', onPointerUp );

	let rafId = 0;
	let lastMs = performance.now();
	let fpsAccum = 0, fpsCount = 0;

	function tick( nowMs ) {
		rafId = requestAnimationFrame( tick );
		const dt = Math.min( 0.033, Math.max( 0.001, ( nowMs - lastMs ) / 1000 ) );
		lastMs = nowMs;
		simTime += dt;
		fpsAccum += dt; fpsCount ++;
		if ( fpsAccum > 0.4 ) { stats.fps = Math.round( fpsCount / fpsAccum ); fpsAccum = 0; fpsCount = 0; }

		// Collect pointer & webcam touches
		const touches = [];
		for ( const [ pid, ptr ] of pointers.entries() ) {
			if ( drawPreview?.pid === pid || anchorDrag?.pid === pid ) {
				ptr.prevX = ptr.x; ptr.prevY = ptr.y; continue;
			}
			touches.push( { id: `p-${ pid }`, prevX: ptr.prevX, prevY: ptr.prevY, x: ptr.x, y: ptr.y, vx: ( ptr.x - ptr.prevX ) / dt, vy: ( ptr.y - ptr.prevY ) / dt, down: ptr.down } );
			ptr.prevX = ptr.x; ptr.prevY = ptr.y;
		}

		const activeHandIds = new Set();
		const pinchDigits = [];
		if ( latestHandState?.detected && Array.isArray( latestHandState.digits ) ) {
			for ( const d of latestHandState.digits ) {
				const id = d.id || 'h_0';
				activeHandIds.add( id );
				const x = d.x * width, y = d.y * height;
				const prev = prevHandDigits.get( id ) || { x, y };
				const vx = ( x - prev.x ) / dt;
				const vy = ( y - prev.y ) / dt;
				prevHandDigits.set( id, { x, y } );
				if ( id.endsWith( '_pinch' ) ) {
					pinchDigits.push( { x, y } );
				} else {
					touches.push( { id, prevX: prev.x, prevY: prev.y, x, y, vx, vy, down: false } );
				}
			}
		}
		for ( const key of prevHandDigits.keys() ) {
			if ( ! activeHandIds.has( key ) ) prevHandDigits.delete( key );
		}
		if ( pinchDigits.length >= 2 ) {
			handPinchPreview = { start: pinchDigits[ 0 ], end: pinchDigits[ 1 ], palette: paletteId };
		} else if ( handPinchPreview ) {
			const created = createString( handPinchPreview.start, handPinchPreview.end, handPinchPreview.palette );
			handPinchPreview = null;
			if ( created ) excite( created, 0.5, 420, 0.55 );
		}

		// Bowstring grabs, swept crossings & corona arcs
		coronaArcs = [];
		const touchMap = new Map( touches.map( ( t ) => [ t.id, t ] ) );
		for ( const s of strings ) {
			if ( ! s.grab ) continue;
			const touch = touchMap.get( s.grab.tid );
			const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
			const len = Math.max( 1, Math.hypot( dx, dy ) );
			const nx = - dy / len, ny = dx / len;
			const idx = s.grab.idx;
			const tNode = idx / ( NODE_COUNT - 1 );
			const rx = s.start.x + dx * tNode, ry = s.start.y + dy * tNode;
			if ( ! touch || ! touch.down ) {
				const ratio = Math.min( 1, s.grab.pullDist / MAX_PULL_SNAP );
				s.grab = null;
				if ( ratio > 0.14 ) {
					const sign = ( ( s.px[ idx ] - rx ) * nx + ( s.py[ idx ] - ry ) * ny ) >= 0 ? - 1 : 1;
					excite( s, tNode, sign * ( 220 + ratio * 540 ), 0.35 + ratio * 0.65 );
				}
				continue;
			}
			const pullX = touch.x - rx, pullY = touch.y - ry;
			const dist = Math.hypot( pullX, pullY );
			s.grab.pullDist = dist;
			if ( dist > MAX_PULL_SNAP ) {
				const sign = ( pullX * nx + pullY * ny ) >= 0 ? - 1 : 1;
				s.grab = null;
				excite( s, tNode, sign * 620, 0.85 );
			} else {
				s.grab.tx = touch.x; s.grab.ty = touch.y;
				s.charge[ idx ] = Math.min( 1.6, s.charge[ idx ] + 0.09 );
				s.energy = Math.min( 1.6, Math.max( s.energy, 0.28 + ( dist / MAX_PULL_SNAP ) * 0.72 ) );
			}
		}

		for ( const touch of touches ) {
			const speed = Math.hypot( touch.vx, touch.vy );
			for ( const s of strings ) {
				if ( s.grab && s.grab.tid === touch.id ) {
					coronaArcs.push( { x0: touch.x, y0: touch.y, x1: s.px[ s.grab.idx ], y1: s.py[ s.grab.idx ], pal: s.palette, intensity: 0.95, seed: s.seed + simTime * 21 } );
					continue;
				}
				const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
				const len = Math.max( 1, Math.hypot( dx, dy ) );
				const nx = - dy / len, ny = dx / len;
				const proj = pointToSeg( touch.x, touch.y, s.start.x, s.start.y, s.end.x, s.end.y );
				const crossT = segIntersectT( touch.prevX, touch.prevY, touch.x, touch.y, s.start.x, s.start.y, s.end.x, s.end.y );
				const cool = simTime - s.lastPluck > 0.065;
				if ( touch.down && ! s.grab && proj.dist < 22 && proj.t > 0.05 && proj.t < 0.95 && speed < 520 && cool ) {
					s.grab = { tid: touch.id, idx: Math.max( 1, Math.min( NODE_COUNT - 2, Math.round( proj.t * ( NODE_COUNT - 1 ) ) ) ), pullDist: proj.dist, tx: touch.x, ty: touch.y };
					continue;
				}
				if ( crossT !== null && cool ) {
					const nv = touch.vx * nx + touch.vy * ny;
					excite( s, crossT, Math.abs( nv ) > 60 ? nv : Math.sign( nv || 1 ) * Math.max( 280, speed ), Math.min( 1, 0.35 + speed / 1200 ) );
				} else if ( proj.dist < 76 && proj.t > 0.03 && proj.t < 0.97 ) {
					const prox = 1 - proj.dist / 76;
					const idx = Math.max( 1, Math.min( NODE_COUNT - 2, Math.round( proj.t * ( NODE_COUNT - 1 ) ) ) );
					coronaArcs.push( { x0: touch.x, y0: touch.y, x1: s.px[ idx ], y1: s.py[ idx ], pal: s.palette, intensity: prox, seed: s.seed + simTime * 19 } );
					s.vx[ idx ] += ( touch.x - s.px[ idx ] ) * prox * 6.5;
					s.vy[ idx ] += ( touch.y - s.py[ idx ] ) * prox * 6.5;
				}
			}
		}

		// Breath coupling: gentle breeze ripples active spring-mass strings
		if ( latestBreath?.energy > 0.05 ) {
			const breeze = latestBreath.energy * 140;
			for ( const s of strings ) {
				const mid = Math.floor( NODE_COUNT * 0.5 );
				s.vy[ mid ] += Math.sin( simTime * 9 + s.seed ) * breeze;
			}
		}

		// 2D Coupled Spring-Mass Sub-Step Solver (20 sub-steps Symplectic Euler)
		const subSteps = 20;
		const subDt = dt / subSteps;
		const kStruct = 34000 * ( 0.5 + 0.55 * tension );
		const kBend = 1400 * ( 0.5 + 0.6 * tension );
		const kRestore = 24 * tension;
		const cGlobal = 2.55 / Math.max( 0.35, reverb );
		const cRel = 12.0 / Math.max( 0.4, reverb );
		const fx = new Float32Array( NODE_COUNT );
		const fy = new Float32Array( NODE_COUNT );

		for ( const s of strings ) {
			const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
			const segLen = Math.max( 1, Math.hypot( dx, dy ) ) / ( NODE_COUNT - 1 );
			const unstretched = segLen * 0.45;
			const bendRest = segLen * 2;

			for ( let step = 0; step < subSteps; step ++ ) {
				s.px[ 0 ] = s.start.x; s.py[ 0 ] = s.start.y; s.vx[ 0 ] = 0; s.vy[ 0 ] = 0;
				s.px[ NODE_COUNT - 1 ] = s.end.x; s.py[ NODE_COUNT - 1 ] = s.end.y; s.vx[ NODE_COUNT - 1 ] = 0; s.vy[ NODE_COUNT - 1 ] = 0;
				fx.fill( 0 ); fy.fill( 0 );

				for ( let i = 0; i < NODE_COUNT - 1; i ++ ) {
					const rx = s.px[ i + 1 ] - s.px[ i ], ry = s.py[ i + 1 ] - s.py[ i ];
					const dist = Math.hypot( rx, ry );
					if ( dist > 1e-5 ) {
						const fMag = kStruct * ( dist - unstretched );
						const sfx = ( fMag * rx ) / dist + cRel * ( s.vx[ i + 1 ] - s.vx[ i ] );
						const sfy = ( fMag * ry ) / dist + cRel * ( s.vy[ i + 1 ] - s.vy[ i ] );
						fx[ i ] += sfx; fy[ i ] += sfy;
						fx[ i + 1 ] -= sfx; fy[ i + 1 ] -= sfy;
					}
				}
				for ( let i = 0; i < NODE_COUNT - 2; i ++ ) {
					const rx = s.px[ i + 2 ] - s.px[ i ], ry = s.py[ i + 2 ] - s.py[ i ];
					const dist = Math.hypot( rx, ry );
					if ( dist > 1e-5 ) {
						const sc = ( kBend * ( dist - bendRest ) ) / dist;
						fx[ i ] += rx * sc; fy[ i ] += ry * sc;
						fx[ i + 2 ] -= rx * sc; fy[ i + 2 ] -= ry * sc;
					}
				}
				for ( let i = 1; i < NODE_COUNT - 1; i ++ ) {
					const t = i / ( NODE_COUNT - 1 );
					const restX = s.start.x + dx * t, restY = s.start.y + dy * t;
					fx[ i ] += kRestore * ( restX - s.px[ i ] ) - cGlobal * s.vx[ i ];
					fy[ i ] += kRestore * ( restY - s.py[ i ] ) - cGlobal * s.vy[ i ];
					s.vx[ i ] += fx[ i ] * subDt; s.vy[ i ] += fy[ i ] * subDt;
					s.px[ i ] += s.vx[ i ] * subDt; s.py[ i ] += s.vy[ i ] * subDt;
					const ox = s.px[ i ] - restX, oy = s.py[ i ] - restY;
					const od = Math.hypot( ox, oy );
					if ( od > MAX_DISP ) {
						const sc = MAX_DISP / od;
						s.px[ i ] = restX + ox * sc; s.py[ i ] = restY + oy * sc;
						s.vx[ i ] *= 0.45; s.vy[ i ] *= 0.45;
					}
				}
				if ( s.grab ) {
					const gi = s.grab.idx;
					s.px[ gi ] += ( s.grab.tx - s.px[ gi ] ) * 0.55;
					s.py[ gi ] += ( s.grab.ty - s.py[ gi ] ) * 0.55;
					s.vx[ gi ] *= 0.5; s.vy[ gi ] *= 0.5;
				}
			}

			let sumE = 0;
			const decay = Math.exp( - dt * ( 1.8 / Math.max( 0.4, reverb ) ) );
			for ( let i = 1; i < NODE_COUNT - 1; i ++ ) {
				s.charge[ i ] = ( 0.25 * ( s.charge[ i - 1 ] + s.charge[ i + 1 ] ) + 0.5 * s.charge[ i ] ) * decay;
				const t = i / ( NODE_COUNT - 1 );
				const d = Math.hypot( s.px[ i ] - ( s.start.x + dx * t ), s.py[ i ] - ( s.start.y + dy * t ) );
				sumE += d * 0.025 + Math.hypot( s.vx[ i ], s.vy[ i ] ) * 0.0012 + s.charge[ i ] * 0.35;
			}
			s.energy = Math.min( 2, s.energy * Math.exp( - dt * 1.4 ) + ( sumE / ( NODE_COUNT - 2 ) ) * ( 1 - Math.exp( - dt * 8 ) ) );
			s.anchorFlash = Math.max( 0, s.anchorFlash - dt * 2.2 );
		}

		// Inter-string proximity sympathetic coupling & faint dissonant hum resonance
		resonantPairs = [];
		let rawHum = 0, wFreq = 0, wDiss = 0, wBeat = 0, wPan = 0;
		if ( strings.length >= 2 ) {
			const vib = strings.map( ( s ) => {
				const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
				let acc = 0;
				for ( let i = 1; i < NODE_COUNT - 1; i ++ ) {
					const t = i / ( NODE_COUNT - 1 );
					acc += Math.hypot( s.px[ i ] - ( s.start.x + dx * t ), s.py[ i ] - ( s.start.y + dy * t ) ) * 0.048 + Math.hypot( s.vx[ i ], s.vy[ i ] ) * 0.0022;
				}
				return Math.min( 1.5, acc / ( NODE_COUNT - 2 ) );
			} );
			const kCoupleBase = 14.5 * ( 0.65 + 0.35 * voltage ) * dt;
			for ( let i = 0; i < strings.length; i ++ ) {
				for ( let j = i + 1; j < strings.length; j ++ ) {
					const a = strings[ i ], b = strings[ j ];
					const cl = segToSegClosest( a.start.x, a.start.y, a.end.x, a.end.y, b.start.x, b.start.y, b.end.x, b.end.y );
					if ( cl.dist >= PROXIMITY_RADIUS ) continue;
					const prox = 1 - cl.dist / PROXIMITY_RADIUS;
					const idxA = Math.max( 1, Math.min( NODE_COUNT - 2, Math.round( cl.tA * ( NODE_COUNT - 1 ) ) ) );
					const idxB = Math.max( 1, Math.min( NODE_COUNT - 2, Math.round( cl.tB * ( NODE_COUNT - 1 ) ) ) );
					const kc = prox * prox * kCoupleBase;
					const dvx = b.vx[ idxB ] - a.vx[ idxA ], dvy = b.vy[ idxB ] - a.vy[ idxA ];
					for ( let off = - 2; off <= 2; off ++ ) {
						const wgt = off === 0 ? 1 : ( Math.abs( off ) === 1 ? 0.62 : 0.25 );
						if ( idxA + off > 0 && idxA + off < NODE_COUNT - 1 ) { a.vx[ idxA + off ] += dvx * kc * wgt; a.vy[ idxA + off ] += dvy * kc * wgt; }
						if ( idxB + off > 0 && idxB + off < NODE_COUNT - 1 ) { b.vx[ idxB + off ] -= dvx * kc * wgt; b.vy[ idxB + off ] -= dvy * kc * wgt; }
					}
					if ( vib[ i ] < 0.015 || vib[ j ] < 0.015 ) continue;
					const pInt = Math.min( 1, prox * prox * Math.min( 1.2, Math.sqrt( vib[ i ] * vib[ j ] ) * 1.45 ) );
					if ( pInt < 0.01 ) continue;
					resonantPairs.push( { x0: a.px[ idxA ], y0: a.py[ idxA ], x1: b.px[ idxB ], y1: b.py[ idxB ], intensity: pInt, pal: a.palette, seed: a.id * 3.1 + b.id } );
					const lenAvg = 0.5 * ( Math.hypot( a.end.x - a.start.x, a.end.y - a.start.y ) + Math.hypot( b.end.x - b.start.x, b.end.y - b.start.y ) );
					const baseF = Math.max( 68, Math.min( 210, 220 - ( lenAvg / Math.max( 600, width ) ) * 120 ) );
					rawHum += pInt;
					wFreq += baseF * pInt;
					wDiss += ( 1.056 + ( 1 - prox ) * 0.018 ) * pInt;
					wBeat += ( 2.4 + prox * 3.8 + pInt * 2.0 ) * pInt;
					wPan += ( ( ( a.px[ idxA ] + b.px[ idxB ] ) * 0.5 / Math.max( 1, width ) ) * 2 - 1 ) * pInt;
				}
			}
		}
		const targetHum = rawHum > 0 ? Math.min( 1, 1 - Math.exp( - rawHum * 1.35 ) ) : 0;
		const humAlpha = targetHum > humIntensity ? 1 - Math.exp( - dt * 9 ) : 1 - Math.exp( - dt * 3.4 );
		humIntensity += ( targetHum - humIntensity ) * humAlpha;
		if ( humIntensity < 0.002 ) humIntensity = 0;
		syncProximityHum( humIntensity, rawHum > 0 ? wFreq / rawHum : 110, rawHum > 0 ? wDiss / rawHum : 1.06, rawHum > 0 ? wBeat / rawHum : 3.2, rawHum > 0 ? wPan / rawHum : 0 );

		// Integrate sparks
		const drag = Math.exp( - dt * 3.1 );
		let w = 0;
		for ( let i = 0; i < sparks.length; i ++ ) {
			const p = sparks[ i ];
			p.life -= dt;
			if ( p.life <= 0 ) continue;
			p.vx *= drag; p.vy = p.vy * drag + 460 * dt;
			p.x += p.vx * dt; p.y += p.vy * dt;
			sparks[ w ++ ] = p;
		}
		sparks.length = w;
		stats.bodies = strings.length * NODE_COUNT + sparks.length;

		// Render
		ctx.save();
		ctx.scale( dpr, dpr );
		ctx.fillStyle = '#050708';
		ctx.fillRect( 0, 0, width, height );
		const palBase = PALETTES[ paletteId ] || PALETTES.lime;
		const bg = ctx.createRadialGradient( width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max( width, height ) * 0.55 );
		bg.addColorStop( 0, hexAlpha( palBase.outer, 0.14 ) );
		bg.addColorStop( 1, 'rgba(0,0,0,0)' );
		ctx.fillStyle = bg;
		ctx.fillRect( 0, 0, width, height );

		const traceSmooth = ( xs, ys ) => {
			ctx.beginPath();
			ctx.moveTo( xs[ 0 ], ys[ 0 ] );
			for ( let i = 1; i < xs.length - 1; i ++ ) {
				ctx.quadraticCurveTo( xs[ i ], ys[ i ], ( xs[ i ] + xs[ i + 1 ] ) * 0.5, ( ys[ i ] + ys[ i + 1 ] ) * 0.5 );
			}
			ctx.lineTo( xs[ xs.length - 1 ], ys[ ys.length - 1 ] );
		};

		const tSlot = Math.floor( simTime * 36 );
		for ( const s of strings ) {
			const pal = PALETTES[ s.palette ] || PALETTES.lime;
			const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
			const len = Math.max( 1, Math.hypot( dx, dy ) );
			const nx = - dy / len, ny = dx / len;
			const ptsX = new Float32Array( NODE_COUNT ), ptsY = new Float32Array( NODE_COUNT );
			for ( let i = 0; i < NODE_COUNT; i ++ ) {
				const t = i / ( NODE_COUNT - 1 );
				const j = hash11( i * 1.73 + tSlot * 0.91 + s.seed ) * ( 0.42 + s.charge[ i ] * 1.85 * voltage ) * Math.sin( Math.PI * t );
				ptsX[ i ] = s.px[ i ] + nx * j;
				ptsY[ i ] = s.py[ i ] + ny * j;
			}
			ctx.save();
			ctx.globalCompositeOperation = 'lighter';
			ctx.lineCap = 'round';
			ctx.strokeStyle = hexAlpha( pal.inner, 0.26 );
			ctx.lineWidth = 0.9;
			ctx.beginPath(); ctx.moveTo( s.start.x, s.start.y ); ctx.lineTo( s.end.x, s.end.y ); ctx.stroke();

			ctx.shadowColor = pal.glow;
			ctx.shadowBlur = 24 + s.energy * 14;
			ctx.strokeStyle = hexAlpha( pal.glow, 0.55 );
			ctx.lineWidth = 3.2 + s.energy;
			traceSmooth( ptsX, ptsY ); ctx.stroke();

			ctx.shadowBlur = 8;
			ctx.strokeStyle = pal.core;
			ctx.lineWidth = 1.7 + Math.min( 1, s.energy * 0.65 );
			traceSmooth( ptsX, ptsY ); ctx.stroke();

			for ( const pt of [ s.start, s.end ] ) {
				const halo = ctx.createRadialGradient( pt.x, pt.y, 0, pt.x, pt.y, 18 );
				halo.addColorStop( 0, pal.core );
				halo.addColorStop( 0.4, hexAlpha( pal.glow, 0.55 ) );
				halo.addColorStop( 1, 'rgba(0,0,0,0)' );
				ctx.fillStyle = halo;
				ctx.beginPath(); ctx.arc( pt.x, pt.y, 18, 0, Math.PI * 2 ); ctx.fill();
			}
			ctx.restore();
		}

		// Sympathetic interference filaments & corona arcs
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		for ( const pair of resonantPairs ) {
			if ( pair.intensity < 0.06 ) continue;
			const pal = PALETTES[ pair.pal ] || PALETTES.lime;
			const dx = pair.x1 - pair.x0, dy = pair.y1 - pair.y0, len = Math.max( 1, Math.hypot( dx, dy ) );
			const nx = - dy / len, ny = dx / len;
			ctx.strokeStyle = hexAlpha( pal.inner, Math.min( 0.32, pair.intensity * 0.34 ) );
			ctx.lineWidth = 0.9 + pair.intensity * 0.7;
			ctx.beginPath(); ctx.moveTo( pair.x0, pair.y0 );
			for ( let k = 1; k < 7; k ++ ) {
				const t = k / 7;
				const wv = Math.sin( t * Math.PI * 3 + simTime * 22 + pair.seed ) * 5 * pair.intensity;
				ctx.lineTo( pair.x0 + dx * t + nx * wv * Math.sin( Math.PI * t ), pair.y0 + dy * t + ny * wv * Math.sin( Math.PI * t ) );
			}
			ctx.lineTo( pair.x1, pair.y1 ); ctx.stroke();
		}
		for ( const a of coronaArcs ) {
			const pal = PALETTES[ a.pal ] || PALETTES.lime;
			const dx = a.x1 - a.x0, dy = a.y1 - a.y0, len = Math.max( 1, Math.hypot( dx, dy ) );
			const nx = - dy / len, ny = dx / len;
			ctx.strokeStyle = hexAlpha( pal.core, 0.35 + a.intensity * 0.65 );
			ctx.lineWidth = 1.3;
			ctx.beginPath(); ctx.moveTo( a.x0, a.y0 );
			for ( let i = 1; i < 7; i ++ ) {
				const t = i / 7;
				const jag = hash11( i * 3.7 + a.seed ) * 16 * Math.sin( Math.PI * t );
				ctx.lineTo( a.x0 + dx * t + nx * jag, a.y0 + dy * t + ny * jag );
			}
			ctx.lineTo( a.x1, a.y1 ); ctx.stroke();
		}
		// Preview line (pointer draw or two-hand webcam pinch)
		const activePreview = drawPreview || handPinchPreview;
		if ( activePreview ) {
			const pal = PALETTES[ activePreview.palette ] || PALETTES.lime;
			ctx.strokeStyle = pal.core;
			ctx.lineWidth = 1.8;
			ctx.setLineDash( [ 8, 8 ] );
			ctx.lineDashOffset = - simTime * 42;
			ctx.beginPath(); ctx.moveTo( activePreview.start.x, activePreview.start.y ); ctx.lineTo( activePreview.end.x, activePreview.end.y ); ctx.stroke();
			ctx.setLineDash( [] );
		}
		// Sparks
		for ( const p of sparks ) {
			const ratio = Math.max( 0, Math.min( 1, p.life / p.maxLife ) );
			const tx = p.x - p.vx * 0.022, ty = p.y - p.vy * 0.022;
			ctx.strokeStyle = hexAlpha( p.tail, ratio * 0.9 );
			ctx.lineWidth = p.size * ( 0.9 + ratio * 0.65 );
			ctx.beginPath(); ctx.moveTo( tx, ty ); ctx.lineTo( p.x, p.y ); ctx.stroke();
			ctx.strokeStyle = hexAlpha( p.core, Math.min( 1, ratio * 1.35 ) );
			ctx.lineWidth = Math.max( 0.9, p.size * 0.55 );
			ctx.beginPath(); ctx.moveTo( tx * 0.45 + p.x * 0.55, ty * 0.45 + p.y * 0.55 ); ctx.lineTo( p.x, p.y ); ctx.stroke();
		}
		ctx.restore();
		ctx.restore();
	}

	rafId = requestAnimationFrame( tick );

	return {
		engine: { stats },
		setMode( next ) { mode = next === 'draw' ? 'draw' : 'strum'; },
		setPalette( next ) {
			if ( ! PALETTES[ next ] ) return;
			paletteId = next;
			for ( const s of strings ) { s.palette = next; s.anchorFlash = 0.7; }
		},
		setTension( v ) { tension = v; },
		setReverb( v ) { reverb = v; },
		setSparks( v ) { sparkIntensity = v; },
		triggerPulse() {
			strings.forEach( ( s, i ) => excite( s, 0.4 + ( ( i * 0.17 ) % 0.25 ), ( i % 2 === 0 ? 1 : - 1 ) * 680, 0.75 ) );
		},
		clear() { strings.length = 0; },
		applyHands( h ) { latestHandState = h; },
		applyBreath( b ) { latestBreath = b; },
		dispose() {
			cancelAnimationFrame( rafId );
			window.removeEventListener( 'resize', resize );
			canvas.removeEventListener( 'pointerdown', onPointerDown );
			canvas.removeEventListener( 'pointermove', onPointerMove );
			canvas.removeEventListener( 'pointerup', onPointerUp );
			canvas.removeEventListener( 'pointercancel', onPointerUp );
			try { humOscA?.stop(); humOscB?.stop(); humOscTri?.stop(); humCtx?.close(); } catch { /* ignore */ }
			if ( canvas.parentNode === container ) container.removeChild( canvas );
		}
	};
}
