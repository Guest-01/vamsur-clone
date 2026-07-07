/**
 * Music — a tiny procedural BGM sequencer on top of the Sound engine.
 *
 * Two moods, both generated at runtime (no audio files, perfect loops):
 *  - 'menu': sparse dark-ambient pads + a slow bell line (menu / shop)
 *  - 'game': driving eighth-note bass ostinato, arpeggio, kick + hat, and a
 *    sparse bell melody over an Am–F–C–E progression (the run itself)
 *
 * Scheduling uses the standard look-ahead pattern: a coarse JS interval keeps
 * ~1.3s of notes queued on the AudioContext clock, so playback stays sample-
 * accurate even though timers jitter. When the tab is hidden or the context is
 * suspended (autoplay policy), the pattern pauses and re-arms cleanly instead
 * of "catching up" a burst of stale steps.
 *
 * Infrastructure like Sound — any scene may import { Music } directly.
 */
import { Sound } from './Sound';

export type MusicMood = 'menu' | 'game';

const LOOKAHEAD_SEC = 1.3;
const TICK_MS = 240;
/** mood-gain multiplier while a modal (pause / level-up) is up */
const DUCK_LEVEL = 0.35;

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Chord {
  /** bass root (MIDI) */
  bass: number;
  /** triad tones (MIDI) used by the arpeggio / pad */
  tones: number[];
}

const AM: Chord = { bass: 33, tones: [57, 60, 64] }; // A minor
const F: Chord = { bass: 29, tones: [53, 57, 60] }; // F major
const C: Chord = { bass: 36, tones: [55, 60, 64] }; // C major
const E: Chord = { bass: 28, tones: [52, 56, 59] }; // E major (harmonic-minor V)

// --- 'game': 8 bars × 8 eighth-note steps at 102 BPM (~18.8s loop) ---------
const GAME_BPM = 102;
const GAME_BARS: Chord[] = [AM, AM, F, F, C, C, E, E];
/** sparse bell melody: absolute step (bar*8+sub) → MIDI note */
const GAME_BELLS: Record<number, number> = {
  8: 76, // E5
  14: 72, // C5
  24: 77, // F5
  28: 76, // E5
  40: 79, // G5
  44: 76, // E5
  56: 71, // B4
  60: 68, // G#4
};

// --- 'menu': 4 bars × 4 quarter-note steps at 56 BPM (~17s loop) -----------
const MENU_BPM = 56;
const MENU_BARS: Chord[] = [AM, F, C, E];
const MENU_BELLS: Record<number, number> = { 2: 76, 6: 72, 10: 79, 14: 71 };

class MusicDirector {
  /** the mood a scene asked for (survives mute → unmute) */
  private desired?: MusicMood;
  /** the mood currently scheduling */
  private playing?: MusicMood;
  /** per-mood gain: disconnecting it silences everything already queued */
  private out: GainNode | null = null;
  private timer: number | undefined;
  private step = 0;
  private nextTime = 0;
  /** true when the pattern clock must resync to "now" before scheduling */
  private rearm = true;
  private ducked = false;

