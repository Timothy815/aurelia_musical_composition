import * as Tone from 'tone';
import { SongData, NoteData, InstrumentPreset, EffectsSettings, TempoChange, RepeatMarker, HairpinData, VoltaData } from '../types';
import { transposeNote } from './constants';

const DYNAMIC_VELOCITY: Record<string, number> = {
  ppp: 0.08, pp: 0.18, p: 0.32, mp: 0.5, mf: 0.65, f: 0.8, ff: 0.92, fff: 1.0,
};

const ARTICULATION_VEL: Record<string, number> = {
  staccato: 1.0,   // unchanged — duration handles the difference
  accent:   1.35,  // louder attack
  tenuto:   1.05,  // slight stress, full duration
  fermata:  1.0,
};

const ARTICULATION_DUR: Record<string, number> = {
  staccato: 0.45,
  accent:   1.0,
  tenuto:   1.05,
  fermata:  1.75,
};

// ── Tempo / repeat helpers ────────────────────────────────────────────────────

function bpmAtBeat(beat: number, base: number, changes: TempoChange[]): number {
  const hits = changes.filter(c => c.beat <= beat).sort((a, b) => a.beat - b.beat);
  return hits.length ? hits[hits.length - 1].bpm : base;
}

function beatToSeconds(beat: number, base: number, changes: TempoChange[]): number {
  const sorted = [...changes].filter(c => c.beat <= beat).sort((a, b) => a.beat - b.beat);
  let sec = 0, prev = 0, bpm = base;
  for (const c of sorted) {
    sec += (c.beat - prev) * (60 / bpm);
    prev = c.beat;
    bpm = c.bpm;
  }
  return sec + (beat - prev) * (60 / bpm);
}

/**
 * Build the ordered sequence of 0-based measure indices to play, respecting
 * repeat signs and volta brackets.
 *
 * Algorithm:
 *  - Walk measures 0..totalM-1.
 *  - On reaching a repeat-end, jump back to the matching repeat-start for a
 *    second pass.  Track how many times each repeat-end has been visited so
 *    we only repeat once.
 *  - Volta routing: a volta bracket tagged with number N is only played on
 *    pass N through that repeat.  Concretely, when we're on pass 1 we skip
 *    volta-2+ measures; when on pass 2 we skip volta-1 measures.
 */
function buildMeasurePlaySequence(
  repeats: RepeatMarker[],
  voltas: VoltaData[],
  totalMeasures: number
): number[] {
  if (!totalMeasures) return [];

  const endMs = repeats.filter(r => r.type === 'end').map(r => r.measure - 1).sort((a, b) => a - b);
  const startMs = repeats.filter(r => r.type === 'start').map(r => r.measure - 1);

  // Map each repeat-end measure → matching repeat-start measure
  const repeatPairs: Map<number, number> = new Map();
  endMs.forEach(endM => {
    const start = [...startMs].filter(s => s <= endM).sort((a, b) => b - a)[0] ?? 0;
    repeatPairs.set(endM, start);
  });

  // Helper: which volta pass (1 or 2) should a given measure play on?
  // Returns 0 if the measure is not inside any volta bracket.
  const voltaPass = (m: number): number => {
    for (const v of voltas) {
      if (m >= v.startMeasure && m <= v.endMeasure) return v.number;
    }
    return 0;
  };

  const visited = new Map<number, number>(); // repeatEnd → times visited
  const seq: number[] = [];
  let m = 0;
  let pass = 1; // current pass through the active repeat section

  while (m < totalMeasures) {
    const vp = voltaPass(m);
    // Skip this measure if it belongs to a volta that shouldn't play on this pass
    if (vp !== 0 && vp !== pass) {
      m++;
      continue;
    }

    seq.push(m);

    // Check if this measure is a repeat-end
    if (repeatPairs.has(m)) {
      const timesVisited = (visited.get(m) ?? 0) + 1;
      visited.set(m, timesVisited);
      if (timesVisited === 1) {
        // First time at this repeat-end → jump back
        const jumpTo = repeatPairs.get(m)!;
        pass = 2;
        m = jumpTo;
        continue;
      } else {
        // Already repeated → continue forward, reset pass
        pass = 1;
      }
    }
    m++;
  }

  return seq;
}

