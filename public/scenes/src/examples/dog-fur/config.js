// Configuration for the "Petting Fur" macro interactive dog coat experience.

export const DOG_FUR_CONFIG = {

	background: 0x0c0907,

	camera: {
		fov: 28,
		near: 0.15,
		far: 50,
		distance: 4.32,
		minHalfWidth: 0.78,
		rise: 0.36,
		parallax: 0.26,
		parallaxLag: 2.2,
		parallaxScaleX: 0.14,
		parallaxScaleY: 0.09,
		lookScaleX: 0.07,
		lookScaleY: 0.05,
		baseCenterY: 0.12
	},

	// Macro golden-hour optical depth of field & restrained filmic finish
	post: {
		focusDistance: 3.85,
		focusSlab: 0.32,
		focalRange: 2.15,
		bokeh: 12.0,
		bloomThreshold: 1.18,
		bloomStrength: 0.16,
		bloomRadius: 0.46,
		exposure: 1.02,
		vignette: 0.34,
		haze: 0.004,
		chromaticAberration: 0.007,
		grain: 0.024
	},

	// Sculpted golden-hour chiaroscuro lighting: preserves deep obsidian blacks & crisp white hair detail
	light: {
		key: {
			color: 0xffd6a2,
			intensity: 17.5,
			position: [ - 2.6, 4.4, 2.3 ],
			target: [ 0.05, - 0.12, 0.15 ],
			angle: 0.72,
			penumbra: 0.90,
			distance: 18,
			decay: 1.55,
			shadowBias: - 0.0005,
			shadowNormalBias: 0.022
		},
		rim: {
			color: 0xffb462,
			intensity: 14.5,
			position: [ 0.9, 3.1, - 3.6 ],
			distance: 15,
			decay: 1.45
		},
		fill: {
			color: 0x6f93c6,
			intensity: 3.4,
			position: [ 3.2, - 0.4, 3.4 ],
			distance: 16,
			decay: 1.5
		},
		touchLight: {
			color: 0xffc682,
			baseIntensity: 0.0,
			activeIntensity: 0.42,
			distance: 2.4,
			decay: 1.8
		},
		hemisphere: {
			sky: 0xffdfba,
			ground: 0x0d0907,
			intensity: 0.18
		},
		sunShafts: [
			{
				apex: [ - 3.1, 4.9, - 1.5 ],
				target: [ 0.55, - 1.4, - 1.2 ],
				angle: 0.30,
				color: 0xffcf88,
				rimTint: [ 1.0, 0.84, 0.58 ],
				strength: 0.044,
				blurGrowth: 0.14
			},
			{
				apex: [ - 0.9, 5.2, - 2.2 ],
				target: [ 1.65, - 1.3, - 1.6 ],
				angle: 0.26,
				color: 0xffc070,
				rimTint: [ 1.0, 0.78, 0.50 ],
				strength: 0.034,
				blurGrowth: 0.16
			}
		],
		environment: {
			background: 0x080605,
			sigma: 0.05,
			cards: [
				{ color: 0xffd299, intensity: 2.8, position: [ - 5, 8, 4 ], width: 6, height: 6 },
				{ color: 0xffaa58, intensity: 2.4, position: [ 2, 6, - 7 ], width: 8, height: 5 },
				{ color: 0x5c7ea8, intensity: 1.1, position: [ 7, 1, 5 ], width: 6, height: 5 },
				{ color: 0x1a110b, intensity: 0.5, position: [ 0, - 6, 2 ], width: 10, height: 4 }
			]
		}
	},

	// Breed physical & grooming profiles (morphed live on the GPU)
	breeds: {
		labrador: {
			label: 'Black Labrador',
			lengthMul: 0.48,
			widthMul: 1.24,
			laydown: 0.92,
			loft: 0.18,
			waveAmp: 0.03,
			waveFreq: 3.2,
			stiffness: 1.42,
			specular: 1.15,
			roughness: 0.34,
			rimGlow: 0.52
		},
		husky: {
			label: 'Husky',
			lengthMul: 0.98,
			widthMul: 1.14,
			laydown: 0.42,
			loft: 0.68,
			waveAmp: 0.14,
			waveFreq: 4.8,
			stiffness: 0.92,
			specular: 0.56,
			roughness: 0.58,
			rimGlow: 0.85
		},
		bernese: {
			label: 'Bernese Mountain Dog',
			lengthMul: 1.38,
			widthMul: 1.04,
			laydown: 0.64,
			loft: 0.36,
			waveAmp: 0.48,
			waveFreq: 6.4,
			stiffness: 0.72,
			specular: 1.08,
			roughness: 0.34,
			rimGlow: 0.92
		}
	},

	interaction: {
		touchRadius: 0.42,
		maxTouches: 5,
		defaultPressure: 1.0,
		defaultSoftness: 1.0,
		defaultWarmth: 1.0
	},

	tiers: {
		low: { strands: 38000, motes: 140, shadowMap: 1024, dofTaps: 24 },
		medium: { strands: 68000, motes: 240, shadowMap: 1536, dofTaps: 36 },
		high: { strands: 96000, motes: 360, shadowMap: 2048, dofTaps: 48 },
		ultra: { strands: 136000, motes: 520, shadowMap: 2048, dofTaps: 64 }
	}

};
