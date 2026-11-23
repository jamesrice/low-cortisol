import {
	parseRuntimeFlags,
	createAudioEngine,
	createBreathInput,
	createHandInput
} from './engine/index.js';
import { createMossTreeExperience } from './examples/moss-tree/scene.js';
import { createSnowAndLightExperience } from './examples/snow-and-light/scene.js';
import { createDogFurExperience } from './examples/dog-fur/scene.js';
import { createFilmBloomExperience } from './examples/film-bloom/scene.js';

window.__appBooted = true;

const $ = ( id ) => document.getElementById( id );

const stage = $( 'stage' );
const btnPanel = $( 'btn-toggle-panel' );
const panel = $( 'hud-panel' );
const themeMeta = document.querySelector( 'meta[name="theme-color"]' );

const sensoryDock = document.querySelector( '.sensory-dock' );
const btnHands = $( 'btn-hands' );
const btnBreath = $( 'btn-breath' );
const btnAudio = $( 'btn-audio' );
const modeToast = $( 'mode-toast' );
const hint = $( 'hint' );

// Global multi-sensory engines (persist across scene switches)
const audioEngine = createAudioEngine();
const breathInput = createBreathInput( {
	getAudioOutputLevel: () => audioEngine.getOutputLevel()
} );
const handInput = createHandInput();
window.__sensory = { audio: audioEngine, breath: breathInput, hands: handInput };

const statBackend = $( 'stat-backend' );
const statFps = $( 'stat-fps' );
const statBodies = $( 'stat-bodies' );

const errorBanner = $( 'error-banner' );
const errorDetail = $( 'error-detail' );

const btnScenePicker = $( 'btn-scene-picker' );
const scenePickerLabel = $( 'scene-picker-label' );
const scenePickerMenu = $( 'scene-picker-menu' );

const DEMOS = {
	moss: {
		label: 'Moss & Pappus',
		btn: $( 'btn-demo-moss' ),
		controls: $( 'moss-only-controls' ),
		themeClass: 'theme-moss',
		themeColor: '#050b07',
		hideCursor: false,
		hint: 'Move pointer or drag to awaken the moss & swirl pappus · Hold to pulse'
	},
	snow: {
		label: 'Snow & Light',
		btn: $( 'btn-demo-snow' ),
		controls: $( 'snow-only-controls' ),
		themeClass: 'theme-snow',
		themeColor: '#020712',
		hideCursor: true,
		hint: 'Sweep pointer or finger through the snow · Hold to swell the field'
	},
	dog: {
		label: 'Petting Fur',
		btn: $( 'btn-demo-dog' ),
		controls: $( 'dog-only-controls' ),
		themeClass: 'theme-dog',
		themeColor: '#0c0907',
		hideCursor: false,
		hint: 'Pet slowly with one or more fingers to comb & part the coat'
	},
	film: {
		label: 'Film Bloom',
		btn: $( 'btn-demo-film' ),
		controls: $( 'film-only-controls' ),
		themeClass: 'theme-film',
		themeColor: '#040508',
		hideCursor: false,
		hint: 'Tap to drop a water bead · Hold to swell · Glide to swirl iridescent film'
	}
};

// Moss controls
const btnFocusMoss = $( 'btn-focus-moss' );
const btnFocusPointer = $( 'btn-focus-pointer' );
const rangeFocus = $( 'range-focus' );
const valFocus = $( 'val-focus' );
const rangeWind = $( 'range-wind' );
const valWind = $( 'val-wind' );
const rangeGlow = $( 'range-glow' );
const valGlow = $( 'val-glow' );
const btnPulse = $( 'btn-pulse' );
const btnGame = $( 'btn-game' );

// Snow & Light controls
const btnSnowRepel = $( 'btn-snow-repel' );
const btnSnowVortex = $( 'btn-snow-vortex' );
const rangeSnowDrift = $( 'range-snow-drift' );
const valSnowDrift = $( 'val-snow-drift' );
const rangeSnowRays = $( 'range-snow-rays' );
const valSnowRays = $( 'val-snow-rays' );
const rangeSnowRadius = $( 'range-snow-radius' );
const valSnowRadius = $( 'val-snow-radius' );
const btnSnowGust = $( 'btn-snow-gust' );
const btnSnowGame = $( 'btn-snow-game' );

