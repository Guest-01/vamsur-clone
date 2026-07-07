/**
 * Sound — procedural sound effects + the shared Web Audio core.
 *
 * Every effect is synthesized at runtime with the Web Audio API (oscillators,
 * noise bursts, envelopes) — no audio files, mirroring how TextureFactory
 * generates all art. A lazily-created AudioContext feeds
 * `master → { sfx bus, music bus }`; the context starts suspended under the
 * browser autoplay policy and is resumed by the first user gesture.
 *
 * The single master mute is persisted to localStorage (REGISTRY.MUTED) and
 * toggled anywhere with the M key; UI (HUD/menu buttons) re-renders through
 * `onChanged`.
 *
 * Like `state/MetaState.ts`, this is INFRASTRUCTURE, not an in-run gameplay
 * module — scenes, systems and entities may import it directly
 * (`Sound.play('hit')`) without violating the no-cross-imports golden rule.
 */
import { REGISTRY } from '../types';

export type SfxKey =
  // UI
  | 'uiHover'
  | 'uiClick'
  | 'uiConfirm'
  | 'uiDenied'
  | 'uiBuy'
  | 'uiRefund'
  | 'reroll'
  // pickups / progression
  | 'xp'
  | 'coin'
  | 'heal'
  | 'magnet'
  | 'chest'
  | 'levelup'
  // combat
  | 'hit'
  | 'enemyDie'
  | 'playerHurt'
  | 'revive'
  | 'bossSpawn'
  | 'eventStart'
  | 'victory'
  | 'defeat'
  // weapon fire
  | 'shoot'
  | 'whoosh'
  | 'spin'
  | 'lob';

const MASTER_GAIN = 0.85;
const MUSIC_BUS_GAIN = 0.5;

/**
 * Per-key minimum ms between plays. Horde-frequency sounds (hits, gems, kills)
 * would otherwise stack into white noise — the limiter keeps the mix readable.
 */
const MIN_GAP_MS: Partial<Record<SfxKey, number>> = {
  hit: 50,
  enemyDie: 70,
  xp: 45,
  coin: 50,
  shoot: 70,
  whoosh: 80,
  spin: 120,
  lob: 80,
  playerHurt: 180,
  uiHover: 60,
};

class SoundEngine {
  private ac: AudioContext | null = null;
  /** true once AudioContext construction has failed (no audio available) */
  private failed = false;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private mutedFlag = false;
  private readonly listeners = new Set<() => void>();
  /** performance.now() of the last play per key (rate limiting) */
  private readonly lastPlay = new Map<string, number>();

