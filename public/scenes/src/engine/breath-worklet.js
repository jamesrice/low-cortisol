// Lightweight real-time AudioWorklet microphone analyzer for breath detection.
// Computes per-block RMS, stereo L/R balance (when hardware exposes 2 channels),
// low/mid/high energy bands, and zero-crossing spectral brightness ("whooo" vs. "shhhh")
// so blowing can be separated cleanly from ambient hum and voiced speech.

const TWO_PI = Math.PI * 2;

class BreathAnalyzerProcessor extends AudioWorkletProcessor {

	constructor() {

		super();
		this.sr = sampleRate || 48000;
		this.lp350 = 0;
		this.lp2200 = 0;
		this.prevSample = 0;

		this.accCount = 0;
		this.sumSqL = 0;
		this.sumSqR = 0;
		this.sumLow = 0;
		this.sumMid = 0;
		this.sumHigh = 0;
		this.zcrCount = 0;
		this.isStereo = false;

	}

	process( inputs ) {

		const input = inputs[ 0 ];
		if ( ! input || input.length === 0 ) return true;

		const chL = input[ 0 ];
		const chR = input.length > 1 ? input[ 1 ] : null;
		const N = chL.length;
		const invSr = 1 / this.sr;

		const aLow = 1 - Math.exp( - TWO_PI * 350 * invSr );
		const aMid = 1 - Math.exp( - TWO_PI * 2200 * invSr );

		this.isStereo = Boolean( chR && chR.length === N );

		for ( let i = 0; i < N; i ++ ) {

			const l = chL[ i ];
			const r = this.isStereo ? chR[ i ] : l;
			const mono = this.isStereo ? 0.5 * ( l + r ) : l;

			this.sumSqL += l * l;
			this.sumSqR += r * r;

			// 3-band crossover split: low (<350Hz), mid (350-2200Hz), high (>2200Hz)
			this.lp350 += ( mono - this.lp350 ) * aLow;
			this.lp2200 += ( mono - this.lp2200 ) * aMid;

			const low = this.lp350;
			const mid = this.lp2200 - this.lp350;
			const high = mono - this.lp2200;

			this.sumLow += low * low;
			this.sumMid += mid * mid;
			this.sumHigh += high * high;

			if ( ( mono >= 0 && this.prevSample < 0 ) || ( mono < 0 && this.prevSample >= 0 ) ) {

				this.zcrCount ++;

			}
			this.prevSample = mono;
			this.accCount ++;

		}

		// Emit compact metrics every ~21 ms (1024 samples @ 48 kHz)
		if ( this.accCount >= 1024 ) {

			const inv = 1 / this.accCount;
			const rmsL = Math.sqrt( this.sumSqL * inv );
			const rmsR = Math.sqrt( this.sumSqR * inv );
			const rms = this.isStereo ? 0.5 * ( rmsL + rmsR ) : rmsL;

			const eLow = Math.sqrt( this.sumLow * inv );
			const eMid = Math.sqrt( this.sumMid * inv );
			const eHigh = Math.sqrt( this.sumHigh * inv );

			// Normalized zero-crossing rate -> spectral brightness ("whooo" ~ 0.15, "shhhh" ~ 0.85)
			const zcrHz = ( this.zcrCount * this.sr ) / ( 2 * this.accCount );
			const centroid = Math.max( 0, Math.min( 1, ( zcrHz - 300 ) / 3200 ) );

			// Stereo L/R interaural level balance (-1 = left, +1 = right)
			const denom = rmsL + rmsR;
			const stereoPan = ( this.isStereo && denom > 1e-4 ) ? ( ( rmsR - rmsL ) / denom ) : 0;

			this.port.postMessage( {
				rms,
				eLow,
				eMid,
				eHigh,
				centroid,
				stereoPan,
				hasStereo: this.isStereo
			} );

			this.accCount = 0;
			this.sumSqL = 0;
			this.sumSqR = 0;
			this.sumLow = 0;
			this.sumMid = 0;
			this.sumHigh = 0;
			this.zcrCount = 0;

		}

		return true;

	}

}

registerProcessor( 'breath-analyzer-processor', BreathAnalyzerProcessor );