// Dog Fur controls
const breedButtons = {
	labrador: $( 'btn-dog-labrador' ),
	husky: $( 'btn-dog-husky' ),
	bernese: $( 'btn-dog-bernese' )
};
const rangeDogPressure = $( 'range-dog-pressure' );
const valDogPressure = $( 'val-dog-pressure' );
const rangeDogSoftness = $( 'range-dog-softness' );
const valDogSoftness = $( 'val-dog-softness' );
const rangeDogWarmth = $( 'range-dog-warmth' );
const valDogWarmth = $( 'val-dog-warmth' );
const btnDogShake = $( 'btn-dog-shake' );
const btnDogSmooth = $( 'btn-dog-smooth' );

// Film Bloom controls
const filmSurfaceButtons = {
	lake: $( 'btn-film-lake' ),
	veined: $( 'btn-film-veined' ),
	fracture: $( 'btn-film-fracture' )
};
const rangeFilmThickness = $( 'range-film-thickness' );
const valFilmThickness = $( 'val-film-thickness' );
const rangeFilmViscosity = $( 'range-film-viscosity' );
const valFilmViscosity = $( 'val-film-viscosity' );
const rangeFilmRain = $( 'range-film-rain' );
const valFilmRain = $( 'val-film-rain' );
const btnFilmDrop = $( 'btn-film-drop' );
const btnFilmGust = $( 'btn-film-gust' );

let currentDemo = null;
let currentName = 'moss';
let switching = false;
let hintTimer = null;
let toastTimer = null;
let scenePickerOpen = false;
let mountedExtraDockControls = [];

function isCustomHandTracking( demo ) {

	return Boolean( demo && demo.customHandTracking );

}

function getActiveHandTrackingState( demo ) {

	if ( isCustomHandTracking( demo ) ) {

		return Boolean( demo.getHandsActive?.() );

	}
	return Boolean( handInput.active );

}

function syncHandButtonUI( active ) {

	const on = Boolean( active );
	btnHands.classList.toggle( 'is-active', on );
	btnHands.setAttribute( 'aria-pressed', String( on ) );
	const customTitle = currentDemo?.handsTitle?.( on );
	btnHands.title = customTitle || ( on
		? 'Webcam Hand Tracking (On — wave open hand, 1 finger focus, closer = deeper)'
		: 'Webcam Hand Tracking (Off)' );
	currentDemo?.syncDockControls?.();

}

function clearExtraDockControls() {

	for ( const el of mountedExtraDockControls ) {

		if ( el && el.parentNode ) el.parentNode.removeChild( el );

	}
	mountedExtraDockControls = [];

}

function mountExtraDockControls( demo ) {

	clearExtraDockControls();
	if ( ! sensoryDock || ! demo?.getExtraDockControls ) return;
	const controls = demo.getExtraDockControls();
	if ( ! Array.isArray( controls ) ) return;
	for ( const el of controls ) {

		if ( ! ( el instanceof HTMLElement ) ) continue;
		sensoryDock.insertBefore( el, btnHands );
		mountedExtraDockControls.push( el );

	}
	demo.syncDockControls?.();

}

function stopAllSensors( { disposeGlobal = false } = {} ) {

	if ( isCustomHandTracking( currentDemo ) ) {

		try { currentDemo.stopHands?.(); } catch {}

	}
	if ( disposeGlobal ) {

		try { handInput.dispose?.(); } catch {}

	} else if ( handInput.active ) {

		try { handInput.stop(); } catch {}

	}
	if ( breathInput.active ) {

		try { breathInput.stop?.(); } catch {}

	}
	if ( audioEngine.enabled ) {

		try { audioEngine.setEnabled?.( false ); } catch {}

	}
	syncHandButtonUI( false );

}

function showError( err ) {

	errorDetail.textContent = String( err && err.stack || err );
	errorBanner.hidden = false;

}

function showToast( text, durationMs = 2000 ) {

	if ( ! modeToast ) return;
	modeToast.textContent = text;
	modeToast.classList.add( 'is-visible' );
	if ( toastTimer ) clearTimeout( toastTimer );
	toastTimer = setTimeout( () => modeToast.classList.remove( 'is-visible' ), durationMs );

}