  constructor() {
    this.mutedFlag = this.loadMuted();

    if (typeof window !== 'undefined') {
      // Autoplay policy: resume the (suspended) context on the first gesture.
      // Listeners stay attached — iOS can re-suspend the context later.
      const unlock = (): void => {
        if (this.ac && this.ac.state === 'suspended') void this.ac.resume();
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);

      // Global master-mute hotkey (works in every scene).
      window.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.key === 'm' || e.key === 'M') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
          this.toggleMuted();
        }
      });
    }
  }

  /* --------------------------------------------------------------- */
  /* Context / busses                                                 */
  /* --------------------------------------------------------------- */

  /** Lazily create the AudioContext + bus graph. Null if audio is unavailable. */
  context(): AudioContext | null {
    if (this.failed) return null;
    if (!this.ac) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) throw new Error('no AudioContext');
        this.ac = new AC();
      } catch {
        this.failed = true;
        return null;
      }
      this.master = this.ac.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : MASTER_GAIN;
      this.master.connect(this.ac.destination);

      this.sfxBus = this.ac.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ac.createGain();
      this.musicBus.gain.value = MUSIC_BUS_GAIN;
      this.musicBus.connect(this.master);
    }
    return this.ac;
  }

  /** The music bus (Music.ts connects its per-mood gain here). */
  musicOut(): GainNode | null {
    this.context();
    return this.musicBus;
  }

  /** Shared 2s white-noise buffer (looped slices power every noise burst). */
  noiseBuffer(): AudioBuffer | null {
    const ac = this.context();
    if (!ac) return null;
    if (!this.noiseBuf) {
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  /* --------------------------------------------------------------- */
  /* Master mute                                                      */
  /* --------------------------------------------------------------- */

  get muted(): boolean {
    return this.mutedFlag;
  }

  setMuted(m: boolean): void {
    if (m === this.mutedFlag) return;
    this.mutedFlag = m;
    try {
      window.localStorage.setItem(REGISTRY.MUTED, m ? '1' : '0');
    } catch {
      /* ignore unavailable storage */
    }
    if (this.master) this.master.gain.value = m ? 0 : MASTER_GAIN;
    this.listeners.forEach((cb) => cb());
    // Audible confirmation when sound comes back (nothing to hear on mute).
    if (!m) this.play('uiClick');
  }

  toggleMuted(): void {
    this.setMuted(!this.mutedFlag);
  }

  /** Subscribe to mute-state changes (HUD / menu buttons re-render on this). */
  onChanged(cb: () => void): void {
    this.listeners.add(cb);
  }

  offChanged(cb: () => void): void {
    this.listeners.delete(cb);
  }

  private loadMuted(): boolean {
    try {
      return window.localStorage.getItem(REGISTRY.MUTED) === '1';
    } catch {
      return false;
    }
  }

  /* --------------------------------------------------------------- */
  /* Playback                                                         */
  /* --------------------------------------------------------------- */

  play(key: SfxKey): void {
    if (this.mutedFlag) return;
    const ac = this.context();
    // A suspended context (no user gesture yet) can't produce sound anyway.
    if (!ac || ac.state !== 'running' || !this.sfxBus) return;

    const gap = MIN_GAP_MS[key] ?? 30;
    const now = performance.now();
    if (now - (this.lastPlay.get(key) ?? -1e9) < gap) return;
    this.lastPlay.set(key, now);

    this.recipe(key);
  }

  /* --------------------------------------------------------------- */
  /* Synth helpers                                                    */
  /* --------------------------------------------------------------- */

  /** One oscillator voice with an exponential attack/decay envelope. */
  private tone(o: {
    type: OscillatorType;
    from: number;
    to?: number;
    dur: number;
    gain: number;
    at?: number;
    attack?: number;
    detune?: number;
    lowpass?: number;
  }): void {
    const ac = this.ac!;
    const t = ac.currentTime + (o.at ?? 0);
    const osc = ac.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(Math.max(1, o.from), t);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;

    const g = ac.createGain();
    const attack = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    let head: AudioNode = osc;
    if (o.lowpass) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      osc.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(this.sfxBus!);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /** A filtered white-noise burst (impacts, whooshes, shimmer). */
  private noise(o: {
    dur: number;
    gain: number;
    at?: number;
    attack?: number;
    type?: BiquadFilterType;
    from?: number;
    to?: number;
    Q?: number;
  }): void {
    const buf = this.noiseBuffer();
    if (!buf) return;
    const ac = this.ac!;
    const t = ac.currentTime + (o.at ?? 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const g = ac.createGain();
    const attack = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    let head: AudioNode = src;
    if (o.type && o.from) {
      const f = ac.createBiquadFilter();
      f.type = o.type;
      f.frequency.setValueAtTime(o.from, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      if (o.Q) f.Q.value = o.Q;
      src.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(this.sfxBus!);
    src.start(t, Math.random() * 1.0); // random slice so bursts don't repeat
    src.stop(t + o.dur + 0.05);
  }

  /* --------------------------------------------------------------- */
  /* Recipes (retro-arcade voicings tuned to the pixel-art fiction)   */
  /* --------------------------------------------------------------- */

  private recipe(key: SfxKey): void {
    switch (key) {
      /* ------------------------------ UI ---------------------------- */
      case 'uiHover':
        this.tone({ type: 'triangle', from: 980, dur: 0.045, gain: 0.05 });
        break;
      case 'uiClick':
        this.tone({ type: 'square', from: 740, to: 520, dur: 0.07, gain: 0.11 });
        break;
      case 'uiConfirm':
        this.tone({ type: 'square', from: 620, dur: 0.07, gain: 0.12 });
        this.tone({ type: 'square', from: 930, dur: 0.12, gain: 0.12, at: 0.07 });
        break;
      case 'uiDenied':
        this.tone({ type: 'sawtooth', from: 170, to: 115, dur: 0.2, gain: 0.13, lowpass: 900 });
        this.tone({ type: 'square', from: 84, dur: 0.2, gain: 0.08 });
        break;
      case 'uiBuy': // classic two-tone coin + a sparkle
        this.tone({ type: 'square', from: 988, dur: 0.07, gain: 0.13 });
        this.tone({ type: 'square', from: 1319, dur: 0.22, gain: 0.13, at: 0.07 });
        this.noise({ dur: 0.18, gain: 0.03, at: 0.07, type: 'highpass', from: 6000 });
        break;
      case 'uiRefund': // the coin, reversed
        this.tone({ type: 'square', from: 1319, dur: 0.07, gain: 0.12 });
        this.tone({ type: 'square', from: 988, dur: 0.16, gain: 0.12, at: 0.07 });
        break;
      case 'reroll':
        this.noise({ dur: 0.16, gain: 0.06, type: 'bandpass', from: 900, to: 2600 });
        this.tone({ type: 'triangle', from: 520, dur: 0.05, gain: 0.09, at: 0.02 });
        this.tone({ type: 'triangle', from: 700, dur: 0.08, gain: 0.09, at: 0.09 });
        break;

      /* ------------------------ pickups / levels -------------------- */
      case 'xp': {
        const v = 1 + (Math.random() - 0.5) * 0.1;
        this.tone({ type: 'triangle', from: 1080 * v, to: 1500 * v, dur: 0.07, gain: 0.06 });
        break;
      }
      case 'coin':
        this.tone({ type: 'square', from: 940, dur: 0.06, gain: 0.09 });
        this.tone({ type: 'square', from: 1400, dur: 0.14, gain: 0.09, at: 0.05 });
        break;
      case 'heal':
        this.tone({ type: 'sine', from: 520, to: 790, dur: 0.28, gain: 0.12, attack: 0.03 });
        this.tone({ type: 'sine', from: 780, to: 1180, dur: 0.3, gain: 0.06, at: 0.06, attack: 0.03 });
        break;
      case 'magnet': // rising vacuum sweep
        this.noise({ dur: 0.35, gain: 0.08, type: 'bandpass', from: 350, to: 2600, Q: 2 });
        this.tone({ type: 'sine', from: 240, to: 960, dur: 0.35, gain: 0.09, attack: 0.02 });
        break;
      case 'chest': // little C-major fanfare + sparkle
        this.tone({ type: 'square', from: 523, dur: 0.09, gain: 0.11 });
        this.tone({ type: 'square', from: 659, dur: 0.09, gain: 0.11, at: 0.08 });
        this.tone({ type: 'square', from: 784, dur: 0.09, gain: 0.11, at: 0.16 });
        this.tone({ type: 'square', from: 1047, dur: 0.3, gain: 0.12, at: 0.24 });
        this.noise({ dur: 0.5, gain: 0.03, at: 0.2, type: 'highpass', from: 5000 });
        break;
      case 'levelup': // ascending A-major arpeggio with a shimmer tail
        this.tone({ type: 'square', from: 440, dur: 0.24, gain: 0.1 });
        this.tone({ type: 'square', from: 554, dur: 0.24, gain: 0.1, at: 0.09 });
        this.tone({ type: 'square', from: 659, dur: 0.24, gain: 0.1, at: 0.18 });
        this.tone({ type: 'square', from: 880, dur: 0.4, gain: 0.11, at: 0.27 });
        this.tone({ type: 'sine', from: 1760, dur: 0.5, gain: 0.05, at: 0.27 });
        this.noise({ dur: 0.5, gain: 0.025, at: 0.25, type: 'highpass', from: 6000 });
        break;

      /* ----------------------------- combat ------------------------- */
      case 'hit': {
        const v = 1 + (Math.random() - 0.5) * 0.2;
        this.noise({ dur: 0.06, gain: 0.09, type: 'lowpass', from: 1000 * v, to: 320 });
        this.tone({ type: 'sine', from: 230 * v, to: 95, dur: 0.06, gain: 0.07 });
        break;
      }
      case 'enemyDie': {
        const v = 1 + (Math.random() - 0.5) * 0.16;
        this.tone({ type: 'square', from: 280 * v, to: 70, dur: 0.17, gain: 0.08 });
        this.noise({ dur: 0.12, gain: 0.05, type: 'lowpass', from: 700 });
        break;
      }
      case 'playerHurt':
        this.tone({ type: 'sawtooth', from: 320, to: 95, dur: 0.24, gain: 0.17, lowpass: 1600 });
        this.tone({ type: 'sine', from: 140, to: 55, dur: 0.2, gain: 0.2 });
        this.noise({ dur: 0.1, gain: 0.1, type: 'lowpass', from: 900 });
        break;
      case 'revive': // holy chord swell
        this.tone({ type: 'sine', from: 440, dur: 0.9, gain: 0.1, attack: 0.2 });
        this.tone({ type: 'sine', from: 659, dur: 0.9, gain: 0.08, at: 0.1, attack: 0.2 });
        this.tone({ type: 'sine', from: 880, dur: 1.0, gain: 0.07, at: 0.2, attack: 0.25 });
        this.noise({ dur: 0.9, gain: 0.03, at: 0.15, type: 'highpass', from: 5200 });
        break;
      case 'bossSpawn': // detuned low drone + distant roar
        this.tone({ type: 'sawtooth', from: 55, dur: 1.3, gain: 0.16, attack: 0.4, lowpass: 420 });
        this.tone({ type: 'sawtooth', from: 55, detune: 14, dur: 1.3, gain: 0.14, attack: 0.4, lowpass: 420 });
        this.tone({ type: 'sine', from: 42, dur: 1.2, gain: 0.2, attack: 0.3 });
        this.noise({ dur: 1.0, gain: 0.05, type: 'bandpass', from: 420, to: 130, Q: 1.4 });
        break;
      case 'eventStart': // two dark bell tolls
        this.tone({ type: 'sine', from: 392, dur: 1.0, gain: 0.13 });
        this.tone({ type: 'sine', from: 392 * 2.4, dur: 0.55, gain: 0.045 });
        this.tone({ type: 'sine', from: 330, dur: 1.1, gain: 0.11, at: 0.42 });
        this.tone({ type: 'sine', from: 330 * 2.4, dur: 0.6, gain: 0.04, at: 0.42 });
        break;
      case 'victory': // triumphant A-major sting
        this.tone({ type: 'square', from: 440, dur: 0.16, gain: 0.1 });
        this.tone({ type: 'square', from: 659, dur: 0.16, gain: 0.1, at: 0.12 });
        this.tone({ type: 'square', from: 880, dur: 0.16, gain: 0.1, at: 0.24 });
        this.tone({ type: 'square', from: 1109, dur: 0.5, gain: 0.11, at: 0.36 });
        this.tone({ type: 'sine', from: 1319, dur: 0.9, gain: 0.06, at: 0.36, attack: 0.05 });
        this.noise({ dur: 0.8, gain: 0.03, at: 0.36, type: 'highpass', from: 5500 });
        break;
      case 'defeat': // slow descending line into a sub drop
        this.tone({ type: 'sawtooth', from: 220, to: 208, dur: 0.5, gain: 0.1, lowpass: 1100, attack: 0.02 });
        this.tone({ type: 'sawtooth', from: 165, to: 156, dur: 0.55, gain: 0.1, at: 0.45, lowpass: 900 });
        this.tone({ type: 'sawtooth', from: 131, to: 124, dur: 0.6, gain: 0.1, at: 0.95, lowpass: 800 });
        this.tone({ type: 'sine', from: 110, to: 55, dur: 1.4, gain: 0.15, at: 1.45, attack: 0.05 });
        break;

      /* --------------------------- weapon fire ---------------------- */
      case 'shoot': {
        const v = 1 + (Math.random() - 0.5) * 0.12;
        this.tone({ type: 'square', from: 1150 * v, to: 420, dur: 0.06, gain: 0.045 });
        break;
      }
      case 'whoosh':
        this.noise({ dur: 0.16, gain: 0.07, type: 'bandpass', from: 420, to: 1900, Q: 1.2 });
        break;
      case 'spin':
        this.noise({ dur: 0.3, gain: 0.09, type: 'bandpass', from: 260, to: 1400, Q: 1.2 });
        this.tone({ type: 'triangle', from: 300, to: 900, dur: 0.24, gain: 0.03 });
        break;
      case 'lob':
        this.noise({ dur: 0.13, gain: 0.06, type: 'lowpass', from: 800, to: 300 });
        this.tone({ type: 'sine', from: 260, to: 130, dur: 0.12, gain: 0.05 });
        break;
    }
  }
}

/** Process-wide singleton (like MetaState). */
export const Sound = new SoundEngine();
