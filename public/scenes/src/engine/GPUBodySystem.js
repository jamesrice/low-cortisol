import * as THREE from 'three/webgpu';
import { instancedArray } from 'three/tsl';

// Reusable GPU storage-buffer instanced body system.
// Encapsulates allocation of `instancedArray` storage buffers, compilation of a
// TSL compute pass, creation of a zero-readback GPU-instanced THREE.Mesh,
// draw-fraction scaling, and clean disposal.

/**
 * Allocate a map of `instancedArray` storage buffers from typed-array specs.
 *
 * @param {number} count Number of GPU bodies
 * @param {Record<string, { type?: string, array?: Float32Array }>} schema
 */
export function createStorageBuffers( count, schema ) {

	const buffers = { count };

	for ( const [ key, def ] of Object.entries( schema ) ) {

		const type = def.type || 'vec4';
		const components = type === 'float' ? 1 : type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4;
		const data = def.array || new Float32Array( count * components );
		buffers[ key ] = instancedArray( data, type );

	}

	return buffers;

}

/**
 * Create a self-contained GPU-simulated instanced body family.
 *
 * @param {object} opts
 * @param {string} opts.name Compute shader label for GPU profilers
 * @param {number} opts.count Total simulated instances
 * @param {object} opts.buffers Map of `instancedArray` storage buffers
 * @param {function} opts.buildComputeFn `(buffers) => Fn(...)` returning compute node factory
 * @param {THREE.BufferGeometry} opts.geometry Base geometry per instance
 * @param {THREE.Material} opts.material NodeMaterial binding `buffers.*.toAttribute()`
 * @param {THREE.Scene} opts.targetScene Scene or overlayScene to add the mesh into
 * @param {boolean} [opts.castShadow=false]
 * @param {boolean} [opts.receiveShadow=false]
 * @param {number} [opts.renderOrder=0]
 */
export function createGPUBodySystem( {
	name = 'GPUBodySystem',
	count,
	buffers,
	buildComputeFn,
	geometry,
	material,
	targetScene,
	castShadow = false,
	receiveShadow = false,
	renderOrder = 0
} ) {

	const computeNode = buildComputeFn ? buildComputeFn( buffers )().compute( count ).setName( name ) : null;

	const mesh = new THREE.Mesh( geometry, material );
	mesh.count = count;
	mesh.frustumCulled = false;
	mesh.castShadow = castShadow;
	mesh.receiveShadow = receiveShadow;
	mesh.renderOrder = renderOrder;

	if ( targetScene ) targetScene.add( mesh );

	function setDrawFraction( fraction ) {

		mesh.count = Math.max( 1, Math.min( count, Math.round( count * fraction ) ) );

	}

	function dispatch( renderer ) {

		if ( computeNode ) renderer.compute( computeNode );

	}

	function dispose() {

		if ( mesh.parent ) mesh.parent.remove( mesh );
		geometry.dispose();
		material.dispose();
		if ( computeNode ) computeNode.dispose();

	}

	return {
		name,
		count,
		buffers,
		mesh,
		computeNode,
		setDrawFraction,
		dispatch,
		dispose
	};

}