function setSegmentedActive( buttons, activeBtn ) {

	for ( const b of buttons ) {

		b.setAttribute( 'aria-pressed', String( b === activeBtn ) );

	}

}

function showHint( text ) {

	hint.textContent = text;
	hint.classList.remove( 'is-hidden' );
	if ( hintTimer ) clearTimeout( hintTimer );
	hintTimer = setTimeout( () => hint.classList.add( 'is-hidden' ), 4800 );

}

function setScenePickerOpen( open ) {

	scenePickerOpen = Boolean( open );
	if ( scenePickerMenu ) scenePickerMenu.hidden = ! scenePickerOpen;
	if ( btnScenePicker ) btnScenePicker.setAttribute( 'aria-expanded', String( scenePickerOpen ) );

}

function updateDemoUI( name ) {

	const spec = DEMOS[ name ] || DEMOS.moss;
	document.body.classList.remove( 'theme-moss', 'theme-snow', 'theme-dog', 'theme-film', 'theme-arc' );
	document.body.classList.add( spec.themeClass );
	if ( themeMeta ) themeMeta.setAttribute( 'content', spec.themeColor );
	if ( scenePickerLabel ) scenePickerLabel.textContent = spec.label;

	for ( const [ key, def ] of Object.entries( DEMOS ) ) {

		if ( def.btn ) def.btn.setAttribute( 'aria-selected', String( key === name ) );
		if ( def.controls ) def.controls.hidden = key !== name;

	}

	stage.classList.toggle( 'cursor-hidden', spec.hideCursor );
	showHint( spec.hint );

}

function resetMossControlUI() {

	setSegmentedActive( [ btnFocusMoss, btnFocusPointer ], btnFocusMoss );
	rangeFocus.value = '0';
	valFocus.textContent = '0.00';
	rangeWind.value = '1';
	valWind.textContent = '1.0x';
	rangeGlow.value = '1';
	valGlow.textContent = '1.0x';
	btnGame.setAttribute( 'aria-pressed', 'false' );
	btnGame.classList.remove( 'is-active' );

}

function resetSnowControlUI() {

	setSegmentedActive( [ btnSnowRepel, btnSnowVortex ], btnSnowRepel );
	rangeSnowDrift.value = '1';
	valSnowDrift.textContent = '1.0x';
	rangeSnowRays.value = '1';
	valSnowRays.textContent = '1.0x';
	rangeSnowRadius.value = '1';
	valSnowRadius.textContent = '1.0x';
	btnSnowGame.setAttribute( 'aria-pressed', 'false' );
	btnSnowGame.classList.remove( 'is-active' );

}

function resetDogControlUI( breed = 'labrador' ) {

	const chosen = breedButtons[ breed ] ? breed : 'labrador';
	setSegmentedActive( Object.values( breedButtons ), breedButtons[ chosen ] );
	rangeDogPressure.value = '1';
	valDogPressure.textContent = '1.0x';
	rangeDogSoftness.value = '1';
	valDogSoftness.textContent = '1.0x';
	rangeDogWarmth.value = '1';
	valDogWarmth.textContent = '1.0x';

}

function resetFilmControlUI( surface = 'lake' ) {

	const chosen = filmSurfaceButtons[ surface ] ? surface : 'lake';
	setSegmentedActive( Object.values( filmSurfaceButtons ), filmSurfaceButtons[ chosen ] );
	rangeFilmThickness.value = '1';
	valFilmThickness.textContent = '1.0x';
	rangeFilmViscosity.value = '1';
	valFilmViscosity.textContent = '1.0x';
	rangeFilmRain.value = '1';
	valFilmRain.textContent = '1.0x';

}

