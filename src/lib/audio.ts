import * as Tone from 'tone';
import { SongData, InstrumentPreset } from '../types';

const PRESETS: Record<InstrumentPreset, object> = {
  piano:   { oscillator: { type: 'triangle' },  envelope: { attack: 0.01,  decay: 0.3,  sustain: 0.2, release: 1    } },
  guitar:  { oscillator: { type: 'triangle' },  envelope: { attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.6  } },
  strings: { oscillator: { type: 'sawtooth' },  envelope: { attack: 0.4,   decay: 0.1,  sustain: 0.8, release: 1.5  } },
  brass:   { oscillator: { type: 'square' },    envelope: { attack: 0.08,  decay: 0.1,  sustain: 0.7, release: 0.5  } },
  bass:    { oscillator: { type: 'triangle' },  envelope: { attack: 0.05,  decay: 0.2,  sustain: 0.5, release: 0.8  } },
  flute:   { oscillator: { type: 'sine' },      envelope: { attack: 0.12,  decay: 0.05, sustain: 0.9, release: 0.6  } },
  organ:   { oscillator: { type: 'square' },    envelope: { attack: 0.01,  decay: 0,    sustain: 1,   release: 0.15 } },
  synth:   { oscillator: { type: 'sawtooth' },  envelope: { attack: 0.02,  decay: 0.1,  sustain: 0.5, release: 0.8  } },
};

class AudioEngine {
  initialized = false;
  sampler: Tone.Sampler | null = null;
  fallbackSynth: Tone.PolySynth | null = null;
  previewSynth: Tone.PolySynth | null = null;
  metronomeSynth: Tone.Synth | null = null;
  metronomeLoop: Tone.Loop | null = null;
  isMetronomeEnabled = false;
  trackSynths: Map<string, Tone.PolySynth> = new Map();
  realtimeNotes = new Set<string>();
  private pendingReleases = new Set<string>();
  // Dedicated synth for interactive key presses — short release prevents stuck-note tails
  private realtimeSynth: Tone.PolySynth | null = null;
  private initPromise: Promise<void> | null = null;

  onNotePlay?: (pitch: string) => void;
  onNoteStop?: (pitch: string) => void;

  async init() {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await Tone.start();

        this.realtimeSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as any },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.05 }
        }).toDestination();

        this.fallbackSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as any },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 }
        }).toDestination();

        this.previewSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' as any },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 }
        }).toDestination();

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
          release: 1,
          baseUrl: "https://tonejs.github.io/audio/salamander/",
        }).toDestination();

        this.metronomeSynth = new Tone.Synth({
          oscillator: { type: "square" as any },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 }
        }).toDestination();
        this.metronomeSynth.volume.value = -10;

        this.initialized = true;
      })();
    }
    return this.initPromise;
  }

  private getRealtimeInstrument(): Tone.Sampler | Tone.PolySynth {
    return (this.sampler && this.sampler.loaded) ? this.sampler : (this.fallbackSynth!);
  }

  private getSynthForPreset(preset: InstrumentPreset): Tone.PolySynth {
    if (preset === 'piano') return this.fallbackSynth!;
    return new Tone.PolySynth(Tone.Synth, PRESETS[preset] as any).toDestination();
  }

  playNoteRealtime(pitch: string) {
    if (!this.initialized) return;
    if (this.pendingReleases.has(pitch)) {
      this.pendingReleases.delete(pitch);
      return;
    }
    // If the note is already tracked, release it first to avoid double-attack
    if (this.realtimeNotes.has(pitch)) {
      this.realtimeSynth?.triggerRelease(pitch);
    }
    this.realtimeNotes.add(pitch);
    this.realtimeSynth!.triggerAttack(pitch);
  }

  stopNoteRealtime(pitch: string) {
    if (!this.initialized) {
      this.pendingReleases.add(pitch);
      return;
    }
    this.pendingReleases.delete(pitch);
    this.realtimeNotes.delete(pitch);
    this.realtimeSynth?.triggerRelease(pitch);
  }

  playNotePreview(pitch: string, preset?: InstrumentPreset) {
    if (!this.initialized) return;
    if (preset && preset !== 'piano') {
      const synth = this.getSynthForPreset(preset);
      synth.triggerAttackRelease(pitch, "8n");
      setTimeout(() => synth.dispose(), 2000);
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

  scheduleSong(song: SongData, loopEnabled?: boolean, loopStart?: number, loopEnd?: number) {
    Tone.Transport.cancel(0);
    Tone.Transport.bpm.value = song.tempo;
    Tone.Transport.timeSignature = song.timeSignature;

    // Dispose previous per-track synths
    this.trackSynths.forEach(s => s.dispose());
    this.trackSynths.clear();

    // Create per-track synths
    song.tracks.forEach(track => {
      const preset = track.instrument;
      if (preset === 'piano') {
        // piano reuses sampler/fallback — no dedicated synth needed
      } else {
        const synth = new Tone.PolySynth(Tone.Synth, PRESETS[preset] as any).toDestination();
        this.trackSynths.set(track.id, synth);
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

        Tone.Transport.schedule((time) => {
          instrument.triggerAttackRelease(note.pitch, durationSecs, time);
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
    this.trackSynths.forEach(s => s.dispose());
    this.trackSynths.clear();
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