  constructor() {
    // Mute halts the scheduler entirely (no point queueing silent notes);
    // unmute restarts the desired mood from the top of its loop.
    Sound.onChanged(() => {
      if (Sound.muted) this.halt();
      else if (this.desired) this.start(this.desired);
    });
    if (typeof document !== 'undefined') {
      // Background tabs throttle timers hard; kick the scheduler the moment
      // the tab is visible again so the loop resumes promptly.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.tick();
      });
    }
  }

  /** Start (or keep) a mood. Safe to call every scene create. */
  play(mood: MusicMood): void {
    this.desired = mood;
    if (Sound.muted) return;
    if (this.playing === mood) return;
    this.start(mood);
  }

  stop(): void {
    this.desired = undefined;
    this.halt();
  }

  /** Fade the music behind a modal (pause / level-up choice) and back. */
  duck(on: boolean): void {
    this.ducked = on;
    const ac = Sound.context();
    if (ac && this.out) {
      this.out.gain.setTargetAtTime(on ? DUCK_LEVEL : 1, ac.currentTime, 0.15);
    }
  }

  /* --------------------------------------------------------------- */
  /* Scheduler                                                        */
  /* --------------------------------------------------------------- */

  private start(mood: MusicMood): void {
    this.halt();
    const ac = Sound.context();
    const bus = Sound.musicOut();
    if (!ac || !bus) return;
    this.out = ac.createGain();
    this.out.gain.value = 1;
    this.out.connect(bus);
    this.ducked = false;
    this.playing = mood;
    this.step = 0;
    this.rearm = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  private halt(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    // Disconnecting the mood gain silences already-scheduled notes at once.
    this.out?.disconnect();
    this.out = null;
    this.playing = undefined;
  }

  private tick(): void {
    const mood = this.playing;
    if (!mood || !this.out) return;
    const ac = Sound.context();
    if (!ac) return;
    if (ac.state !== 'running' || document.hidden) {
      this.rearm = true;
      return;
    }
    if (this.rearm) {
      this.nextTime = ac.currentTime + 0.1;
      this.rearm = false;
    }
    const stepDur = mood === 'game' ? 60 / GAME_BPM / 2 : 60 / MENU_BPM;
    const total = mood === 'game' ? GAME_BARS.length * 8 : MENU_BARS.length * 4;
    while (this.nextTime < ac.currentTime + LOOKAHEAD_SEC) {
      if (mood === 'game') this.gameStep(ac, this.step, this.nextTime);
      else this.menuStep(ac, this.step, this.nextTime);
      this.step = (this.step + 1) % total;
      this.nextTime += stepDur;
    }
  }

  /* --------------------------------------------------------------- */
  /* Patterns                                                         */
  /* --------------------------------------------------------------- */

  private gameStep(ac: AudioContext, step: number, t: number): void {
    const bar = Math.floor(step / 8);
    const sub = step % 8;
    const chord = GAME_BARS[bar];
    const accent = sub === 0 || sub === 4;

    // driving eighth-note bass ostinato, accented on the downbeats
    this.tone(ac, t, {
      type: 'sawtooth',
      freq: midiHz(chord.bass),
      dur: 0.24,
      gain: accent ? 0.13 : 0.085,
      lowpass: 300,
      attack: 0.008,
    });

    // kick thump on the downbeats
    if (accent) this.tone(ac, t, { type: 'sine', freq: 105, to: 44, dur: 0.1, gain: 0.16 });

    // off-beat noise hat for momentum
    if (sub % 2 === 1) this.noise(ac, t, { dur: 0.03, gain: 0.012, type: 'highpass', freq: 6500 });

    // chord arpeggio, jumping an octave in the back half of each bar
    const arp = chord.tones[sub % 3] + (sub >= 4 ? 12 : 0);
    this.tone(ac, t, {
      type: 'triangle',
      freq: midiHz(arp),
      dur: 0.2,
      gain: 0.04,
      lowpass: 2600,
      attack: 0.006,
    });

    const bell = GAME_BELLS[step];
    if (bell !== undefined) this.bell(ac, t, midiHz(bell), 0.055);
  }

  private menuStep(ac: AudioContext, step: number, t: number): void {
    const bar = Math.floor(step / 4);
    const sub = step % 4;
    const chord = MENU_BARS[bar];

    if (sub === 0) {
      // slow pad: root drone + two detuned triangles per chord tone
      this.tone(ac, t, { type: 'sine', freq: midiHz(chord.bass), dur: 4.4, gain: 0.11, attack: 0.9 });
      for (const m of chord.tones) {
        this.tone(ac, t, { type: 'triangle', freq: midiHz(m), dur: 4.2, gain: 0.028, attack: 1.2, lowpass: 1300, detune: -5 });
        this.tone(ac, t, { type: 'triangle', freq: midiHz(m), dur: 4.2, gain: 0.028, attack: 1.2, lowpass: 1300, detune: 5 });
      }
    }

    const bell = MENU_BELLS[step];
    if (bell !== undefined) this.bell(ac, t, midiHz(bell), 0.045);
  }

  /* --------------------------------------------------------------- */
  /* Voices (all connect into the mood gain `out`)                    */
  /* --------------------------------------------------------------- */

  private bell(ac: AudioContext, t: number, freq: number, gain: number): void {
    this.tone(ac, t, { type: 'sine', freq, dur: 1.5, gain, attack: 0.01 });
    // a slightly inharmonic upper partial gives the "bell" character
    this.tone(ac, t, { type: 'sine', freq: freq * 2.4, dur: 0.8, gain: gain * 0.35, attack: 0.01 });
  }

  private tone(
    ac: AudioContext,
    t: number,
    o: {
      type: OscillatorType;
      freq: number;
      to?: number;
      dur: number;
      gain: number;
      attack?: number;
      lowpass?: number;
      detune?: number;
    }
  ): void {
    if (!this.out) return;
    const osc = ac.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;

    const g = ac.createGain();
    const attack = o.attack ?? 0.01;
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
    g.connect(this.out);
    osc.start(t);
    osc.stop(t + o.dur + 0.1);
  }

  private noise(
    ac: AudioContext,
    t: number,
    o: { dur: number; gain: number; type?: BiquadFilterType; freq?: number }
  ): void {
    if (!this.out) return;
    const buf = Sound.noiseBuffer();
    if (!buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    let head: AudioNode = src;
    if (o.type && o.freq) {
      const f = ac.createBiquadFilter();
      f.type = o.type;
      f.frequency.value = o.freq;
      src.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(this.out);
    src.start(t, Math.random() * 1.0);
    src.stop(t + o.dur + 0.05);
  }
}

/** Process-wide singleton (like MetaState / Sound). */
export const Music = new MusicDirector();