async function mountDemo( name, options = {} ) {

	if ( switching ) return;
	switching = true;

	try {

		const prevWasCustom = isCustomHandTracking( currentDemo );

		if ( currentDemo ) {

			if ( prevWasCustom ) {

				try { currentDemo.stopHands?.(); } catch {}

			}
			clearExtraDockControls();
			currentDemo.dispose();
			currentDemo = null;

		}

		currentName = name;
		updateDemoUI( name );
		audioEngine.setScene( name );
		errorBanner.hidden = true;

		if ( name === 'snow' ) {

			resetSnowControlUI();
			currentDemo = await createSnowAndLightExperience( {
				container: stage,
				audio: audioEngine
			} );

		} else if ( name === 'dog' ) {

			const initialBreed = breedButtons[ options.breed ] ? options.breed : 'labrador';
			resetDogControlUI( initialBreed );
			currentDemo = await createDogFurExperience( {
				container: stage,
				audio: audioEngine
			} );
			if ( initialBreed !== 'labrador' ) currentDemo.setBreed( initialBreed );

		} else if ( name === 'film' ) {

			const initialSurface = filmSurfaceButtons[ options.surface ] ? options.surface : 'lake';
			resetFilmControlUI( initialSurface );
			currentDemo = await createFilmBloomExperience( {
				container: stage,
				audio: audioEngine
			} );
			if ( initialSurface !== 'lake' ) currentDemo.setSurfaceMode( initialSurface );

		} else {

			resetMossControlUI();
			currentDemo = await createMossTreeExperience( {
				container: stage,
				audio: audioEngine
			} );

		}

		// Ensure global handInput & its overlay/chip are stopped whenever a scene opts into custom motion tracking
		if ( isCustomHandTracking( currentDemo ) && handInput.active ) {

			handInput.stop();

		}

		mountExtraDockControls( currentDemo );
		syncHandButtonUI( getActiveHandTrackingState( currentDemo ) );

		window.__activeDemo = currentDemo;

	} catch ( err ) {

		console.error( '[app] failed to start demo', err );
		showError( err );

	} finally {

		switching = false;

	}

}

// ------------------------------------------------------------ Shared Binding Helpers

function bindRange( input, readout, format, apply ) {

	let wheelAccum = parseFloat( input.value );
	let lastWheelMs = - Infinity;

	const commit = ( v ) => {

		readout.textContent = format( v );
		apply( v );

	};

	input.addEventListener( 'input', () => {

		const v = parseFloat( input.value );
		wheelAccum = v;
		commit( v );

	} );

	// macOS touchscreen Chrome translates single-finger drags into continuous horizontal
	// wheel events (negative deltaX when dragging right) instead of pointermove.
	// Only responds to horizontal/diagonal pixel drags (leaves vertical mouse scroll,
	// mouse click-drag, and iOS touch 100% unchanged).
	const wheelTarget = input.closest( '.control-row' ) || input;
	wheelTarget.addEventListener( 'wheel', ( e ) => {

		if ( e.ctrlKey || e.deltaMode !== 0 ) return;
		if ( Math.abs( e.deltaX ) < 0.01 || Math.abs( e.deltaX ) < Math.abs( e.deltaY ) * 0.5 ) return;
		if ( e.cancelable ) e.preventDefault();
		e.stopPropagation();

		const now = performance.now();
		if ( now - lastWheelMs > 260 ) wheelAccum = parseFloat( input.value );
		lastWheelMs = now;

		const min = parseFloat( input.min );
		const max = parseFloat( input.max );
		const step = parseFloat( input.step ) || 0.01;
		const trackW = Math.max( 120, input.getBoundingClientRect().width );

		wheelAccum = Math.max( min, Math.min( max, wheelAccum + ( - e.deltaX / trackW ) * ( max - min ) ) );

		const snapped = Math.max( min, Math.min( max, min + Math.round( ( wheelAccum - min ) / step ) * step ) );
		const decimals = ( String( step ).split( '.' )[ 1 ] || '' ).length;
		const nextStr = snapped.toFixed( decimals );

		if ( nextStr !== input.value ) {

			input.value = nextStr;
			commit( parseFloat( nextStr ) );

		}

	}, { passive: false } );

}

function bindGameToggle( button ) {

	button.addEventListener( 'click', () => {

		if ( ! currentDemo?.setGameMode ) return;
		const next = button.getAttribute( 'aria-pressed' ) !== 'true';
		button.setAttribute( 'aria-pressed', String( next ) );
		button.classList.toggle( 'is-active', next );
		currentDemo.setGameMode( next );

	} );

}

