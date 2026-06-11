import * as Tone from 'tone';
import { SongData, InstrumentPreset, EffectsSettings } from '../types';

const DYNAMIC_VELOCITY: Record<string, number> = {
  pp: 0.15, p: 0.3, mp: 0.5, mf: 0.65, f: 0.8, ff: 1.0,
};

// ── Instrument factory ────────────────────────────────────────────────────────
// Returns { synth, chain } where synth is the playable node and chain is the
// last node in any instrument-specific effects chain (connect chain → masterBus).

function makeInstrument(preset: InstrumentPreset): { synth: any; chain: Tone.ToneAudioNode } {
  switch (preset) {
    case 'guitar': {
      // PluckSynth (Karplus-Strong) — cannot go in PolySynth because it extends
      // Instrument, not Synth. Use a round-robin voice pool instead.
      const NUM_VOICES = 6;
      const voices = Array.from({ length: NUM_VOICES }, () =>
        new Tone.PluckSynth({ attackNoise: 1.5, dampening: 4500, resonance: 0.97 } as any)
      );
      const gain = new Tone.Gain(1);
      voices.forEach(v => v.connect(gain));
      let vi = 0;
      const synth = {
        triggerAttack: (note: string | string[], time?: any) => {
          const notes = Array.isArray(note) ? note : [note];
          notes.forEach(n => { voices[vi % NUM_VOICES].triggerAttack(n, time ?? Tone.now()); vi++; });
        },
        triggerRelease: (_note?: any) => {},
        triggerAttackRelease: (note: string | string[], _dur?: any, time?: any, _vel?: any) => {
          const notes = Array.isArray(note) ? note : [note];
          notes.forEach(n => { voices[vi % NUM_VOICES].triggerAttack(n, time ?? Tone.now()); vi++; });
        },
        dispose: () => { voices.forEach(v => { try { v.dispose(); } catch (_) {} }); gain.dispose(); },
      };
      return { synth, chain: gain };
    }
    case 'strings': {
      // AMSynth with slow attack + chorus + short reverb for lush strings
      const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.6 }).start();
      const reverb = new Tone.Freeverb({ roomSize: 0.75, dampening: 4000 });
      const synth = new Tone.PolySynth(Tone.AMSynth as any, {
        harmonicity: 1.5,
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.45, decay: 0.1, sustain: 0.9, release: 2.0 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 2 },
      } as any);
      synth.connect(chorus);
      chorus.connect(reverb);
      return { synth, chain: reverb };
    }
    case 'brass': {
      // FMSynth for a bright metallic brass timbre
      const dist = new Tone.Distortion({ distortion: 0.12, wet: 0.35 });
      const synth = new Tone.PolySynth(Tone.FMSynth as any, {
        harmonicity: 2,
        modulationIndex: 4,
        oscillator: { type: 'square' },
        envelope: { attack: 0.08, decay: 0.2, sustain: 0.75, release: 0.5 },
        modulation: { type: 'sawtooth' },
        modulationEnvelope: { attack: 0.1, decay: 0.15, sustain: 0.5, release: 0.5 },
      } as any);
      synth.connect(dist);
      return { synth, chain: dist };
    }
    case 'bass': {
      // Heavy low-pass filtered synth for electric bass
      const filter = new Tone.Filter({ frequency: 600, type: 'lowpass', rolloff: -24 });
      const synth = new Tone.PolySynth(Tone.Synth as any, {
        oscillator: { type: 'triangle8' },
        envelope: { attack: 0.04, decay: 0.35, sustain: 0.7, release: 0.5 },
      } as any);
      synth.connect(filter);
      return { synth, chain: filter };
    }
    case 'flute': {
      // Sine with vibrato for a breathy flute sound
      const vibrato = new Tone.Vibrato({ frequency: 5.5, depth: 0.15 });
      const reverb = new Tone.Freeverb({ roomSize: 0.5, dampening: 6000 });
      const synth = new Tone.PolySynth(Tone.Synth as any, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.2, decay: 0.05, sustain: 0.95, release: 0.8 },
      } as any);
      synth.connect(vibrato);
      vibrato.connect(reverb);
      return { synth, chain: reverb };
    }
    case 'organ': {
      // FMSynth tuned for a Hammond drawbar-style organ sound
      const chorus = new Tone.Chorus({ frequency: 3, delayTime: 3.5, depth: 0.4 }).start();
      const synth = new Tone.PolySynth(Tone.FMSynth as any, {
        harmonicity: 1,
        modulationIndex: 1,
        oscillator: { type: 'square' },
        envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.1 },
        modulation: { type: 'square' },
        modulationEnvelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.1 },
      } as any);
      synth.connect(chorus);
      return { synth, chain: chorus };
    }
    case 'synth': {
      // Classic polysynth — sawtooth with mild PWM for animation
      const synth = new Tone.PolySynth(Tone.Synth as any, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.02, decay: 0.15, sustain: 0.6, release: 1.0 },
      } as any);
      return { synth, chain: synth };
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
  private realtimeNoteSynth = new Map<string, 'sampler' | 'fallback'>();
  private realtimeFallback: Tone.PolySynth | null = null;
  private initPromise: Promise<void> | null = null;
  private midiActivePitches = new Set<string>();

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

        (this.fxFuzz as any).wet.value = 0;

        // Chain in series: masterBus → fuzz → overdrive → phaser → chorus → flanger → tremolo → delay → reverb → dest
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

  playNoteRealtime(pitch: string) {
    if (!this.initialized) return;
    if (this.pendingReleases.has(pitch)) {
      this.pendingReleases.delete(pitch);
      return;
    }
    if (this.realtimeNotes.has(pitch)) this._releaseRealtimeNote(pitch);
    this.realtimeNotes.add(pitch);
    if (this.sampler) {
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
    if (synthType === 'sampler') {
      try { this.sampler?.triggerRelease(pitch); } catch (_) {}
    } else {
      try { this.realtimeFallback?.triggerRelease(pitch); } catch (_) {}
    }
  }

  // ── MIDI keyboard ─────────────────────────────────────────────────────────

  playMidiNote(pitch: string) {
    if (!this.initialized || !this.sampler) return;
    if (this.midiActivePitches.has(pitch)) {
      try { this.sampler.triggerRelease(pitch, Tone.now()); } catch (_) {}
    }
    this.midiActivePitches.add(pitch);
    this.sampler.triggerAttack(pitch, Tone.now() + 0.015, 0.8);
  }

  stopMidiNote(pitch: string) {
    if (!this.initialized || !this.sampler) return;
    this.midiActivePitches.delete(pitch);
    try { this.sampler.triggerRelease(pitch, Tone.now() + 0.015); } catch (_) {}
  }

  releaseAllMidiNotes() {
    if (!this.sampler) return;
    const now = Tone.now();
    this.midiActivePitches.forEach(pitch => {
      try { this.sampler!.triggerRelease(pitch, now); } catch (_) {}
    });
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
      const beatsPerBar = timeSignature[0];
      let beat = 0;
      this.metronomeLoop = new Tone.Loop((time) => {
        if (beat % beatsPerBar === 0) {
          this.metronomeSynth!.triggerAttackRelease("C6", "32n", time, 1);
        } else {
          this.metronomeSynth!.triggerAttackRelease("G5", "32n", time, 0.5);
        }
        beat++;
      }, "4n");
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

  scheduleSong(song: SongData, loopEnabled?: boolean, loopStart?: number, loopEnd?: number) {
    Tone.Transport.cancel(0);
    Tone.Transport.bpm.value = song.tempo;
    Tone.Transport.timeSignature = song.timeSignature;

    this.trackSynths.forEach(s => { try { s.dispose(); } catch (_) {} });
    this.trackSynths.clear();
    this.trackChainNodes.forEach(nodes => nodes.forEach(n => { try { n.dispose(); } catch (_) {} }));
    this.trackChainNodes.clear();

    song.tracks.forEach(track => {
      const preset = track.instrument;
      if (preset !== 'piano') {
        const { synth, chain } = makeInstrument(preset);
        chain.connect(this.masterBus!);
        this.trackSynths.set(track.id, synth);
        // track intermediate nodes only when chain !== synth
        this.trackChainNodes.set(track.id, chain !== synth ? [chain] : []);
      }
    });

    this.setMetronome(this.isMetronomeEnabled, song.timeSignature);

    song.tracks.forEach(track => {
      const instrument: any = (track.instrument !== 'piano' && this.trackSynths.has(track.id))
        ? this.trackSynths.get(track.id)!
        : (this.sampler && this.sampler.loaded) ? this.sampler : this.fallbackSynth!;

      track.notes.forEach(note => {
        if (note.isRest) return;
        const bars = Math.floor(note.start / song.timeSignature[0]);
        const beats = Math.floor(note.start % song.timeSignature[0]);
        const sixteenths = Math.round((note.start % 1) * 4);
        const startTime = `${bars}:${beats}:${sixteenths}`;
        const durationSecs = note.duration * (60 / song.tempo);
        const velocity = DYNAMIC_VELOCITY[note.dynamic ?? 'mf'] ?? 0.65;
        const playDuration = note.articulation === 'staccato' ? durationSecs * 0.45 : durationSecs;

        Tone.Transport.schedule((time) => {
          try {
            instrument.triggerAttackRelease(note.pitch, playDuration, time, velocity);
          } catch (_) {}
          Tone.Draw.schedule(() => { this.onNotePlay?.(note.pitch); }, time);
          Tone.Draw.schedule(() => { this.onNoteStop?.(note.pitch); }, time + durationSecs);
        }, startTime);
      });
    });

    if (loopEnabled && loopStart !== undefined && loopEnd !== undefined) {
      Tone.Transport.loop = true;
      Tone.Transport.loopStart = loopStart * (60 / song.tempo);
      Tone.Transport.loopEnd = loopEnd * (60 / song.tempo);
    } else {
      Tone.Transport.loop = false;
    }
  }

  play(song: SongData, loopEnabled?: boolean, loopStart?: number, loopEnd?: number) {
    if (!this.initialized) return;
    if (Tone.Transport.state !== 'started') {
      this.scheduleSong(song, loopEnabled, loopStart, loopEnd);
      Tone.Transport.start();
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
}

export const audio = new AudioEngine();
