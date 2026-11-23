import * as THREE from 'three/webgpu';

// Responsive framing, DPR/pixel-budget calculation, smooth parallax camera rig,
// and pixel-exact view-offset inspection magnifier.

export function createCameraRig( {
	fov = 30,
	near = 0.25,
	far = 140,
	distance = 11.2,
	minHalfWidth = 2.35,
	rise = 0.25,
	parallax = 0.5,
	parallaxLag = 2.2,
	parallaxScaleX = 0.17,
	parallaxScaleY = 0.14,
	lookScaleX = 0.1,
	lookScaleY = 0.08,
	floorY = null,
	floorFraction = 0.8,
	floorBias = - 0.25,
	baseCenterY = 0,
	baseTarget = new THREE.Vector3( 0, 0, 0 )
} = {} ) {

	const camera = new THREE.PerspectiveCamera( fov, 1, near, far );
	camera.position.set( baseTarget.x, baseCenterY + rise, baseTarget.z + distance );

	const lookAt = baseTarget.clone();
	camera.lookAt( lookAt );

	const frame = {
		width: 1,
		height: 1,
		aspect: 1,
		dpr: 1,
		halfWidth: 4,
		halfHeight: 3,
		centerY: baseCenterY,
		distance,
		pixelSize: 0.001
	};

	const cameraOffset = camera.position.clone();
	const cameraGoal = new THREE.Vector3();
	const lookGoal = new THREE.Vector3();
	let inspectZoom = 1;

	function measure( width, height, quality, resolutionScale = 1 ) {

		const w = Math.max( 1, width );
		const h = Math.max( 1, height );
		const aspect = w / h;
		const tanHalf = Math.tan( THREE.MathUtils.degToRad( fov * 0.5 ) );

		// Pull camera back on narrow/portrait viewports so the subject never clips
		const dist = Math.max( distance, minHalfWidth / ( tanHalf * aspect ) );

		frame.width = w;
		frame.height = h;
		frame.aspect = aspect;

		const budget = Math.max( 0.75, Math.sqrt( quality.maxPixels / ( w * h ) ) );
		frame.dpr = Math.min( window.devicePixelRatio || 1, quality.maxDpr, budget ) * resolutionScale;
		frame.distance = dist;
		frame.halfHeight = tanHalf * dist;
		frame.halfWidth = frame.halfHeight * aspect;

		if ( floorY !== null ) {

			frame.centerY = floorY + floorFraction * frame.halfHeight + floorBias;

		} else {

			frame.centerY = baseCenterY;

		}

		// World height of 1 device pixel at unit distance from the camera
		frame.pixelSize = ( 2 * tanHalf ) / ( h * frame.dpr * inspectZoom );

		camera.aspect = aspect;
		camera.updateProjectionMatrix();

		return frame;

	}

	function update( dt, time, focusPoint = null ) {

		const px = focusPoint ? focusPoint.x - baseTarget.x : 0;
		const py = focusPoint ? focusPoint.y - frame.centerY : 0;

		cameraGoal.set(
			baseTarget.x + px * parallaxScaleX * parallax,
			frame.centerY + rise + py * parallaxScaleY * parallax,
			baseTarget.z + frame.distance
		);

		lookGoal.set(
			baseTarget.x + px * lookScaleX * parallax,
			frame.centerY + py * lookScaleY * parallax,
			baseTarget.z
		);

		const follow = time < 0.05 ? 1 : 1 - Math.exp( - dt * parallaxLag );

		cameraOffset.lerp( cameraGoal, follow );
		lookAt.lerp( lookGoal, follow );

		camera.position.copy( cameraOffset );
		camera.lookAt( lookAt );
		camera.updateMatrixWorld();

	}

	function setInspect( cx = 0.5, cy = 0.5, zoom = 1 ) {

		inspectZoom = Math.max( 1, zoom );

		if ( inspectZoom === 1 ) {

			camera.clearViewOffset();

		} else {

			const W = frame.width * inspectZoom;
			const H = frame.height * inspectZoom;
			camera.setViewOffset( W, H, cx * W - frame.width / 2, cy * H - frame.height / 2, frame.width, frame.height );

		}

	}

	return {
		camera,
		frame,
		lookAt,
		baseTarget,
		get inspectZoom() { return inspectZoom; },
		measure,
		update,
		setInspect
	};

}
