// Quality tiers, pixel-budget DPR capping, and URL query overrides.
//
// URL flags supported across all engine scenes:
//   ?q=low|medium|high|ultra  Force a specific quality tier
//   ?dpr=1.5                  Force a fixed device pixel ratio (disables pixel budget cap)
//   ?drs=0                    Disable adaptive dynamic resolution scaling
//   ?webgl                    Force WebGL2 backend fallback
//   ?debug                    Expose engine handle on window.__collisionEngine

export const DEFAULT_TIERS = {
	low: {
		name: 'low',
		maxDpr: 1.5,
		maxPixels: 1.4e6,
		shadows: false,
		shadowSize: 512,
		shadowSamples: 6,
		dofTaps: 24,
		scale: 0.35
	},
	medium: {
		name: 'medium',
		maxDpr: 2,
		maxPixels: 2.3e6,
		shadows: true,
		shadowSize: 1024,
		shadowSamples: 6,
		dofTaps: 36,
		scale: 0.65
	},
	high: {
		name: 'high',
		maxDpr: 2,
		maxPixels: 3.6e6,
		shadows: true,
		shadowSize: 1024,
		shadowSamples: 8,
		dofTaps: 48,
		scale: 1.0
	},
	ultra: {
		name: 'ultra',
		maxDpr: 2,
		maxPixels: 7.0e6,
		shadows: true,
		shadowSize: 2048,
		shadowSamples: 14,
		dofTaps: 64,
		scale: 1.65
	}
};

/**
 * Resolve the active quality profile by merging scene-specific tier overrides
 * with hardware heuristics and URL query parameters.
 */
export function resolveQuality( customTiers = {}, search = typeof window !== 'undefined' ? window.location.search : '' ) {

	const params = new URLSearchParams( search );
	const tiers = {};

	for ( const key of Object.keys( DEFAULT_TIERS ) ) {

		tiers[ key ] = { ...DEFAULT_TIERS[ key ], ...( customTiers[ key ] || {} ) };

	}

	const dpr = parseFloat( params.get( 'dpr' ) );
	const override = Number.isFinite( dpr ) && dpr > 0 ? { maxDpr: dpr, maxPixels: Infinity } : {};

	const forced = params.get( 'q' );
	if ( forced && tiers[ forced ] ) return { ...tiers[ forced ], ...override };

	if ( typeof window === 'undefined' ) return { ...tiers.high, ...override };

	const coarse = window.matchMedia && window.matchMedia( '(pointer: coarse)' ).matches;
	const small = Math.min( window.screen.width, window.screen.height ) < 820;
	const cores = navigator.hardwareConcurrency || 4;

	if ( coarse && small ) return { ...tiers.low, ...override };
	if ( coarse || cores < 8 ) return { ...tiers.medium, ...override };

	return { ...tiers.high, ...override };

}

/**
 * Parse shared engine runtime flags from a URL query string.
 */
export function parseRuntimeFlags( search = typeof window !== 'undefined' ? window.location.search : '' ) {

	const params = new URLSearchParams( search );

	return {
		forceWebGL: params.has( 'webgl' ),
		adaptiveResolution: params.get( 'drs' ) !== '0',
		debug: params.has( 'debug' ),
		demo: params.get( 'demo' ) || ''
	};

}