// ------------------------------------------------------------ Scene Picker & Panel

const demoEntries = Object.entries( DEMOS );

btnScenePicker.addEventListener( 'click', ( e ) => {

	e.stopPropagation();
	const nextOpen = ! scenePickerOpen;
	setScenePickerOpen( nextOpen );
	if ( nextOpen && ! panel.hidden ) {

		panel.hidden = true;
		btnPanel.setAttribute( 'aria-expanded', 'false' );

	}

} );

for ( const [ key, def ] of demoEntries ) {

	def.btn.addEventListener( 'click', () => {

		setScenePickerOpen( false );
		if ( currentName !== key ) mountDemo( key );
		btnScenePicker.focus();

	} );

}

document.addEventListener( 'pointerdown', ( e ) => {

	if ( ! scenePickerOpen ) return;
	if ( btnScenePicker.contains( e.target ) || scenePickerMenu.contains( e.target ) ) return;
	setScenePickerOpen( false );

} );

document.addEventListener( 'keydown', ( e ) => {

	if ( ! scenePickerOpen ) return;
	if ( e.key === 'Escape' ) {

		e.preventDefault();
		setScenePickerOpen( false );
		btnScenePicker.focus();
		return;

	}

	if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {

		e.preventDefault();
		const optionBtns = demoEntries.map( ( [ , def ] ) => def.btn );
		const focusedIdx = optionBtns.indexOf( document.activeElement );
		const currentIdx = focusedIdx >= 0 ? focusedIdx : demoEntries.findIndex( ( [ k ] ) => k === currentName );
		const step = e.key === 'ArrowDown' ? 1 : - 1;
		const nextIdx = ( currentIdx + step + optionBtns.length ) % optionBtns.length;
		optionBtns[ nextIdx ]?.focus();

	}

} );

btnPanel.addEventListener( 'click', () => {

	const open = panel.hidden;
	panel.hidden = ! open;
	btnPanel.setAttribute( 'aria-expanded', String( open ) );
	if ( open && scenePickerOpen ) setScenePickerOpen( false );

} );

// ------------------------------------------------------------ Moss & Pappus Controls

btnFocusMoss.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFocusMode ) return;
	currentDemo.setFocusMode( 'moss' );
	setSegmentedActive( [ btnFocusMoss, btnFocusPointer ], btnFocusMoss );

} );

btnFocusPointer.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFocusMode ) return;
	currentDemo.setFocusMode( 'pointer' );
	setSegmentedActive( [ btnFocusMoss, btnFocusPointer ], btnFocusPointer );

} );

bindRange( rangeFocus, valFocus, ( v ) => v.toFixed( 2 ), ( v ) => currentDemo?.setFocusOffset?.( v ) );
bindRange( rangeWind, valWind, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setWindScale?.( v ) );
bindRange( rangeGlow, valGlow, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setActivationPersistence?.( v ) );
btnPulse.addEventListener( 'click', () => currentDemo?.triggerPulse?.() );
bindGameToggle( btnGame );

// ------------------------------------------------------------ Snow & Light Controls

btnSnowRepel.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFieldMode ) return;
	currentDemo.setFieldMode( 'repel' );
	setSegmentedActive( [ btnSnowRepel, btnSnowVortex ], btnSnowRepel );

} );

btnSnowVortex.addEventListener( 'click', () => {

	if ( ! currentDemo?.setFieldMode ) return;
	currentDemo.setFieldMode( 'vortex' );
	setSegmentedActive( [ btnSnowRepel, btnSnowVortex ], btnSnowVortex );

} );

bindRange( rangeSnowDrift, valSnowDrift, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setBlizzardDrift?.( v ) );
bindRange( rangeSnowRays, valSnowRays, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setFrozenRays?.( v ) );
bindRange( rangeSnowRadius, valSnowRadius, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setFieldRadius?.( v ) );
btnSnowGust.addEventListener( 'click', () => currentDemo?.triggerFrostGust?.() );
bindGameToggle( btnSnowGame );

// ------------------------------------------------------------ Petting Fur Controls