function expandNotesForRepeats(
  notes: NoteData[],
  repeats: RepeatMarker[],
  voltas: VoltaData[],
  beatsPerMeasure: number
): NoteData[] {
  if (!repeats?.length && !voltas?.length) return notes;

  const maxBeat = notes.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0);
  const totalMeasures = Math.max(
    Math.ceil(maxBeat / beatsPerMeasure),
    repeats.reduce((acc, r) => Math.max(acc, r.measure), 0),
    voltas.reduce((acc, v) => Math.max(acc, v.endMeasure + 1), 0),
    1
  );

  const sequence = buildMeasurePlaySequence(repeats, voltas, totalMeasures);

  const result: NoteData[] = [];
  let offset = 0;

  for (const mIdx of sequence) {
    const mS = mIdx * beatsPerMeasure;
    const mE = (mIdx + 1) * beatsPerMeasure;
    notes
      .filter(n => n.start >= mS - 0.001 && n.start < mE - 0.001)
      .forEach(n => result.push({ ...n, start: n.start - mS + offset }));
    offset += beatsPerMeasure;
  }

  return result.sort((a, b) => a.start - b.start);
}

// ── Hairpin velocity ──────────────────────────────────────────────────────────

function getHairpinVelocityMultiplier(beat: number, hairpins: HairpinData[]): number {
  for (const h of hairpins) {
    if (beat >= h.startBeat - 0.001 && beat <= h.endBeat + 0.001) {
      const span = h.endBeat - h.startBeat;
      if (span <= 0) return 1;
      const t = Math.max(0, Math.min(1, (beat - h.startBeat) / span));
      return h.type === 'cresc' ? 0.6 + t * 0.4 : 1.0 - t * 0.4;
    }
  }
  return 1;
}

// ── Instrument factory ────────────────────────────────────────────────────────
// Returns { synth, chain } where synth is the playable node and chain is the
// last node in any instrument-specific effects chain (connect chain → masterBus).

// Samplers are expensive to create (each triggers CDN fetches). Cache one per
// preset and reuse across play sessions — only disconnect, never dispose them.
const _samplerCache = new Map<string, Tone.Sampler>();

function makeSamplerInstrument(
  cacheKey: string,
  baseUrl: string,
  urls: Record<string, string>,
  fallbackOptions: object
): { synth: any; chain: Tone.ToneAudioNode } {
  if (!_samplerCache.has(cacheKey)) {
    _samplerCache.set(cacheKey, new Tone.Sampler({ urls, baseUrl, release: 1.0 }));
  }
  const sampler = _samplerCache.get(cacheKey)!;

  const gain = new Tone.Gain(1);
  sampler.connect(gain);
  const fallback = new Tone.PolySynth(Tone.Synth as any, fallbackOptions as any).connect(gain);

  const wrapper = {
    triggerAttack: (note: string | string[], time?: any) => {
      const notes = Array.isArray(note) ? note : [note];
      const inst: any = sampler.loaded ? sampler : fallback;
      notes.forEach(n => { try { inst.triggerAttack(n, time ?? Tone.now()); } catch (_) {} });
    },
    triggerRelease: (note?: any, time?: any) => {
      const inst: any = sampler.loaded ? sampler : fallback;
      try { inst.triggerRelease(note, time ?? Tone.now()); } catch (_) {}
    },
    triggerAttackRelease: (note: string | string[], dur: any, time?: any, vel?: any) => {
      const inst: any = sampler.loaded ? sampler : fallback;
      const notes = Array.isArray(note) ? note : [note];
      notes.forEach(n => { try { inst.triggerAttackRelease(n, dur, time ?? Tone.now(), vel); } catch (_) {} });
    },
    dispose: () => {
      // Disconnect sampler from this gain but do NOT dispose it — the sampler
      // is cached and reused across play sessions to avoid CDN re-fetches.
      try { (sampler as any).disconnect(gain); } catch (_) {}
      try { fallback.dispose(); } catch (_) {}
      try { gain.dispose(); } catch (_) {}
    },
  };
  return { synth: wrapper, chain: gain };
}

