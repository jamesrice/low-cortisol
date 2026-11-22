import * as THREE from 'three/webgpu';

// Configuration for the "Film Bloom" thin-film interference still-lake experience.
// Physically grounded two-beam Airy thin-film interference over a coupled 2D capillary
// ripple + Marangoni nanometer-thickness fluid simulation, with three live-morphing
// surface characters: Still Lake (default), Micro-Veined, and Fracture Lines.

export const FILM_BLOOM_CONFIG = {
	background: 0x040508,

	tiers: {
		low: { simRes: 144, meshSegs: 96, motes: 6000, dofTaps: 24, maxDpr: 1.35, maxPixels: 1.0e6, shadows: false },
		medium: { simRes: 176, meshSegs: 128, motes: 11000, dofTaps: 32, maxDpr: 1.65, maxPixels: 1.7e6, shadows: false },
		high: { simRes: 208, meshSegs: 160, motes: 16000, dofTaps: 40, maxDpr: 2.0, maxPixels: 2.5e6, shadows: false },
		ultra: { simRes: 224, meshSegs: 176, motes: 22000, dofTaps: 48, maxDpr: 2.0, maxPixels: 3.1e6, shadows: false }
	},

	camera: {
		fov: 32,
		near: 0.25,
		far: 60,
		distance: 5.4,
		minHalfWidth: 1.55,
		rise: 1.80,
		baseCenterY: 0.0,
		baseTarget: new THREE.Vector3( 0, 0, 0 ),
		parallax: 0.42,
		parallaxLag: 2.2,
		parallaxScaleX: 0.19,
		parallaxScaleY: 0.14,
		lookScaleX: 0.09,
		lookScaleY: 0.07
	},

	post: {
		exposure: 1.0,
		focusDistance: 5.65,
		focusSlab: 2.1,
		focalRange: 5.8,
		bokeh: 5.8,
		bloomStrength: 0.22,
		bloomRadius: 0.62,
		bloomThreshold: 1.02,
		haze: 0.0005,
		chromaticAberration: 0.004,
		vignette: 0.56,
		grain: 0.016
	},

	surface: {
		// Macro oblique lake tilt (~50° toward camera) so viewing angle sweeps across 20°–48°
		// for lush natural thin-film Brewster/Fresnel color shifting and 3D falling droplet depth
		tiltX: 0.88,
		meshSize: 18.0,
		simSpan: 10.4,
		// Thin-film refractive index (natural oil / iridescent surfactant film over water n=1.333)
		filmIOR: 1.46,
		waterIOR: 1.333,
		// Default surface mode ('lake' | 'veined' | 'fracture')
		defaultMode: 'lake'
	},

	interaction: {
		maxTouches: 5,
		defaultThickness: 1.0,
		defaultViscosity: 1.0,
		defaultRain: 1.0
	},

	light: {
		// Soft moody nocturnal studio & twilight sky cards for velvety specular glints on still water
		environment: {
			background: 0x04060b,
			sigma: 0.06,
			cards: [
				// Soft wide moonlit overcast zenith sheet (makes ripples catch luminous pearl rims)
				{ width: 16, height: 9, color: 0x9ab8d8, intensity: 2.4, position: [ - 1.5, 11, - 3.5 ] },
				// Warm oblique amber-copper grazing card (brings out embossed micro-veins & bronze sheen)
				{ width: 11, height: 7, color: 0xffc688, intensity: 3.1, position: [ - 9.5, 6.5, 3.5 ] },
				// Cool deep teal-indigo opposite rim card
				{ width: 12, height: 8, color: 0x4ea8d8, intensity: 2.3, position: [ 10.0, 5.5, - 2.5 ] },
				// Subtle orchid-rose accent reflection high back
				{ width: 8, height: 5, color: 0xd888d4, intensity: 1.5, position: [ 3.5, 9.0, - 8.5 ] },
				// Soft foreground whisper fill
				{ width: 14, height: 4, color: 0x4a647a, intensity: 0.85, position: [ 0, 2.5, 12.0 ] }
			]
		},

		key: {
			position: [ - 4.4, 5.8, 3.6 ],
			target: [ 0.0, 0.0, 0.0 ],
			color: 0xffdfb8,
			intensity: 19.0,
			distance: 24,
			angle: 0.78,
			penumbra: 0.92,
			decay: 1.7
		},

		rim: {
			position: [ 5.2, 4.4, - 3.4 ],
			color: 0x70c4ec,
			intensity: 12.0,
			distance: 22,
			decay: 1.7
		},

		fill: {
			position: [ 0.8, 3.6, 5.4 ],
			color: 0xb896d4,
			intensity: 4.5,
			distance: 18,
			decay: 1.8
		},

		hemisphere: {
			sky: 0x4a6484,
			ground: 0x0c0907,
			intensity: 0.42
		},

		touchLight: {
			color: 0xdcf4ff,
			activeIntensity: 2.4,
			distance: 6.5,
			decay: 2.0
		}
	}
};