const allBreedBtns = Object.values( breedButtons );
for ( const [ breedKey, btn ] of Object.entries( breedButtons ) ) {

	btn.addEventListener( 'click', () => {

		if ( ! currentDemo?.setBreed ) return;
		currentDemo.setBreed( breedKey );
		setSegmentedActive( allBreedBtns, btn );

	} );

}

bindRange( rangeDogPressure, valDogPressure, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setTouchPressure?.( v ) );
bindRange( rangeDogSoftness, valDogSoftness, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setCoatSoftness?.( v ) );
bindRange( rangeDogWarmth, valDogWarmth, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setSunbeamWarmth?.( v ) );
btnDogShake.addEventListener( 'click', () => currentDemo?.triggerShakeOff?.() );
btnDogSmooth.addEventListener( 'click', () => currentDemo?.triggerSmoothCoat?.() );

// ------------------------------------------------------------ Film Bloom Controls

const allFilmSurfaceBtns = Object.values( filmSurfaceButtons );
for ( const [ surfaceKey, btn ] of Object.entries( filmSurfaceButtons ) ) {

	btn.addEventListener( 'click', () => {

		if ( ! currentDemo?.setSurfaceMode ) return;
		currentDemo.setSurfaceMode( surfaceKey );
		setSegmentedActive( allFilmSurfaceBtns, btn );

	} );

}

bindRange( rangeFilmThickness, valFilmThickness, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setThicknessScale?.( v ) );
bindRange( rangeFilmViscosity, valFilmViscosity, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setViscosity?.( v ) );
bindRange( rangeFilmRain, valFilmRain, ( v ) => `${ v.toFixed( 1 ) }x`, ( v ) => currentDemo?.setRainRate?.( v ) );
btnFilmDrop.addEventListener( 'click', () => currentDemo?.triggerDropBead?.() );
btnFilmGust.addEventListener( 'click', () => currentDemo?.triggerMarangoniGust?.() );

// ------------------------------------------------------------ Global Sensory Dock (Hands, 3-Phase Breath, Audio)

btnAudio.addEventListener( 'click', async () => {

	try {

		const on = await audioEngine.toggle();
		btnAudio.classList.toggle( 'is-active', on );
		btnAudio.setAttribute( 'aria-pressed', String( on ) );
		btnAudio.title = on ? 'Ambient Audio (On)' : 'Ambient Audio (Muted)';
		showToast( on ? 'Audio: Ambient On' : 'Audio: Muted', 1600 );

	} catch ( err ) {

		console.warn( '[audio] unable to start audio', err );
		showToast( 'Audio unavailable in this browser', 2400 );

	}

} );

let breathBusy = false;
btnBreath.addEventListener( 'click', async () => {

	if ( breathBusy ) return;
	breathBusy = true;
	btnBreath.classList.add( 'is-loading' );

	try {

		const mode = await breathInput.cycle();
		btnBreath.dataset.phase = mode;
		btnBreath.setAttribute( 'aria-pressed', String( mode !== 'off' ) );
		if ( mode === 'breeze' ) {

			btnBreath.setAttribute( 'aria-label', 'Breath microphone control: Breeze' );
			btnBreath.title = 'Breath: Breeze (blow softly for wind, puff for burst — click again for Steer)';
			showToast( 'Breath: Breeze · puff for burst', 2200 );

		} else if ( mode === 'steer' ) {

			btnBreath.setAttribute( 'aria-label', 'Breath microphone control: Steer' );
			btnBreath.title = 'Breath: Steer (whooo ↔ shhhh steers across scene — click again for Off)';
			showToast( 'Breath: Steer · tone guides motion', 2200 );

		} else {

			btnBreath.setAttribute( 'aria-label', 'Breath microphone control: Off' );
			btnBreath.title = 'Breath Control: Off (click for Breeze, again for Steer)';
			btnBreath.style.setProperty( '--breath-level', '0' );
			showToast( 'Breath: Off', 1500 );

		}

	} catch ( err ) {

		console.warn( '[breath] microphone unavailable', err );
		btnBreath.dataset.phase = 'off';
		btnBreath.setAttribute( 'aria-pressed', 'false' );
		const name = err && err.name || '';
		const msg = ( name === 'NotAllowedError' || name === 'PermissionDeniedError' )
			? 'Microphone permission denied'
			: ( name === 'NotFoundError' ? 'No microphone detected' : `Breath error: ${ err?.message || 'unavailable' }` );
		showToast( msg, 2800 );

	} finally {

		btnBreath.classList.remove( 'is-loading' );
		breathBusy = false;

	}

} );

