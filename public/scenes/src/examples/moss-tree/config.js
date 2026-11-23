// Art direction, macro optics, botanical simulation tunables, and quality tiers
// for the Macro Moss Tree & Dandelion Pappus example.

export const MOSS_CONFIG = {

	background: 0x030705,

	camera: {
		fov: 28,
		near: 0.2,
		far: 60,
		distance: 4.85,
		minHalfWidth: 1.5,
		rise: 0.04,
		parallax: 0.32,
		parallaxLag: 2.0,
		parallaxScaleX: 0.15,
		parallaxScaleY: 0.11,
		lookScaleX: 0.08,
		lookScaleY: 0.06,
		baseCenterY: 0.02
	},

	collider: {
		radius: 0.64,
		surfaceOffset: 0.16,
		fallbackPlaneZ: 0.78,
		stiffness: 68,
		damping: 0.68,
		maxSpeed: 18,
		depthSway: 0.12,
		idleAfter: 3.4,
		chargeScale: 1.62,
		lightColor: 0xcff58e,
		lightIntensity: 0.85
	},

	moss: {
		stiffness: 46,
		damping: 5.8,
		brushStrength: 16.5,
		wakeStrength: 1.4,
		swirlStrength: 1.15,
		breezeFreq: 1.35,
		breezeAmp: 0.07,
		activationDecay: 0.38,
		activationGain: 1.85,
		unfurlLift: 0.24,
		sporeLift: 1.45,
		sporeGain: 0.42
	},

	dandelion: {
		flowFrequency: 0.45,
		flowAmplitude: 0.34,
		flowDrift: 0.055,
		prevailingWind: [ 0.14, 0.035, 0.0 ],
		drag: 3.2,
		homeStiffness: 0.14,
		wake: 1.7,
		swirl: 1.65,
		shieldStiffness: 230,
		shieldDamping: 18,
		shieldCore: 0.42,
		rightingStrength: 7.5,
		maxSpeed: 14
	},

	light: {
		sun: {
			position: [ 5.0, 7.4, 3.2 ],
			target: [ - 0.15, - 0.1, 0.1 ],
			color: 0xffe4a8,
			intensity: 175,
			angle: 0.34,
			penumbra: 1.0,
			goboScale: 3.2,
			goboSpeed: 0.04,
			goboContrast: 0.48
		},
		skyRim: { direction: [ - 0.68, 0.65, - 0.48 ], color: 0x6cb8cf, intensity: 0.46 },
		mossBounce: { direction: [ 0.35, - 0.75, 0.55 ], color: 0x3b782c, intensity: 0.22 },
		frontFill: { direction: [ 0.18, 0.25, 0.95 ], color: 0xbcd8a8, intensity: 0.10 },
		environmentIntensity: 0.22,
		shaftStrength: 0.17
	},

	post: {
		exposure: 0.96,
		focusDistance: 4.18, // tack-sharp on front mossy bark & nearby pappus
		focusSlab: 0.28,
		focalRange: 1.50,
		bokeh: 16,
		bloomStrength: 0.26,
		bloomRadius: 0.64,
		bloomThreshold: 1.05,
		haze: 0.0014,
		chromaticAberration: 0.008,
		vignette: 0.48,
		grain: 0.028
	},

	tiers: {
		low: { moss: 36000, sporophytes: 900, spores: 2600, pappus: 55, dofTaps: 24 },
		medium: { moss: 68000, sporophytes: 1600, spores: 4800, pappus: 90, dofTaps: 36 },
		high: { moss: 105000, sporophytes: 2400, spores: 7500, pappus: 125, dofTaps: 48 },
		ultra: { moss: 160000, sporophytes: 3800, spores: 12000, pappus: 175, dofTaps: 64 }
	}

};
