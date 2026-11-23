// Tunables and quality tiers for the "Snow & Light" experience,
// running on the `src/engine` framework.

export const SNOW_AND_LIGHT_CONFIG = {

	background: 0x020712,

	world: {
		floorY: - 2.05,
		wallZ: - 5.6,
		coveRadius: 2.9
	},

	camera: {
		fov: 30,
		near: 0.5,
		far: 140,
		distance: 11.2,
		minHalfWidth: 2.35,
		rise: 0.25,
		parallax: 0.5,
		parallaxLag: 2.2,
		floorY: - 2.05,
		floorFraction: 0.8,
		floorBias: - 0.25
	},

	orb: {
		radius: 0.115,
		shieldRadius: 1.0,
		color: 0xfff0dc,
		intensity: 16,
		emissive: 26,
		stiffness: 52,
		damping: 0.6,
		maxSpeed: 24,
		depthSway: 0.35,
		idleAfter: 2.6,
		chargeScale: 1.55
	},

	swarm: {
		flowFrequency: 0.34,
		flowAmplitude: 0.42,
		flowDrift: 0.045,
		drag: 3.1,
		homeStiffness: 0.42,
		gravity: 7.5,
		gravityRange: 3.0,
		shieldStiffness: 620,
		shieldDamping: 38,
		shieldCore: 0.58,
		swirl: 1.25,
		wake: 1.0,
		maxSpeed: 26,
		dustGain: 1.5,
		dustPull: 0.6,
		cubePull: 0.35
	},

	light: {
		spot: {
			position: [ 7.6, 10.8, - 0.6 ],
			target: [ - 1.3, - 2.05, - 3.1 ],
			color: 0xfff1d2,
			intensity: 760,
			angle: 0.17,
			penumbra: 1.0
		},
		fillMagenta: { direction: [ - 0.72, 0.52, 0.46 ], color: 0x8e8cff, intensity: 0.11 },
		fillTeal: { direction: [ 0.7, - 0.42, 0.58 ], color: 0x4dbdff, intensity: 0.16 },
		environmentIntensity: 0.16,
		spotOnDust: 0.3,
		shaft: 0.24,
		deepBlueShafts: [
			{
				apex: [ - 6.8, 9.8, - 4.6 ],
				target: [ 1.6, - 2.05, - 5.2 ],
				angle: 0.22,
				color: 0x267aff,
				rimTint: [ 0.16, 0.46, 1.0 ],
				strength: 0.34,
				blurGrowth: 0.36
			},
			{
				apex: [ - 1.6, 10.8, - 4.9 ],
				target: [ 4.8, - 2.05, - 5.2 ],
				angle: 0.19,
				color: 0x52bcff,
				rimTint: [ 0.24, 0.62, 1.0 ],
				strength: 0.28,
				blurGrowth: 0.42
			},
			{
				apex: [ - 9.8, 8.6, - 5.0 ],
				target: [ - 2.4, - 2.05, - 5.3 ],
				angle: 0.20,
				color: 0x1d64e8,
				rimTint: [ 0.14, 0.42, 0.95 ],
				strength: 0.24,
				blurGrowth: 0.40
			}
		]
	},

	post: {
		exposure: 1.0,
		focusDistance: 11.2,
		focusSlab: 0.55,
		focalRange: 3.0,
		bokeh: 11,
		bloomStrength: 0.36,
		bloomRadius: 0.72,
		bloomThreshold: 1.0,
		haze: 0.004,
		chromaticAberration: 0.012,
		vignette: 0.5,
		grain: 0.035
	},

	tiers: {
		low: { dust: 45000, cubes: 3500, dofTaps: 24 },
		medium: { dust: 90000, cubes: 6000, dofTaps: 36 },
		high: { dust: 150000, cubes: 9000, dofTaps: 48 },
		ultra: { dust: 280000, cubes: 16000, dofTaps: 64 }
	}

};