let handsBusy = false;
btnHands.addEventListener( 'click', async () => {

	if ( handsBusy ) return;
	handsBusy = true;
	btnHands.classList.add( 'is-loading' );

	try {

		let on = false;
		if ( isCustomHandTracking( currentDemo ) ) {

			// Guarantee global handInput & its overlay/status chip are torn down before delegating to the scene
			if ( handInput.active ) handInput.stop();
			if ( typeof currentDemo.toggleHands === 'function' ) {

				on = Boolean( await currentDemo.toggleHands() );

			} else if ( currentDemo.getHandsActive?.() ) {

				currentDemo.stopHands?.();
				on = false;

			} else {

				await currentDemo.startHands?.();
				on = true;

			}

		} else {

			on = await handInput.toggle();

		}

		syncHandButtonUI( on );
		const customToast = currentDemo?.handsToast?.( on );
		showToast(
			customToast || ( on ? 'Hands: Active · wave open hand or point' : 'Hands: Off' ),
			2200
		);

	} catch ( err ) {

		console.warn( '[hands] webcam unavailable', err );
		syncHandButtonUI( false );
		const name = err && err.name || '';
		const msg = ( name === 'NotAllowedError' || name === 'PermissionDeniedError' )
			? 'Camera permission denied'
			: ( name === 'NotFoundError' ? 'No camera detected' : `Hand tracking error: ${ err?.message || 'failed to load' }` );
		showToast( msg, 3000 );

	} finally {

		btnHands.classList.remove( 'is-loading' );
		handsBusy = false;

	}

} );

// Tear down active webcam / mic streams cleanly when parent switches away or iframe unloads
window.addEventListener( 'message', ( ev ) => {

	if ( ev.origin !== window.location.origin || ! ev.data || typeof ev.data !== 'object' ) return;
	if ( ev.data.type === 'lc:stop-sensors' ) {

		stopAllSensors( { disposeGlobal: true } );

	}

} );
window.addEventListener( 'pagehide', () => stopAllSensors( { disposeGlobal: true } ) );

// Unified sensor pump feeding active scene every animation frame (zero work when sensors are off)
let lastSensorMs = performance.now();
let prevBreathActive = false;
let prevHandActive = false;

function pumpSensors( nowMs ) {

	const dt = Math.min( 0.05, Math.max( 1 / 240, ( nowMs - lastSensorMs ) / 1000 ) );
	lastSensorMs = nowMs;

	if ( currentDemo ) {

		if ( breathInput.active ) {

			prevBreathActive = true;
			const b = breathInput.update( dt );
			btnBreath.style.setProperty( '--breath-level', b.energy.toFixed( 3 ) );
			currentDemo.applyBreath?.( b );

		} else if ( prevBreathActive ) {

			prevBreathActive = false;
			currentDemo.applyBreath?.( null );

		}

		if ( ! isCustomHandTracking( currentDemo ) ) {

			if ( handInput.active ) {

				prevHandActive = true;
				const h = handInput.update();
				currentDemo.applyHands?.( h );

			} else if ( prevHandActive ) {

				prevHandActive = false;
				currentDemo.applyHands?.( null );

			}

		}

	}

	requestAnimationFrame( pumpSensors );

}
requestAnimationFrame( pumpSensors );

// Dismiss helper hint quickly once the user touches or moves across the stage
function dismissHintSoon() {

	if ( hint.classList.contains( 'is-hidden' ) ) return;
	if ( hintTimer ) clearTimeout( hintTimer );
	hintTimer = setTimeout( () => hint.classList.add( 'is-hidden' ), 1600 );

}
stage.addEventListener( 'pointerdown', dismissHintSoon, { passive: true } );
stage.addEventListener( 'pointermove', dismissHintSoon, { passive: true } );
stage.addEventListener( 'wheel', dismissHintSoon, { passive: true } );