function makeInstrument(preset: InstrumentPreset): { synth: any; chain: Tone.ToneAudioNode } {
  switch (preset) {
    case 'guitar': {
      return makeSamplerInstrument(
        'guitar',
        'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_guitar_steel-mp3/',
        {
          E2: 'E2.mp3', G2: 'G2.mp3', Bb2: 'Bb2.mp3', Db3: 'Db3.mp3',
          E3: 'E3.mp3', G3: 'G3.mp3', Bb3: 'Bb3.mp3', Db4: 'Db4.mp3',
          E4: 'E4.mp3', G4: 'G4.mp3', Bb4: 'Bb4.mp3', Db5: 'Db5.mp3',
          E5: 'E5.mp3',
        },
        { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.8 } }
      );
    }
    case 'strings': {
      return makeSamplerInstrument(
        'strings',
        'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/string_ensemble_1-mp3/',
        {
          C3: 'C3.mp3', Eb3: 'Eb3.mp3', Gb3: 'Gb3.mp3', A3: 'A3.mp3',
          C4: 'C4.mp3', Eb4: 'Eb4.mp3', Gb4: 'Gb4.mp3', A4: 'A4.mp3',
          C5: 'C5.mp3', Eb5: 'Eb5.mp3', Gb5: 'Gb5.mp3', A5: 'A5.mp3',
          C6: 'C6.mp3',
        },
        { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.4, decay: 0.1, sustain: 0.9, release: 1.5 } }
      );
    }
    case 'brass': {
      return makeSamplerInstrument(
        'brass',
        'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/brass_section-mp3/',
        {
          E2: 'E2.mp3', G2: 'G2.mp3', Bb2: 'Bb2.mp3', Db3: 'Db3.mp3',
          E3: 'E3.mp3', G3: 'G3.mp3', Bb3: 'Bb3.mp3', Db4: 'Db4.mp3',
          E4: 'E4.mp3', G4: 'G4.mp3', Bb4: 'Bb4.mp3',
        },
        { oscillator: { type: 'square' }, envelope: { attack: 0.08, decay: 0.2, sustain: 0.75, release: 0.5 } }
      );
    }
    case 'bass': {
      return makeSamplerInstrument(
        'bass',
        'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/electric_bass_finger-mp3/',
        {
          E1: 'E1.mp3', G1: 'G1.mp3', Bb1: 'Bb1.mp3', Db2: 'Db2.mp3',
          E2: 'E2.mp3', G2: 'G2.mp3', Bb2: 'Bb2.mp3', Db3: 'Db3.mp3',
          E3: 'E3.mp3', G3: 'G3.mp3',
        },
        { oscillator: { type: 'triangle' }, envelope: { attack: 0.04, decay: 0.35, sustain: 0.7, release: 0.5 } }
      );
    }
    case 'flute': {
      return makeSamplerInstrument(
        'flute',
        'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/flute-mp3/',
        {
          C4: 'C4.mp3', Eb4: 'Eb4.mp3', Gb4: 'Gb4.mp3', A4: 'A4.mp3',
          C5: 'C5.mp3', Eb5: 'Eb5.mp3', Gb5: 'Gb5.mp3', A5: 'A5.mp3',
          C6: 'C6.mp3', Eb6: 'Eb6.mp3', Gb6: 'Gb6.mp3', A6: 'A6.mp3',
          C7: 'C7.mp3',
        },
        { oscillator: { type: 'sine' }, envelope: { attack: 0.2, decay: 0.05, sustain: 0.95, release: 0.8 } }
      );
    }
    case 'organ': {
      return makeSamplerInstrument(
        'organ',
        'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/church_organ-mp3/',
        {
          C2: 'C2.mp3', Eb2: 'Eb2.mp3', Gb2: 'Gb2.mp3', A2: 'A2.mp3',
          C3: 'C3.mp3', Eb3: 'Eb3.mp3', Gb3: 'Gb3.mp3', A3: 'A3.mp3',
          C4: 'C4.mp3', Eb4: 'Eb4.mp3', Gb4: 'Gb4.mp3', A4: 'A4.mp3',
          C5: 'C5.mp3', Eb5: 'Eb5.mp3', Gb5: 'Gb5.mp3', A5: 'A5.mp3',
          C6: 'C6.mp3',
        },
        { oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.1 } }
      );
    }
    case 'synth': {
      // Classic polysynth — sawtooth with mild PWM for animation
      const synth = new Tone.PolySynth(Tone.Synth as any, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.02, decay: 0.15, sustain: 0.6, release: 1.0 },
      } as any);
      return { synth, chain: synth };
    }
    case 'drums': {
      const gain = new Tone.Gain(1);

      // Kick
      const kick = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 6,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
      }).connect(gain);

      // Floor tom
      const floorTom = new Tone.MembraneSynth({
        pitchDecay: 0.04, octaves: 5,
        envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.1 },
      }).connect(gain);

      // Mid tom
      const midTom = new Tone.MembraneSynth({
        pitchDecay: 0.035, octaves: 4.5,
        envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
      }).connect(gain);

      // High tom
      const highTom = new Tone.MembraneSynth({
        pitchDecay: 0.03, octaves: 4,
        envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.06 },
      }).connect(gain);

      // Snare
      const snare = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.05 },
      }).connect(gain);

      // Hi-hat closed
      const hihat = new (Tone as any).MetalSynth({
        frequency: 400, envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(gain);

      // Hi-hat open
      const openHihat = new (Tone as any).MetalSynth({
        frequency: 400, envelope: { attack: 0.001, decay: 0.35, release: 0.1 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(gain);

      // Ride
      const ride = new (Tone as any).MetalSynth({
        frequency: 250, envelope: { attack: 0.001, decay: 0.5, release: 0.2 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 3000, octaves: 1.5,
      }).connect(gain);

      // Crash
      const crash = new (Tone as any).MetalSynth({
        frequency: 300, envelope: { attack: 0.001, decay: 1.2, release: 0.5 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 3500, octaves: 1.5,
      }).connect(gain);

      const drumSynths: Record<string, any> = {
        F3: kick, A3: floorTom, D4: midTom, E4: highTom,
        C4: snare, F5: hihat, G5: openHihat, A5: ride, B5: crash,
      };
      const drumFreqs: Record<string, number> = {
        F3: 55, A3: 80, D4: 110, E4: 150,
      };

      const triggerDrum = (pitch: string, dur: any, time: any, vel: any) => {
        const s = drumSynths[pitch];
        if (!s) return;
        try {
          if (pitch === 'C4') {
            s.triggerAttackRelease(dur, time ?? Tone.now(), vel);
          } else if (['F5', 'G5', 'A5', 'B5'].includes(pitch)) {
            s.triggerAttackRelease(dur, time ?? Tone.now(), vel);
          } else {
            s.triggerAttackRelease(drumFreqs[pitch] ?? 100, dur, time ?? Tone.now(), vel);
          }
        } catch (_) {}
      };

      const wrapper = {
        triggerAttack: (_note: any, _time?: any) => {},
        triggerRelease: (_note?: any, _time?: any) => {},
        triggerAttackRelease: (note: string | string[], dur: any, time?: any, vel?: any) => {
          const notes = Array.isArray(note) ? note : [note];
          notes.forEach(n => triggerDrum(n, dur, time, vel));
        },
        dispose: () => {
          [kick, floorTom, midTom, highTom, snare, hihat, openHihat, ride, crash, gain]
            .forEach(s => { try { s.dispose(); } catch (_) {} });
        },
      };
      return { synth: wrapper, chain: gain };
    }
    default:
      // piano — caller handles via sampler, but need a fallback shape
      const synth = new Tone.PolySynth(Tone.Synth as any, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 1.0 },
      } as any);
      return { synth, chain: synth };
  }
}

class AudioEngine {
  initialized = false;
  sampler: Tone.Sampler | null = null;
  fallbackSynth: Tone.PolySynth | null = null;
  previewSynth: Tone.PolySynth | null = null;
  metronomeSynth: Tone.Synth | null = null;
  metronomeLoop: Tone.Loop | null = null;
  isMetronomeEnabled = false;
  trackSynths: Map<string, any> = new Map();
  trackChainNodes: Map<string, Tone.ToneAudioNode[]> = new Map();
  realtimeNotes = new Set<string>();
  private pendingReleases = new Set<string>();
  private realtimeNoteSynth = new Map<string, 'sampler' | 'fallback' | 'custom'>();
  private realtimeFallback: Tone.PolySynth | null = null;
  private customRealtime: { synth: any; chain: Tone.ToneAudioNode; preset: InstrumentPreset } | null = null;
  private initPromise: Promise<void> | null = null;
  private midiActivePitches = new Set<string>();
  private midiNoteSource = new Map<string, 'sampler' | 'fallback' | 'custom'>();

  // ── Master bus + effects chain ───────────────────────────────────────────
  private masterBus: Tone.Gain | null = null;
  private fxFuzz: Tone.Chebyshev | null = null;
  private fxOverdrive: Tone.Distortion | null = null;
  private fxPhaser: Tone.Phaser | null = null;
  private fxChorus: Tone.Chorus | null = null;
  private fxFlanger: Tone.Chorus | null = null;
  private fxTremolo: Tone.Tremolo | null = null;
  private fxDelay: Tone.FeedbackDelay | null = null;
  private fxReverb: Tone.Freeverb | null = null;
  private fxVibrato: Tone.Vibrato | null = null;

  onNotePlay?: (pitch: string) => void;
  onNoteStop?: (pitch: string) => void;
  onSamplerLoad?: () => void;

  async init() {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await Tone.start();

        // Master bus (all sources connect here)
        this.masterBus = new Tone.Gain(1);

        // Effects chain (wet=0 = bypassed; always in chain)
        this.fxFuzz      = new Tone.Chebyshev(50);
        this.fxOverdrive = new Tone.Distortion({ distortion: 0.4, wet: 0 });
        this.fxPhaser    = new Tone.Phaser({ frequency: 0.5, octaves: 3, wet: 0 });
        this.fxChorus    = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 }).start();
        this.fxFlanger   = new Tone.Chorus({ frequency: 0.3, delayTime: 1,   depth: 0.5, wet: 0 }).start();
        this.fxTremolo   = new Tone.Tremolo({ frequency: 4,   depth: 0.8,   wet: 0 }).start();
        this.fxDelay     = new Tone.FeedbackDelay({ delayTime: 0.375, feedback: 0.4, wet: 0 });
        this.fxReverb    = new Tone.Freeverb({ roomSize: 0.7, dampening: 3000, wet: 0 });
        this.fxVibrato   = new Tone.Vibrato({ frequency: 5, depth: 0, wet: 1 });

        (this.fxFuzz as any).wet.value = 0;

        // Chain in series: masterBus → fuzz → overdrive → phaser → chorus → flanger → tremolo → delay → reverb → vibrato → dest
        // NOTE: .connect() returns `this` (the source), so chaining it wires everything in parallel.
        // .chain() wires nodes in series as expected.
        this.masterBus.chain(
          this.fxFuzz!,
          this.fxOverdrive!,
          this.fxPhaser!,
          this.fxChorus!,
          this.fxFlanger!,
          this.fxTremolo!,
          this.fxDelay!,
          this.fxReverb!,
          this.fxVibrato!,
          Tone.getDestination()
        );

        this.realtimeFallback = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as any },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.8 }
        }).connect(this.masterBus);

        this.fallbackSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as any },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 }
        }).connect(this.masterBus);

        this.previewSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as any },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 }
        }).connect(this.masterBus);

        this.sampler = new Tone.Sampler({
          urls: {
            A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
            A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
            A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
            A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
            A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
            A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
            A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
            A7: "A7.mp3", C8: "C8.mp3"
          },
          release: 1.0,
          baseUrl: `${import.meta.env.BASE_URL}salamander/`,
          onload: () => { this.onSamplerLoad?.(); },
        }).connect(this.masterBus);

        this.metronomeSynth = new Tone.Synth({
          oscillator: { type: "square" as any },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 }
        }).toDestination(); // metronome bypasses master FX chain
        this.metronomeSynth.volume.value = -10;

        this.initialized = true;
      })();
    }
    return this.initPromise;
  }

  // ── MIDI wheel controls ───────────────────────────────────────────────────

  applyPitchBend(cents: number) {
    if (this.sampler) {
      try { (this.sampler as any).detune.value = cents; } catch (_) {}
    }
    _samplerCache.forEach(s => {
      try { (s as any).detune.value = cents; } catch (_) {}
    });
    if (this.customRealtime) {
      try { (this.customRealtime.synth as any).detune?.value !== undefined && ((this.customRealtime.synth as any).detune.value = cents); } catch (_) {}
    }
    if (this.realtimeFallback) {
      try { (this.realtimeFallback as any).detune.value = cents; } catch (_) {}
    }
    if (this.fallbackSynth) {
      try { (this.fallbackSynth as any).detune.value = cents; } catch (_) {}
    }
    if (this.previewSynth) {
      try { (this.previewSynth as any).detune.value = cents; } catch (_) {}
    }
  }

  setModulation(value: number) {
    if (this.fxVibrato) {
      (this.fxVibrato.depth as any).value = (value / 127) * 0.3;
    }
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  setEffects(s: EffectsSettings) {
    if (!this.initialized) return;

    (this.fxReverb as any).wet.value    = s.reverb.enabled    ? s.reverb.wet    : 0;
    (this.fxReverb as any).roomSize.value = s.reverb.roomSize;

    (this.fxDelay as any).wet.value     = s.delay.enabled     ? s.delay.wet     : 0;
    (this.fxDelay as any).delayTime.value = s.delay.time;
    (this.fxDelay as any).feedback.value  = s.delay.feedback;

    (this.fxChorus as any).wet.value    = s.chorus.enabled    ? s.chorus.wet    : 0;
    (this.fxChorus as any).depth        = s.chorus.depth;
    (this.fxChorus as any).frequency.value = s.chorus.frequency;

    (this.fxPhaser as any).wet.value    = s.phaser.enabled    ? s.phaser.wet    : 0;
    (this.fxPhaser as any).frequency.value = s.phaser.frequency;

    (this.fxTremolo as any).wet.value   = s.tremolo.enabled   ? s.tremolo.wet   : 0;
    (this.fxTremolo as any).frequency.value = s.tremolo.frequency;
    (this.fxTremolo as any).depth.value = s.tremolo.depth;

    (this.fxOverdrive as any).wet.value = s.overdrive.enabled ? s.overdrive.wet : 0;
    (this.fxOverdrive as any).distortion = s.overdrive.amount;

    (this.fxFuzz as any).wet.value      = s.fuzz.enabled      ? s.fuzz.wet      : 0;
    (this.fxFuzz as any).order          = s.fuzz.order;

    (this.fxFlanger as any).wet.value   = s.flanger.enabled   ? s.flanger.wet   : 0;
    (this.fxFlanger as any).depth       = s.flanger.depth;
    (this.fxFlanger as any).frequency.value = s.flanger.frequency;
  }

  // ── Realtime ──────────────────────────────────────────────────────────────

  private getRealtimeInstrument(): Tone.Sampler | Tone.PolySynth {
    return (this.sampler && this.sampler.loaded) ? this.sampler : (this.fallbackSynth!);
  }

  setActivePreset(preset: InstrumentPreset) {
    if (!this.initialized) return;
    if (this.customRealtime?.preset === preset) return;
    // Release any held notes on the old instrument
    for (const p of this.realtimeNotes) this._releaseRealtimeNote(p);
    this.realtimeNotes.clear();
    if (this.customRealtime) {
      try { this.customRealtime.chain.dispose(); } catch (_) {}
      this.customRealtime = null;
    }
    if (preset !== 'piano') {
      const { synth, chain } = makeInstrument(preset);
      chain.connect(this.masterBus!);
      this.customRealtime = { synth, chain, preset };
    }
  }

  playNoteRealtime(pitch: string) {
    if (!this.initialized) return;
    if (this.pendingReleases.has(pitch)) {
      this.pendingReleases.delete(pitch);
      return;
    }
    if (this.realtimeNotes.has(pitch)) this._releaseRealtimeNote(pitch);
    this.realtimeNotes.add(pitch);
    if (this.customRealtime) {
      this.customRealtime.synth.triggerAttack(pitch, Tone.now());
      this.realtimeNoteSynth.set(pitch, 'custom');
    } else if (this.sampler) {
      this.sampler.triggerAttack(pitch);
      this.realtimeNoteSynth.set(pitch, 'sampler');
    } else {
      this.realtimeFallback!.triggerAttack(pitch);
      this.realtimeNoteSynth.set(pitch, 'fallback');
    }
  }

  stopNoteRealtime(pitch: string) {
    if (!this.initialized) {
      this.pendingReleases.add(pitch);
      return;
    }
    this.pendingReleases.delete(pitch);
    if (!this.realtimeNotes.has(pitch)) return;
    this.realtimeNotes.delete(pitch);
    this._releaseRealtimeNote(pitch);
  }

  private _releaseRealtimeNote(pitch: string) {
    const synthType = this.realtimeNoteSynth.get(pitch);
    this.realtimeNoteSynth.delete(pitch);
    if (synthType === 'custom') {
      try { this.customRealtime?.synth.triggerRelease?.(pitch, Tone.now()); } catch (_) {}
    } else if (synthType === 'sampler') {
      try { this.sampler?.triggerRelease(pitch); } catch (_) {}
    } else {
      try { this.realtimeFallback?.triggerRelease(pitch); } catch (_) {}
    }
  }

  // ── MIDI keyboard ─────────────────────────────────────────────────────────

  playMidiNote(pitch: string) {
    if (!this.initialized) return;
    if (this.midiActivePitches.has(pitch)) this._releaseMidiNote(pitch);
    this.midiActivePitches.add(pitch);
    const t = Tone.now() + 0.015;
    if (this.customRealtime) {
      try { this.customRealtime.synth.triggerAttack(pitch, t); } catch (_) {}
      this.midiNoteSource.set(pitch, 'custom');
    } else if (this.sampler) {
      this.sampler.triggerAttack(pitch, t, 0.8);
      this.midiNoteSource.set(pitch, 'sampler');
    } else {
      this.realtimeFallback?.triggerAttack(pitch, t);
      this.midiNoteSource.set(pitch, 'fallback');
    }
  }

  stopMidiNote(pitch: string) {
    if (!this.initialized) return;
    if (!this.midiActivePitches.has(pitch)) return;
    this.midiActivePitches.delete(pitch);
    this._releaseMidiNote(pitch);
  }

  private _releaseMidiNote(pitch: string) {
    const src = this.midiNoteSource.get(pitch);
    this.midiNoteSource.delete(pitch);
    const t = Tone.now() + 0.015;
    try {
      if (src === 'custom') this.customRealtime?.synth.triggerRelease?.(pitch, t);
      else if (src === 'fallback') this.realtimeFallback?.triggerRelease(pitch, t);
      else this.sampler?.triggerRelease(pitch, t);
    } catch (_) {}
  }

  releaseAllMidiNotes() {
    this.midiActivePitches.forEach(pitch => this._releaseMidiNote(pitch));
    this.midiActivePitches.clear();
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  playNotePreview(pitch: string, preset?: InstrumentPreset) {
    if (!this.initialized) return;
    if (preset && preset !== 'piano') {
      const { synth, chain } = makeInstrument(preset);
      chain.connect(this.masterBus!);
      try { synth.triggerAttackRelease(pitch, "8n"); } catch (_) {}
      setTimeout(() => {
        try { synth.dispose(); chain.dispose(); } catch (_) {}
      }, 3000);
    } else if (this.sampler && this.sampler.loaded) {
      this.sampler.triggerAttackRelease(pitch, "8n");
    } else {
      this.previewSynth?.triggerAttackRelease(pitch, "8n");
    }
  }

  playChordRealtime(pitches: string[]) {
    if (!this.initialized) return;
    this.getRealtimeInstrument().triggerAttackRelease(pitches, "2n");
  }

  // ── Metronome ─────────────────────────────────────────────────────────────

  setMetronome(enabled: boolean, timeSignature: number[]) {
    this.isMetronomeEnabled = enabled;
    if (this.metronomeLoop) {
      this.metronomeLoop.dispose();
      this.metronomeLoop = null;
    }
    if (enabled && this.metronomeSynth) {
      // Compound meter detection: denominator=8 and numerator divisible by 3 (6/8, 9/8, 12/8)
      const [num, denom] = timeSignature;
      const isCompound = denom === 8 && num % 3 === 0;
      // In compound meter, felt beats are dotted quarters (= 3 eighth notes = 1.5 quarter beats)
      // beatsPerBar in felt beats: 6/8→2, 9/8→3, 12/8→4
      const feltBeatsPerBar = isCompound ? num / 3 : num;
      const tickInterval = isCompound ? "4n." : "4n";
      let beat = 0;
      this.metronomeLoop = new Tone.Loop((time) => {
        if (beat % feltBeatsPerBar === 0) {
          this.metronomeSynth!.triggerAttackRelease("C6", "32n", time, 1);
        } else {
          this.metronomeSynth!.triggerAttackRelease("G5", "32n", time, 0.5);
        }
        beat++;
      }, tickInterval);
      this.metronomeLoop.start(0);
    }
  }

  playCountInBeat(isDownbeat: boolean) {
    if (!this.initialized || !this.metronomeSynth) return;
    this.metronomeSynth.triggerAttackRelease(
      isDownbeat ? "C6" : "G5", "32n", Tone.now(), isDownbeat ? 1 : 0.5
    );
  }

  startCountIn(tempo: number, timeSignature: number[]) {
    if (!this.initialized) return;
    Tone.Transport.cancel(0);
    Tone.Transport.bpm.value = tempo;
    Tone.Transport.timeSignature = timeSignature;
    this.setMetronome(true, timeSignature);
    Tone.Transport.start();
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  private mergeTiedNotes(notes: NoteData[]): NoteData[] {
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch.localeCompare(b.pitch));
    const merged: NoteData[] = [];
    const skip = new Set<string>();
    for (const note of sorted) {
      if (skip.has(note.id)) continue;
      let totalDur = note.duration;
      let current = note;
      while (true) {
        const end = Math.round((current.start + current.duration) * 1000) / 1000;
        const next = sorted.find(n =>
          !skip.has(n.id) && n.tied === true && n.pitch === note.pitch && !n.isRest && Math.abs(n.start - end) < 0.005
        );
        if (!next) break;
        skip.add(next.id);
        totalDur += next.duration;
        current = next;
      }
      merged.push({ ...note, duration: totalDur });
    }
    return merged;
  }

  scheduleSong(song: SongData, loopEnabled?: boolean, loopStart?: number, loopEnd?: number) {
    Tone.Transport.cancel(0);
    Tone.Transport.bpm.value = song.tempo;
    Tone.Transport.timeSignature = song.timeSignature;

    this.trackSynths.forEach(s => { try { s.dispose(); } catch (_) {} });
    this.trackSynths.clear();
    this.trackChainNodes.forEach(nodes => nodes.forEach(n => { try { n.dispose(); } catch (_) {} }));
    this.trackChainNodes.clear();

    const anySoloed = song.tracks.some(t => t.solo);
    const tempoChanges = song.tempoChanges ?? [];
    const repeats = song.repeats ?? [];

    song.tracks.forEach(track => {
      const preset = track.instrument;
      if (preset !== 'piano') {
        const { synth, chain } = makeInstrument(preset);
        chain.connect(this.masterBus!);
        this.trackSynths.set(track.id, synth);
        this.trackChainNodes.set(track.id, chain !== synth ? [chain] : []);
      }
    });

    // Schedule tempo changes so the transport BPM stays in sync (affects metronome)
    if (tempoChanges.length) {
      [...tempoChanges].sort((a, b) => a.beat - b.beat).forEach(tc => {
        const time = beatToSeconds(tc.beat, song.tempo, tempoChanges);
        Tone.Transport.schedule((t) => {
          Tone.Transport.bpm.setValueAtTime(tc.bpm, t);
        }, time);
      });
    }

    this.setMetronome(this.isMetronomeEnabled, song.timeSignature);

    song.tracks.forEach(track => {
      // Respect mute / solo
      const audible = !track.muted && (!anySoloed || !!track.solo);
      if (!audible) return;

      const trackVol = track.volume ?? 1;
      const instrument: any = (track.instrument !== 'piano' && this.trackSynths.has(track.id))
        ? this.trackSynths.get(track.id)!
        : (this.sampler && this.sampler.loaded) ? this.sampler : this.fallbackSynth!;

      const hairpins = song.hairpins ?? [];
      const notes = this.mergeTiedNotes(expandNotesForRepeats(track.notes, repeats, song.voltas ?? [], song.timeSignature[0] * (4 / song.timeSignature[1])));

      notes.forEach(note => {
        if (note.isRest) return;
        const startSec = beatToSeconds(note.start, song.tempo, tempoChanges);
        const bpm = bpmAtBeat(note.start, song.tempo, tempoChanges);
        const durationSecs = note.duration * (60 / bpm);
        const baseVel = DYNAMIC_VELOCITY[note.dynamic ?? 'mf'] ?? 0.65;
        const artVel = note.articulation ? (ARTICULATION_VEL[note.articulation] ?? 1.0) : 1.0;
        const artDur = note.articulation ? (ARTICULATION_DUR[note.articulation] ?? 1.0) : 1.0;
        const hairpinMul = getHairpinVelocityMultiplier(note.start, hairpins);
        const velocity = Math.min(1, baseVel * artVel * hairpinMul * trackVol);
        const playDuration = durationSecs * artDur;

        // Grace note: schedule a short note slightly before the main note
        if (note.graceNote) {
          const graceDur = Math.min(0.1, durationSecs * 0.15);
          const graceStart = Math.max(0, startSec - graceDur);
          Tone.Transport.schedule((time) => {
            try {
              instrument.triggerAttackRelease(note.graceNote!.pitch, graceDur, time, velocity * 0.8);
            } catch (_) {}
          }, graceStart);
        }

        const ottava = (song.ottava ?? []).find(
          o => note.start >= o.startBeat && note.start < o.endBeat
        );
        const playedPitch = ottava
          ? transposeNote(note.pitch, ottava.type === '8va' ? 12 : -12)
          : note.pitch;

        Tone.Transport.schedule((time) => {
          try {
            instrument.triggerAttackRelease(playedPitch, playDuration, time, velocity);
          } catch (_) {}
          Tone.Draw.schedule(() => { this.onNotePlay?.(note.pitch); }, time);
          Tone.Draw.schedule(() => { this.onNoteStop?.(note.pitch); }, time + durationSecs);
        }, startSec);
      });
    });

    if (loopEnabled && loopStart !== undefined && loopEnd !== undefined) {
      Tone.Transport.loop = true;
      Tone.Transport.loopStart = beatToSeconds(loopStart, song.tempo, tempoChanges);
      Tone.Transport.loopEnd = beatToSeconds(loopEnd, song.tempo, tempoChanges);
    } else {
      Tone.Transport.loop = false;
    }
  }

  play(song: SongData, loopEnabled?: boolean, loopStart?: number, loopEnd?: number, startBeat = 0) {
    if (!this.initialized) return;
    if (Tone.Transport.state !== 'started') {
      this.scheduleSong(song, loopEnabled, loopStart, loopEnd);
      const offsetSecs = startBeat > 0
        ? beatToSeconds(startBeat, song.tempo, song.tempoChanges ?? [])
        : 0;
      Tone.Transport.start(Tone.now(), offsetSecs > 0 ? offsetSecs : undefined);
    }
  }

  stop() {
    if (!this.initialized) return;
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    Tone.Transport.loop = false;
    this.trackSynths.forEach(s => { try { s.dispose(); } catch (_) {} });
    this.trackSynths.clear();
    this.trackChainNodes.forEach(nodes => nodes.forEach(n => { try { n.dispose(); } catch (_) {} }));
    this.trackChainNodes.clear();
  }

  setTempo(tempo: number) {
    Tone.Transport.bpm.value = tempo;
  }

  setVolume(value: number) {
    const db = value === 0 ? -Infinity : 20 * Math.log10(value);
    Tone.getDestination().volume.value = db;
  }

  get currentBeat(): number {
    if (!this.initialized || Tone.Transport.state !== 'started') return -1;
    return Tone.Transport.ticks / Tone.Transport.PPQ;
  }
}

export const audio = new AudioEngine();