// Periodic telemetry update
setInterval( () => {

	const stats = currentDemo?.engine?.stats;
	if ( ! stats ) return;

	statBackend.textContent = `${ stats.backend.toUpperCase() } · ${ stats.tier }`;
	statFps.textContent = stats.fps > 0 ? `${ Math.round( stats.fps ) } fps` : 'warming…';
	statBodies.textContent = `${ stats.bodies.toLocaleString() } bodies`;

	if ( stats.error ) showError( stats.error );

}, 500 );

// Boot initial scene (?demo=moss | ?demo=snow | ?demo=dog | ?demo=film)
const flags = parseRuntimeFlags();
const urlParams = new URLSearchParams( window.location.search );
const requestedBreed = ( urlParams.get( 'breed' ) || '' ).toLowerCase();
const requestedSurface = ( urlParams.get( 'surface' ) || '' ).toLowerCase();

// Strictly opt-in passive input event monitor (?debug-input only; completely dormant otherwise)
if ( urlParams.has( 'debug-input' ) ) {

	const box = document.createElement( 'pre' );
	box.id = 'input-debug-overlay';
	box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;margin:0;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,0.82);color:#d7f5e5;border:1px solid rgba(255,255,255,0.22);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;max-width:min(94vw,480px);white-space:pre-wrap;';
	box.textContent = `debug-input ready · maxTouchPoints=${ navigator.maxTouchPoints } · pointer=${ window.matchMedia?.( '(pointer: coarse)' ).matches ? 'coarse' : 'fine' }`;
	document.body.appendChild( box );

	const rows = [];
	const logEv = ( e ) => {

		const tgt = e.target && e.target.id ? `#${ e.target.id }` : ( e.target?.tagName?.toLowerCase() || '?' );
		const pInfo = e.pointerType ? `(${ e.pointerType }#${ e.pointerId })` : '';
		const sig = `${ e.type }${ pInfo } ${ tgt }`;
		const xy = typeof e.clientX === 'number'
			? `${ Math.round( e.clientX ) },${ Math.round( e.clientY ) }`
			: ( e.touches?.[ 0 ] ? `${ Math.round( e.touches[ 0 ].clientX ) },${ Math.round( e.touches[ 0 ].clientY ) }` : '' );
		const extra = e.type === 'wheel'
			? ` d=${ Math.round( e.deltaX ) },${ Math.round( e.deltaY ) }`
			: ( e.touches ? ` n=${ e.touches.length }` : ( typeof e.buttons === 'number' ? ` b=${ e.buttons }` : '' ) );

		if ( rows.length > 0 && rows[ rows.length - 1 ].sig === sig ) {

			rows[ rows.length - 1 ].count ++;
			rows[ rows.length - 1 ].tail = `${ xy }${ extra }`;

		} else {

			rows.push( { sig, count: 1, tail: `${ xy }${ extra }` } );
			if ( rows.length > 12 ) rows.shift();

		}

		box.textContent = `maxTouchPoints=${ navigator.maxTouchPoints }\n` + rows.map( ( r ) => `${ r.sig } x${ r.count } ${ r.tail }` ).join( '\n' );

	};

	const evNames = [
		'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture',
		'touchstart', 'touchmove', 'touchend', 'touchcancel',
		'mousedown', 'mousemove', 'mouseup', 'click', 'wheel',
		'gesturestart', 'gesturechange', 'gestureend'
	];
	for ( const name of evNames ) {

		window.addEventListener( name, logEv, { passive: true, capture: true } );

	}

}

function resolveInitialDemo( demoFlag ) {

	if ( demoFlag === 'snow' || demoFlag === 'snow-and-light' || demoFlag === 'light' ) return 'snow';
	if ( demoFlag === 'dog' || demoFlag === 'fur' || demoFlag === 'dog-fur' || demoFlag === 'petting' ) return 'dog';
	if ( demoFlag === 'film' || demoFlag === 'film-bloom' || demoFlag === 'thin-film' || demoFlag === 'bloom' || demoFlag === 'lake' ) return 'film';
	return 'moss';

}

mountDemo( resolveInitialDemo( flags.demo ), { breed: requestedBreed, surface: requestedSurface } );
